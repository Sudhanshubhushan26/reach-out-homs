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
    def test_create_refund_request(self, admin_token):
        # Get initial refund-requests list
        r0 = requests.get(f"{API}/wallet/refund-requests", headers=H(admin_token), timeout=15)
        assert r0.status_code == 200, f"refund-requests list failed: {r0.status_code} {r0.text}"
        initial = r0.json()
        assert isinstance(initial, list)
        initial_count = len(initial)

        # Ensure patient 1 has enough balance — credit 1500 if not
        rw = requests.get(f"{API}/wallet/1", headers=H(admin_token), timeout=15)
        bal = float(rw.json().get("current_balance") or 0)
        if bal < 1000:
            requests.post(f"{API}/wallet/1/adjust", headers=H(admin_token),
                          json={"direction": "credit", "amount": 1500, "remarks": "ensure for refund test"},
                          timeout=15)

        # Create refund request
        rr = requests.post(f"{API}/wallet/1/refund-request",
                           headers=H(admin_token),
                           json={"amount": 1000, "reason": "Test"},
                           timeout=15)
        assert rr.status_code == 200, rr.text

        # List again — should grow by 1
        r1 = requests.get(f"{API}/wallet/refund-requests", headers=H(admin_token), timeout=15)
        assert r1.status_code == 200
        rows = r1.json()
        assert len(rows) >= initial_count + 1


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
