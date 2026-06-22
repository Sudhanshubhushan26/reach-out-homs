# Reach Out HOMS — Wallet Module Audit & Fix

## Original problem statement
The app (clinic ops system) was migrated from Emergent → Render (backend) + Vercel (frontend).
After migration:
- Dashboard, Patients, Bookings, Revenue all work.
- **Wallet module shows "0 patients" / "No wallets with balance yet"**, even though 7 patients
  exist in the database. Searching for a patient in Wallet returns nothing.

## Root cause (confirmed)
`GET /api/wallets` (in `backend/server.py`) only returned documents from the `patient_wallets`
collection. When the data was migrated to Render's MongoDB, the `patients` collection was
copied but the `patient_wallets` collection was **not**, so the endpoint returned `[]`. The
endpoint also did not fall back to listing patients — it strictly enumerated wallet records.

A second latent bug surfaced during testing: route shadowing — `/api/wallet/{pid:int}` was
declared before `/api/wallet/refund-requests`, so FastAPI tried to int-parse the string
`refund-requests` → HTTP 422.

## Architecture
- **Backend**: FastAPI + Motor (async MongoDB), single-file `backend/server.py` (4 200+ LOC).
- **Frontend**: React (CRA) single-file `frontend/src/App.js` with `WalletModule` component
  at line 5118 — calls `/api/wallets`, `/api/wallet/{pid}`, `/api/wallet/{pid}/transactions`,
  `/api/wallet/refund-requests`, etc.
- **Collections**: `patients`, `patient_wallets`, `wallet_transactions`,
  `wallet_refund_requests`, `counters` (id sequencer).

## Implemented fixes (2026-01)
- ✅ `GET /api/wallets` rewritten — returns **one row per Active patient**, auto-creating
  missing wallet docs via `_ensure_wallet()`. Supports `min_balance` & `search` filters.
- ✅ `POST /api/patients` auto-creates a wallet on patient registration.
- ✅ `backfill_wallets()` runs on every backend startup — idempotent migration that creates
  wallet docs for any patient missing one. Existing balances preserved.
- ✅ `backend/migrate_wallets.py` — standalone migration script with before/after report,
  safe to run on Render (`python migrate_wallets.py`).
- ✅ Route ordering fixed — `/wallet/refund-requests` (GET) and
  `/wallet/refund-requests/{rid}/status` (PATCH) moved above `/wallet/{pid}` to avoid
  FastAPI route shadowing.
- ✅ **Wallet self-heal/recovery (iter-3)** — addresses the lost `wallet_transactions`
  ledger from the Render migration:
  - `reconcile_wallet_credits_from_bookings()` scans every Stopped/Cancelled/Converted
    booking and recreates the missing CREDIT transactions. Idempotent on
    `(patient_id, reference_id, CREDIT/REFUND/ADJUSTMENT)`.
  - `recompute_wallet_balances_from_transactions()` rebuilds
    `patient_wallets.{current_balance,total_credited,total_debited,total_refunded}`
    strictly from the `wallet_transactions` ledger.
  - Both run on every startup AND can be triggered on demand by admin via
    `POST /api/wallet/admin/recalculate` (returns reconciliation + recompute payloads).

## Test coverage
- `/app/backend/tests/test_wallet_module.py` — **30 pytest tests, 30/30 PASSED**.
- Iteration history: iter-1 (15 tests, 14/15 — found route shadowing) → iter-2
  (21/21 after route reorder) → iter-3 (30/30 with self-heal coverage).
- Covers: login, patient seed, `/api/wallets` list+search+min_balance, `/api/wallet/{pid}`,
  credit/debit/adjust, transactions, dashboard-stats, new-patient auto-wallet, refund
  workflow Pending→Approved→Completed (with REFUND wallet transaction), role-based 403s,
  migration script idempotency, route-shadowing regression guard, full self-heal recovery
  (stop booking → wipe ledger → recalculate → balance recovered) + idempotency.

## Files modified
- `backend/server.py` — `list_wallets()`, `create_patient()`, `on_start()` +
  `backfill_wallets()`, route reorder for refund-requests.
- `backend/migrate_wallets.py` — new standalone script.
- `frontend/src/App.js` — unchanged (frontend already calls the API correctly; no fix
  needed once backend returns proper rows).

## Deployment notes (Render + Vercel)
1. Pull these changes into the Sudhanshubhushan26/reach-out-homs repo and redeploy backend
   to Render. The startup `backfill_wallets()` will auto-create missing wallet records for
   all existing patients on first boot.
2. Alternatively, SSH into Render and run `python backend/migrate_wallets.py` once. The
   script is fully idempotent.
3. Frontend on Vercel needs no changes.

## Roles / seeded users
admin/Admin@1234 · manager/Manager@1234 · supervisor/Super@1234 · accountant/Account@1234 ·
foe/Foe@1234.

## Backlog / future enhancements
- **P2** Split `server.py` into modular routers (auth, patients, wallet, billing).
- **P2** Add a unique index on `patient_wallets.patient_id` to guarantee one-doc-per-patient
  at the DB level (currently enforced only by application logic).
- **P2** Server-side pagination on `/api/wallets` (current implementation loads all patients
  + wallets into memory — fine for current scale).
- **P3** One-shot migration flag instead of re-running backfill on every startup.
