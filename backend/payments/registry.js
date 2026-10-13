import { PaymentGateway } from './PaymentGateway.js';
import { CashGateway } from './cash/CashGateway.js';
import { LencoGateway } from './lenco/LencoGateway.js';
import { MpesaGateway } from './mpesa/MpesaGateway.js';
import { getLencoConfig, getMpesaConfig } from '../config.js';

let registry = null;

// Stands in for a provider that can't be constructed (e.g. required env vars unset) — fails
// only when actually used, with a clear reason, rather than crashing the whole registry (and
// cash along with it) at startup.
class UnconfiguredGateway extends PaymentGateway {
  constructor(providerName, reason) {
    super();
    this.providerName = providerName;
    this.reason = reason;
  }

  async initiatePayment() {
    throw new Error(`${this.providerName} payment gateway unavailable: ${this.reason}`);
  }

  async checkStatus() {
    throw new Error(`${this.providerName} payment gateway unavailable: ${this.reason}`);
  }

  async handleWebhook() {
    throw new Error(`${this.providerName} payment gateway unavailable: ${this.reason}`);
  }

  async isReachable() {
    return false;
  }
}

// One gateway instance per method, built lazily (so a missing env var only breaks the one
// method it affects, never cash — checkout must keep working offline/unconfigured for cash).
//
// card    -> Lenco (unchanged — "supplementing" per the Winrose customization request)
// mobile_money -> M-Pesa (replaces Lenco's Zambia/Malawi mobile-money flow for Kenya).
//    DRAFT / INACTIVE until MPESA_* env vars are supplied: with no credentials set,
//    getMpesaConfig() returns blank strings, MpesaGateway's constructor throws, and this falls
//    back to UnconfiguredGateway — so mobile-money checkout fails with a clear "M-Pesa payment
//    gateway unavailable" message instead of silently doing nothing, until Levi has real Daraja
//    keys to put in .env. Cash and card (Lenco) are unaffected either way.
export function getPaymentRegistry() {
  if (registry) return registry;

  const cash = new CashGateway();

  let lenco;
  try {
    lenco = new LencoGateway(getLencoConfig());
  } catch (err) {
    lenco = new UnconfiguredGateway('Lenco', err.message);
  }

  let mpesa;
  try {
    mpesa = new MpesaGateway(getMpesaConfig());
  } catch (err) {
    mpesa = new UnconfiguredGateway('M-Pesa', err.message);
  }

  registry = {
    cash,
    card: lenco,
    mobile_money: mpesa,
    lenco,
    mpesa,
  };
  return registry;
}

export function getGateway(method) {
  const reg = getPaymentRegistry();
  const gateway = reg[method];
  if (!gateway) throw new Error(`No payment gateway registered for method "${method}"`);
  return gateway;
}

// Test-only: lets tests inject a fresh registry (e.g. a fake Lenco gateway) without the module
// singleton leaking state between test files.
export function _resetRegistryForTests(next) {
  registry = next || null;
}
