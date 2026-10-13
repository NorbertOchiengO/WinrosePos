import { PaymentGateway } from '../PaymentGateway.js';
import { createMpesaClient, buildStkPassword, daraTimestamp } from './client.js';

// *** DRAFT — see client.js header. Not verified against a live Daraja sandbox. ***
//
// Maps Daraja's STK Push result codes onto our internal status vocabulary (same vocabulary
// LencoGateway uses — see payments.status in backend/db.js): 0 = success, anything else on a
// completed callback = failed/cancelled, no callback yet = pending.
export function mapMpesaResultCode(resultCode) {
  if (resultCode === 0 || resultCode === '0') return 'successful';
  if (resultCode === undefined || resultCode === null) return 'pending';
  return 'failed';
}

function extractCallbackMetadata(items = []) {
  const get = (name) => items.find((i) => i.Name === name)?.Value;
  return {
    amount: get('Amount'),
    mpesaReceiptNumber: get('MpesaReceiptNumber'),
    transactionDate: get('TransactionDate'),
    phoneNumber: get('PhoneNumber'),
  };
}

export class MpesaGateway extends PaymentGateway {
  constructor({ baseUrl, consumerKey, consumerSecret, shortcode, passkey, callbackUrl }) {
    super();
    this.baseUrl = baseUrl;
    this.shortcode = shortcode;
    this.passkey = passkey;
    this.callbackUrl = callbackUrl;
    this.client = createMpesaClient({ baseUrl, consumerKey, consumerSecret });

    if (!shortcode || !passkey) {
      throw new Error(
        'MPESA_SHORTCODE / MPESA_PASSKEY are not set — see .env.example'
      );
    }
    if (!callbackUrl) {
      throw new Error(
        'MPESA_CALLBACK_URL is not set — Safaricom needs a publicly reachable HTTPS URL to call back to'
      );
    }
  }

  // params: { method: 'mobile_money', reference, amount, mobileMoney: { phone } }
  // Only 'mobile_money' is handled here — card stays on Lenco (see registry.js); this gateway
  // is never registered for 'card'.
  async initiatePayment(params) {
    const { method, reference, amount, mobileMoney } = params;
    if (method !== 'mobile_money') {
      throw new Error(`MpesaGateway.initiatePayment: unsupported method "${method}"`);
    }
    const phone = normalizeKenyanMsisdn(mobileMoney?.phone);
    if (!phone) {
      throw new Error('MpesaGateway: a valid M-Pesa phone number is required (e.g. 07XXXXXXXX)');
    }

    const timestamp = daraTimestamp();
    const password = buildStkPassword({ shortcode: this.shortcode, passkey: this.passkey, timestamp });

    const res = await this.client.authedPost('/mpesa/stkpush/v1/processrequest', {
      BusinessShortCode: this.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(Number(amount)),
      PartyA: phone,
      PartyB: this.shortcode,
      PhoneNumber: phone,
      CallBackURL: this.callbackUrl,
      AccountReference: reference,
      TransactionDesc: `Payment ${reference}`,
    });

    // The STK push "succeeding" here only means the prompt was sent to the phone, NOT that the
    // customer has paid — same shape as Lenco's 'pending' until a webhook/poll confirms it.
    return {
      providerReference: res.CheckoutRequestID,
      reference,
      status: 'pending',
      rawStatus: res.ResponseDescription,
      amount,
      currency: 'KES',
      raw: res,
    };
  }

  // checkoutRequestId: the providerReference returned by initiatePayment — used as the lookup
  // key here instead of our own `reference`, since that's what Daraja's query endpoint expects.
  async checkStatus(checkoutRequestId) {
    const timestamp = daraTimestamp();
    const password = buildStkPassword({ shortcode: this.shortcode, passkey: this.passkey, timestamp });

    const res = await this.client.authedPost('/mpesa/stkpushquery/v1/query', {
      BusinessShortCode: this.shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    });

    return {
      providerReference: checkoutRequestId,
      status: mapMpesaResultCode(res.ResultCode !== undefined ? Number(res.ResultCode) : undefined),
      rawStatus: res.ResultDesc,
      raw: res,
    };
  }

  // Safaricom's STK callback is NOT signed (no HMAC/signature header, unlike Lenco) — Daraja's
  // own guidance is to treat the callback as a trigger to re-confirm via checkStatus/the query
  // endpoint rather than trust its body outright, and to restrict the callback route to
  // Safaricom's published IP ranges at the network/firewall level in production. This method
  // only parses the payload; routes/payments.js is responsible for the IP allowlist and for
  // matching CheckoutRequestID against a payment we actually initiated before accepting it.
  async handleWebhook(rawBody) {
    const body = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
    const callback = body?.Body?.stkCallback;
    if (!callback) throw new Error('MpesaGateway: unrecognized callback payload shape');

    const status = mapMpesaResultCode(callback.ResultCode);
    const metadata =
      status === 'successful' ? extractCallbackMetadata(callback.CallbackMetadata?.Item) : {};

    return {
      event: status === 'successful' ? 'payment.successful' : 'payment.failed',
      record: {
        providerReference: callback.CheckoutRequestID,
        status,
        rawStatus: callback.ResultDesc,
        amount: metadata.amount,
        mpesaReceiptNumber: metadata.mpesaReceiptNumber,
        phoneNumber: metadata.phoneNumber,
        raw: callback,
      },
    };
  }

  async isReachable(timeoutMs = 3000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      await this.client.getAccessToken();
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async refund() {
    // Daraja has a separate "Reversal" API (different credentials/flow from STK Push) that
    // isn't implemented here yet — out of scope until M-Pesa is actually wired up live.
    throw new Error('MpesaGateway.refund: not implemented — reconcile M-Pesa refunds manually for now');
  }
}

// Daraja expects a local-format MSISDN without the leading 0, prefixed with the country code:
// 2547XXXXXXXX or 2541XXXXXXXX. Accepts 07XXXXXXXX, 01XXXXXXXX, 2547XXXXXXXX, or +254...
function normalizeKenyanMsisdn(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (/^254(7|1)\d{8}$/.test(digits)) return digits;
  if (/^0(7|1)\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^(7|1)\d{8}$/.test(digits)) return `254${digits}`;
  return null;
}
