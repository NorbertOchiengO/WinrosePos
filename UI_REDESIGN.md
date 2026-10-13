# We Care POS — UI/UX redesign (phase report)

**Status: foundation delivered (audit, design system, shell, auth, accessibility, Invoices). The page-by-page
redesign of the remaining screens (Till layout, Inventory, Catalogue, Prescriptions, Customers, Transactions,
Cash-up, Analytics, Settings) is NOT done yet** — those screens inherit the new tokens, dialog behaviour,
label fixes and colour fixes, but their layouts are unchanged. See "Not done" below.

## 1. Audit summary (what the repository actually contains)
- **Stack:** React 18 + TypeScript + Vite, plain CSS with variables (`frontend/index.css`), `lucide-react` icons.
  **No Tailwind and no router** — views are switched with a `NavView` state in `PosPage`. The brief's "Tailwind if
  installed" rule therefore means: keep the existing CSS-token architecture (done).
- **Pages (lines, measured):** Till 1,320 · Inventory 698 · Invoices 634 · PosPage 551 · Catalog 496 ·
  Analytics 455 · Prescriptions 427 · Settings 332 · Customers 313. `Transactions` and `Cash-up` are rendered from
  `PosPage` / `TransactionsModal`.
  There is **no Dashboard view**, so none was added to the navigation.
- **Findings, with numbers.** An automated axe-core (WCAG 2.0/2.1 A+AA) scan of all 11 screens found **50 failing
  elements, 48 "critical"** (35 form fields and 13 selects with no accessible name, 2 contrast failures).
  Also: only 4 `aria-label`s in the app, 88 `<label>`s but 2 `htmlFor`, no `:focus-visible`, no
  reduced-motion handling, 2 responsive rules, dialogs without roles/focus handling.
- **Fake / dead UI found:** the header "Search…" box had no handler; the bell was a non-interactive sum of
  unrelated badges; the connectivity data existed (`getSyncStatus` in preload) but was never shown.
- **Pre-existing bugs found:** every login bounced admins to Settings (first-render race); buttons rendered black
  text in dark mode; Escape did not close dialogs; quick-cash buttons were Zambian denominations; validation
  errors on my own Invoices page were hidden behind the open dialog.
- **Regression risks identified:** role-based navigation (cashier=Till only, admin=everything but Till), sync
  semantics, payment gateway behaviour — all preserved (backend and Electron files untouched this phase).

## 2. Design-system changes
- **Tokens** (top of `frontend/index.css`): brand red/burgundy/gold, ivory/white/graphite, success/warning/danger
  each with `-soft`/`-ink` variants; light default, retuned dark theme (not an inversion). Preference persisted in
  `localStorage` (`pos-theme`) — no backend dependency.
- **Contrast-checked:** every text pair ≥ 4.5:1 except gold (2.46:1), which is never used for text.
- **Shared components** (`frontend/components/ui/`): `Button` (variants, sizes, loading + `aria-busy`, blocks
  double-submit), `StatusBadge` (always icon + text), `LoadingState` / `EmptyState` / `ErrorState`, `PageHeader`,
  `FormField` (label↔control wiring, hint, inline error), `PasswordInput`, `ConfirmDialog`, `Toast` (+`useToast`).
- **`Modal`** rebuilt: `role=dialog`, `aria-labelledby`, focus moved in and restored on close, Tab trap, Escape,
  top-most-only handling for stacked dialogs.
- **`frontend/a11y.ts`** — *transitional*: links the ~90 legacy orphan `<label>`s to their controls at runtime so
  untouched pages are accessible now. Migrate pages to `FormField` over time, then delete this helper.
- Global: `:focus-visible` ring, skip link, `.sr-only`, `prefers-reduced-motion`, `button{color:inherit}`.

## 3. Application shell
Grouped navigation (Sales · Pharmacy · Reports · Administration) listing only views that exist; collapsible icon
rail (remembered; starts collapsed under 1200px; tooltips + accessible names); skip link; `aria-current`; document
title per page; top bar with **honest sync status** (`SyncIndicator`) and a **user menu** (sign out, quit).
Sync states shown from the real `{enabled, online, syncing, pendingCount, lastResult, lastError}` contract:
*Local mode* (no bridge) · *Local only* (sync not configured) · *Offline · N queued* · *Syncing…* · *Sync error* ·
*N to sync* · *Synced*. "Synced" is shown only when enabled, online, idle, error-free and nothing is pending.

## 4. Pages
- **Login / forced password change:** labelled fields, show/hide password, inline validation, `role=alert` errors,
  spinner on submit, unmistakable mandatory-change banner. Auth logic unchanged; no credentials stored.
- **Invoices:** rebuilt on the shared components (loading/empty/error states, toasts, in-app void confirmation,
  badges with text+icon, overdue flag and totals, errors shown inside the dialog, thousands separators).
- **Till / Inventory / Prescriptions:** targeted fixes only — payment options say "M-Pesa" and
  "(unavailable)" instead of "(offline)", clearer notice; goods-receiving rows (batch, **expiry date**, qty, cost)
  and the prescription status filter now have accessible names.

## 5. Verification (real browser, Playwright + axe-core, seeded database)
**54/54 scripted checks pass**, covering: login validation and password toggle; forced password change
(mismatch / too short / success); role-based navigation for cashier, admin and tech; nav groups; collapse +
persistence; skip link; user-menu keyboard behaviour; theme persistence; dialog semantics, focus trap, focus
restore; invoice validation, overpayment rejection (server-confirmed balance), void confirm/cancel; **all 8 sync
states** (using a mock built from the real status contract); no horizontal overflow at 1024×768, 768×1024,
1366×768 on all 11 screens; **axe: 0 violations** across all screens, an open dialog, and dark theme
(baseline: 50). Existing suite: **88/88 backend/integration tests pass**; `tsc` and `vite build` clean.

**Not verified:** the Electron app itself was not launched (no Electron binary in the build environment) — no
`electron/` file was changed, but startup and the live `getSyncStatus` IPC are untested; no physical receipt
printer; no live payment gateway; checkout through real card/M-Pesa (inactive/unverified, as before).

## 6. Not done (be careful before promising these to the client)
Till layout rework (cart/totals hierarchy, keyboard shortcuts beyond existing F-keys); Inventory summary metrics,
sortable/paginated table and expiry/near-expiry states; Catalogue add/edit form with unsaved-change protection;
Prescriptions status views; Customers lookup/history layout; Transactions detail and refund/cash-up screens;
Analytics chart redesign; Settings grouping; migrating every page to `FormField`; component tests (the repo's
test runner is Node-only — frontend tests need a runner such as Vitest).

## 7. Existing issues still open
Settings → "Demo data" can wipe catalog and sales (restrict before go-live) · login pre-fills username `admin` ·
native `confirm()`/`alert()` prompts remain in 9 places (Catalog ×4 incl. bulk delete, Customers ×2, Till held-sale delete, PhotoPicker, Settings demo-data) — replace with `ConfirmDialog` · M-Pesa unverified against Safaricom; Lenco's Kenya
support unconfirmed; no KRA eTIMS/VAT handling (see `WINROSE_CUSTOMIZATION.md`).

## 8. Run it
```
npm install
npm run dev        # Vite + Electron
npm run build && npm test
```

## 9. Recommended next phases
1. POS screen (cart/totals hierarchy, payment-pad status states) — highest operational value.
2. Inventory: expiry/stock states + sortable, paginated table (needs only existing endpoints).
3. Migrate forms to `FormField`, then remove `a11y.ts`.
4. Catalogue form, Prescriptions, Customers, Transactions/refunds/cash-up, Analytics, Settings.
5. Add Vitest + Testing Library and fold the Playwright checks into CI.
