import { Router } from 'express';
import { getDb } from '../db.js';
import { getGateway } from '../payments/registry.js';
import {
  createPaymentRecord,
  updatePaymentStatus,
  recordWebhookPayload,
  getPaymentByReference,
  getPaymentByProviderReference,
  getPaymentsForTransaction,
  linkPaymentToTransaction,
  generateReference,
} from '../payments/paymentsStore.js';
import { enqueueSync } from '../../sync-engine/outbox.js';
import { requirePerm } from '../auth.js';

// mobile_money -> mpesa: see registry.js for why (DRAFT/inactive until MPESA_* env vars exist).
const METHOD_PROVIDER = { cash: 'cash', card: 'lenco', mobile_money: 'mpesa' };
const TERMINAL_STATUSES = new Set(['successful', 'failed', 'refunded']);

function enqueuePaymentSync(db, reference, status, extra = {}) {
  enqueueSync(db, 'payments', reference, 'update', {
    reference,
    status,
    updatedAt: new Date().toISOString(),
    ...extra,
  });
}

// Requires payments never appear settled unless a real gateway said so — checkout must never
// silently treat an unconfirmed card/mobile-money charge as paid (Phase 2 ground rule).
function applyStatusUpdate(db, reference, result, extra = {}) {
  const run = db.transaction(() => {
    updatePaymentStatus(db, reference, {
      status: result.status,
      providerReference: result.providerReference,
      reasonForFailure: result.reasonForFailure,
      redirectUrl: result.redirectUrl,
      raw: result.raw,
    });
    enqueuePaymentSync(db, reference, result.status, extra);
  });
  run();
}

// Authenticated routes: initiate/poll/list payments.
const router = Router();

// Lets the checkout UI know whether card/mobile-money can be offered right now — cash is
// always available. Never silently queue a card/mobile-money charge as if it succeeded; this
// is what the checkout flow polls to decide whether to grey those options out.
router.get('/methods', async (_req, res) => {
  let cardReachable = false;
  try {
    cardReachable = await getGateway('card').isReachable();
  } catch {
    cardReachable = false;
  }
  // M-Pesa is a DRAFT integration (see registry.js) — isReachable() correctly returns false
  // via UnconfiguredGateway until MPESA_* env vars are set, so the Till greys out M-Pesa on its
  // own without any extra flag here.
  let mobileMoneyReachable = false;
  try {
    mobileMoneyReachable = await getGateway('mobile_money').isReachable();
  } catch {
    mobileMoneyReachable = false;
  }
  res.json({ cash: true, card: cardReachable, mobile_money: mobileMoneyReachable });
});

router.post('/initiate', async (req, res) => {
  const body = req.body || {};
  const { transactionId, method, currency = 'KES', customer, card, billing, mobileMoney, bearer } = body;
  const amount = parseFloat(body.amount);

  if (!method || !METHOD_PROVIDER[method]) {
    return res.status(400).json({ error: `Unsupported payment method "${method}"` });
  }
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }

  const db = getDb();
  const reference = generateReference();
  const provider = METHOD_PROVIDER[method];

  createPaymentRecord(db, {
    transactionId: transactionId || null,
    provider,
    method,
    reference,
    amount,
    currency,
  });
  enqueuePaymentSync(db, reference, 'pending', { transactionId: transactionId || null, method, amount });

  try {
    const gateway = getGateway(method);
    const result = await gateway.initiatePayment({
      method,
      reference,
      amount,
      currency,
      bearer,
      customer,
      card,
      billing,
      mobileMoney,
    });

    applyStatusUpdate(db, reference, result, { transactionId: transactionId || null, method, amount });

    res.json({
      reference,
      status: result.status,
      redirectUrl: result.redirectUrl || null,
      transactionId: transactionId || null,
    });
  } catch (err) {
    applyStatusUpdate(
      db,
      reference,
      { status: 'failed', reasonForFailure: err.message, raw: { error: err.message } },
      { transactionId: transactionId || null, method, amount }
    );
    res.status(502).json({ error: err.message, reference });
  }
});

router.get('/:reference/status', async (req, res) => {
  const db = getDb();
  const local = getPaymentByReference(db, req.params.reference);
  if (!local) return res.status(404).json({ error: 'Payment not found' });

  if (TERMINAL_STATUSES.has(local.status)) {
    return res.json(local);
  }

  try {
    const gateway = getGateway(local.method);
    // M-Pesa's query endpoint is keyed by Safaricom's own CheckoutRequestID (our stored
    // provider_reference), not our reference — Lenco's checkStatus takes our own reference
    // directly, so this only branches for mobile_money.
    const statusKey = local.method === 'mobile_money' ? local.provider_reference : local.reference;
    const result = statusKey ? await gateway.checkStatus(statusKey) : null;
    if (!result) return res.json(local);
    if (result && result.status !== local.status) {
      applyStatusUpdate(db, local.reference, result, {
        transactionId: local.transaction_id,
        method: local.method,
        amount: local.amount,
      });
    }
    res.json(getPaymentByReference(db, local.reference));
  } catch {
    // Transient poll failure (offline, timeout) — return last known local state instead of
    // erroring the checkout; the caller keeps polling or falls back to cash.
    res.json(local);
  }
});

router.post('/:reference/link', (req, res) => {
  const db = getDb();
  const transactionId = parseInt(req.body?.transactionId, 10);
  if (!transactionId) return res.status(400).json({ error: 'transactionId is required' });

  const payment = getPaymentByReference(db, req.params.reference);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });

  linkPaymentToTransaction(db, req.params.reference, transactionId);
  enqueuePaymentSync(db, req.params.reference, payment.status, { transactionId, linked: true });
  res.json(getPaymentByReference(db, req.params.reference));
});

router.get('/transaction/:transactionId', requirePerm('perm_transactions'), (req, res) => {
  const db = getDb();
  const transactionId = parseInt(req.params.transactionId, 10);
  res.json(getPaymentsForTransaction(db, transactionId));
});

export default router;

// Unauthenticated: Lenco calls this directly, so it's mounted outside the `authenticate`
// middleware in server/index.js (same pattern as /api/health and /api/users).
export const paymentsWebhookRouter = Router();

paymentsWebhookRouter.post('/lenco', async (req, res) => {
  const rawBody = req.rawBody;
  if (!rawBody) {
    return res.status(400).json({ error: 'raw request body unavailable for signature check' });
  }

  try {
    const gateway = getGateway('card');
    const { event, record } = await gateway.handleWebhook(rawBody, req.headers);

    if (record?.reference) {
      const db = getDb();
      const local = getPaymentByReference(db, record.reference);
      if (local) {
        applyStatusUpdate(db, record.reference, record, {
          transactionId: local.transaction_id,
          method: local.method,
          amount: local.amount,
          via: 'webhook',
        });
        recordWebhookPayload(db, record.reference, { event, data: record.raw });
      }
    }

    res.sendStatus(200);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// DRAFT — see backend/payments/mpesa/MpesaGateway.js and registry.js. Inert until MPESA_* env
// vars are set (getGateway('mobile_money') resolves to UnconfiguredGateway otherwise, and
// handleWebhook() on that stub always throws, which falls through to the 500 below — harmless,
// since Safaricom will never be calling this URL before MPESA_CALLBACK_URL exists anyway).
// Safaricom does NOT sign this callback the way Lenco does, so — per the "never trust the
// client" rule — this always re-confirms via gateway.checkStatus() before touching the payment
// record; the callback body alone is never enough to mark a sale paid.
paymentsWebhookRouter.post('/mpesa', async (req, res) => {
  try {
    const gateway = getGateway('mobile_money');
    const { record } = await gateway.handleWebhook(req.body);
    if (!record?.providerReference) return res.sendStatus(200);

    const db = getDb();
    const local = getPaymentByProviderReference(db, record.providerReference);
    if (!local) return res.sendStatus(200); // unknown CheckoutRequestID — ignore, don't error

    // Re-confirm independently rather than trusting the callback body outright.
    const confirmed = await gateway.checkStatus(record.providerReference);

    applyStatusUpdate(db, local.reference, confirmed, {
      transactionId: local.transaction_id,
      method: local.method,
      amount: local.amount,
      via: 'webhook',
    });
    recordWebhookPayload(db, local.reference, { event: 'stkCallback', data: record.raw });

    res.sendStatus(200);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});
