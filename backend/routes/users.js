import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { getDb, mapUser } from '../db.js';
import {
  authenticate,
  requirePerm,
  loginUser,
  signToken,
  hashPassword,
} from '../auth.js';

const router = Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  let user;
  try {
    user = loginUser(username, password);
  } catch (err) {
    if (err.code === 'LOGIN_LOCKED_OUT') {
      return res.status(429).json({ error: err.message, lockedUntil: err.lockedUntil });
    }
    throw err;
  }
  if (!user) {
    return res.status(401).json({ error: 'Incorrect username or password' });
  }
  const token = signToken(user);
  res.json({ user, token });
});

router.get('/check', (_req, res) => {
  const admin = getDb().prepare('SELECT id FROM users WHERE id = 1').get();
  res.json({ ready: !!admin });
});

router.use(authenticate);

// SECURITY (hardening pass): self-service password change. Any authenticated user may change
// only their own password (no perm_users required — that permission governs managing *other*
// accounts, not your own credentials) — req.user.id comes from the verified JWT, never the
// request body, so this can't be used to change someone else's password. This is what clears
// must_change_password after the forced first-login change (see login route below).
router.post('/change-password', (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!row) return res.status(404).json({ error: 'User not found' });

  // Skip the current-password check only for a first-login forced change where the account
  // still has no usable password set up any differently — in every other case the caller must
  // prove they know the current password before setting a new one.
  if (!row.must_change_password) {
    if (!currentPassword || !bcrypt.compareSync(currentPassword, row.password)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
  }

  db.prepare('UPDATE users SET password = ?, must_change_password = 0 WHERE id = ?').run(
    hashPassword(newPassword),
    row.id
  );
  res.json(mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(row.id)));
});

router.get('/user/:userId', (req, res) => {
  const row = getDb()
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(parseInt(req.params.userId, 10));
  res.json(mapUser(row));
});

router.get('/logout/:userId', (req, res) => {
  getDb()
    .prepare('UPDATE users SET status = ? WHERE id = ?')
    .run(`Logged Out_${new Date().toISOString()}`, parseInt(req.params.userId, 10));
  res.sendStatus(200);
});

router.get('/all', requirePerm('perm_users'), (_req, res) => {
  const rows = getDb().prepare('SELECT * FROM users ORDER BY id').all();
  res.json(rows.map(mapUser));
});

router.delete(
  '/user/:userId',
  requirePerm('perm_users'),
  (req, res) => {
    const id = parseInt(req.params.userId, 10);
    if (id === 1) {
      return res.status(400).json({ error: 'Cannot delete the default admin' });
    }
    getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
    res.sendStatus(200);
  }
);

router.post('/post', requirePerm('perm_users'), (req, res) => {
  const body = req.body || {};
  const perms = {
    perm_products: body.perm_products ? 1 : 0,
    perm_categories: body.perm_categories ? 1 : 0,
    perm_transactions: body.perm_transactions ? 1 : 0,
    perm_users: body.perm_users ? 1 : 0,
    perm_settings: body.perm_settings ? 1 : 0,
    perm_discount_approve: body.perm_discount_approve ? 1 : 0,
    perm_refund_void: body.perm_refund_void ? 1 : 0,
    perm_controlled_approve: body.perm_controlled_approve ? 1 : 0,
    perm_price_override: body.perm_price_override ? 1 : 0,
    perm_invoices: body.perm_invoices ? 1 : 0,
  };
  const role = ['cashier', 'pharmacist', 'manager', 'admin', 'tech'].includes(body.role)
    ? body.role
    : 'cashier';

  if (!body.id) {
    const result = getDb()
      .prepare(
        `INSERT INTO users (
          username, password, fullname, role,
          perm_products, perm_categories, perm_transactions, perm_users, perm_settings,
          perm_discount_approve, perm_refund_void, perm_controlled_approve, perm_price_override,
          perm_invoices, must_change_password
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
      )
      .run(
        body.username,
        hashPassword(body.password || 'password'),
        body.fullname || '',
        role,
        perms.perm_products,
        perms.perm_categories,
        perms.perm_transactions,
        perms.perm_users,
        perms.perm_settings,
        perms.perm_discount_approve,
        perms.perm_refund_void,
        perms.perm_controlled_approve,
        perms.perm_price_override,
        perms.perm_invoices
      );
    const row = getDb().prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    return res.json(mapUser(row));
  }

  const id = parseInt(body.id, 10);
  if (body.password) {
    getDb()
      .prepare(
        `UPDATE users SET username = ?, password = ?, fullname = ?, role = ?,
         perm_products = ?, perm_categories = ?, perm_transactions = ?, perm_users = ?, perm_settings = ?,
         perm_discount_approve = ?, perm_refund_void = ?, perm_controlled_approve = ?, perm_price_override = ?,
         perm_invoices = ?, must_change_password = 1
         WHERE id = ?`
      )
      .run(
        body.username,
        hashPassword(body.password),
        body.fullname || '',
        role,
        perms.perm_products,
        perms.perm_categories,
        perms.perm_transactions,
        perms.perm_users,
        perms.perm_settings,
        perms.perm_discount_approve,
        perms.perm_refund_void,
        perms.perm_controlled_approve,
        perms.perm_price_override,
        perms.perm_invoices,
        id
      );
  } else {
    getDb()
      .prepare(
        `UPDATE users SET username = ?, fullname = ?, role = ?,
         perm_products = ?, perm_categories = ?, perm_transactions = ?, perm_users = ?, perm_settings = ?,
         perm_discount_approve = ?, perm_refund_void = ?, perm_controlled_approve = ?, perm_price_override = ?,
         perm_invoices = ?
         WHERE id = ?`
      )
      .run(
        body.username,
        body.fullname || '',
        role,
        perms.perm_products,
        perms.perm_categories,
        perms.perm_transactions,
        perms.perm_users,
        perms.perm_settings,
        perms.perm_discount_approve,
        perms.perm_refund_void,
        perms.perm_controlled_approve,
        perms.perm_price_override,
        perms.perm_invoices,
        id
      );
  }
  res.sendStatus(200);
});

// Verifies a *different* user's credentials + a required permission, without switching the
// caller's session — used for supervisor overrides (e.g. a manager authorizing a cashier's
// above-threshold discount) right at the till.
router.post('/authorize', (req, res) => {
  const { username, password, perm } = req.body || {};
  if (!username || !password || !perm) {
    return res.status(400).json({ error: 'username, password, and perm are required' });
  }
  const user = loginUser(username, password);
  if (!user) {
    return res.status(401).json({ error: 'Incorrect username or password' });
  }
  if (user.id !== 1 && !user[perm]) {
    return res.status(403).json({ error: `${user.fullname || user.username} cannot approve this` });
  }
  res.json({ id: user.id, fullname: user.fullname, username: user.username });
});

export default router;
