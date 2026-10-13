import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { initDatabase, getDb } from './backend/db.js';
import { hashPassword } from './backend/auth.js';

const rl = readline.createInterface({ input: stdin, output: stdout });

try {
  const dbPath = process.argv[2];

  if (!dbPath || !fs.existsSync(dbPath)) {
    throw new Error(
      'Pass the full path to your existing pos.sqlite database.'
    );
  }

  const keyPath = `${dbPath}.key`;

  if (!fs.existsSync(keyPath)) {
    throw new Error(
      'Encryption key not found. Stop here; do not create a new key.'
    );
  }

  const backupDir = `${dbPath}.backup-${Date.now()}`;
  fs.mkdirSync(backupDir, { recursive: true });

  fs.copyFileSync(dbPath, path.join(backupDir, 'pos.sqlite'));
  fs.copyFileSync(keyPath, path.join(backupDir, 'pos.sqlite.key'));

  const password = await rl.question(
    'Enter your new admin password (minimum 12 characters): '
  );

  if (password.length < 12) {
    throw new Error('Password must be at least 12 characters.');
  }

  const confirm = await rl.question('Confirm new password: ');

  if (password !== confirm) {
    throw new Error('Passwords do not match.');
  }

  await initDatabase(dbPath);

  const db = getDb();

  const admin = db.prepare(
    'SELECT id FROM users WHERE username = ?'
  ).get('admin');

  if (!admin) {
    throw new Error('Admin user not found. No user was changed.');
  }

  db.prepare(
    'UPDATE users SET password = ?, must_change_password = 0 WHERE id = ?'
  ).run(hashPassword(password), admin.id);

  console.log('Admin password reset successfully.');
  console.log('Backup saved at:', backupDir);
} catch (error) {
  console.error('Reset failed:', error.message);
  process.exitCode = 1;
} finally {
  rl.close();
}