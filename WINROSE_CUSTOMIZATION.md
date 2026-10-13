# Winrose POS — customization notes

> UI/UX redesign status and test results: see **UI_REDESIGN.md**.

This is the MediPOS codebase customized for Winrose Pharmaceuticals (Kenya). Read this first.

## What changed

| Area | Change | Where |
|---|---|---|
| **KES localization** | Default currency/symbol is now `KES`; Zambia/Malawi operator + country pickers removed from the Till | `backend/db.js`, `backend/routes/{settings,payments}.js`, `frontend/pages/{TillView,PosPage,SettingsView}.tsx` |
| **Credit invoices (accounts receivable)** | Bill a client now, collect later: create invoice, partial/full payments, balance + status tracking, overdue list, void. New **Invoices** page + `perm_invoices` permission | `backend/routes/invoices.js`, `backend/db.js` (migrations 16–17), `frontend/pages/InvoicesView.tsx` |
| **Printing** | Invoices print (itemised, balance, QR). Any past sale in **Sales history** can now be reprinted as a "RECEIPT COPY". Till checkout printing unchanged | `InvoicesView.tsx`, `frontend/components/TransactionsModal.tsx` |
| **M-Pesa (DRAFT, inactive)** | Daraja STK Push gateway written and registered for `mobile_money`; callback route `/api/payments/webhook/mpesa`. **Does nothing until `MPESA_*` keys are set** — mobile money shows "unavailable"; cash and card are unaffected | `backend/payments/mpesa/*`, `registry.js`, `.env.example` |
| **Security** | (1) JWT secret was a guessable string — now a random 256-bit secret stored per install. (2) Default `admin/admin` is forced through a change-password screen on first login; admin-created/reset accounts too. (3) New `POST /api/users/change-password`. (4) `perm_invoices` carried in the token | `electron/main.js`, `backend/auth.js`, `backend/routes/users.js`, `frontend/pages/ForcedPasswordChange.tsx` |
| **Branding (We Care)** | Logo, colour palette and name applied: light sidebar with the circular logo, red reserved for actions, burgundy for nav/headings, gold decorative only, separate green/amber/red for success/warning/danger. Dark mode retuned. Contrast checked (all text pairs ≥ 4.5:1 except gold, which is never used for text). App icons/favicon regenerated from the logo | `frontend/index.css` (tokens at top), `frontend/assets/logo.png`, `frontend/brand.ts` (name + logo in one place), `build/icon.*` |

Also fixed while testing in a real browser: Settings opened on every login (first-render race), Escape now closes dialogs, quick-cash buttons are Kenyan notes (50/100/200/500/1000), Invoices show an Overdue flag + outstanding/overdue totals, CSP allows inlined fonts.

Tests: 88 passing (`npm test`) — 4 new invoice/password tests + 12 M-Pesa unit tests. Typecheck and production build are clean.

## Before go-live — things only you can supply or verify

1. **M-Pesa:** create a Daraja app, fill `MPESA_*` in `.env`, then **verify `backend/payments/mpesa/` against the live Daraja docs and a sandbox run.** It was written from the public API contract and has *never* hit a real endpoint. `MPESA_CALLBACK_URL` must be public HTTPS (use ngrok for sandbox). Safaricom does not sign callbacks, so also restrict the callback route to Safaricom's IP ranges in production (the code re-confirms every callback via the query API before marking a sale paid). Refunds are not implemented (reconcile manually).
2. **Card payments (Lenco):** Lenco's Kenya support is *unverified*. It still handles `card`, with a default currency of KES now passed through. If Lenco doesn't serve Kenya, card needs a different processor (the gateway interface in `backend/payments/PaymentGateway.js` makes that a drop-in).
3. **Branding:** done from the supplied logo and palette. Thermal receipts are plain text and carry no logo (80mm thermal printers render images poorly). The product name is "We Care" (from the logo) — change `BRAND` in `frontend/brand.ts` plus the seed names in `backend/db.js` if the legal/trading name should differ.
4. **Invoice numbering/tax:** invoices number as `INV-<year>-0001`. There is no KRA eTIMS / VAT handling — if Winrose must issue tax-compliant invoices, that needs a separate integration and confirmation of the legal requirements with their accountant.
5. **Existing databases:** defaults changed for *new* installs. An already-created database keeps its old currency symbol (change it in Settings).
6. Pharmacy regulatory items (PPB licensing, controlled-substance record rules) are outside what this code can certify — confirm with Winrose's superintendent pharmacist.

## Invoices — how it behaves
- Needs a *named* customer (not walk-in). Total must be > 0.
- Payments cannot exceed the balance; fully-paid and void invoices accept no payments; an invoice with payments can't be voided.
- Payment history is append-only; `balance`/`status` are updated in the same DB transaction.
- Invoices are pushed to the cloud sync API through the existing outbox (the API is generic per entity type) and are treated as server-authoritative on conflict, like transactions/payments. They are **not pulled down to other terminals yet** — today only products/categories are pulled (`SYNC_ENTITY_TYPES` in `electron/main.js`). In a single-till shop this doesn't matter; for multiple tills sharing invoices, add pull support first.

## Watch out
- **Settings → "Demo data"** has buttons that load sample data or *wipe catalog and sales data*. Fine for setup; remove or restrict them before a real pharmacy trades on this — the wipe is irreversible.
- The upstream `README.md` still says "MediPOS"; it is documentation only.
