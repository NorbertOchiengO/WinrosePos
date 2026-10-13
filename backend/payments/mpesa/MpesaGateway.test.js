import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MpesaGateway, mapMpesaResultCode } from './MpesaGateway.js';
import { buildStkPassword, daraTimestamp } from './client.js';

// These are unit tests of pure logic only (status mapping, config validation, password
// building) — no live Daraja call is made or mocked here. See client.js/MpesaGateway.js header
// comments: the actual HTTP behavior is unverified against a real sandbox.

const fullConfig = {
  baseUrl: 'https://sandbox.safaricom.co.ke',
  consumerKey: 'key',
  consumerSecret: 'secret',
  shortcode: '174379',
  passkey: 'passkey',
  callbackUrl: 'https://example.com/api/payments/webhook/mpesa',
};

test('mapMpesaResultCode maps 0 to successful', () => {
  assert.equal(mapMpesaResultCode(0), 'successful');
  assert.equal(mapMpesaResultCode('0'), 'successful');
});

test('mapMpesaResultCode maps a missing result code to pending (no callback yet)', () => {
  assert.equal(mapMpesaResultCode(undefined), 'pending');
  assert.equal(mapMpesaResultCode(null), 'pending');
});

test('mapMpesaResultCode maps any non-zero code to failed (errors and user cancellation alike)', () => {
  assert.equal(mapMpesaResultCode(1), 'failed');
  assert.equal(mapMpesaResultCode(1032), 'failed'); // Daraja's "request cancelled by user"
});

test('buildStkPassword base64-encodes shortcode + passkey + timestamp, in that order', () => {
  const password = buildStkPassword({ shortcode: '174379', passkey: 'secret', timestamp: '20260101120000' });
  assert.equal(password, Buffer.from('174379secret20260101120000').toString('base64'));
});

test('daraTimestamp formats as YYYYMMDDHHmmss with zero-padding', () => {
  const ts = daraTimestamp(new Date(2026, 0, 5, 9, 3, 7)); // Jan 5 2026, 09:03:07
  assert.equal(ts, '20260105090307');
});

test('MpesaGateway constructs when fully configured', () => {
  assert.doesNotThrow(() => new MpesaGateway(fullConfig));
});

test('MpesaGateway throws a clear error when shortcode/passkey are missing', () => {
  assert.throws(
    () => new MpesaGateway({ ...fullConfig, shortcode: '', passkey: '' }),
    /MPESA_SHORTCODE/
  );
});

test('MpesaGateway throws a clear error when the callback URL is missing', () => {
  assert.throws(() => new MpesaGateway({ ...fullConfig, callbackUrl: '' }), /MPESA_CALLBACK_URL/);
});

test('MpesaGateway throws from the underlying client when consumer key/secret are missing', () => {
  assert.throws(
    () => new MpesaGateway({ ...fullConfig, consumerKey: '', consumerSecret: '' }),
    /MPESA_CONSUMER_KEY/
  );
});

test('handleWebhook parses a successful STK callback and extracts the receipt metadata', async () => {
  const gateway = new MpesaGateway(fullConfig);
  const callback = {
    Body: {
      stkCallback: {
        MerchantRequestID: 'abc',
        CheckoutRequestID: 'ws_CO_123',
        ResultCode: 0,
        ResultDesc: 'The service request is processed successfully.',
        CallbackMetadata: {
          Item: [
            { Name: 'Amount', Value: 500 },
            { Name: 'MpesaReceiptNumber', Value: 'NLJ7RT61SV' },
            { Name: 'TransactionDate', Value: 20260105090307 },
            { Name: 'PhoneNumber', Value: 254712345678 },
          ],
        },
      },
    },
  };

  const { event, record } = await gateway.handleWebhook(callback);
  assert.equal(event, 'payment.successful');
  assert.equal(record.status, 'successful');
  assert.equal(record.providerReference, 'ws_CO_123');
  assert.equal(record.mpesaReceiptNumber, 'NLJ7RT61SV');
});

test('handleWebhook parses a cancelled/failed STK callback with no metadata', async () => {
  const gateway = new MpesaGateway(fullConfig);
  const callback = {
    Body: {
      stkCallback: {
        MerchantRequestID: 'abc',
        CheckoutRequestID: 'ws_CO_456',
        ResultCode: 1032,
        ResultDesc: 'Request cancelled by user.',
      },
    },
  };

  const { event, record } = await gateway.handleWebhook(callback);
  assert.equal(event, 'payment.failed');
  assert.equal(record.status, 'failed');
});

test('handleWebhook rejects a payload that does not look like an STK callback', async () => {
  const gateway = new MpesaGateway(fullConfig);
  await assert.rejects(() => gateway.handleWebhook({ not: 'a callback' }), /unrecognized/);
});
