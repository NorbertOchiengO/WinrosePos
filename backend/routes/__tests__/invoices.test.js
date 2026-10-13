import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { createServer } from '../../index.js';

async function setupApp() {
  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const dbPath = path.join(os.tmpdir(), `inv-test-${suffix}.db`);
  const uploadsPath = path.join(os.tmpdir(), `inv-test-uploads-${suffix}`);
  const app = await createServer({ dbPath, uploadsPath, jwtSecret: 'inv-test-secret' });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dbPath, { force: true });
      fs.rmSync(`${dbPath}.key`, { force: true });
      fs.rmSync(uploadsPath, { recursive: true, force: true });
    },
  };
}

async function req(base, token, method, urlPath, body) {
  const res = await fetch(`${base}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function login(base, username, password) {
  const r = await req(base, null, 'POST', '/api/users/login', { username, password });
  assert.equal(r.status, 200, `login failed: ${JSON.stringify(r.json)}`);
  return r.json;
}

async function createCustomer(base, token, name) {
  const r = await req(base, token, 'POST', '/api/customers/customer', { name });
  assert.ok(r.status === 200, `create customer failed: ${JSON.stringify(r.json)}`);
  return r.json;
}

test('seeded admin is flagged must_change_password, and change-password clears it', async () => {
  const app = await setupApp();
  try {
    const { token, user } = await login(app.base, 'admin', 'admin');
    assert.equal(user.must_change_password, true);

    const tooShort = await req(app.base, token, 'POST', '/api/users/change-password', { newPassword: 'short' });
    assert.equal(tooShort.status, 400);

    const ok = await req(app.base, token, 'POST', '/api/users/change-password', { newPassword: 'a-much-better-password' });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.must_change_password, false);

    // old password no longer works, new one does
    const oldRes = await req(app.base, null, 'POST', '/api/users/login', { username: 'admin', password: 'admin' });
    assert.notEqual(oldRes.status, 200);
    const fresh = await login(app.base, 'admin', 'a-much-better-password');
    assert.equal(fresh.user.must_change_password, false);

    // once the flag is clear, the current password is required to change it again
    const noCurrent = await req(app.base, fresh.token, 'POST', '/api/users/change-password', { newPassword: 'another-good-one' });
    assert.equal(noCurrent.status, 401);
  } finally {
    await app.close();
  }
});

test('invoice lifecycle: create, partial payment, full payment, overpay rejected, void rules', async () => {
  const app = await setupApp();
  try {
    const { token } = await login(app.base, 'admin', 'admin');
    const customer = await createCustomer(app.base, token, 'Acme Clinic');

    const created = await req(app.base, token, 'POST', '/api/invoices', {
      customerId: customer.id,
      items: [{ name: 'Paracetamol 500mg', quantity: 10, price: 50 }],
      subtotal: 500,
      total: 500,
      dueDate: '2000-01-01',
    });
    assert.equal(created.status, 200);
    assert.match(created.json.invoice_number, /^INV-\d{4}-0001$/);
    assert.equal(created.json.status, 'unpaid');
    assert.equal(created.json.balance, 500);

    // second invoice gets the next sequence number
    const second = await req(app.base, token, 'POST', '/api/invoices', {
      customerId: customer.id, items: [{ name: 'X', quantity: 1, price: 100 }], subtotal: 100, total: 100,
    });
    assert.match(second.json.invoice_number, /-0002$/);

    // past due date + unpaid => shows up as overdue
    const overdue = await req(app.base, token, 'GET', '/api/invoices/overdue');
    assert.deepEqual(overdue.json.map((i) => i.id), [created.json.id]);

    const partial = await req(app.base, token, 'POST', `/api/invoices/${created.json.id}/payments`, {
      amount: 200, method: 'mpesa', reference: 'NLJ7RT61SV',
    });
    assert.equal(partial.status, 200);
    assert.equal(partial.json.status, 'partial');
    assert.equal(partial.json.balance, 300);

    // a partly-paid invoice can't be voided
    const voidPartial = await req(app.base, token, 'POST', `/api/invoices/${created.json.id}/void`);
    assert.equal(voidPartial.status, 400);

    // overpaying the remaining balance is rejected and leaves the invoice untouched
    const over = await req(app.base, token, 'POST', `/api/invoices/${created.json.id}/payments`, { amount: 300.5 });
    assert.equal(over.status, 400);
    assert.match(over.json.error, /exceeds/);

    const paid = await req(app.base, token, 'POST', `/api/invoices/${created.json.id}/payments`, { amount: 300 });
    assert.equal(paid.json.status, 'paid');
    assert.equal(paid.json.balance, 0);

    const payAgain = await req(app.base, token, 'POST', `/api/invoices/${created.json.id}/payments`, { amount: 1 });
    assert.equal(payAgain.status, 400);

    const history = await req(app.base, token, 'GET', `/api/invoices/${created.json.id}/payments`);
    assert.equal(history.json.length, 2);
    assert.equal(history.json[0].reference, 'NLJ7RT61SV');

    // paid invoices are no longer overdue
    const overdueAfter = await req(app.base, token, 'GET', '/api/invoices/overdue');
    assert.equal(overdueAfter.json.length, 0);

    // an unpaid invoice can be voided, and then accepts no payments
    const voided = await req(app.base, token, 'POST', `/api/invoices/${second.json.id}/void`);
    assert.equal(voided.json.status, 'void');
    const payVoid = await req(app.base, token, 'POST', `/api/invoices/${second.json.id}/payments`, { amount: 10 });
    assert.equal(payVoid.status, 400);
  } finally {
    await app.close();
  }
});

test('invoice creation validates input', async () => {
  const app = await setupApp();
  try {
    const { token } = await login(app.base, 'admin', 'admin');
    const noCustomer = await req(app.base, token, 'POST', '/api/invoices', { items: [], total: 10 });
    assert.equal(noCustomer.status, 400);

    const customer = await createCustomer(app.base, token, 'Zero Co');
    const zeroTotal = await req(app.base, token, 'POST', '/api/invoices', { customerId: customer.id, items: [], total: 0 });
    assert.equal(zeroTotal.status, 400);

    const badPay = await req(app.base, token, 'POST', '/api/invoices/999/payments', { amount: -5 });
    assert.equal(badPay.status, 400);
  } finally {
    await app.close();
  }
});

test('perm_invoices gates the invoices API for non-admin users', async () => {
  const app = await setupApp();
  try {
    const { token: adminToken } = await login(app.base, 'admin', 'admin');

    const mk = (username, perm_invoices) =>
      req(app.base, adminToken, 'POST', '/api/users/post', {
        username, password: 'cashier-pass-1', fullname: username, role: 'cashier', perm_invoices,
      });
    assert.equal((await mk('with_inv', true)).status, 200);
    assert.equal((await mk('without_inv', false)).status, 200);

    const withInv = await login(app.base, 'with_inv', 'cashier-pass-1');
    assert.equal(withInv.user.must_change_password, true); // admin-created accounts must set their own password
    assert.equal(withInv.user.perm_invoices, 1);
    const without = await login(app.base, 'without_inv', 'cashier-pass-1');

    assert.equal((await req(app.base, withInv.token, 'GET', '/api/invoices')).status, 200);
    assert.equal((await req(app.base, without.token, 'GET', '/api/invoices')).status, 403);
    assert.equal((await req(app.base, null, 'GET', '/api/invoices')).status, 401);
  } finally {
    await app.close();
  }
});
