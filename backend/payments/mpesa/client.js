// Thin HTTP client for Safaricom's Daraja API v1 (M-Pesa Express / STK Push).
//
// *** DRAFT — NOT VERIFIED AGAINST A LIVE SANDBOX ***
// Written from the publicly documented Daraja contract (OAuth client-credentials grant, then
// Lipa Na M-Pesa Online "STK Push" + its matching query endpoint). Levi does not have a Daraja
// app/credentials yet, so — unlike the Lenco client, which was built and confirmed against live
// docs — this has only been checked for internal consistency, never against a real call or a
// fresh read of https://developer.safaricom.co.ke/APIs. Before taking this live: create a
// Daraja sandbox app, re-read the current STK Push + STK Push Query reference pages end to end,
// and adjust anything below that's drifted (Safaricom does revise field names/response shapes
// over time).
export function createMpesaClient({ baseUrl, consumerKey, consumerSecret }) {
  if (!consumerKey || !consumerSecret) {
    throw new Error(
      'MPESA_CONSUMER_KEY / MPESA_CONSUMER_SECRET are not set — see .env.example. ' +
        'M-Pesa stays disabled (falls back to "unavailable") until these are supplied.'
    );
  }

  let cachedToken = null;
  let cachedTokenExpiresAt = 0;

  // POST isn't used here — Daraja's OAuth endpoint takes grant_type as a query param with
  // HTTP Basic auth, not a request body.
  async function getAccessToken() {
    if (cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken;

    const basic = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
    const res = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${basic}` },
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.access_token) {
      const err = new Error(json?.errorMessage || `M-Pesa OAuth error: HTTP ${res.status}`);
      err.httpStatus = res.status;
      err.response = json;
      throw err;
    }
    cachedToken = json.access_token;
    // expires_in is seconds (typically 3599); refresh a minute early to avoid edge-of-expiry
    // failures on a request that's mid-flight when the token turns over.
    cachedTokenExpiresAt = Date.now() + (Number(json.expires_in || 3600) - 60) * 1000;
    return cachedToken;
  }

  async function authedPost(path, body) {
    const token = await getAccessToken();
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    // Daraja's error envelope on request validation failures differs from its success envelope
    // (errorCode/errorMessage vs ResponseCode/ResponseDescription) — check both.
    if (!res.ok || json?.errorCode || (json?.ResponseCode && json.ResponseCode !== '0')) {
      const message = json?.errorMessage || json?.ResponseDescription || `M-Pesa API error: HTTP ${res.status}`;
      const err = new Error(message);
      err.httpStatus = res.status;
      err.response = json;
      throw err;
    }
    return json;
  }

  return { getAccessToken, authedPost };
}

// Password = Base64(Shortcode + Passkey + Timestamp), Timestamp = YYYYMMDDHHmmss — exactly as
// specified for Lipa Na M-Pesa Online requests.
export function buildStkPassword({ shortcode, passkey, timestamp }) {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
}

export function daraTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    date.getFullYear().toString() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}
