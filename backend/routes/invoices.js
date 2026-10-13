import { Router } from 'express';
import { getDb, mapInvoice, mapInvoicePayment, generateInvoiceNumber, recordInvoicePayment } from '../db.js';
import { requirePerm, requireAnyPerm } from '../auth.js';
import { enqueueSync } from '../../sync-engine/outbox.js';

const router = Router();

// Credit invoices (bill-now, pay-later) — distinct from the Till's immediate-payment flow.
// Gated by perm_invoices; id === 1 / admin / tech still always pass via requirePerm's own
// super-admin/full-access rule (see auth.js), same as every other perm-gated route.

router.get('/', requirePerm('perm_invoices'), (req, res) => {
  const db = getDb();
  const { status, customerId } = req.query;
  let sql = 'SELECT * FROM invoices';
  const clauses = [];
  const params = [];
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  if (customerId) {
    clauses.push('customer_id = ?');
    params.push(parseInt(customerId, 10));
  }
  if (clauses.length) sql += ` WHERE ${clauses.join(' AND ')}`;
  sql += ' ORDER BY created_at DESC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(mapInvoice));
});

// Overdue = still owing (unpaid/partial) and past its due date — the one query the Analytics/
// Invoices view needs most, so it gets its own route rather than making the frontend filter
// client-side across every invoice.
router.get('/overdue', requirePerm('perm_invoices'), (_req, res) => {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const rows = db
    .prepare(
      `SELECT * FROM invoices
       WHERE status IN ('unpaid', 'partial') AND due_date IS NOT NULL AND due_date < ?
       ORDER BY due_date ASC`
    )
    .all(today);
  res.json(rows.map(mapInvoice));
});

router.get('/customer/:customerId', requirePerm('perm_invoices'), (req, res) => {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM invoices WHERE customer_id = ? ORDER BY created_at DESC')
    .all(parseInt(req.params.customerId, 10));
  res.json(rows.map(mapInvoice));
});

router.get('/:id', requirePerm('perm_invoices'), (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(parseInt(req.params.id, 10));
  if (!row) return res.status(404).json({ error: 'Invoice not found' });
  res.json(mapInvoice(row));
});

router.get('/:id/payments', requirePerm('perm_invoices'), (req, res) => {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY paid_at ASC')
    .all(parseInt(req.params.id, 10));
  res.json(rows.map(mapInvoicePayment));
});

// Creates a credit invoice — either standalone (e.g. a pre-order, a corporate bill raised
// without a till sale) or linked to an existing paid-in-full till transaction (transactionId)
// so staff can hand a client a formal invoice document for a sale that's already gone through
// the register. Either way the invoice itself always starts 'unpaid' with its own balance —
// linking does not imply the invoice is paid; that only happens via recordInvoicePayment.
router.post('/', requirePerm('perm_invoices'), (req, res) => {
  const db = getDb();
  const body = req.body || {};
  const customerId = parseInt(body.customerId, 10);
  if (!customerId) return res.status(400).json({ error: 'customerId is required' });

  const items = Array.isArray(body.items) ? body.items : [];
  const subtotal = Number(body.subtotal) || 0;
  const discount = Number(body.discount) || 0;
  const tax = Number(body.tax) || 0;
  const total = Number(body.total) || Math.max(subtotal - discount + tax, 0);
  if (total <= 0) return res.status(400).json({ error: 'total must be greater than 0' });

  const invoiceNumber = generateInvoiceNumber(db);
  const now = new Date().toISOString();
  const issuedDate = body.issuedDate || now.slice(0, 10);

  const result = db
    .prepare(
      `INSERT INTO invoices
        (invoice_number, customer_id, transaction_id, subtotal, discount, tax, total,
         amount_paid, balance, status, items_json, notes, issued_date, due_date, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'unpaid', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      invoiceNumber,
      customerId,
      body.transactionId ? parseInt(body.transactionId, 10) : null,
      subtotal,
      discount,
      tax,
      total,
      total,
      JSON.stringify(items),
      body.notes || '',
      issuedDate,
      body.dueDate || null,
      req.user?.id || null,
      now
    );

  const invoice = mapInvoice(db.prepare('SELECT * FROM invoices WHERE id = ?').get(result.lastInsertRowid));
  enqueueSync(db, 'invoices', invoice.invoice_number, 'create', invoice);
  res.json(invoice);
});

// Records a payment (full or partial) against an invoice. Accepts any of the existing payment
// methods, including 'mpesa' — if the client pays an outstanding invoice via M-Pesa, record the
// resulting payments.reference here so the invoice payment and the M-Pesa transaction can be
// cross-referenced, but this route itself does not call the M-Pesa gateway: that happens
// through POST /api/payments/initiate as normal, and the reference it returns is passed in here
// once the gateway confirms success — an invoice is never marked paid on an unconfirmed charge,
// same rule as the Till.
router.post('/:id/payments', requireAnyPerm('perm_invoices', 'perm_transactions'), (req, res) => {
  const db = getDb();
  const invoiceId = parseInt(req.params.id, 10);
  const amount = Number(req.body?.amount);
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }

  try {
    const invoice = recordInvoicePayment(db, {
      invoiceId,
      amount,
      method: req.body?.method || 'cash',
      reference: req.body?.reference || '',
      notes: req.body?.notes || '',
      recordedBy: req.user?.id || null,
    });
    enqueueSync(db, 'invoices', invoice.invoice_number, 'update', invoice);
    res.json(invoice);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/void', requirePerm('perm_invoices'), (req, res) => {
  const db = getDb();
  const invoiceId = parseInt(req.params.id, 10);
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.amount_paid > 0) {
    return res
      .status(400)
      .json({ error: 'Cannot void an invoice with payments recorded against it — refund the payments first' });
  }
  db.prepare("UPDATE invoices SET status = 'void' WHERE id = ?").run(invoiceId);
  const updated = mapInvoice(db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId));
  enqueueSync(db, 'invoices', updated.invoice_number, 'update', updated);
  res.json(updated);
});

export default router;
