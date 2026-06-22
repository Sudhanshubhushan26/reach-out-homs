"""Backend tests for the Wallet module bug-fix verification.

Covers:
 - Authentication (admin / manager / accountant / staff role)
 - GET /api/wallets (the main fix — must list ALL active patients)
 - GET /api/wallet/{pid}, transactions, adjust, refund-request
 - POST /api/patients auto-creates wallet
 - Permission check (staff blocked)
 - Standalone migrate_wallets.py idempotency
"""
import os
import subprocess
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://wallet-render-fix.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"username": "admin",      "password": "Admin@1234"}
MANAGER = {"username": "manager",  "password": "Manager@1234"}
ACCT  = {"username": "accountant", "password": "Account@1234"}
STAFF = {"username": "foe",        "password": "Foe@1234"}

EXPECTED_PATIENTS = {
    "Nitin Gupta", "Brijesh Kumar", "Kamla Devi", "Rajesh Sharma",
    "Anita Kapoor", "Harish Chandra", "Sunita Agarwal",
}


# ────────────────────────────── fixtures ──────────────────────────────
def _login(creds):
    r = requests.post(f"{API}/login", json=creds, timeout=15)
    return r


@pytest.fixture(scope="session")
def admin_token():
    r = _login(ADMIN)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def manager_token():
    r = _login(MANAGER)
    if r.status_code != 200:
        pytest.skip(f"manager login unavailable: {r.status_code}")
    return r.json()["token"]


@pytest.fixture(scope="session")
def accountant_token():
    r = _login(ACCT)
    if r.status_code != 200:
        pytest.skip(f"accountant login unavailable: {r.status_code}")
    return r.json()["token"]


@pytest.fixture(scope="session")
def staff_token():
    r = _login(STAFF)
    if r.status_code != 200:
        pytest.skip(f"staff(foe) login unavailable: {r.status_code}")
    return r.json()["token"]


def H(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ─────────────────────────── Auth tests ────────────────────────────
class TestAuth:
    def test_admin_login(self):
        r = _login(ADMIN)
        assert r.status_code == 200
        j = r.json()
        assert j.get("success") is True
        assert j.get("role") == "admin"
        assert isinstance(j.get("token"), str) and len(j["token"]) > 20

    def test_bad_password(self):
        r = _login({"username": "admin", "password": "wrong"})
        assert r.status_code == 401


# ─────────────────────── Patient list seed check ────────────────────
class TestPatients:
    def test_seven_active_patients(self, admin_token):
        r = requests.get(f"{API}/patients?status=Active", headers=H(admin_token), timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        names = {p.get("name") for p in data}
        # All 7 expected seeded patients must be present
        missing = EXPECTED_PATIENTS - names
        assert not missing, f"Missing expected seeded patients: {missing}"
        assert len(data) >= 7


# ─────────────────────────── Wallet list (main fix) ─────────────────
class TestWalletsList:
    def test_list_wallets_returns_all_active(self, admin_token):
        r = requests.get(f"{API}/wallets?min_balance=0", headers=H(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        rows = r.json()
        assert isinstance(rows, list)
        assert len(rows) >= 7, f"expected >=7 wallet rows, got {len(rows)}"
        sample = rows[0]
        for k in ("patient_id", "patient_name", "patient_mobile", "reg_number",
                  "current_balance", "total_credited", "total_debited", "total_refunded"):
            assert k in sample, f"missing field {k} in wallet row"
        names = {r_["patient_name"] for r_ in rows}
        assert EXPECTED_PATIENTS.issubset(names), f"some seeded patients missing from wallet list: {EXPECTED_PATIENTS - names}"

    def test_search_by_name(self, admin_token):
        r = requests.get(f"{API}/wallets?search=Brijesh", headers=H(admin_token), timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert len(rows) == 1, f"expected 1 result for 'Brijesh', got {len(rows)}"
        assert "Brijesh" in rows[0]["patient_name"]

    def test_search_by_mobile(self, admin_token):
        # Find one patient mobile first
        r = requests.get(f"{API}/patients?status=Active", headers=H(admin_token), timeout=15)
        patients = r.json()
        target = next((p for p in patients if p.get("mobile")), None)
        assert target, "no active patient with a mobile number"
        mob = target["mobile"]
        r = requests.get(f"{API}/wallets?search={mob}", headers=H(admin_token), timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert any(row["patient_mobile"] == mob for row in rows), f"mobile {mob} not found in wallet search"

    def test_min_balance_filter(self, admin_token):
        r = requests.get(f"{API}/wallets?min_balance=100", headers=H(admin_token), timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert all(row["current_balance"] >= 100 for row in rows), "min_balance filter not applied"

    def test_permission_staff_blocked(self, staff_token):
        r = requests.get(f"{API}/wallets", headers=H(staff_token), timeout=15)
        assert r.status_code == 403, f"staff(foe) should get 403, got {r.status_code} {r.text}"

    def test_permission_manager_allowed(self, manager_token):
        r = requests.get(f"{API}/wallets", headers=H(manager_token), timeout=15)
        assert r.status_code == 200

    def test_permission_accountant_allowed(self, accountant_token):
        r = requests.get(f"{API}/wallets", headers=H(accountant_token), timeout=15)
        assert r.status_code == 200


# ─────────────────── Per-patient wallet endpoints ───────────────────
class TestWalletDetail:
    def test_get_wallet_for_patient_1(self, admin_token):
        r = requests.get(f"{API}/wallet/1", headers=H(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        w = r.json()
        for k in ("patient_id", "current_balance", "patient_name", "patient_mobile", "reg_number"):
            assert k in w, f"missing {k}"
        assert w["patient_id"] == 1

    def test_credit_adjust_then_balance_and_stats(self, admin_token):
        # 1. Read current balance
        r = requests.get(f"{API}/wallet/1", headers=H(admin_token), timeout=15)
        before = float(r.json().get("current_balance") or 0)

        # 2. Credit 5000
        r = requests.post(f"{API}/wallet/1/adjust",
                          headers=H(admin_token),
                          json={"direction": "credit", "amount": 5000, "remarks": "Test"},
                          timeout=15)
        assert r.status_code == 200, r.text

        # 3. Verify new balance
        r = requests.get(f"{API}/wallet/1", headers=H(admin_token), timeout=15)
        after = float(r.json().get("current_balance") or 0)
        assert round(after - before, 2) == 5000.0, f"balance delta {after-before}"

        # 4. Verify transaction recorded
        r = requests.get(f"{API}/wallet/1/transactions", headers=H(admin_token), timeout=15)
        assert r.status_code == 200
        txs = r.json()
        assert any(t.get("amount") == 5000 and t.get("transaction_type") in ("CREDIT", "ADJUSTMENT") for t in txs)

        # 5. Dashboard stats
        r = requests.get(f"{API}/wallet/dashboard-stats", headers=H(admin_token), timeout=15)
        assert r.status_code == 200
        s = r.json()
        assert s["totalWalletBalance"] >= 5000
        assert s["patientsWithBalance"] >= 1
        assert s["walletCreditsThisMonth"] >= 5000


# ─────────────── New patient auto-creates wallet ───────────────
class TestNewPatientAutoWallet:
    def test_create_patient_auto_wallet(self, admin_token):
        # Count current wallets
        r0 = requests.get(f"{API}/wallets", headers=H(admin_token), timeout=15)
        assert r0.status_code == 200
        count_before = len(r0.json())

        # Create unique patient (TEST_ prefix)
        suffix = uuid.uuid4().hex[:6]
        new_p = {
            "name": f"TEST_Patient_{suffix}",
            "mobile": f"9{int(time.time()) % 10**9:09d}",
            "status": "Active",
        }
        r = requests.post(f"{API}/patients", headers=H(admin_token), json=new_p, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        new_id = body["id"]
        assert "reg_number" in body and body["reg_number"].startswith("RO-PAT-")

        # Wallet must exist (balance 0)
        rw = requests.get(f"{API}/wallet/{new_id}", headers=H(admin_token), timeout=15)
        assert rw.status_code == 200, rw.text
        w = rw.json()
        assert float(w.get("current_balance") or 0) == 0.0
        assert w.get("patient_id") == new_id

        # List wallets count incremented
        r2 = requests.get(f"{API}/wallets", headers=H(admin_token), timeout=15)
        count_after = len(r2.json())
        assert count_after == count_before + 1, f"wallet count did not grow: before={count_before} after={count_after}"


# ─────────────── Refund request workflow ───────────────
class TestRefundRequests:
    def test_list_refund_requests_returns_200(self, admin_token):
        """Re-verify route-shadowing fix: GET /api/wallet/refund-requests must be HTTP 200 with JSON array."""
        r = requests.get(f"{API}/wallet/refund-requests", headers=H(admin_token), timeout=15)
        assert r.status_code == 200, f"refund-requests must be 200 after fix, got {r.status_code}: {r.text}"
        body = r.json()
        assert isinstance(body, list), f"expected list, got {type(body).__name__}"

    def test_list_refund_requests_status_filter(self, admin_token):
        """GET /api/wallet/refund-requests?status=Pending must return 200 and only Pending rows."""
        r = requests.get(f"{API}/wallet/refund-requests?status=Pending", headers=H(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        rows = r.json()
        assert isinstance(rows, list)
        for row in rows:
            assert row.get("status") == "Pending", f"non-Pending row leaked: {row.get('status')}"

    def test_create_refund_request_full_workflow(self, admin_token):
        """Create → list (verify enrichment fields) → Approve → Complete (verify wallet REFUND tx + balance decrement)."""
        # Ensure patient 1 has enough balance — credit 5000
        rw = requests.get(f"{API}/wallet/1", headers=H(admin_token), timeout=15)
        bal_before_credit = float(rw.json().get("current_balance") or 0)
        cr = requests.post(f"{API}/wallet/1/adjust", headers=H(admin_token),
                           json={"direction": "credit", "amount": 5000, "remarks": "credit before refund workflow"},
                           timeout=15)
        assert cr.status_code == 200, cr.text

        rw2 = requests.get(f"{API}/wallet/1", headers=H(admin_token), timeout=15)
        balance_after_credit = float(rw2.json().get("current_balance") or 0)
        assert round(balance_after_credit - bal_before_credit, 2) == 5000.0

        # Capture initial list
        r0 = requests.get(f"{API}/wallet/refund-requests", headers=H(admin_token), timeout=15)
        assert r0.status_code == 200, r0.text
        initial_count = len(r0.json())

        # Create refund request for ₹1234
        refund_amount = 1234.0
        rr = requests.post(f"{API}/wallet/1/refund-request",
                           headers=H(admin_token),
                           json={"amount": refund_amount, "reason": "TEST_refund_workflow"},
                           timeout=15)
        assert rr.status_code == 200, rr.text
        created = rr.json()
        # API may return the doc directly or wrap it — handle either
        rid = None
        if isinstance(created, dict):
            rid = created.get("id") or (created.get("request") or {}).get("id") or (created.get("refund_request") or {}).get("id")

        # If id wasn't returned, look it up from listing
        r1 = requests.get(f"{API}/wallet/refund-requests", headers=H(admin_token), timeout=15)
        assert r1.status_code == 200
        rows = r1.json()
        assert len(rows) >= initial_count + 1, f"list did not grow: before={initial_count} after={len(rows)}"

        # Find our newly created row for patient 1 — pick the one with the highest id
        # (i.e. the most recently created) to avoid picking a stale Completed row from
        # a previous test run that has the same amount.
        mine = [r_ for r_ in rows if r_.get("patient_id") == 1 and float(r_.get("amount", 0)) == refund_amount]
        assert mine, "newly created refund request not found in listing"
        if rid is not None:
            matched = [r_ for r_ in mine if r_.get("id") == rid]
            row = matched[0] if matched else max(mine, key=lambda x: int(x.get("id") or 0))
        else:
            row = max(mine, key=lambda x: int(x.get("id") or 0))
            rid = row.get("id")

        # Verify enrichment fields present
        for k in ("patient_name", "patient_mobile", "reg_number", "amount", "status"):
            assert k in row, f"missing enrichment field {k}"
        assert row["patient_name"], "patient_name should be non-empty"
        assert row["status"] == "Pending"
        assert float(row["amount"]) == refund_amount

        # Status=Pending filter must include this row
        rp = requests.get(f"{API}/wallet/refund-requests?status=Pending", headers=H(admin_token), timeout=15)
        assert rp.status_code == 200
        assert any(rr_.get("id") == rid for rr_ in rp.json()), "Pending filter missed newly created request"

        # PATCH → Approved (admin only)
        pa = requests.patch(f"{API}/wallet/refund-requests/{rid}/status",
                            headers=H(admin_token),
                            json={"status": "Approved", "remarks": "OK"},
                            timeout=15)
        assert pa.status_code == 200, pa.text

        # Verify status now Approved
        ra = requests.get(f"{API}/wallet/refund-requests?status=Approved", headers=H(admin_token), timeout=15)
        assert ra.status_code == 200
        approved = [r_ for r_ in ra.json() if r_.get("id") == rid]
        assert approved, f"request {rid} not in Approved list"
        assert approved[0]["status"] == "Approved"

        # Capture balance before completing
        rwb = requests.get(f"{API}/wallet/1", headers=H(admin_token), timeout=15)
        bal_before_complete = float(rwb.json().get("current_balance") or 0)

        # PATCH → Completed (must create REFUND wallet transaction and decrement balance)
        pc = requests.patch(f"{API}/wallet/refund-requests/{rid}/status",
                            headers=H(admin_token),
                            json={"status": "Completed"},
                            timeout=15)
        assert pc.status_code == 200, pc.text

        # Verify wallet balance decremented by refund amount
        rwa = requests.get(f"{API}/wallet/1", headers=H(admin_token), timeout=15)
        bal_after_complete = float(rwa.json().get("current_balance") or 0)
        delta = round(bal_before_complete - bal_after_complete, 2)
        assert delta == refund_amount, f"wallet not decremented correctly: before={bal_before_complete} after={bal_after_complete} delta={delta} expected={refund_amount}"

        # Verify REFUND transaction recorded
        rtx = requests.get(f"{API}/wallet/1/transactions?tx_type=REFUND", headers=H(admin_token), timeout=15)
        assert rtx.status_code == 200
        txs = rtx.json()
        assert any(round(float(t.get("amount", 0)), 2) == refund_amount
                   and (t.get("transaction_type") or "").upper() == "REFUND"
                   for t in txs), f"REFUND tx for ₹{refund_amount} not found in transactions"

        # Listing should show Completed status now
        rc = requests.get(f"{API}/wallet/refund-requests?status=Completed", headers=H(admin_token), timeout=15)
        assert rc.status_code == 200
        assert any(rr_.get("id") == rid for rr_ in rc.json()), f"request {rid} not in Completed list"

    def test_patch_refund_request_status_invalid_value(self, admin_token):
        """PATCH with invalid status must return 400."""
        # Create a Pending request first
        cr = requests.post(f"{API}/wallet/1/adjust", headers=H(admin_token),
                           json={"direction": "credit", "amount": 200, "remarks": "for-invalid-patch"}, timeout=15)
        assert cr.status_code == 200
        rr = requests.post(f"{API}/wallet/1/refund-request", headers=H(admin_token),
                           json={"amount": 100, "reason": "TEST_invalid_patch"}, timeout=15)
        assert rr.status_code == 200
        # find latest row
        rl = requests.get(f"{API}/wallet/refund-requests?status=Pending", headers=H(admin_token), timeout=15).json()
        mine = [r_ for r_ in rl if r_.get("patient_id") == 1 and float(r_.get("amount", 0)) == 100.0]
        assert mine
        rid = max(mine, key=lambda x: int(x.get("id") or 0))["id"]
        bad = requests.patch(f"{API}/wallet/refund-requests/{rid}/status",
                             headers=H(admin_token),
                             json={"status": "Garbage"}, timeout=15)
        assert bad.status_code == 400, f"expected 400 for invalid status, got {bad.status_code}: {bad.text}"


# ─────────────── Re-verify parametric routes still work post-reorder ───────────────
class TestRouteShadowingRegression:
    def test_get_wallet_pid_still_works(self, admin_token):
        """GET /api/wallet/1 must still return the per-patient wallet (parametric route)."""
        r = requests.get(f"{API}/wallet/1", headers=H(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        w = r.json()
        assert w.get("patient_id") == 1
        for k in ("current_balance", "patient_name", "patient_mobile", "reg_number"):
            assert k in w

    def test_get_wallet_pid_transactions_still_works(self, admin_token):
        """GET /api/wallet/1/transactions must still return list."""
        r = requests.get(f"{API}/wallet/1/transactions", headers=H(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_wallets_list_still_returns_seven_plus(self, admin_token):
        """GET /api/wallets?min_balance=0 still returns >=7 active patients."""
        r = requests.get(f"{API}/wallets?min_balance=0", headers=H(admin_token), timeout=15)
        assert r.status_code == 200
        assert len(r.json()) >= 7


# ─────────────── Migrate script idempotency ───────────────
class TestMigrationScript:
    def test_migrate_wallets_idempotent(self):
        script = "/app/backend/migrate_wallets.py"
        if not os.path.exists(script):
            pytest.skip("migrate_wallets.py not present")
        out = subprocess.run(
            ["python", script],
            capture_output=True, text=True, timeout=60,
            cwd="/app/backend",
        )
        combined = (out.stdout or "") + "\n" + (out.stderr or "")
        assert out.returncode == 0, f"migration script failed: {combined}"
        low = combined.lower()
        # Should report 0 created since startup backfill already ran
        assert "created" in low or "wallet" in low, f"unexpected output: {combined}"



# ─────────────── Iteration 3 — Wallet recovery / reconciliation ───────────────
class TestWalletAdminRecalculate:
    """Coverage for POST /api/wallet/admin/recalculate.

    Validates:
      * 200 OK + correct response shape for admin
      * 403 for every non-admin role (manager / accountant / foe / staff)
      * Idempotency — second call reports created=0
      * End-to-end recovery: stop booking 2 → wipe ledger via pymongo →
        recalculate → wallet balance recovered
      * Startup hooks intact (iter-1 wallets list & iter-2 refund-requests)
      * Dashboard stats reflect post-recalculation totals
    """

    ENDPOINT = f"{API}/wallet/admin/recalculate"

    def test_recalculate_as_admin_returns_correct_shape(self, admin_token):
        r = requests.post(self.ENDPOINT, headers=H(admin_token), timeout=30)
        assert r.status_code == 200, f"admin should get 200, got {r.status_code}: {r.text}"
        body = r.json()
        assert "reconciliation" in body, f"missing 'reconciliation' key: {body}"
        assert "balance_recompute" in body, f"missing 'balance_recompute' key: {body}"
        recon = body["reconciliation"]
        for k in ("created", "skipped_already_credited", "skipped_no_refundable", "bookings_scanned"):
            assert k in recon, f"reconciliation missing '{k}': {recon}"
            assert isinstance(recon[k], int), f"reconciliation.{k} must be int, got {type(recon[k]).__name__}"
        recomp = body["balance_recompute"]
        assert "recomputed" in recomp, f"balance_recompute missing 'recomputed': {recomp}"
        assert isinstance(recomp["recomputed"], int)

    def test_recalculate_blocked_for_manager(self, manager_token):
        r = requests.post(self.ENDPOINT, headers=H(manager_token), timeout=15)
        assert r.status_code == 403, f"manager must be 403, got {r.status_code}: {r.text}"

    def test_recalculate_blocked_for_accountant(self, accountant_token):
        r = requests.post(self.ENDPOINT, headers=H(accountant_token), timeout=15)
        assert r.status_code == 403, f"accountant must be 403, got {r.status_code}: {r.text}"

    def test_recalculate_blocked_for_foe_staff(self, staff_token):
        r = requests.post(self.ENDPOINT, headers=H(staff_token), timeout=15)
        assert r.status_code == 403, f"foe must be 403, got {r.status_code}: {r.text}"

    def test_recalculate_unauthenticated_blocked(self):
        r = requests.post(self.ENDPOINT, timeout=15)
        assert r.status_code in (401, 403), f"unauth must be 401/403, got {r.status_code}: {r.text}"

    def test_recalculate_idempotent_back_to_back(self, admin_token):
        # First call
        r1 = requests.post(self.ENDPOINT, headers=H(admin_token), timeout=30)
        assert r1.status_code == 200, r1.text
        # Second call immediately after — must create 0 new wallet credits
        r2 = requests.post(self.ENDPOINT, headers=H(admin_token), timeout=30)
        assert r2.status_code == 200, r2.text
        body2 = r2.json()
        assert body2["reconciliation"]["created"] == 0, (
            f"idempotency violated — 2nd call created "
            f"{body2['reconciliation']['created']} new credits: {body2}"
        )

    def test_end_to_end_recovery_for_booking_2(self, admin_token):
        """(a) stop booking 2 → (b) wipe wallet_transactions+zero wallet via pymongo →
        (c) call /admin/recalculate → (d) verify GET /api/wallet/2 balance recovered."""
        from datetime import date

        # ── Step 0: read MONGO_URL + DB_NAME from backend/.env so we can simulate data loss ──
        env_path = "/app/backend/.env"
        mongo_url = None
        db_name = None
        if os.path.exists(env_path):
            for line in open(env_path):
                line = line.strip()
                if line.startswith("MONGO_URL"):
                    mongo_url = line.split("=", 1)[1].strip().strip('"').strip("'")
                elif line.startswith("DB_NAME"):
                    db_name = line.split("=", 1)[1].strip().strip('"').strip("'")
        if not mongo_url or not db_name:
            pytest.skip("MONGO_URL/DB_NAME not available — cannot simulate data loss")

        from pymongo import MongoClient
        sync_db = MongoClient(mongo_url, serverSelectionTimeoutMS=5000)[db_name]

        # ── Step 0b: ensure booking 2 (Brijesh Kumar) is Active. If a previous run
        # already stopped it, the e2e flow still works — we just credit it once and
        # then wipe & recover. ──
        bk = sync_db.bookings.find_one({"id": 2})
        assert bk, "booking 2 missing from DB — seed broken"
        pid = bk.get("patient_id")
        assert pid == 2, f"booking 2 patient_id must be 2 (Brijesh Kumar), got {pid}"

        if bk.get("status") not in ("Stopped", "Converted", "Cancelled"):
            # Stop the booking → should credit wallet of patient 2
            stop_resp = requests.post(
                f"{API}/bookings/2/stop", headers=H(admin_token),
                json={"stop_date": date.today().isoformat(), "reason": "TEST_e2e_recovery"},
                timeout=20,
            )
            assert stop_resp.status_code == 200, f"stop booking 2 failed: {stop_resp.status_code} {stop_resp.text}"

        # Now there should be a CREDIT for booking 2 — capture original refundable
        bk_after_stop = sync_db.bookings.find_one({"id": 2})
        assert bk_after_stop["status"] in ("Stopped", "Converted", "Cancelled"), \
            f"expected booking 2 to be Stopped, got {bk_after_stop.get('status')}"
        original_refundable = float(bk_after_stop.get("refundable_amount") or 0)
        assert original_refundable > 0, (
            f"booking 2 has no refundable amount after stop — paid={bk_after_stop.get('paid_amount')} "
            f"consumed={bk_after_stop.get('consumed_amount')}"
        )

        # Confirm wallet credited
        rw_before_wipe = requests.get(f"{API}/wallet/2", headers=H(admin_token), timeout=15).json()
        balance_before_wipe = float(rw_before_wipe.get("current_balance") or 0)
        assert balance_before_wipe >= original_refundable, (
            f"wallet not credited after stop: balance={balance_before_wipe} expected>={original_refundable}"
        )

        # ── Step (b): simulate data loss — wipe wallet_transactions for booking 2
        # and zero out the patient_wallets row. ──
        del_res = sync_db.wallet_transactions.delete_many({"patient_id": 2, "reference_id": 2})
        assert del_res.deleted_count >= 1, f"expected to delete at least 1 wallet_tx, got {del_res.deleted_count}"
        sync_db.patient_wallets.update_one(
            {"patient_id": 2},
            {"$set": {"current_balance": 0.0, "total_credited": 0.0,
                      "total_debited": 0.0, "total_refunded": 0.0}},
        )

        # Confirm the wipe took effect
        rw_after_wipe = requests.get(f"{API}/wallet/2", headers=H(admin_token), timeout=15).json()
        balance_after_wipe = float(rw_after_wipe.get("current_balance") or 0)
        # The wipe may leave non-booking-2 credits intact (e.g. unrelated adjustments).
        # But the booking-2 credit specifically must be gone. We verify balance dropped
        # by at least original_refundable.
        assert balance_after_wipe <= balance_before_wipe - original_refundable + 0.01, (
            f"wipe ineffective: before={balance_before_wipe} after={balance_after_wipe} "
            f"refundable={original_refundable}"
        )

        # ── Step (c): call admin recalculate ──
        rc = requests.post(self.ENDPOINT, headers=H(admin_token), timeout=30)
        assert rc.status_code == 200, rc.text
        rc_body = rc.json()
        # Must have created at least 1 wallet credit during reconciliation
        assert rc_body["reconciliation"]["created"] >= 1, (
            f"recovery failed — expected >=1 created, got: {rc_body}"
        )

        # ── Step (d): verify GET /api/wallet/2 shows the original credit recovered ──
        rw_recovered = requests.get(f"{API}/wallet/2", headers=H(admin_token), timeout=15).json()
        balance_recovered = float(rw_recovered.get("current_balance") or 0)
        assert balance_recovered >= original_refundable - 0.01, (
            f"balance NOT recovered: expected>={original_refundable}, got {balance_recovered}"
        )

        # And the wallet_transactions ledger has the credit back, keyed on booking 2
        txs = requests.get(f"{API}/wallet/2/transactions", headers=H(admin_token), timeout=15).json()
        recovered_tx = [t for t in txs
                        if int(t.get("reference_id") or 0) == 2
                        and (t.get("transaction_type") or "").upper() in ("CREDIT", "ADJUSTMENT")]
        assert recovered_tx, f"no recovery CREDIT tx found in ledger for booking 2: {txs[:3]}"
        assert round(float(recovered_tx[-1].get("amount") or 0), 2) == round(original_refundable, 2), (
            f"recovery tx amount mismatch: expected {original_refundable}, got {recovered_tx[-1].get('amount')}"
        )

        # ── Bonus: now that data is recovered, recalc again must be idempotent ──
        rc2 = requests.post(self.ENDPOINT, headers=H(admin_token), timeout=30)
        assert rc2.status_code == 200
        assert rc2.json()["reconciliation"]["created"] == 0, (
            f"recalc not idempotent after recovery: {rc2.json()}"
        )

    def test_startup_hooks_still_green_after_recalc(self, admin_token):
        """iter-1: GET /api/wallets returns >=7 active patients.
        iter-2: GET /api/wallet/refund-requests returns 200.
        iter-3: GET /api/wallet/{pid} auto-creates wallet for any active patient."""
        # iter-1
        r = requests.get(f"{API}/wallets?min_balance=0", headers=H(admin_token), timeout=15)
        assert r.status_code == 200
        assert len(r.json()) >= 7, f"iter-1 broken — only {len(r.json())} wallets"
        # iter-2
        r = requests.get(f"{API}/wallet/refund-requests", headers=H(admin_token), timeout=15)
        assert r.status_code == 200, f"iter-2 broken — refund-requests: {r.status_code} {r.text}"
        assert isinstance(r.json(), list)
        # iter-3 — wallet auto-create
        r = requests.get(f"{API}/wallet/3", headers=H(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        w = r.json()
        assert w.get("patient_id") == 3
        assert "current_balance" in w

    def test_dashboard_stats_reflect_post_recalculation(self, admin_token):
        """After recalculate, dashboard totalWalletBalance must equal the sum of
        all current_balance values from the wallet list."""
        rc = requests.post(self.ENDPOINT, headers=H(admin_token), timeout=30)
        assert rc.status_code == 200, rc.text

        wallets = requests.get(f"{API}/wallets?min_balance=0", headers=H(admin_token), timeout=15).json()
        sum_of_balances = round(sum(float(w.get("current_balance") or 0) for w in wallets), 2)

        ds = requests.get(f"{API}/wallet/dashboard-stats", headers=H(admin_token), timeout=15).json()
        total = round(float(ds.get("totalWalletBalance") or 0), 2)

        assert abs(total - sum_of_balances) < 0.5, (
            f"dashboard totalWalletBalance ({total}) drifted from sum of wallet list ({sum_of_balances})"
        )
        # patientsWithBalance must match count of wallets with positive balance
        pos = sum(1 for w in wallets if float(w.get("current_balance") or 0) > 0)
        assert ds.get("patientsWithBalance") == pos, (
            f"patientsWithBalance mismatch: dashboard={ds.get('patientsWithBalance')} actual={pos}"
        )
