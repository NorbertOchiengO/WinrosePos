import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let loaded = false;

// Resolved relative to this file, not process.cwd() — Electron's main process imports this
// dynamically and its cwd isn't guaranteed to be the repo root, unlike `npm run dev`/`npm test`.
function loadEnv() {
  if (loaded) return;
  dotenv.config({ path: path.join(__dirname, '..', '.env') });
  loaded = true;
}

export function getLencoConfig() {
  loadEnv();

  const environment = process.env.LENCO_ENV === 'production' ? 'production' : 'sandbox';
  const baseUrl =
    environment === 'production'
      ? process.env.LENCO_PRODUCTION_BASE_URL || 'https://api.lenco.co/access/v2'
      : process.env.LENCO_SANDBOX_BASE_URL || 'https://sandbox.lenco.co/access/v2';

  return {
    environment,
    baseUrl,
    secretKey: process.env.LENCO_SECRET_KEY || '',
    publicKey: process.env.LENCO_PUBLIC_KEY || '',
  };
}

// M-Pesa Daraja (Safaricom) config — all blank until real credentials are supplied via .env.
// DRAFT / NOT LIVE: written from the publicly documented Daraja v1 STK Push contract, not
// verified against a real sandbox app (no credentials available at the time this was written —
// unlike the Lenco integration above, this has NOT been confirmed against a live call). Treat
// field names/response shapes here as "best known, needs verification" until someone with a
// Daraja app re-checks them against https://developer.safaricom.co.ke/APIs before go-live.
export function getMpesaConfig() {
  loadEnv();

  const environment = process.env.MPESA_ENV === 'production' ? 'production' : 'sandbox';
  const baseUrl =
    environment === 'production'
      ? process.env.MPESA_PRODUCTION_BASE_URL || 'https://api.safaricom.co.ke'
      : process.env.MPESA_SANDBOX_BASE_URL || 'https://sandbox.safaricom.co.ke';

  return {
    environment,
    baseUrl,
    consumerKey: process.env.MPESA_CONSUMER_KEY || '',
    consumerSecret: process.env.MPESA_CONSUMER_SECRET || '',
    // "Shortcode" = the Paybill or Till number the STK prompt charges into. passkey is the
    // Lipa Na M-Pesa Online passkey Safaricom issues alongside it (test shortcode/passkey pair
    // is published on the Daraja sandbox docs; production values come from Safaricom directly).
    shortcode: process.env.MPESA_SHORTCODE || '',
    passkey: process.env.MPESA_PASSKEY || '',
    // Must be a publicly reachable HTTPS URL Safaricom's servers can call back to — a local
    // dev/LAN address will not work; use a tunnel (ngrok etc.) for sandbox testing.
    callbackUrl: process.env.MPESA_CALLBACK_URL || '',
  };
}

export function getCloudSyncUrl() {
  loadEnv();
  return process.env.CLOUD_SYNC_URL || 'http://127.0.0.1:8787';
}
