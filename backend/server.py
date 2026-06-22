"""
Reach Out Healthcare Operations Management System — FastAPI + MongoDB
Migrated from Node.js/SQLite, keeping the same endpoint surface so the existing
React frontend works unchanged.

All routes are prefixed with `/api` to comply with the Kubernetes ingress.
"""
from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Form, Header, Query
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
import jwt
import os, asyncio, random, re, json, math, logging
from pathlib import Path
from dotenv import load_dotenv
from datetime import datetime, timezone, timedelta, date as dt_date
from typing import Optional, List, Dict, Any

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

UPLOAD_DIR = ROOT_DIR / "uploads"
for sub in ["staff", "patients", "assets"]:
    (UPLOAD_DIR / sub).mkdir(parents=True, exist_ok=True)

JWT_SECRET = os.environ.get("JWT_SECRET", "reachout_secret_2026_dev_only")
JWT_ALG = "HS256"

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

logger = logging.getLogger("reachout")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

app = FastAPI(title="Reach Out HOMS")
api = APIRouter(prefix="/api")

# ── Counter / id helpers ───────────────────────────────────────────────────
async def next_id(col: str) -> int:
    res = await db.counters.find_one_and_update(
        {"_id": col}, {"$inc": {"seq": 1}}, upsert=True, return_document=True
    )
    return res["seq"]

def now_iso() -> str: return datetime.now(timezone.utc).isoformat()
def today() -> str: return dt_date.today().isoformat()
def in_days(n: int) -> str: return (dt_date.today() + timedelta(days=n)).isoformat()
def strip_mongo(doc):
    if not doc: return doc
    doc.pop("_id", None)
    return doc

# ── Auth ───────────────────────────────────────────────────────────────────
def make_token(payload: dict) -> str:
    p = {**payload, "exp": datetime.now(timezone.utc) + timedelta(days=1)}
    return jwt.encode(p, JWT_SECRET, algorithm=JWT_ALG)

async def current_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "No token")
    try:
        return jwt.decode(authorization.split(" ", 1)[1], JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid token")

# ── RBAC ───────────────────────────────────────────────────────────────────
ROLES = ["admin", "manager", "supervisor", "accountant", "foe", "staff"]
PERMS = {
    "admin": {"*"},
    "manager": {"staff:read","staff:write","patient:read","patient:write","booking:*","payroll:read","payroll:write","report:*","analytics:*","compliance:*","refund:verify","refund:approve","roster:*","incident:*"},
    "supervisor": {"staff:read","patient:read","booking:read","roster:read","roster:write","attendance:read","incident:read","incident:write","report:read"},
    "accountant": {"bill:*","refund:verify","payroll:read","report:read","analytics:read"},
    "foe": {"lead:*","patient:read","patient:write","booking:read","booking:write","refund:initiate"},
    "staff":  {"self:*","attendance:write","chart:*","incident:write"},
}
def has_perm(user_role: str, perm: str) -> bool:
    p = PERMS.get(user_role, set())
    if "*" in p: return True
    if perm in p: return True
    head = perm.split(":")[0] + ":*"
    return head in p

def require(perm: str):
    async def dep(user=Depends(current_user)):
        if not has_perm(user.get("role",""), perm):
            raise HTTPException(403, f"Forbidden: requires {perm}")
        return user
    return dep

# ── Audit log ──────────────────────────────────────────────────────────────
def _sanitize(obj):
    """Recursively strip ObjectId / make a JSON-safe deep copy."""
    if obj is None: return None
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items() if k != "_id"}
    if isinstance(obj, list):
        return [_sanitize(x) for x in obj]
    if isinstance(obj, (str, int, float, bool)): return obj
    return str(obj)  # ObjectId, datetime, etc. → string

async def audit(user, action: str, target_type: str, target_id=None, before=None, after=None, notes: str = ""):
    try:
        await db.audit_logs.insert_one({
            "id": await next_id("audit_logs"),
            "user_id": user.get("id"), "user_name": user.get("name"), "user_role": user.get("role"),
            "action": action, "target_type": target_type, "target_id": target_id,
            "before": _sanitize(before), "after": _sanitize(after), "notes": notes,
            "created_at": now_iso(),
        })
    except Exception as e:
        logger.warning(f"audit failed: {e}")

# ── Role helpers (Super Admin / Manager / Coordinator) ────────────────────
SUPER_ADMIN_ROLES = {"admin"}
MANAGER_ROLES     = {"admin", "manager"}
COORDINATOR_ROLES = {"admin", "manager", "supervisor", "foe", "accountant"}

def is_super_admin(u): return u.get("role") in SUPER_ADMIN_ROLES
def is_manager_or_admin(u): return u.get("role") in MANAGER_ROLES
def role_label(u):
    r = u.get("role")
    return {"admin":"Super Admin","manager":"Manager","supervisor":"Coordinator",
            "foe":"Coordinator","accountant":"Coordinator","staff":"Staff"}.get(r, r or "")

# ── Wallet helpers ────────────────────────────────────────────────────────
async def _ensure_wallet(patient_id: int) -> Dict[str, Any]:
    w = await db.patient_wallets.find_one({"patient_id": patient_id}, {"_id": 0})
    if w:
        return w
    doc = {
        "id": await next_id("patient_wallets"),
        "patient_id": patient_id,
        "current_balance": 0.0,
        "total_credited":  0.0,
        "total_debited":   0.0,
        "total_refunded":  0.0,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.patient_wallets.insert_one(doc)
    return doc

async def _wallet_tx(patient_id: int, tx_type: str, amount: float,
                     reference_type: str, reference_id: Any,
                     remarks: str, user: Dict[str, Any]) -> Dict[str, Any]:
    """Immutable wallet transaction. tx_type ∈ CREDIT|DEBIT|REFUND|ADJUSTMENT.
       Raises 400 on invalid input or insufficient balance for DEBIT/REFUND."""
    if amount is None:
        raise HTTPException(400, "amount is required")
    try:
        amount = round(float(amount), 2)
    except Exception:
        raise HTTPException(400, "amount must be numeric")
    if amount <= 0:
        raise HTTPException(400, "amount must be > 0")
    tx_type = (tx_type or "").upper()
    if tx_type not in ("CREDIT", "DEBIT", "REFUND", "ADJUSTMENT"):
        raise HTTPException(400, f"Unknown transaction_type: {tx_type}")

    wallet = await _ensure_wallet(patient_id)
    bal = float(wallet.get("current_balance") or 0)

    if tx_type in ("CREDIT", "ADJUSTMENT"):
        new_bal = round(bal + amount, 2)
        inc = {"current_balance": amount, "total_credited": amount}
    else:  # DEBIT or REFUND
        if amount > bal + 1e-6:
            raise HTTPException(400, f"Insufficient wallet balance: have ₹{bal:.2f}, need ₹{amount:.2f}")
        new_bal = round(bal - amount, 2)
        if tx_type == "REFUND":
            inc = {"current_balance": -amount, "total_refunded": amount}
        else:
            inc = {"current_balance": -amount, "total_debited": amount}

    await db.patient_wallets.update_one(
        {"patient_id": patient_id},
        {"$inc": inc, "$set": {"updated_at": now_iso()}}
    )
    tx_doc = {
        "id": await next_id("wallet_transactions"),
        "patient_id": patient_id,
        "transaction_type": tx_type,
        "amount": amount,
        "reference_type": reference_type or "",
        "reference_id": reference_id,
        "balance_before": round(bal, 2),
        "balance_after":  new_bal,
        "remarks": remarks or "",
        "created_by": user.get("name") or user.get("username") or "system",
        "created_by_role": user.get("role"),
        "created_at": now_iso(),
    }
    await db.wallet_transactions.insert_one(tx_doc)
    tx_doc.pop("_id", None)
    return tx_doc

def _parse_date(s: Optional[str]):
    if not s: return None
    try: return dt_date.fromisoformat(s[:10])
    except Exception: return None

def _calc_consumed_amount(booking: Dict[str, Any], as_of_date: Optional[str] = None) -> float:
    """Estimate consumed amount for a booking up to as_of_date (inclusive).
       Prefers rate_per_shift × shifts_used; falls back to prorating amount over duration."""
    as_of = _parse_date(as_of_date) or dt_date.today()
    s = _parse_date(booking.get("start_date"))
    if not s:
        return 0.0
    e = _parse_date(booking.get("end_date"))
    used_until = min(as_of, e) if e else as_of
    if used_until < s:
        return 0.0
    days_used = (used_until - s).days + 1  # inclusive

    rate = booking.get("rate_per_shift")
    if rate not in (None, "", 0):
        try:
            return round(float(rate) * days_used, 2)
        except Exception:
            pass
    total = float(booking.get("amount") or 0)
    if e:
        total_days = (e - s).days + 1
        if total_days > 0:
            return round(total * (days_used / total_days), 2)
    return 0.0


# ── Weighted rating ────────────────────────────────────────────────────────
RATING_WEIGHTS = {
    "patient_feedback": 0.40,
    "family_feedback": 0.20,
    "punctuality": 0.15,
    "tat": 0.10,
    "training": 0.10,
    "supervisor": 0.05,
}
async def recalc_weighted_rating(staff_id: int):
    """Compute weighted rating using source weights; fall back to avg if no sources tagged."""
    pipe = [
        {"$match": {"staff_id": staff_id}},
        {"$group": {"_id": "$source", "avg": {"$avg": "$score"}, "count": {"$sum": 1}}},
    ]
    rows = await db.staff_ratings.aggregate(pipe).to_list(50)
    if not rows: return
    src_map = {r["_id"] or "patient_feedback": r["avg"] for r in rows}
    # Normalise source labels
    alias = {
        "Patient Feedback": "patient_feedback", "Patient": "patient_feedback",
        "Family": "family_feedback", "Family Feedback": "family_feedback",
        "Punctuality": "punctuality",
        "TAT": "tat", "Duty Completion TAT": "tat",
        "Training": "training", "Training Score": "training",
        "Supervisor": "supervisor", "Supervisor Feedback": "supervisor",
    }
    bucket = {k: 0.0 for k in RATING_WEIGHTS}
    bucket_w = {k: 0.0 for k in RATING_WEIGHTS}
    fallback_avg, fallback_n = 0.0, 0
    for label, avg in src_map.items():
        key = alias.get(label, label if label in RATING_WEIGHTS else "patient_feedback")
        bucket[key] += avg; bucket_w[key] += 1
        fallback_avg += avg; fallback_n += 1
    used_w = 0.0; rating = 0.0
    for k, w in RATING_WEIGHTS.items():
        if bucket_w[k] > 0:
            rating += (bucket[k] / bucket_w[k]) * w
            used_w += w
    final = rating / used_w if used_w > 0 else (fallback_avg / fallback_n if fallback_n else 0)
    await db.staff.update_one({"id": staff_id}, {"$set": {"rating": round(final, 2)}})
    return round(final, 2)

# ── Seed ───────────────────────────────────────────────────────────────────
async def seed():
    if not await db.users.find_one({"username": "admin"}):
        await db.users.insert_one({
            "id": await next_id("users"), "username": "admin",
            "password": pwd_ctx.hash("Admin@1234"),
            "role": "admin", "name": "Super Admin", "status": "Active",
            "created_at": now_iso(),
        })
    # Seed extra role users
    extra_users = [
        ("manager", "Manager@1234", "manager", "Operations Manager"),
        ("supervisor", "Super@1234", "supervisor", "Field Supervisor"),
        ("accountant", "Account@1234", "accountant", "Finance Accountant"),
        ("foe", "Foe@1234", "foe", "Front Office Executive"),
    ]
    for uname, pwd, role, name in extra_users:
        if not await db.users.find_one({"username": uname}):
            await db.users.insert_one({
                "id": await next_id("users"), "username": uname,
                "password": pwd_ctx.hash(pwd), "role": role, "name": name,
                "status": "Active", "created_at": now_iso(),
            })
    if not await db.staff.find_one({"code": "RO001"}):
        staff_seed = [
            ("RO001","Prachi Sharma","Nurse","Nursing","MedCare Staffing","On Duty",4.8,"9876541001","Rohini, Delhi","B.Sc Nursing","6 years","Permanent","25000"),
            ("RO002","Anita Verma","Nurse","Nursing","MedCare Staffing","Available",4.6,"9876541002","Dwarka, Delhi","GNM Nursing","4 years","Permanent","22000"),
            ("RO003","Ramesh Kumar","GDA","GDA","HealthLink","On Duty",4.2,"9876541003","Uttam Nagar, Delhi","GDA Certificate","3 years","Contractual","15000"),
            ("RO004","Sunita Devi","Aaya","GDA","HealthLink","Available",4.0,"9876541004","Nangloi, Delhi","10th Pass","2 years","Contractual","12000"),
            ("RO005","Dr. Kavita Joshi","Physiotherapist","Allied Health","PhysioPlus","Available",4.9,"9876541005","Paschim Vihar, Delhi","BPT, MPT","7 years","Permanent","35000"),
            ("RO006","Mohan Lal","Driver","Driver","MedCare Staffing","On Duty",4.3,"9876541006","Shahdara, Delhi","12th Pass","5 years","Permanent","18000"),
            ("RO007","Poonam Tiwari","Nurse","Nursing","MedCare Staffing","On Leave",4.5,"9876541007","Pitampura, Delhi","B.Sc Nursing","3 years","Permanent","22000"),
            ("RO008","Suresh Yadav","GDA","GDA","HealthLink","Available",3.9,"9876541008","Burari, Delhi","GDA Certificate","1 year","Contractual","14000"),
            ("RO009","Deepa Singh","Nurse","Nursing","PhysioPlus","On Duty",4.7,"9876541009","Janakpuri, Delhi","B.Sc Nursing","5 years","Permanent","24000"),
            ("RO010","Rajesh Pandey","Helper","GDA","HealthLink","Available",4.1,"9876541010","Laxmi Nagar, Delhi","8th Pass","2 years","Contractual","11000"),
        ]
        for code,name,role,cat,vendor,duty,rating,mob,addr,qual,exp,emp_type,sal in staff_seed:
            await db.staff.insert_one({
                "id": await next_id("staff"), "code": code, "name": name, "role": role,
                "category": cat, "vendor": vendor, "duty_tag": duty, "status": "Active",
                "rating": rating, "mobile": mob, "address": addr, "qualification": qual,
                "experience": exp, "employment_type": emp_type, "salary": sal,
                "joining_date": (dt_date.today() - timedelta(days=random.randint(60, 730))).isoformat(),
                "photo": "", "created_at": now_iso(),
            })
    if not await db.patients.find_one({"reg_number": "RO-PAT-001"}):
        pseed = [
            ("RO-PAT-001","SGRH-10234","Nitin Gupta","58","Male","9811001001","C-14, Sector 8, Rohini, Delhi","SGRH","Post-operative rehabilitation after CABG","Dr. Suresh Mehta","Home","Internal Home","A+","Aspirin, Atorvastatin","Diabetes, Hypertension"),
            ("RO-PAT-002","SGRH-10235","Brijesh Kumar","72","Male","9811001002","Plot 22, Janakpuri Block B, Delhi","SGRH","Stroke rehabilitation, left-sided hemiplegia","Dr. A.K. Sharma","Home","Internal Home","B+","Clopidogrel, Amlodipine","Hypertension, Atrial Fibrillation"),
            ("RO-PAT-003","SGRH-10236","Kamla Devi","68","Female","9811001003","H-45, Uttam Nagar, Delhi","SGRH","Palliative care, advanced COPD","Dr. Rekha Singh","Home","External Home","O+","Salbutamol, Prednisolone","COPD, Hypothyroidism"),
            ("RO-PAT-004","SGRH-10237","Rajesh Sharma","55","Male","9811001004","D-112, Paschim Vihar, Delhi","","ICU at Home post-ventilator weaning","Dr. V.K. Gupta","Home","External Home","AB+","Linezolid, Pantoprazole","Pneumonia, Type 2 Diabetes"),
            ("RO-PAT-005","SGRH-10238","Anita Kapoor","45","Female","9811001005","12/3, Subhash Nagar, Delhi","SGRH","Post-caesarean mother and baby care","Dr. Priya Nanda","Home","Internal Home","A-","Iron supplements, Calcium","Gestational Diabetes"),
            ("RO-PAT-006","","Harish Chandra","80","Male","9811001006","2B, Model Town, Delhi","Apollo","Wound care — diabetic foot ulcer","Dr. M. Jain","Home","External Home","B-","Metformin, Insulin","Type 2 Diabetes, CKD"),
            ("RO-PAT-007","SGRH-10239","Sunita Agarwal","62","Female","9811001007","Flat 4C, Dwarka Sector 10, Delhi","SGRH","Hip replacement post-op physiotherapy","Dr. R.K. Verma","Home","Internal Home","O+","Tramadol, Pantoprazole","Osteoporosis, Hypertension"),
        ]
        for reg,sgrh,name,age,gender,mob,addr,hosp,diag,doc,sloc,cat,bg,meds,allerg in pseed:
            await db.patients.insert_one({
                "id": await next_id("patients"), "reg_number": reg, "sgrh_reg": sgrh,
                "name": name, "age": age, "gender": gender, "mobile": mob, "address": addr,
                "hospital": hosp, "diagnosis": diag, "doctor_name": doc, "service_location": sloc,
                "category": cat, "status": "Active", "blood_group": bg,
                "current_medications": meds, "allergies": allerg, "frozen": 0,
                "photo": "", "created_at": now_iso(),
            })
        p1 = await db.patients.find_one({"reg_number": "RO-PAT-001"})
        p2 = await db.patients.find_one({"reg_number": "RO-PAT-002"})
        s1 = await db.staff.find_one({"code": "RO001"})
        s3 = await db.staff.find_one({"code": "RO003"})
        for bk_id, p, s, svc, amt, paid in [
            ("BK-2026001", p1, s1, "24-Hour Nursing", 45000, 30000),
            ("BK-2026002", p2, s3, "Physiotherapy (Specialized)", 28000, 28000),
        ]:
            if p and s:
                await db.bookings.insert_one({
                    "id": await next_id("bookings"), "booking_id": bk_id,
                    "patient_id": p["id"], "service_category": "Nursing",
                    "service_name": svc, "start_date": in_days(-15), "end_date": in_days(45),
                    "shift": "24-Hour", "staff_id": s["id"], "status": "Active",
                    "amount": amt, "paid_amount": paid, "balance": amt-paid,
                    "payment_mode": "NEFT", "payment_status": "Paid" if amt==paid else "Partial",
                    "created_by": "Admin", "created_at": now_iso(),
                    "expires_at": in_days(30),
                })
                await db.bills.insert_one({
                    "id": await next_id("bills"),
                    "receipt_number": f"RO-RCP-{bk_id[-3:]}",
                    "booking_id": bk_id, "patient_id": p["id"], "patient_name": p["name"],
                    "service": svc, "amount": amt, "paid_amount": paid, "balance": amt-paid,
                    "payment_mode": "NEFT", "payment_status": "Paid" if amt==paid else "Partial",
                    "date": today(), "refund_amount": 0,
                })
    if not await db.leads.find_one({"caller_mobile": "9811002001"}):
        leads = [
            ("Vikram Singh","9811002001","Son","Helpline","Ashok Kumar","68","Male","Punjabi Bagh, Delhi","Post-stroke care","24-Hour Nursing","Immediate","New"),
            ("Meena Sharma","9811002002","Daughter","Hospital Referral","Shanti Devi","75","Female","Model Town, Delhi","Hip fracture rehab","Physiotherapy","Planned","Contacted"),
            ("Arun Kapoor","9811002003","Self","WhatsApp","Arun Kapoor","52","Male","Rohini, Delhi","Diabetic wound care","Wound Dressing","Immediate","Assessment Scheduled"),
            ("Priya Nair","9811002004","Spouse","Doctor Referral","Rajan Nair","60","Male","Janakpuri, Delhi","Ventilator weaning support","ICU at Home","Immediate","Quote Sent"),
            ("Sunil Kumar","9811002005","Brother","Website","Ramesh Kumar","45","Male","Dwarka, Delhi","Post-surgery nursing","12-Hour Nursing","Planned","Follow-Up"),
        ]
        for cn,cm,rel,src,pn,pa,pg,paddr,diag,svc,urg,status in leads:
            await db.leads.insert_one({
                "id": await next_id("leads"), "caller_name": cn, "caller_mobile": cm,
                "relation": rel, "source": src, "patient_name": pn, "patient_age": pa,
                "patient_gender": pg, "patient_address": paddr, "diagnosis": diag,
                "service_needed": svc, "urgency": urg, "status": status,
                "follow_up_date": in_days(2), "created_at": now_iso(),
            })
    if not await db.ambulance_calls.find_one({"call_number": "AMB-001"}):
        await db.ambulance_calls.insert_one({"id": await next_id("ambulance_calls"), "call_number":"AMB-001","caller_name":"Rajesh Gupta","caller_mobile":"9811003001","patient_name":"Nitin Gupta","pickup_address":"C-14 Rohini Delhi","drop_address":"SGRH New Delhi","call_type":"Local","ambulance_type":"BLS","priority":"Normal","assigned_driver":"Mohan Lal","assigned_vehicle":"DL-01-XY-1234","status":"Completed","amount":2500,"payment_status":"Paid","created_at":now_iso()})
        await db.ambulance_calls.insert_one({"id": await next_id("ambulance_calls"), "call_number":"AMB-002","caller_name":"Priya Nair","caller_mobile":"9811003002","patient_name":"Rajan Nair","pickup_address":"Janakpuri Delhi","drop_address":"Medanta Gurgaon","call_type":"Domestic","ambulance_type":"ALS","priority":"Emergency","status":"Received","amount":8000,"payment_status":"Pending","created_at":now_iso()})
    if not await db.vendors.find_one({"name": "MedCare Staffing"}):
        for n, t, c in [("MedCare Staffing","Staffing","9900001111"),("HealthLink","Staffing","9900002222"),("Apollo Medical","Equipment","9900003333"),("PhysioPlus","Staffing","9900004444")]:
            await db.vendors.insert_one({"id": await next_id("vendors"), "name": n, "type": t, "contact": c, "status": "Active", "created_at": now_iso()})
    if not await db.assets.find_one({"asset_code": {"$exists": True}}):
        for n, cat, vendor, sn, amc, cmc in [
            ("Ventilator A1","Medical Equipment","Apollo Medical","VEN-001",in_days(45),in_days(120)),
            ("Patient Monitor B2","Medical Equipment","Apollo Medical","MON-002",in_days(15),in_days(200)),
            ("Hospital Bed C3","Furniture","HealthLink","BED-003",in_days(-5),in_days(60)),
        ]:
            await db.assets.insert_one({"id": await next_id("assets"), "asset_code": f"AST-{await next_id('asset_code')}", "name": n, "category": cat, "vendor": vendor, "serial_number": sn, "purchase_date": in_days(-365), "warranty_expiry": in_days(180), "amc_date": amc, "cmc_date": cmc, "location": "Main Office", "status": "Active", "quantity": 1, "cost": 50000})

@app.on_event("startup")
async def on_start():
    await seed()
    await backfill_wallets()
    await reconcile_wallet_credits_from_bookings()
    await reconcile_wallet_credits_from_bills()
    await recompute_wallet_balances_from_transactions()
    logger.info("Reach Out HOMS backend started")


async def backfill_wallets():
    """Idempotent migration: ensure every patient has a `patient_wallets` doc.

    Safe to run on every startup — only creates wallets for patients that
    don't already have one. Existing balances are preserved.
    """
    try:
        pids_with_wallet = set()
        async for w in db.patient_wallets.find({}, {"patient_id": 1, "_id": 0}):
            pids_with_wallet.add(w.get("patient_id"))
        created = 0
        async for p in db.patients.find({}, {"id": 1, "_id": 0}):
            pid = p.get("id")
            if pid is None or pid in pids_with_wallet:
                continue
            await db.patient_wallets.insert_one({
                "id": await next_id("patient_wallets"),
                "patient_id": pid,
                "current_balance": 0.0,
                "total_credited":  0.0,
                "total_debited":   0.0,
                "total_refunded":  0.0,
                "created_at": now_iso(),
                "updated_at": now_iso(),
            })
            created += 1
        if created:
            logger.info(f"Wallet backfill: created {created} missing wallet records")
        else:
            logger.info("Wallet backfill: all patients already have wallet records")
    except Exception as e:
        logger.warning(f"Wallet backfill failed: {e}")


async def reconcile_wallet_credits_from_bookings():
    """One-shot historical reconciliation.

    For every Stopped / Converted / Cancelled booking where the patient paid
    more than they consumed, ensure a corresponding wallet CREDIT transaction
    exists. If it doesn't (e.g. lost during a DB migration), create it now and
    update the wallet balance accordingly.

    Idempotent: we look up wallet_transactions by `reference_id == booking.id`
    and skip any that already have a credit recorded.
    """
    try:
        target_statuses = ("Stopped", "Converted", "Cancelled")
        bookings = await db.bookings.find(
            {"status": {"$in": list(target_statuses)}}, {"_id": 0}
        ).to_list(10000)
        created = 0
        skipped_existing = 0
        skipped_no_refund = 0
        for b in bookings:
            bid = b.get("id")
            pid = b.get("patient_id")
            if not bid or not pid:
                continue

            paid = float(b.get("paid_amount") or 0)
            # Prefer the value persisted by stop_booking/convert_booking;
            # otherwise compute from rates/dates.
            consumed = b.get("consumed_amount")
            if consumed is None:
                consumed = _calc_consumed_amount(b, b.get("stop_date") or b.get("end_date"))
            try:
                consumed = float(consumed or 0)
            except Exception:
                consumed = 0.0
            if consumed > paid:
                consumed = paid
            refundable = round(paid - consumed, 2)
            if refundable <= 0:
                skipped_no_refund += 1
                continue

            # Skip if we already recorded a credit for this booking
            existing = await db.wallet_transactions.find_one({
                "patient_id": pid,
                "reference_id": bid,
                "transaction_type": {"$in": ["CREDIT", "REFUND", "ADJUSTMENT"]},
            })
            if existing:
                skipped_existing += 1
                continue

            ref_type = "Service Conversion" if b.get("status") == "Converted" else "Service Cancellation"
            remarks = (
                f"[Reconciliation] {b.get('booking_id') or bid} {b.get('status','').lower()} "
                f"— consumed ₹{consumed:.2f} of paid ₹{paid:.2f}"
            )
            try:
                await _wallet_tx(
                    pid, "CREDIT", refundable,
                    ref_type, bid, remarks,
                    {"name": "system-reconciliation", "role": "admin"},
                )
                created += 1
            except Exception as e:
                logger.warning(f"reconcile: failed for booking {bid}: {e}")

        logger.info(
            f"Wallet reconciliation: created {created} credit txns "
            f"(skipped {skipped_existing} already-credited, {skipped_no_refund} with no refundable)"
        )
        return {
            "created": created,
            "skipped_already_credited": skipped_existing,
            "skipped_no_refundable": skipped_no_refund,
            "bookings_scanned": len(bookings),
        }
    except Exception as e:
        logger.warning(f"Wallet reconciliation failed: {e}")
        return {"error": str(e)}


async def reconcile_wallet_credits_from_bills():
    """Backfill wallet credits for existing PAID bills.

    For every bill with paid_amount > 0, ensure a wallet CREDIT transaction
    exists referenced as ("Bill", bill.id). Idempotent.
    Additional payments recorded in `bill.payments[]` (beyond the first) are
    each credited as ("Bill Payment", "{bid}.{idx}").
    """
    try:
        created_initial = 0
        created_extra = 0
        scanned = 0
        async for b in db.bills.find({}, {"_id": 0}):
            scanned += 1
            pid = b.get("patient_id")
            bid = b.get("id")
            if not pid or not bid:
                continue
            paid = float(b.get("paid_amount") or 0)
            payments = b.get("payments") or []
            # Initial bill credit (sum of first payment OR full paid if no payments[] history)
            initial_amount = float(payments[0]["amount"]) if payments else paid
            if initial_amount > 0:
                existing = await db.wallet_transactions.find_one({
                    "patient_id": pid, "reference_type": "Bill", "reference_id": bid,
                })
                if not existing:
                    try:
                        await _wallet_tx(
                            pid, "CREDIT", initial_amount,
                            "Bill", bid,
                            f"[Reconciliation] Bill #{b.get('receipt_number') or bid} payment recovered",
                            {"name": "system-reconciliation", "role": "admin"},
                        )
                        created_initial += 1
                    except Exception as e:
                        logger.warning(f"bill->wallet backfill failed for bill {bid}: {e}")
            # Additional payments (index >= 1)
            for i, p in enumerate(payments[1:], start=1):
                amt = float(p.get("amount") or 0)
                if amt <= 0: continue
                ref_id = f"{bid}.{i}"
                existing = await db.wallet_transactions.find_one({
                    "patient_id": pid, "reference_type": "Bill Payment", "reference_id": ref_id,
                })
                if existing: continue
                try:
                    await _wallet_tx(
                        pid, "CREDIT", amt,
                        "Bill Payment", ref_id,
                        f"[Reconciliation] Bill #{b.get('receipt_number') or bid} payment #{i+1} recovered",
                        {"name": "system-reconciliation", "role": "admin"},
                    )
                    created_extra += 1
                except Exception as e:
                    logger.warning(f"bill payment->wallet backfill failed for bill {bid} idx {i}: {e}")
        logger.info(
            f"Bill->wallet reconciliation: scanned {scanned}, "
            f"created {created_initial} initial credits + {created_extra} extra-payment credits"
        )
        return {"bills_scanned": scanned, "initial_credits_created": created_initial,
                "extra_payment_credits_created": created_extra}
    except Exception as e:
        logger.warning(f"Bill->wallet reconciliation failed: {e}")
        return {"error": str(e)}


async def recompute_wallet_balances_from_transactions():
    """Recompute every patient_wallet's totals from wallet_transactions.

    Safety net: if balances ever drift from the transaction ledger (data
    corruption, partial migration, mis-applied updates), this brings them
    back into agreement with the source of truth.
    """
    try:
        # Aggregate sums per patient + per transaction_type
        pipe = [
            {"$group": {
                "_id": {"pid": "$patient_id", "ty": "$transaction_type"},
                "total": {"$sum": "$amount"},
            }},
        ]
        rows = await db.wallet_transactions.aggregate(pipe).to_list(100000)
        agg: Dict[int, Dict[str, float]] = {}
        for r in rows:
            pid = r["_id"]["pid"]
            ty  = (r["_id"]["ty"] or "").upper()
            agg.setdefault(pid, {"CREDIT": 0.0, "ADJUSTMENT": 0.0, "DEBIT": 0.0, "REFUND": 0.0})
            if ty in agg[pid]:
                agg[pid][ty] += float(r["total"] or 0)
        updated = 0
        for pid, s in agg.items():
            credited = round(s["CREDIT"] + s["ADJUSTMENT"], 2)
            debited  = round(s["DEBIT"], 2)
            refunded = round(s["REFUND"], 2)
            balance  = round(credited - debited - refunded, 2)
            await db.patient_wallets.update_one(
                {"patient_id": pid},
                {"$set": {
                    "current_balance": balance,
                    "total_credited":  credited,
                    "total_debited":   debited,
                    "total_refunded":  refunded,
                    "updated_at": now_iso(),
                }},
                upsert=False,
            )
            updated += 1
        logger.info(f"Wallet balances recomputed from transactions for {updated} patients")
        return {"recomputed": updated}
    except Exception as e:
        logger.warning(f"Wallet balance recompute failed: {e}")
        return {"error": str(e)}

# ────────────────────────────────────────────────────────────────────────────
# AUTH
# ────────────────────────────────────────────────────────────────────────────
@api.post("/login")
async def login(body: Dict[str, Any]):
    u = await db.users.find_one({"username": body.get("username")})
    if not u: raise HTTPException(401, "User not found")
    if not pwd_ctx.verify(body.get("password", ""), u["password"]):
        raise HTTPException(401, "Invalid password")
    token = make_token({"id": u["id"], "role": u["role"], "name": u["name"]})
    return {"success": True, "role": u["role"], "name": u["name"], "token": token}

# ────────────────────────────────────────────────────────────────────────────
# DASHBOARD STATS
# ────────────────────────────────────────────────────────────────────────────
@api.get("/dashboard-stats")
async def dashboard_stats(user=Depends(current_user)):
    async def c(col, q={}): return await db[col].count_documents(q)
    async def sum_field(col, field, q={}):
        pipe = [{"$match": q}, {"$group": {"_id": None, "v": {"$sum": f"${field}"}}}]
        a = await db[col].aggregate(pipe).to_list(1)
        return a[0]["v"] if a else 0
    return {
        "totalPatients": await c("patients", {"status": "Active"}),
        "totalStaff": await c("staff", {"status": "Active"}),
        "staffOnDuty": await c("staff", {"duty_tag": "On Duty"}),
        "staffAvailable": await c("staff", {"duty_tag": "Available"}),
        "totalBookings": await c("bookings"),
        "activeBookings": await c("bookings", {"status": "Active"}),
        "pendingBookings": await c("bookings", {"status": "Pending"}),
        "pendingPayments": await c("bills", {"payment_status": "Pending"}),
        "totalRevenue": await sum_field("bills", "paid_amount"),
        "pendingBalance": await sum_field("bills", "balance", {"payment_status": {"$ne": "Paid"}}),
        "pendingRefunds": await c("refunds", {"status": "Pending"}),
        "ambulanceCalls": await c("ambulance_calls"),
        "todayAttendance": await c("attendance", {"date": today()}),
        "totalLeads": await c("leads", {"status": {"$nin": ["Converted", "Not Interested"]}}),
        "newLeads": await c("leads", {"status": "New"}),
        "pendingConsents": 0,
        "lowCompliance": 0,
        # Wallet rollups (Phase 3)
        "totalWalletBalance":    round(float(await sum_field("patient_wallets", "current_balance")), 2),
        "patientsWithWallet":    await c("patient_wallets", {"current_balance": {"$gt": 0}}),
        "pendingWalletRefunds":  await c("wallet_refund_requests", {"status": "Pending"}),
    }

# ────────────────────────────────────────────────────────────────────────────
# Generic helper for list endpoints
# ────────────────────────────────────────────────────────────────────────────
async def list_col(col, q=None, sort=("id", -1), limit=2000):
    q = q or {}
    cursor = db[col].find(q, {"_id": 0}).sort(*sort).limit(limit)
    return await cursor.to_list(limit)

# ────────────────────────────────────────────────────────────────────────────
# STAFF
# ────────────────────────────────────────────────────────────────────────────
@api.get("/staff")
async def list_staff(role: Optional[str]=None, vendor: Optional[str]=None, status: Optional[str]=None,
                     duty_tag: Optional[str]=None, category: Optional[str]=None, search: Optional[str]=None,
                     user=Depends(current_user)):
    q = {}
    for k, v in [("role", role), ("vendor", vendor), ("status", status), ("duty_tag", duty_tag), ("category", category)]:
        if v: q[k] = v
    if search:
        q["$or"] = [{"name": {"$regex": search, "$options": "i"}}, {"code": {"$regex": search, "$options": "i"}}]
    rows = await list_col("staff", q)
    # add doc_count
    for r in rows:
        r["doc_count"] = await db.staff_documents.count_documents({"staff_id": r["id"]})
    return rows

@api.get("/staff/available")
async def staff_available(date: Optional[str]=None, shift: Optional[str]=None, role: Optional[str]=None, vendor: Optional[str]=None, user=Depends(current_user)):
    check_date = date or today()
    q = {"status": "Active", "duty_tag": {"$nin": ["Suspended","Terminated"]}}
    if role: q["role"] = role
    if vendor: q["vendor"] = vendor
    rows = await list_col("staff", q, sort=("rating", -1))
    for r in rows:
        active_bookings = await db.bookings.count_documents({"staff_id": r["id"], "status": "Active"})
        today_roster = await db.roster.count_documents({"staff_id": r["id"], "date": check_date})
        r["active_bookings"] = active_bookings
        r["today_roster"] = today_roster
        r["availability_status"] = (
            "Rostered" if today_roster > 0 else
            "On Assignment" if active_bookings > 0 else
            "Free" if r.get("duty_tag")=="Available" else r.get("duty_tag")
        )
    return rows

@api.get("/staff/{sid}")
async def get_staff(sid: int, user=Depends(current_user)):
    r = await db.staff.find_one({"id": sid}, {"_id": 0})
    if not r: raise HTTPException(404, "Not found")
    return r

@api.post("/staff")
async def create_staff(d: Dict[str, Any], user=Depends(current_user)):
    last = await db.staff.find({"code": {"$regex": "^RO"}}).sort("code", -1).limit(1).to_list(1)
    nxt = 1
    if last:
        m = re.match(r"RO(\d+)", last[0].get("code", ""))
        if m: nxt = int(m.group(1)) + 1
    code = f"RO{nxt:03d}"
    sid = await next_id("staff")
    doc = {"id": sid, "code": code, "status": d.get("status","Active"), "duty_tag": d.get("duty_tag","Available"),
           "rating": 0, "photo": "", "created_at": now_iso(), **{k: v for k, v in d.items() if k not in ("id","code")}}
    await db.staff.insert_one(doc)
    return {"id": sid, "code": code, "message": "Staff Created"}

@api.put("/staff/{sid}")
async def update_staff(sid: int, d: Dict[str, Any], user=Depends(current_user)):
    d.pop("id", None); d.pop("_id", None)
    await db.staff.update_one({"id": sid}, {"$set": d})
    return {"message": "Staff Updated"}

@api.delete("/staff/{sid}")
async def del_staff(sid: int, user=Depends(current_user)):
    await db.staff.delete_one({"id": sid})
    return {"message": "Staff Deleted"}

@api.patch("/staff/{sid}/duty-tag")
async def patch_duty(sid: int, body: Dict[str, Any], user=Depends(current_user)):
    await db.staff.update_one({"id": sid}, {"$set": {"duty_tag": body.get("duty_tag")}})
    return {"message": "Duty tag updated"}

# Documents
@api.post("/staff/{sid}/photo")
async def upload_staff_photo(sid: int, photo: UploadFile = File(...)):
    UPLOAD_DIR.joinpath("staff/photos").mkdir(parents=True, exist_ok=True)
    ext = (photo.filename or "img.jpg").rsplit(".", 1)[-1].lower()
    fname = f"staff-{sid}-{int(datetime.now().timestamp()*1000)}.{ext}"
    path = UPLOAD_DIR / "staff" / "photos" / fname
    path.write_bytes(await photo.read())
    rel = str(path.relative_to(ROOT_DIR))
    await db.staff.update_one({"id": sid}, {"$set": {"photo": rel}})
    return {"message": "Photo uploaded", "photo": rel}

@api.post("/staff/{sid}/documents")
async def upload_staff_doc(sid: int, document: UploadFile = File(...),
                           documentType: str = Form(""), expiry_date: str = Form("")):
    path = UPLOAD_DIR / "staff" / f"{documentType or 'doc'}-{int(datetime.now().timestamp()*1000)}-{document.filename}"
    path.write_bytes(await document.read())
    await db.staff_documents.insert_one({
        "id": await next_id("staff_documents"), "staff_id": sid,
        "document_type": documentType, "document_name": document.filename,
        "file_path": str(path.relative_to(ROOT_DIR)),
        "expiry_date": expiry_date or None, "upload_date": today(),
    })
    return {"message": "Document uploaded"}

@api.get("/staff/{sid}/documents")
async def list_staff_docs(sid: int, user=Depends(current_user)):
    return await list_col("staff_documents", {"staff_id": sid})

# ────────────────────────────────────────────────────────────────────────────
# ATTENDANCE
# ────────────────────────────────────────────────────────────────────────────
@api.post("/attendance/login")
async def att_login(staff_id: int = Form(...), lat: str = Form(""), lng: str = Form(""),
                    photo: Optional[UploadFile] = File(None)):
    d = today()
    if await db.attendance.find_one({"staff_id": staff_id, "date": d}):
        raise HTTPException(400, "Already logged in today")
    pp = ""
    if photo:
        path = UPLOAD_DIR / "staff" / f"login-{staff_id}-{int(datetime.now().timestamp()*1000)}.jpg"
        path.write_bytes(await photo.read()); pp = str(path.relative_to(ROOT_DIR))
    await db.attendance.insert_one({
        "id": await next_id("attendance"), "staff_id": staff_id, "date": d,
        "login_time": now_iso(), "login_photo": pp,
        "login_lat": float(lat) if lat else None, "login_lng": float(lng) if lng else None,
        "status": "Present",
    })
    await db.staff.update_one({"id": staff_id}, {"$set": {"duty_tag": "On Duty"}})
    return {"message": "Logged in"}

@api.post("/attendance/logout")
async def att_logout(body: Dict[str, Any], user=Depends(current_user)):
    sid = body.get("staff_id"); d = today()
    rec = await db.attendance.find_one({"staff_id": sid, "date": d, "logout_time": None})
    if not rec:
        rec = await db.attendance.find_one({"staff_id": sid, "date": d, "logout_time": {"$exists": False}})
    if not rec: raise HTTPException(400, "No active login found")
    login_dt = datetime.fromisoformat(rec["login_time"].replace("Z",""))
    hours = round((datetime.now(timezone.utc) - login_dt.replace(tzinfo=timezone.utc)).total_seconds() / 3600, 2)
    await db.attendance.update_one({"id": rec["id"]}, {"$set": {"logout_time": now_iso(), "hours_worked": hours}})
    await db.staff.update_one({"id": sid}, {"$set": {"duty_tag": "Available"}})
    return {"message": "Logged out"}

@api.get("/attendance")
async def list_attendance(staff_id: Optional[int]=None, date: Optional[str]=None,
                          frm: Optional[str]=Query(None, alias="from"), to: Optional[str]=None,
                          vendor: Optional[str]=None, user=Depends(current_user)):
    q = {}
    if staff_id: q["staff_id"] = staff_id
    if date: q["date"] = date
    if frm: q.setdefault("date", {}).update({"$gte": frm}) if isinstance(q.get("date"), dict) else q.update({"date": {"$gte": frm}})
    if to: q.setdefault("date", {}).update({"$lte": to}) if isinstance(q.get("date"), dict) else q.update({"date": {"$lte": to}})
    rows = await list_col("attendance", q, sort=("date", -1))
    # join staff
    staff_map = {s["id"]: s for s in await list_col("staff")}
    for r in rows:
        s = staff_map.get(r.get("staff_id"), {})
        r["staff_name"] = s.get("name"); r["role"] = s.get("role"); r["vendor"] = s.get("vendor"); r["code"] = s.get("code")
    if vendor: rows = [r for r in rows if r.get("vendor") == vendor]
    return rows

# ────────────────────────────────────────────────────────────────────────────
# RATINGS / TRAINING / INCIDENTS
# ────────────────────────────────────────────────────────────────────────────
@api.post("/staff/{sid}/ratings")
async def add_rating(sid: int, body: Dict[str, Any], user=Depends(current_user)):
    await db.staff_ratings.insert_one({"id": await next_id("staff_ratings"), "staff_id": sid,
        "patient_id": body.get("patient_id"), "source": body.get("source"),
        "score": body.get("score"), "comment": body.get("comment"), "rated_at": now_iso()})
    new_rating = await recalc_weighted_rating(sid)
    await audit(user, "create", "staff_rating", sid, after={"score": body.get("score"), "source": body.get("source")})
    return {"message": "Rating submitted", "weighted_rating": new_rating}

@api.get("/staff/{sid}/ratings")
async def get_ratings(sid: int, user=Depends(current_user)):
    return await list_col("staff_ratings", {"staff_id": sid}, sort=("rated_at", -1))

@api.get("/training")
async def list_training(staff_id: Optional[int]=None, user=Depends(current_user)):
    q = {"staff_id": staff_id} if staff_id else {}
    rows = await list_col("training", q, sort=("date", -1))
    smap = {s["id"]: s for s in await list_col("staff")}
    for r in rows: r["staff_name"] = smap.get(r.get("staff_id"), {}).get("name")
    return rows

@api.post("/training")
async def add_training(body: Dict[str, Any], user=Depends(current_user)):
    tid = await next_id("training")
    await db.training.insert_one({"id": tid, **body, "created_at": now_iso()})
    return {"id": tid, "message": "Training logged"}

@api.get("/incidents")
async def list_incidents(user=Depends(current_user)):
    rows = await list_col("incidents", sort=("id", -1))
    smap = {s["id"]: s for s in await list_col("staff")}
    for r in rows: r["staff_name"] = smap.get(r.get("staff_id"), {}).get("name")
    return rows

@api.post("/incidents")
async def add_incident(body: Dict[str, Any], user=Depends(current_user)):
    iid = await next_id("incidents")
    await db.incidents.insert_one({"id": iid, **body, "status": "Open", "reported_at": now_iso()})
    return {"id": iid, "message": "Incident reported"}

@api.put("/incidents/{iid}")
async def upd_incident(iid: int, body: Dict[str, Any], user=Depends(current_user)):
    await db.incidents.update_one({"id": iid}, {"$set": body})
    return {"message": "Incident updated"}

# ────────────────────────────────────────────────────────────────────────────
# PATIENTS
# ────────────────────────────────────────────────────────────────────────────
@api.get("/patients")
async def list_patients(status: Optional[str]=None, service_location: Optional[str]=None,
                        category: Optional[str]=None, search: Optional[str]=None, user=Depends(current_user)):
    q = {}
    if status: q["status"] = status
    if service_location: q["service_location"] = service_location
    if category: q["category"] = category
    if search:
        q["$or"] = [{"name":{"$regex":search,"$options":"i"}}, {"reg_number":{"$regex":search,"$options":"i"}}, {"mobile":{"$regex":search}}]
    return await list_col("patients", q)

@api.get("/patients/{pid}")
async def get_patient(pid: int, user=Depends(current_user)):
    r = await db.patients.find_one({"id": pid}, {"_id": 0})
    if not r: raise HTTPException(404, "Not found")
    return r

@api.post("/patients")
async def create_patient(d: Dict[str, Any], user=Depends(current_user)):
    cnt = await db.patients.count_documents({})
    reg = f"RO-PAT-{cnt+1:04d}"
    pid = await next_id("patients")
    doc = {"id": pid, "reg_number": reg, "status": d.get("status", "Active"), "frozen": 0,
           "photo": "", "created_at": now_iso(),
           **{k: v for k, v in d.items() if k not in ("id","reg_number")}}
    await db.patients.insert_one(doc)
    # Auto-create wallet for the new patient (zero balance) so they appear in
    # the Wallet module immediately.
    try:
        await _ensure_wallet(pid)
    except Exception as e:
        logger.warning(f"failed to auto-create wallet for patient {pid}: {e}")
    return {"id": pid, "reg_number": reg, "message": "Patient Registered"}

@api.put("/patients/{pid}")
async def update_patient(pid: int, d: Dict[str, Any], user=Depends(current_user)):
    cur = await db.patients.find_one({"id": pid})
    if cur and cur.get("frozen") and user.get("role") != "admin":
        raise HTTPException(403, "Patient details are frozen. Only admin can edit.")
    d.pop("id", None); d.pop("_id", None)
    await db.patients.update_one({"id": pid}, {"$set": d})
    return {"message": "Patient Updated"}

@api.patch("/patients/{pid}/freeze")
async def freeze_patient(pid: int, body: Dict[str, Any], user=Depends(current_user)):
    if user.get("role") != "admin":
        raise HTTPException(403, "Only Admin can freeze/unfreeze patient records")
    frozen = 1 if body.get("frozen") else 0
    action = "Frozen" if frozen else "Unfrozen"
    await db.patients.update_one({"id": pid}, {"$set": {"frozen": frozen}})
    await db.patient_freeze_log.insert_one({"id": await next_id("patient_freeze_log"),
        "patient_id": pid, "action": action, "done_by": user.get("name", "Admin"),
        "reason": body.get("reason", ""), "created_at": now_iso()})
    return {"message": f"Patient {action.lower()} successfully"}

@api.get("/patients/{pid}/freeze-log")
async def freeze_log(pid: int, user=Depends(current_user)):
    return await list_col("patient_freeze_log", {"patient_id": pid})

@api.post("/patients/{pid}/photo")
async def upload_patient_photo(pid: int, photo: UploadFile = File(...)):
    UPLOAD_DIR.joinpath("patients/photos").mkdir(parents=True, exist_ok=True)
    ext = (photo.filename or "img.jpg").rsplit(".", 1)[-1].lower()
    fname = f"patient-{pid}-{int(datetime.now().timestamp()*1000)}.{ext}"
    path = UPLOAD_DIR / "patients" / "photos" / fname
    path.write_bytes(await photo.read())
    rel = str(path.relative_to(ROOT_DIR))
    await db.patients.update_one({"id": pid}, {"$set": {"photo": rel}})
    return {"message": "Photo uploaded", "photo": rel}

@api.post("/patients/{pid}/documents")
async def upload_patient_doc(pid: int, document: UploadFile = File(...), documentType: str = Form("")):
    path = UPLOAD_DIR / "patients" / f"{documentType or 'doc'}-{int(datetime.now().timestamp()*1000)}-{document.filename}"
    path.write_bytes(await document.read())
    await db.patient_documents.insert_one({"id": await next_id("patient_documents"), "patient_id": pid,
        "document_type": documentType, "document_name": document.filename,
        "file_path": str(path.relative_to(ROOT_DIR)), "upload_date": today()})
    return {"message": "Document uploaded"}

@api.get("/patients/{pid}/documents")
async def list_patient_docs(pid: int, user=Depends(current_user)):
    return await list_col("patient_documents", {"patient_id": pid})

# ────────────────────────────────────────────────────────────────────────────
# LEADS
# ────────────────────────────────────────────────────────────────────────────
@api.get("/leads")
async def list_leads(status: Optional[str]=None, search: Optional[str]=None, user=Depends(current_user)):
    q = {}
    if status: q["status"] = status
    if search:
        q["$or"] = [{"patient_name":{"$regex":search,"$options":"i"}},{"caller_mobile":{"$regex":search}}]
    return await list_col("leads", q)

@api.post("/leads")
async def add_lead(d: Dict[str, Any], user=Depends(current_user)):
    lid = await next_id("leads")
    await db.leads.insert_one({"id": lid, "status": d.get("status","New"), "created_at": now_iso(), **d})
    return {"id": lid, "message": "Lead created"}

@api.put("/leads/{lid}")
async def upd_lead(lid: int, d: Dict[str, Any], user=Depends(current_user)):
    d.pop("id", None); d.pop("_id", None)
    await db.leads.update_one({"id": lid}, {"$set": d})
    return {"message": "Lead updated"}

# ────────────────────────────────────────────────────────────────────────────
# BOOKINGS
# ────────────────────────────────────────────────────────────────────────────
@api.get("/bookings")
async def list_bookings(patient_id: Optional[int]=None, staff_id: Optional[int]=None,
                        status: Optional[str]=None, service_category: Optional[str]=None,
                        frm: Optional[str]=Query(None, alias="from"), to: Optional[str]=None,
                        search: Optional[str]=None, user=Depends(current_user)):
    q = {}
    if patient_id: q["patient_id"] = patient_id
    if staff_id: q["staff_id"] = staff_id
    if status: q["status"] = status
    if service_category: q["service_category"] = service_category
    if frm: q["start_date"] = {"$gte": frm}
    if to: q.setdefault("start_date", {})["$lte"] = to
    rows = await list_col("bookings", q)
    pmap = {p["id"]: p for p in await list_col("patients")}
    smap = {s["id"]: s for s in await list_col("staff")}
    for r in rows:
        p = pmap.get(r.get("patient_id"), {}); s = smap.get(r.get("staff_id"), {})
        r["patient_name"] = p.get("name"); r["patient_mobile"] = p.get("mobile")
        r["staff_name"] = s.get("name"); r["staff_code"] = s.get("code")
    if search:
        sl = search.lower()
        rows = [r for r in rows if sl in (r.get("patient_name","").lower()) or sl in (r.get("booking_id","").lower())]
    return rows

@api.post("/bookings")
async def add_booking(d: Dict[str, Any], user=Depends(current_user)):
    now = datetime.now()
    today_iso = today()

    # Back-date guard: only Super Admin can create services with start_date in the past
    start_iso = d.get("start_date")
    sd = _parse_date(start_iso)
    if sd and sd < dt_date.today() and not is_super_admin(user):
        raise HTTPException(403, "Only Super Admin can create back-dated services")

    # Computed amount from rate_per_shift × total_shifts when caller didn't pass amount
    rate = d.get("rate_per_shift")
    shifts = d.get("total_shifts")
    try:
        rate_f = float(rate) if rate not in (None, "", 0) else None
        shifts_i = int(shifts) if shifts not in (None, "", 0) else None
    except Exception:
        rate_f, shifts_i = None, None
    explicit_amount = d.get("amount")
    if explicit_amount in (None, "", 0) and rate_f and shifts_i:
        amount = round(rate_f * shifts_i, 2)
    else:
        amount = float(explicit_amount or 0)

    cash_paid = float(d.get("paid_amount") or 0)

    # Wallet usage (optional). Caller passes use_wallet=True or wallet_amount=<n>
    use_wallet = bool(d.get("use_wallet"))
    wallet_amount = float(d.get("wallet_amount") or 0)
    if use_wallet and wallet_amount <= 0:
        # auto: use up to the booking balance not yet covered by cash
        w = await _ensure_wallet(d.get("patient_id"))
        wallet_amount = min(float(w.get("current_balance") or 0), max(0.0, amount - cash_paid))

    total_paid = round(cash_paid + wallet_amount, 2)
    if total_paid > amount + 1e-6:
        # cap so we never overpay
        if wallet_amount > 0:
            wallet_amount = max(0.0, round(amount - cash_paid, 2))
            total_paid = round(cash_paid + wallet_amount, 2)

    bid = f"BK-{now.strftime('%Y%m%d')}-{random.randint(1000,9999)}"
    bid_int = await next_id("bookings")
    doc = {"id": bid_int, "booking_id": bid, "status": d.get("status","Pending"),
           "amount": amount, "paid_amount": total_paid, "balance": round(amount - total_paid, 2),
           "rate_per_shift": rate_f, "total_shifts": shifts_i,
           "wallet_used": wallet_amount,
           "payment_status": d.get("payment_status") or ("Paid" if abs(amount-total_paid) < 1e-6 and amount > 0 else ("Partial" if total_paid > 0 else "Pending")),
           "created_by": user.get("name","Admin"), "created_by_role": user.get("role"),
           "created_at": now_iso(),
           "is_back_dated": bool(sd and sd < dt_date.today()),
           "expires_at": in_days(30),
           **{k:v for k,v in d.items() if k not in ("id","booking_id","amount","paid_amount","balance","payment_status","rate_per_shift","total_shifts","wallet_used","use_wallet","wallet_amount","created_by","created_at","is_back_dated")}}
    await db.bookings.insert_one(doc)

    # Debit wallet AFTER booking insert (so we can reference booking id)
    if wallet_amount > 0:
        try:
            await _wallet_tx(d.get("patient_id"), "DEBIT", wallet_amount,
                             "Service Booking", bid_int,
                             f"Used wallet ₹{wallet_amount:.2f} for booking {bid}", user)
        except HTTPException:
            # rollback booking if wallet debit fails
            await db.bookings.delete_one({"id": bid_int})
            raise

    if cash_paid > 0:
        p = await db.patients.find_one({"id": d.get("patient_id")})
        await db.bills.insert_one({"id": await next_id("bills"),
            "receipt_number": f"RO-RCP-{int(datetime.now().timestamp())}",
            "booking_id": bid, "patient_id": d.get("patient_id"),
            "patient_name": p.get("name") if p else "",
            "service": d.get("service_name"), "amount": amount,
            "paid_amount": cash_paid, "balance": amount-total_paid,
            "payment_mode": d.get("payment_mode"),
            "payment_status": doc["payment_status"],
            "date": today_iso, "refund_amount": 0})
    await db.notifications.insert_one({"id": await next_id("notifications"), "recipient_type":"patient",
        "recipient_id": d.get("patient_id"), "title":"Booking Confirmed",
        "message": f"Booking {bid} created for {d.get('service_name')}",
        "channel":"in-app", "status":"Pending", "created_at": now_iso()})

    # Audit + booking_history on creation
    await db.booking_history.insert_one({
        "id": await next_id("booking_history"),
        "booking_id": bid_int, "action": "created",
        "before": None,
        "after": {"service_name": d.get("service_name"), "amount": amount,
                  "rate_per_shift": rate_f, "total_shifts": shifts_i,
                  "start_date": doc.get("start_date"), "end_date": doc.get("end_date"),
                  "back_dated": doc["is_back_dated"]},
        "edited_by": user.get("name"), "edited_by_role": user.get("role"),
        "reason": "Back-dated entry" if doc["is_back_dated"] else "New booking",
        "created_at": now_iso(),
    })
    if doc["is_back_dated"]:
        await audit(user, "booking_backdated_create", "booking", bid_int, None, {"start_date": start_iso})

    return {"id": bid_int, "booking_id": bid, "message": "Booking Created",
            "amount": amount, "wallet_used": wallet_amount}

@api.put("/bookings/{bid}")
async def upd_booking(bid: int, d: Dict[str, Any], user=Depends(current_user)):
    # Coordinator cannot edit existing services
    if not is_manager_or_admin(user):
        raise HTTPException(403, "Only Super Admin or Manager can edit a booking")
    cur = await db.bookings.find_one({"id": bid})
    if not cur:
        raise HTTPException(404, "Booking not found")
    if cur.get("status") in ("Completed","Cancelled","Stopped","Converted") and not is_super_admin(user):
        raise HTTPException(403, "Only Super Admin can edit a finalised booking")
    d.pop("id", None); d.pop("_id", None)

    # Manager cannot back-date start_date
    new_start = _parse_date(d.get("start_date"))
    if new_start and new_start < dt_date.today() and not is_super_admin(user):
        raise HTTPException(403, "Only Super Admin can back-date a booking")

    # Recompute amount when rate/shifts changed
    if "rate_per_shift" in d or "total_shifts" in d:
        try:
            new_rate = float(d.get("rate_per_shift", cur.get("rate_per_shift") or 0) or 0)
            new_shifts = int(d.get("total_shifts", cur.get("total_shifts") or 0) or 0)
            if new_rate > 0 and new_shifts > 0 and "amount" not in d:
                d["amount"] = round(new_rate * new_shifts, 2)
                paid = float(cur.get("paid_amount") or 0)
                d["balance"] = round(d["amount"] - paid, 2)
        except Exception:
            pass

    before = {k: cur.get(k) for k in d.keys()}
    await db.bookings.update_one({"id": bid}, {"$set": d})

    await db.booking_history.insert_one({
        "id": await next_id("booking_history"),
        "booking_id": bid, "action": "edited",
        "before": _sanitize(before), "after": _sanitize(d),
        "edited_by": user.get("name"), "edited_by_role": user.get("role"),
        "reason": d.get("edit_reason") or "Service edited",
        "created_at": now_iso(),
    })
    await audit(user, "booking_update", "booking", bid, before, d)
    return {"message": "Booking updated"}

@api.post("/bookings/{bid}/reassign")
async def reassign_booking(bid: int, body: Dict[str, Any], user=Depends(current_user)):
    cur = await db.bookings.find_one({"id": bid})
    notes = (cur.get("notes","") if cur else "") + f" | Reassigned: {body.get('reason','')}"
    await db.bookings.update_one({"id": bid}, {"$set": {"staff_id": body.get("staff_id"), "notes": notes}})
    return {"message": "Booking reassigned"}

# ────────────────────────────────────────────────────────────────────────────
# BILLS / REFUNDS
# ────────────────────────────────────────────────────────────────────────────
@api.get("/bills")
async def list_bills(patient_id: Optional[int]=None, payment_status: Optional[str]=None,
                     frm: Optional[str]=Query(None, alias="from"), to: Optional[str]=None,
                     user=Depends(current_user)):
    q = {}
    if patient_id: q["patient_id"] = patient_id
    if payment_status: q["payment_status"] = payment_status
    if frm: q["date"] = {"$gte": frm}
    if to: q.setdefault("date", {})["$lte"] = to
    return await list_col("bills", q)

@api.post("/bills")
async def create_bill(body: Dict[str, Any], user=Depends(current_user)):
    """
    Create a bill with itemized line_items from the service catalog.
    Body: {
      patient_id, booking_id?, payer_name?, service_from?, service_to?,
      line_items: [{ service_id, qty, rate_override? }],
      discount?, paid_amount?, payment_mode?, transaction_ref?, is_package?
    }
    Auto-fills: rates from catalog, subtotal, total, receipt_number.
    """
    if not body.get("patient_id"):
        raise HTTPException(400, "patient_id is required")
    items_in = body.get("line_items") or []
    if not items_in:
        raise HTTPException(400, "At least one line item is required")
    is_pkg = bool(body.get("is_package", False))

    p = await db.patients.find_one({"id": body["patient_id"]}, {"_id":0}) or {}
    enriched = []
    subtotal = 0.0
    for li in items_in:
        sid = li.get("service_id")
        s = await db.services.find_one({"id": sid}, {"_id":0}) if sid else None
        if not s:
            raise HTTPException(400, f"Service id {sid} not found")
        qty = float(li.get("qty") or 1)
        # Use package_rate when bill is package, else standard_rate; allow override
        default_rate = s["package_rate"] if is_pkg else s["standard_rate"]
        rate = float(li.get("rate_override") or default_rate)
        amt = qty * rate
        enriched.append({
            "service_id": sid, "code": s["code"], "service_name": s["name"],
            "category": s["category"], "unit": s["unit"],
            "qty": qty, "rate": rate,
            "rate_type": "package" if is_pkg else "standard",
            "subtotal": amt,
            "ppe_included": s.get("ppe_included", False),
            "hsn_code": s.get("hsn_code","999316"),
        })
        subtotal += amt

    discount = float(body.get("discount") or 0)
    total = max(0, subtotal - discount)
    paid = float(body.get("paid_amount") or 0)
    rcpt_seq = await _next_receipt_number()
    rcpt_num = f"{rcpt_seq}"  # plain number to match physical book; admin can prefix later

    bid_int = await next_id("bills")
    bill = {
        "id": bid_int,
        "receipt_number": rcpt_num,
        "patient_id": body["patient_id"],
        "patient_name": p.get("name",""),
        "patient_reg": p.get("reg_number",""),
        "booking_id": body.get("booking_id"),
        "payer_name": body.get("payer_name") or p.get("name",""),
        "line_items": enriched,
        "subtotal": subtotal,
        "discount": discount,
        "amount": total,                  # legacy field
        "total_amount": total,
        "paid_amount": paid,
        "balance": total - paid,
        "payment_status": "Paid" if paid >= total else ("Partial" if paid > 0 else "Pending"),
        "payment_method": body.get("payment_mode","Cash"),
        "transaction_ref": body.get("transaction_ref",""),
        "service_from": body.get("service_from",""),
        "service_to": body.get("service_to",""),
        "service_type": ", ".join(set(e["category"] for e in enriched)) or "Service",
        "service_description": ", ".join([f"{e['service_name']} × {e['qty']:g} {e['unit']}" for e in enriched]),
        "is_package": is_pkg,
        "payments": [{
            "date": today(), "amount": paid, "mode": body.get("payment_mode","Cash"),
            "reference": body.get("transaction_ref",""), "receipt_number": rcpt_num,
        }] if paid > 0 else [],
        "refund_amount": 0,
        "date": today(),
        "created_at": now_iso(),
        "created_by": user.get("name","Admin"),
    }
    await db.bills.insert_one(bill)
    await audit(user, "create", "bill", bid_int, notes=f"₹{total} rcpt {rcpt_num}")
    # Credit the patient's wallet for the amount paid against this bill so the
    # wallet ledger reflects all money received from the patient. Idempotent
    # via (patient_id, reference_type="Bill", reference_id=bid_int).
    if paid > 0:
        try:
            existing = await db.wallet_transactions.find_one({
                "patient_id": body["patient_id"],
                "reference_type": "Bill",
                "reference_id": bid_int,
            })
            if not existing:
                await _wallet_tx(
                    body["patient_id"], "CREDIT", paid,
                    "Bill", bid_int,
                    f"Bill #{rcpt_num} paid via {body.get('payment_mode','Cash')}",
                    user,
                )
        except Exception as e:
            logger.warning(f"bill->wallet credit failed for bill {bid_int}: {e}")
    return {"id": bid_int, "receipt_number": rcpt_num, "total_amount": total, "balance": total - paid, "message": "Bill created"}

@api.post("/bills/{bid}/pay")
async def pay_bill(bid: int, body: Dict[str, Any], user=Depends(current_user)):
    b = await db.bills.find_one({"id": bid})
    if not b: raise HTTPException(404, "Not found")
    add_paid = float(body.get("amount") or 0)
    paid = float(b.get("paid_amount") or 0) + add_paid
    total = float(b.get("total_amount") or b.get("amount") or 0)
    bal = total - paid
    st = "Paid" if bal <= 0 else "Partial"
    rcpt_seq = await _next_receipt_number()
    rcpt_num = f"{rcpt_seq}"
    new_payment = {
        "date": today(), "amount": add_paid,
        "mode": body.get("mode","Cash"),
        "reference": body.get("reference",""),
        "receipt_number": rcpt_num,
    }
    await db.bills.update_one({"id": bid}, {
        "$set": {"paid_amount": paid, "balance": bal, "payment_status": st,
                 "payment_method": body.get("mode")},
        "$push": {"payments": new_payment}
    })
    await audit(user, "update", "bill", bid, notes=f"payment ₹{add_paid} rcpt {rcpt_num}")
    # Credit wallet for the additional payment. Reference includes the payment
    # index so multiple payments on one bill each create a distinct credit
    # (idempotent across re-runs: if same payment_idx already credited, skip).
    if add_paid > 0:
        pay_idx = len(b.get("payments") or [])  # index of the NEW payment just pushed
        ref_id = f"{bid}.{pay_idx}"
        try:
            existing = await db.wallet_transactions.find_one({
                "patient_id": b.get("patient_id"),
                "reference_type": "Bill Payment",
                "reference_id": ref_id,
            })
            if not existing and b.get("patient_id"):
                await _wallet_tx(
                    b["patient_id"], "CREDIT", add_paid,
                    "Bill Payment", ref_id,
                    f"Bill #{b.get('receipt_number') or bid} additional payment ({body.get('mode','Cash')}) rcpt {rcpt_num}",
                    user,
                )
        except Exception as e:
            logger.warning(f"bill payment->wallet credit failed for bill {bid}: {e}")
    return {"message": "Payment recorded", "receipt_number": rcpt_num, "payment_idx": len(b.get("payments") or [])}

@api.get("/refunds")
async def list_refunds(status: Optional[str]=None, user=Depends(current_user)):
    q = {"status": status} if status else {}
    return await list_col("refunds", q, sort=("id", -1))

@api.post("/refunds")
async def add_refund(d: Dict[str, Any], user=Depends(current_user)):
    if not has_perm(user.get("role",""), "refund:initiate"):
        raise HTTPException(403, "Forbidden")
    rid = await next_id("refunds")
    # Identity & bank capture per requirement
    bank = d.get("bank_account","")
    masked = (("X" * max(0, len(bank)-4)) + bank[-4:]) if bank else ""
    doc = {
        "id": rid, "status": "Pending", "mode": d.get("mode","NEFT"),
        "initiator": user.get("name","Admin"), "initiated_at": now_iso(),
        "receipt_id": d.get("receipt_id"), "booking_id": d.get("booking_id"),
        "patient_id": d.get("patient_id"), "amount": d.get("amount"),
        "reason": d.get("reason",""), "reason_category": d.get("reason_category",""),
        "relative_name": d.get("relative_name",""), "relation": d.get("relation",""),
        "govt_id_type": d.get("govt_id_type",""), "govt_id_number": d.get("govt_id_number",""),
        "id_proof_path": d.get("id_proof_path",""), "cancelled_cheque_path": d.get("cancelled_cheque_path",""),
        "bank_account_full": bank, "bank_account": masked,
        "ifsc": d.get("ifsc",""), "account_holder": d.get("account_holder",""),
        "upi_id": d.get("upi_id",""), "contact": d.get("contact",""),
    }
    await db.refunds.insert_one(doc)
    await audit(user, "create", "refund", rid, after={"amount": d.get("amount"), "patient_id": d.get("patient_id")})
    return {"id": rid, "message": "Refund initiated"}

@api.post("/refunds/{rid}/upload-doc")
async def upload_refund_doc(rid: int, document: UploadFile = File(...), doc_type: str = Form("id_proof"), user=Depends(current_user)):
    path = UPLOAD_DIR / "patients" / f"refund-{doc_type}-{rid}-{int(datetime.now().timestamp()*1000)}-{document.filename}"
    path.write_bytes(await document.read())
    field = "id_proof_path" if doc_type == "id_proof" else "cancelled_cheque_path"
    await db.refunds.update_one({"id": rid}, {"$set": {field: str(path.relative_to(ROOT_DIR))}})
    await audit(user, "upload", "refund", rid, after={"doc_type": doc_type})
    return {"message": "Refund document uploaded"}

@api.patch("/refunds/{rid}/approve")
async def approve_refund(rid: int, body: Dict[str, Any], user=Depends(current_user)):
    level = body.get("level"); name = user.get("name","Admin"); role = user.get("role","")
    if level == "verify":
        if not has_perm(role, "refund:verify"): raise HTTPException(403, "Forbidden")
        await db.refunds.update_one({"id": rid}, {"$set": {"verifier": name, "verified_at": now_iso(), "status": "Verified"}})
        await audit(user, "verify", "refund", rid)
    else:
        if not has_perm(role, "refund:approve"): raise HTTPException(403, "Forbidden")
        await db.refunds.update_one({"id": rid}, {"$set": {"approver": name, "status": "Approved",
            "approved_at": now_iso(), "utr": body.get("utr")}})
        r = await db.refunds.find_one({"id": rid})
        if r and r.get("receipt_id"):
            await db.bills.update_one({"id": r["receipt_id"]}, {"$set": {"watermark": "REFUND", "refund_status": "Processed"}})
        await audit(user, "approve", "refund", rid, after={"utr": body.get("utr")})
    return {"message": f"Refund {'verified' if level=='verify' else 'approved'}"}

# ────────────────────────────────────────────────────────────────────────────
# AMBULANCE
# ────────────────────────────────────────────────────────────────────────────
@api.get("/ambulance")
async def list_amb(status: Optional[str]=None, call_type: Optional[str]=None,
                   frm: Optional[str]=Query(None, alias="from"), to: Optional[str]=None,
                   user=Depends(current_user)):
    q = {}
    if status: q["status"] = status
    if call_type: q["call_type"] = call_type
    return await list_col("ambulance_calls", q)

@api.post("/ambulance")
async def add_amb(d: Dict[str, Any], user=Depends(current_user)):
    cid = await next_id("ambulance_calls")
    cn = f"AMB-{int(datetime.now().timestamp())}"
    await db.ambulance_calls.insert_one({"id": cid, "call_number": cn, "status":"Received",
        "priority": d.get("priority","Normal"), "amount": d.get("amount") or 0,
        "created_at": now_iso(), **{k:v for k,v in d.items() if k not in ("id","call_number","status")}})
    return {"id": cid, "call_number": cn, "message": "Call logged"}

@api.patch("/ambulance/{cid}")
async def upd_amb(cid: int, d: Dict[str, Any], user=Depends(current_user)):
    d.pop("id", None); d.pop("_id", None)
    await db.ambulance_calls.update_one({"id": cid}, {"$set": d})
    return {"message": "Updated"}

# ────────────────────────────────────────────────────────────────────────────
# ASSETS / VENDORS
# ────────────────────────────────────────────────────────────────────────────
@api.get("/assets")
async def list_assets(user=Depends(current_user)): return await list_col("assets")

@api.post("/assets")
async def add_asset(d: Dict[str, Any], user=Depends(current_user)):
    aid = await next_id("assets")
    code = f"AST-{int(datetime.now().timestamp())}"
    await db.assets.insert_one({"id": aid, "asset_code": code, "status": d.get("status","Active"),
        "quantity": d.get("quantity",1), **{k:v for k,v in d.items() if k not in ("id","asset_code")}})
    return {"id": aid, "asset_code": code, "message": "Asset added"}

@api.get("/vendors")
async def list_vendors(user=Depends(current_user)):
    return await list_col("vendors", sort=("name", 1))

@api.post("/vendors")
async def add_vendor(d: Dict[str, Any], user=Depends(current_user)):
    vid = await next_id("vendors")
    await db.vendors.insert_one({"id": vid, "status":"Active", "created_at": now_iso(), **d})
    return {"id": vid, "message": "Vendor added"}

@api.put("/vendors/{vid}")
async def upd_vendor(vid: int, d: Dict[str, Any], user=Depends(current_user)):
    d.pop("id", None); d.pop("_id", None)
    await db.vendors.update_one({"id": vid}, {"$set": d})
    return {"message": "Vendor updated"}

@api.delete("/vendors/{vid}")
async def del_vendor(vid: int, user=Depends(current_user)):
    await db.vendors.delete_one({"id": vid})
    return {"message": "Vendor deleted"}

# ────────────────────────────────────────────────────────────────────────────
# ROSTER
# ────────────────────────────────────────────────────────────────────────────
@api.get("/roster")
async def list_roster(date: Optional[str]=None, frm: Optional[str]=Query(None, alias="from"),
                      to: Optional[str]=None, staff_id: Optional[int]=None,
                      vendor: Optional[str]=None, shift: Optional[str]=None,
                      user=Depends(current_user)):
    q = {}
    if date: q["date"] = date
    if frm: q["date"] = {"$gte": frm}
    if to: q.setdefault("date", {})["$lte"] = to
    if staff_id: q["staff_id"] = staff_id
    if shift: q["shift"] = shift
    rows = await list_col("roster", q, sort=("date", 1))
    smap = {s["id"]: s for s in await list_col("staff")}
    pmap = {p["id"]: p for p in await list_col("patients")}
    for r in rows:
        s = smap.get(r.get("staff_id"), {}); p = pmap.get(r.get("patient_id"), {})
        r["staff_name"]=s.get("name"); r["role"]=s.get("role"); r["vendor"]=s.get("vendor"); r["duty_tag"]=s.get("duty_tag"); r["staff_mobile"]=s.get("mobile")
        r["patient_name"]=p.get("name"); r["patient_address"]=p.get("address"); r["reg_number"]=p.get("reg_number")
    if vendor: rows = [r for r in rows if r.get("vendor") == vendor]
    return rows

@api.get("/roster/available-staff")
async def roster_avail(date: str, shift: Optional[str]=None, role: Optional[str]=None,
                       vendor: Optional[str]=None, user=Depends(current_user)):
    # staff not rostered for this date+shift, active, not on leave
    rostered = await db.roster.find({"date": date, **({"shift":shift} if shift else {})}, {"staff_id":1}).to_list(2000)
    excluded = [r["staff_id"] for r in rostered]
    q = {"status":"Active", "duty_tag":{"$nin":["Suspended","Terminated","On Leave"]},
         "id": {"$nin": excluded}}
    if role: q["role"] = role
    if vendor: q["vendor"] = vendor
    rows = await list_col("staff", q, sort=("rating", -1))
    for r in rows:
        r["roster_count"] = await db.roster.count_documents({"staff_id": r["id"], "date": date})
        r["attended_today"] = await db.attendance.count_documents({"staff_id": r["id"], "date": date})
    return rows

@api.post("/roster")
async def add_roster(d: Dict[str, Any], user=Depends(current_user)):
    if not (d.get("staff_id") and d.get("date") and d.get("shift")):
        raise HTTPException(400, "staff_id, date and shift are required")
    if await db.roster.find_one({"staff_id": d["staff_id"], "date": d["date"], "shift": d["shift"]}):
        raise HTTPException(400, "This staff member is already rostered for this date and shift.")
    rid = await next_id("roster")
    await db.roster.insert_one({"id": rid, "status":"Scheduled",
        **{k:v for k,v in d.items() if k not in ("id","status")}})
    await db.staff.update_one({"id": d["staff_id"], "duty_tag":"Available"}, {"$set": {"duty_tag":"On Duty"}})
    return {"id": rid, "message": "Roster entry added"}

@api.put("/roster/{rid}")
async def upd_roster(rid: int, d: Dict[str, Any], user=Depends(current_user)):
    d.pop("id", None); d.pop("_id", None)
    await db.roster.update_one({"id": rid}, {"$set": d})
    return {"message": "Roster updated"}

@api.delete("/roster/{rid}")
async def del_roster(rid: int, user=Depends(current_user)):
    await db.roster.delete_one({"id": rid})
    return {"message": "Roster entry removed"}

@api.get("/roster/summary")
async def roster_summary(frm: Optional[str]=Query(None, alias="from"), to: Optional[str]=None,
                         user=Depends(current_user)):
    match = {}
    if frm: match["date"] = {"$gte": frm}
    if to: match.setdefault("date", {})["$lte"] = to
    pipe = [{"$match": match}, {"$group": {
        "_id":"$date","total_shifts":{"$sum":1},
        "staff_count":{"$addToSet":"$staff_id"},
        "patient_count":{"$addToSet":"$patient_id"},
        "completed":{"$sum":{"$cond":[{"$eq":["$status","Completed"]},1,0]}},
        "scheduled":{"$sum":{"$cond":[{"$eq":["$status","Scheduled"]},1,0]}}}},
        {"$sort":{"_id":-1}}]
    rows = await db.roster.aggregate(pipe).to_list(1000)
    return [{"date":r["_id"],"total_shifts":r["total_shifts"],
             "staff_count":len(r["staff_count"]),"patient_count":len([x for x in r["patient_count"] if x]),
             "completed":r["completed"],"scheduled":r["scheduled"]} for r in rows]

# ────────────────────────────────────────────────────────────────────────────
# MEDICAL CHARTS
# ────────────────────────────────────────────────────────────────────────────
@api.post("/medical-charts")
async def add_chart(d: Dict[str, Any], user=Depends(current_user)):
    cid = await next_id("medical_charts")
    data = d.get("chart_data")
    if isinstance(data, dict): data = json.dumps(data)
    await db.medical_charts.insert_one({"id": cid, "booking_id": d.get("booking_id"),
        "patient_id": d.get("patient_id"), "staff_id": d.get("staff_id"),
        "chart_type": d.get("chart_type"), "chart_data": data,
        "visit_date": d.get("visit_date") or today(), "created_at": now_iso()})
    return {"id": cid, "message": "Chart saved"}

@api.get("/medical-charts")
async def list_charts(patient_id: Optional[int]=None, booking_id: Optional[str]=None,
                      chart_type: Optional[str]=None, frm: Optional[str]=Query(None, alias="from"),
                      to: Optional[str]=None, user=Depends(current_user)):
    q = {}
    if patient_id: q["patient_id"] = patient_id
    if booking_id: q["booking_id"] = booking_id
    if chart_type: q["chart_type"] = chart_type
    if frm: q["visit_date"] = {"$gte": frm}
    if to: q.setdefault("visit_date", {})["$lte"] = to
    rows = await list_col("medical_charts", q, sort=("visit_date", -1))
    smap = {s["id"]: s for s in await list_col("staff")}
    pmap = {p["id"]: p for p in await list_col("patients")}
    for r in rows:
        r["staff_name"] = smap.get(r.get("staff_id"), {}).get("name")
        r["patient_name"] = pmap.get(r.get("patient_id"), {}).get("name")
        try: r["data"] = json.loads(r.get("chart_data") or "{}")
        except Exception: r["data"] = {}
    return rows

@api.get("/medical-charts/trends/{pid}")
async def chart_trends(pid: int, user=Depends(current_user)):
    rows = await db.medical_charts.find({"patient_id": pid}, {"_id":0}).sort("visit_date", 1).limit(90).to_list(90)
    out: Dict[str, List] = {}
    for r in rows:
        try: data = json.loads(r.get("chart_data") or "{}")
        except: data = {}
        out.setdefault(r.get("chart_type","misc"), []).append({"date": r.get("visit_date"), **data})
    return out

@api.get("/medical-charts/latest-vitals")
async def latest_vitals(user=Depends(current_user)):
    pipe = [{"$match":{"chart_type":"vitals"}},
            {"$sort":{"id":-1}},
            {"$group":{"_id":"$patient_id","doc":{"$first":"$$ROOT"}}},
            {"$replaceRoot":{"newRoot":"$doc"}}]
    rows = await db.medical_charts.aggregate(pipe).to_list(1000)
    pmap = {p["id"]: p for p in await list_col("patients")}
    out = []
    for r in rows:
        r.pop("_id", None)
        try: r["data"] = json.loads(r.get("chart_data") or "{}")
        except: r["data"] = {}
        r["patient_name"] = pmap.get(r.get("patient_id"), {}).get("name")
        out.append(r)
    return out

# ────────────────────────────────────────────────────────────────────────────
# ANALYTICS
# ────────────────────────────────────────────────────────────────────────────
@api.get("/analytics/monthly-revenue")
async def monthly_rev(user=Depends(current_user)):
    pipe = [{"$group":{"_id":{"$substr":["$date",0,7]},
                       "revenue":{"$sum":"$paid_amount"},
                       "billed":{"$sum":"$amount"}, "count":{"$sum":1}}},
            {"$sort":{"_id":-1}}, {"$limit":12}]
    return [{"month":r["_id"],"revenue":r["revenue"],"billed":r["billed"],"count":r["count"]}
            for r in await db.bills.aggregate(pipe).to_list(12)]

@api.get("/analytics/service-demand")
async def svc_demand(user=Depends(current_user)):
    pipe = [{"$group":{"_id":{"service_name":"$service_name","service_category":"$service_category"},
                       "count":{"$sum":1}}},{"$sort":{"count":-1}}]
    return [{"service_name":r["_id"]["service_name"],"service_category":r["_id"]["service_category"],"count":r["count"]}
            for r in await db.bookings.aggregate(pipe).to_list(200)]

@api.get("/analytics/staff-performance")
async def staff_perf(user=Depends(current_user)):
    out = []
    async for s in db.staff.find({}, {"_id":0}):
        bookings = await db.bookings.count_documents({"staff_id": s["id"]})
        hrs_pipe = [{"$match":{"staff_id":s["id"]}},{"$group":{"_id":None,"v":{"$avg":"$hours_worked"}}}]
        a = await db.attendance.aggregate(hrs_pipe).to_list(1)
        out.append({"id":s["id"],"name":s["name"],"role":s.get("role"),"vendor":s.get("vendor"),
                    "rating":s.get("rating",0),"duty_tag":s.get("duty_tag"),
                    "total_bookings":bookings,"avg_hours": round(a[0]["v"],2) if a else 0})
    out.sort(key=lambda x: x["rating"], reverse=True)
    return out

@api.get("/analytics/patient-categories")
async def pat_cat(user=Depends(current_user)):
    pipe = [{"$match":{"status":"Active"}},
            {"$group":{"_id":{"service_location":"$service_location","category":"$category"},"count":{"$sum":1}}}]
    return [{"service_location":r["_id"]["service_location"],"category":r["_id"]["category"],"count":r["count"]}
            for r in await db.patients.aggregate(pipe).to_list(200)]

@api.get("/analytics/ambulance-stats")
async def amb_stats(user=Depends(current_user)):
    pipe = [{"$group":{"_id":{"ambulance_type":"$ambulance_type","call_type":"$call_type","status":"$status"},"count":{"$sum":1}}}]
    return [{"ambulance_type":r["_id"]["ambulance_type"],"call_type":r["_id"]["call_type"],"status":r["_id"]["status"],"count":r["count"]}
            for r in await db.ambulance_calls.aggregate(pipe).to_list(200)]

# ────────────────────────────────────────────────────────────────────────────
# NOTIFICATIONS
# ────────────────────────────────────────────────────────────────────────────
@api.get("/notifications")
async def list_notifs(user=Depends(current_user)):
    return await list_col("notifications", sort=("created_at", -1), limit=50)

# ────────────────────────────────────────────────────────────────────────────
# SERVICES MASTER
# ────────────────────────────────────────────────────────────────────────────
@api.get("/services-legacy")
async def services_legacy(user=Depends(current_user)):
    """Legacy hard-coded category groups — kept for backwards compatibility."""
    return [
        {"category":"Nursing","items":["24-Hour Nursing","12-Hour Nursing","Critical Care Nursing","Palliative Care Nursing","ICU at Home","Mother & Baby Care"]},
        {"category":"GDA / Attendant","items":["24-Hour GDA","12-Hour GDA","Geriatric Care","General Attendant"]},
        {"category":"Allied Health","items":["Physiotherapy (General)","Physiotherapy (Specialized)","Physiotherapy (Chest)","Doctor Home Visit","Dietitian / Nutrition Counseling","Pain Management"]},
        {"category":"Diagnostic","items":["Blood Sample Collection","Portable X-Ray at Home","ECG at Home","Sleep Study"]},
        {"category":"Clinical Procedures","items":["Wound Dressing","Injection (IV/IM/SC)","Ryle's Tube Insertion","Foley Catheter","PICC Line Care","Stoma Care","Tracheostomy Care","Suture Removal","Nebulization"]},
        {"category":"Ambulance","items":["ALS (Advanced Life Support)","BLS (Basic Life Support)","Patient Transport","Air Ambulance","Rail Ambulance","Last Journey"]},
        {"category":"Equipment Rental","items":["Ventilator","BiPAP/CPAP","Oxygen Concentrator","Hospital Bed","Wheelchair","Motorized Stair Climber"]},
        {"category":"Other","items":["Adult Vaccination","Yoga","Medical Equipment Arrangement","Guide Service"]},
    ]

@api.get("/upload/{sid}")
async def legacy_upload(sid: int, user=Depends(current_user)): return []

@api.get("/documents/{sid}")
async def legacy_docs(sid: int, user=Depends(current_user)):
    return await list_col("staff_documents", {"staff_id": sid})

# ────────────────────────────────────────────────────────────────────────────
# STAFF COMPLIANCE ENGINE
# ────────────────────────────────────────────────────────────────────────────
ROLE_DOCS = {
    "Nurse":["Aadhaar Card","PAN Card","Police Verification","Medical Fitness","Bank Passbook","Nursing Council Reg","Degree/Diploma"],
    "GDA":["Aadhaar Card","PAN Card","Police Verification","Medical Fitness","Bank Passbook","GDA Certificate"],
    "Physiotherapist":["Aadhaar Card","PAN Card","Police Verification","Medical Fitness","Bank Passbook","BPT Degree/Diploma"],
    "Doctor":["Aadhaar Card","PAN Card","Police Verification","Medical Fitness","Bank Passbook","MBBS/MD Degree","Medical Council Reg"],
    "Driver":["Aadhaar Card","PAN Card","Police Verification","Medical Fitness","Bank Passbook","Driving License","Vehicle RC"],
    "Aaya":["Aadhaar Card","PAN Card","Police Verification","Bank Passbook"],
    "Helper":["Aadhaar Card","PAN Card","Police Verification","Bank Passbook"],
    "Housekeeping":["Aadhaar Card","PAN Card","Police Verification","Bank Passbook"],
    "FOE":["Aadhaar Card","PAN Card","Police Verification","Bank Passbook","Resume"],
    "Accountant":["Aadhaar Card","PAN Card","Police Verification","Bank Passbook","Degree/Diploma"],
}
def required_docs(role): return ROLE_DOCS.get(role, ["Aadhaar Card","PAN Card","Police Verification","Medical Fitness","Bank Passbook"])

def compute_compliance(s, docs):
    req = required_docs(s.get("role"))
    uploaded = [d.get("document_type") for d in docs]
    missing = [r for r in req if r not in uploaded]
    td = today(); in30 = in_days(30)
    expiring = [d for d in docs if d.get("expiry_date") and td < d["expiry_date"] <= in30]
    expired = [d for d in docs if d.get("expiry_date") and d["expiry_date"] < td]
    pct = round(((len(req) - len(missing)) / len(req)) * 100) if req else 100
    alerts = []
    if "Police Verification" in missing: alerts.append({"type":"CRITICAL","msg":"Police Verification missing"})
    if "Nursing Council Reg" in missing and s.get("role") == "Nurse":
        alerts.append({"type":"CRITICAL","msg":"Nursing Council Registration missing"})
    if expired: alerts.append({"type":"CRITICAL","msg":f"{len(expired)} document(s) expired"})
    if expiring: alerts.append({"type":"WARNING","msg":f"{len(expiring)} document(s) expiring within 30 days"})
    if missing and not any(a["type"]=="CRITICAL" for a in alerts):
        alerts.append({"type":"INFO","msg":f"{len(missing)} document(s) missing"})
    status = ("Non-Compliant" if expired or "Police Verification" in missing else
              "Compliant" if pct >= 80 else "Partial" if pct >= 50 else "Action Needed")
    return {"required":req,"missing":missing,"expiring":expiring,"expired":expired,
            "compliance_pct":pct,"alerts":alerts,"status":status}

@api.get("/staff-compliance")
async def staff_compliance(vendor: Optional[str]=None, role: Optional[str]=None,
                           status: Optional[str]=None, user=Depends(current_user)):
    q = {"status":"Active"}
    if vendor: q["vendor"] = vendor
    if role: q["role"] = role
    staff_list = await list_col("staff", q, sort=("name", 1))
    results = []
    for s in staff_list:
        docs = await list_col("staff_documents", {"staff_id": s["id"]})
        c = compute_compliance(s, docs)
        results.append({"id":s["id"],"name":s["name"],"code":s.get("code"),"role":s.get("role"),
            "vendor":s.get("vendor"),"duty_tag":s.get("duty_tag"),"mobile":s.get("mobile"),
            "doc_count":len(docs),"required_count":len(c["required"]),"missing_count":len(c["missing"]),
            "missing_docs":c["missing"],"expiring_docs":len(c["expiring"]),"expired_docs":len(c["expired"]),
            "compliance_pct":c["compliance_pct"],"status":c["status"],"alerts":c["alerts"]})
    results.sort(key=lambda x: x["compliance_pct"])
    if status: results = [r for r in results if r["status"] == status]
    return results

@api.get("/staff-compliance/summary")
async def compliance_summary(user=Depends(current_user)):
    staff_list = await list_col("staff", {"status":"Active"})
    counts = {"total":len(staff_list),"compliant":0,"partial":0,"non_compliant":0,"action_needed":0,"critical_alerts":0}
    for s in staff_list:
        docs = await list_col("staff_documents", {"staff_id": s["id"]})
        c = compute_compliance(s, docs)
        if c["status"]=="Compliant": counts["compliant"] += 1
        elif c["status"]=="Partial": counts["partial"] += 1
        elif c["status"]=="Non-Compliant": counts["non_compliant"] += 1
        else: counts["action_needed"] += 1
        counts["critical_alerts"] += sum(1 for a in c["alerts"] if a["type"]=="CRITICAL")
    return counts

@api.get("/staff-compliance/{sid}")
async def compliance_detail(sid: int, user=Depends(current_user)):
    s = await db.staff.find_one({"id": sid}, {"_id":0})
    if not s: raise HTTPException(404, "Not found")
    docs = await list_col("staff_documents", {"staff_id": sid})
    c = compute_compliance(s, docs)
    return {**s, "docs": docs, **c}

# ────────────────────────────────────────────────────────────────────────────
# CONSENTS / FEEDBACK
# ────────────────────────────────────────────────────────────────────────────
@api.get("/consents")
async def list_consents(patient_id: Optional[int]=None, user=Depends(current_user)):
    q = {"patient_id": patient_id} if patient_id else {}
    rows = await list_col("consents", q)
    pmap = {p["id"]: p for p in await list_col("patients")}
    for r in rows:
        p = pmap.get(r.get("patient_id"), {})
        r["patient_name"] = p.get("name")
        r["reg_number"] = p.get("reg_number")
    return rows

@api.post("/consents")
async def add_consent(d: Dict[str, Any], user=Depends(current_user)):
    cid = await next_id("consents")
    await db.consents.insert_one({"id": cid, "status":"Signed", "created_at": now_iso(), **d})
    return {"id": cid, "message": "Consent recorded"}

@api.get("/feedback")
async def list_feedback(patient_id: Optional[int]=None, staff_id: Optional[int]=None, user=Depends(current_user)):
    q = {}
    if patient_id: q["patient_id"] = patient_id
    if staff_id: q["staff_id"] = staff_id
    return await list_col("feedback", q)

@api.post("/feedback")
async def add_feedback(d: Dict[str, Any], user=Depends(current_user)):
    fid = await next_id("feedback")
    await db.feedback.insert_one({"id": fid, "created_at": now_iso(), **d})
    if d.get("staff_id") and d.get("staff_rating"):
        await db.staff_ratings.insert_one({"id": await next_id("staff_ratings"),
            "staff_id": d["staff_id"], "patient_id": d.get("patient_id"),
            "source":"Patient Feedback", "score": d["staff_rating"],
            "comment": d.get("comments",""), "rated_at": now_iso()})
        await recalc_weighted_rating(d["staff_id"])
    return {"id": fid, "message": "Feedback submitted"}

# ────────────────────────────────────────────────────────────────────────────
# MCQ
# ────────────────────────────────────────────────────────────────────────────
@api.get("/mcq/questions")
async def list_mcq(topic: Optional[str]=None, user=Depends(current_user)):
    q = {"topic": topic} if topic else {}
    return await list_col("mcq_questions", q, sort=("topic", 1))

@api.post("/mcq/questions")
async def add_mcq(d: Dict[str, Any], user=Depends(current_user)):
    qid = await next_id("mcq_questions")
    await db.mcq_questions.insert_one({"id": qid, "marks": d.get("marks", 1), "created_at": now_iso(), **d})
    return {"id": qid, "message": "Question added"}

@api.delete("/mcq/questions/{qid}")
async def del_mcq(qid: int, user=Depends(current_user)):
    await db.mcq_questions.delete_one({"id": qid})
    return {"message": "Question deleted"}

@api.post("/mcq/submit")
async def submit_mcq(body: Dict[str, Any], user=Depends(current_user)):
    questions = await list_col("mcq_questions", {"topic": body.get("topic")})
    if not questions: raise HTTPException(400, "No questions found")
    answers = body.get("answers", {})
    correct = sum(1 for q in questions if str(answers.get(str(q["id"]), answers.get(q["id"], ""))).upper() == (q.get("correct_option","") or "").upper())
    total = len(questions); score = round((correct / total) * 100) if total else 0
    rid = await next_id("mcq_results")
    await db.mcq_results.insert_one({"id": rid, "staff_id": body.get("staff_id"),
        "topic": body.get("topic"), "training_id": body.get("training_id"),
        "score": score, "correct": correct, "total": total, "submitted_at": now_iso()})
    if body.get("training_id"):
        await db.training.update_one({"id": body["training_id"]}, {"$set":{"test_score": score}})
    return {"id": rid, "score": score, "correct": correct, "total": total,
            "message": f"Score: {score}% ({correct}/{total} correct)"}

@api.get("/mcq/results")
async def mcq_results(staff_id: Optional[int]=None, user=Depends(current_user)):
    q = {"staff_id": staff_id} if staff_id else {}
    rows = await list_col("mcq_results", q, sort=("submitted_at", -1))
    smap = {s["id"]: s for s in await list_col("staff")}
    for r in rows: r["staff_name"] = smap.get(r.get("staff_id"), {}).get("name")
    return rows

# ────────────────────────────────────────────────────────────────────────────
# PAYROLL
# ────────────────────────────────────────────────────────────────────────────
def _parse_salary(s):
    try: return float(re.sub(r"[^0-9.]", "", str(s or "0"))) or 0
    except: return 0

@api.get("/payroll")
async def payroll(month: Optional[str]=None, staff_id: Optional[int]=None,
                  vendor: Optional[str]=None, user=Depends(current_user)):
    m = month or datetime.now().strftime("%Y-%m")
    q = {"status":"Active"}
    if staff_id: q["id"] = staff_id
    if vendor: q["vendor"] = vendor
    staff = await list_col("staff", q, sort=("name",1))
    result = []
    for s in staff:
        att = await db.attendance.find({"staff_id": s["id"],
            "date": {"$regex": f"^{m}"}}).to_list(200)
        present = sum(1 for a in att if a.get("status")=="Present")
        absent = sum(1 for a in att if a.get("status")=="Absent")
        hrs = round(sum(a.get("hours_worked") or 0 for a in att), 2)
        bookings = await db.bookings.count_documents({"staff_id": s["id"], "start_date": {"$regex": f"^{m}"}})
        rec = await db.payroll_records.find_one({"staff_id": s["id"], "month": m}, {"_id":0})
        monthly = _parse_salary(s.get("salary"))
        gross = (rec or {}).get("gross_pay") or round((monthly / 26) * present) if present else 0
        deductions = round(gross * 0.02); net_pay = gross - deductions
        result.append({"id":s["id"],"name":s["name"],"code":s.get("code"),"role":s.get("role"),
            "vendor":s.get("vendor"),"employment_type":s.get("employment_type"),
            "salary":s.get("salary"),"bank_account":s.get("bank_account"),"ifsc":s.get("ifsc"),
            "days_attended":len(att),"present_days":present,"absent_days":absent,
            "total_hours":hrs,"avg_hours_per_day":round(hrs/present,2) if present else 0,
            "bookings_served":bookings,"monthly_salary":monthly,
            "gross_pay":gross,"deductions":deductions,"net_pay":net_pay,
            "payroll_status": (rec or {}).get("payment_status"), "payroll_id": (rec or {}).get("id")})
    return result

@api.post("/payroll/generate")
async def payroll_gen(body: Dict[str, Any], user=Depends(current_user)):
    m = body.get("month")
    if not m: raise HTTPException(400, "month required")
    ids = body.get("staff_ids") or []
    q = {"status":"Active"}
    if ids: q["id"] = {"$in": ids}
    staff = await list_col("staff", q)
    cnt = 0
    for s in staff:
        att = await db.attendance.find({"staff_id": s["id"], "date": {"$regex": f"^{m}"}}).to_list(200)
        present = sum(1 for a in att if a.get("status")=="Present")
        hrs = round(sum(a.get("hours_worked") or 0 for a in att), 2)
        monthly = _parse_salary(s.get("salary"))
        gross = round((monthly / 26) * present); deductions = round(gross * 0.02); net = gross - deductions
        ex = await db.payroll_records.find_one({"staff_id": s["id"], "month": m})
        rec = {"gross_pay":gross,"deductions":deductions,"net_pay":net,"days_payable":present,"total_hours":hrs}
        if ex: await db.payroll_records.update_one({"id": ex["id"]}, {"$set": rec})
        else:
            await db.payroll_records.insert_one({"id": await next_id("payroll_records"),
                "staff_id": s["id"], "month": m, "base_salary": monthly,
                "payment_status":"Pending","generated_by": user.get("name","Admin"),
                "created_at": now_iso(), **rec})
        cnt += 1
    return {"message": f"Payroll generated for {cnt} staff", "month": m}

@api.patch("/payroll/{pid}/pay")
async def payroll_pay(pid: int, body: Dict[str, Any], user=Depends(current_user)):
    await db.payroll_records.update_one({"id": pid}, {"$set": {
        "payment_status":"Paid","payment_mode":body.get("payment_mode"),
        "payment_date": body.get("payment_date") or today(),"remarks": body.get("remarks","")}})
    return {"message": "Payment recorded"}

@api.get("/payroll/records")
async def payroll_records(month: Optional[str]=None, vendor: Optional[str]=None, user=Depends(current_user)):
    q = {}
    if month: q["month"] = month
    rows = await list_col("payroll_records", q)
    smap = {s["id"]: s for s in await list_col("staff")}
    for r in rows:
        s = smap.get(r.get("staff_id"), {})
        r.update({"name":s.get("name"),"code":s.get("code"),"role":s.get("role"),
                  "vendor":s.get("vendor"),"bank_account":s.get("bank_account"),"ifsc":s.get("ifsc")})
    if vendor: rows = [r for r in rows if r.get("vendor")==vendor]
    return rows

# ────────────────────────────────────────────────────────────────────────────
# REPORTS & ALERTS
# ────────────────────────────────────────────────────────────────────────────
@api.get("/reports/staff-summary")
async def staff_summary(frm: Optional[str]=Query(None, alias="from"), to: Optional[str]=None,
                       vendor: Optional[str]=None, user=Depends(current_user)):
    q = {"status":"Active"}
    if vendor: q["vendor"] = vendor
    staff = await list_col("staff", q)
    out = []
    for s in staff:
        aq = {"staff_id": s["id"]}
        if frm: aq["date"] = {"$gte": frm}
        if to: aq.setdefault("date", {})["$lte"] = to
        att = await db.attendance.find(aq).to_list(500)
        days = len(set(a.get("date") for a in att))
        hrs = round(sum(a.get("hours_worked") or 0 for a in att), 2)
        bookings = await db.bookings.count_documents({"staff_id": s["id"]})
        out.append({"name":s["name"],"code":s.get("code"),"role":s.get("role"),"vendor":s.get("vendor"),
                    "days_worked":days,"total_hours":hrs,"total_bookings":bookings,"rating":s.get("rating",0)})
    return out

@api.get("/reports/patient-summary")
async def patient_summary(user=Depends(current_user)):
    pipe = [{"$group":{"_id":{"service_location":"$service_location","category":"$category","status":"$status"},"count":{"$sum":1}}},
            {"$sort":{"count":-1}}]
    return [{"service_location":r["_id"].get("service_location"),"category":r["_id"].get("category"),
             "status":r["_id"].get("status"),"count":r["count"]}
            for r in await db.patients.aggregate(pipe).to_list(500)]

@api.get("/reports/revenue-summary")
async def revenue_summary(frm: Optional[str]=Query(None, alias="from"), to: Optional[str]=None,
                          user=Depends(current_user)):
    match = {}
    if frm: match["date"] = {"$gte": frm}
    if to: match.setdefault("date", {})["$lte"] = to
    pipe = [{"$match": match}, {"$group":{"_id":{"$substr":["$date",0,7]},
        "total_bills":{"$sum":1},"total_billed":{"$sum":"$amount"},
        "total_collected":{"$sum":"$paid_amount"},"total_pending":{"$sum":"$balance"},
        "paid_count":{"$sum":{"$cond":[{"$eq":["$payment_status","Paid"]},1,0]}},
        "pending_count":{"$sum":{"$cond":[{"$eq":["$payment_status","Pending"]},1,0]}}}},
        {"$sort":{"_id":-1}}]
    return [{"month":r["_id"], **{k:r[k] for k in r if k!="_id"}} for r in await db.bills.aggregate(pipe).to_list(36)]

@api.get("/alerts/amc-cmc")
async def amc_cmc(user=Depends(current_user)):
    in30 = in_days(30)
    out = []
    async for a in db.assets.find({"$or": [{"amc_date": {"$lte": in30, "$ne": None}}, {"cmc_date": {"$lte": in30, "$ne": None}}]}, {"_id":0}):
        if a.get("amc_date") and a["amc_date"] <= in30:
            out.append({**a, "alert_type":"AMC","alert_date":a["amc_date"]})
        if a.get("cmc_date") and a["cmc_date"] <= in30:
            out.append({**a, "alert_type":"CMC","alert_date":a["cmc_date"]})
    out.sort(key=lambda x: x.get("alert_date") or "")
    return out

@api.get("/alerts/document-expiry")
async def doc_expiry(user=Depends(current_user)):
    in30 = in_days(30)
    docs = await db.staff_documents.find({"expiry_date": {"$lte": in30, "$ne": None}}, {"_id":0}).sort("expiry_date",1).to_list(500)
    smap = {s["id"]: s for s in await list_col("staff")}
    for d in docs:
        s = smap.get(d.get("staff_id"), {})
        d["staff_name"] = s.get("name"); d["staff_code"] = s.get("code")
    return docs

# ────────────────────────────────────────────────────────────────────────────
# USERS / RBAC
# ────────────────────────────────────────────────────────────────────────────
@api.get("/users")
async def list_users(user=Depends(require("admin:read"))):
    rows = await db.users.find({}, {"_id":0, "password":0}).sort("id", 1).to_list(500)
    return rows

@api.post("/users")
async def create_user(d: Dict[str, Any], user=Depends(current_user)):
    if user.get("role") != "admin": raise HTTPException(403, "Admin only")
    if d.get("role") not in ROLES: raise HTTPException(400, f"Role must be one of {ROLES}")
    if await db.users.find_one({"username": d.get("username")}):
        raise HTTPException(400, "Username already exists")
    uid = await next_id("users")
    doc = {"id": uid, "username": d["username"], "name": d.get("name", d["username"]),
           "role": d["role"], "password": pwd_ctx.hash(d.get("password", "Change@1234")),
           "status": "Active", "phone": d.get("phone",""), "email": d.get("email",""),
           "created_at": now_iso()}
    await db.users.insert_one(doc)
    await audit(user, "create", "user", uid, after={"username": d["username"], "role": d["role"]})
    return {"id": uid, "message": "User created"}

@api.put("/users/{uid}")
async def update_user(uid: int, d: Dict[str, Any], user=Depends(current_user)):
    if user.get("role") != "admin": raise HTTPException(403, "Admin only")
    update = {k: v for k, v in d.items() if k in ("name", "role", "phone", "email", "status")}
    if d.get("password"): update["password"] = pwd_ctx.hash(d["password"])
    if update.get("role") and update["role"] not in ROLES:
        raise HTTPException(400, f"Role must be one of {ROLES}")
    before = await db.users.find_one({"id": uid}, {"_id":0, "password":0})
    await db.users.update_one({"id": uid}, {"$set": update})
    await audit(user, "update", "user", uid, before=before, after=update)
    return {"message": "User updated"}

@api.delete("/users/{uid}")
async def delete_user(uid: int, user=Depends(current_user)):
    if user.get("role") != "admin": raise HTTPException(403, "Admin only")
    if uid == user.get("id"): raise HTTPException(400, "Cannot delete yourself")
    await db.users.update_one({"id": uid}, {"$set": {"status": "Disabled"}})
    await audit(user, "disable", "user", uid)
    return {"message": "User disabled"}

@api.get("/me")
async def me(user=Depends(current_user)):
    full = await db.users.find_one({"id": user.get("id")}, {"_id":0, "password":0})
    return full or user

@api.get("/roles")
async def list_roles(user=Depends(current_user)):
    return [{"role": r, "permissions": sorted(list(PERMS.get(r, set())))} for r in ROLES]

@api.post("/admin/reset-database")
async def reset_database(body: Optional[Dict[str, Any]] = None, user=Depends(current_user)):
    """
    Admin-only: wipe MongoDB collections and re-run seeds.
    Body (optional):
      { "collections": ["staff","patients",...] }   → only wipe these
      { "confirm": true }                           → required when wiping ALL
    Returns counts of seeded entities.
    """
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    body = body or {}
    targets = body.get("collections")
    db_name = db.name

    if targets:
        # Selective wipe — drop just the requested collections
        wiped = []
        for c in targets:
            try:
                await db.drop_collection(c)
                wiped.append(c)
            except Exception as e:
                logger.warning(f"reset: drop {c} failed: {e}")
        await audit(user, "reset", "database", 0, {"mode": "selective", "collections": wiped})
        # Re-run all seeds (idempotent — only fills empty collections)
        await seed()
        await _seed_templates()
        await _seed_services()
        return {"message": "Selective reset complete", "wiped": wiped, "reseeded": True}

    # Full wipe — require explicit confirm to avoid accidents
    if not body.get("confirm"):
        raise HTTPException(400, "Add {\"confirm\": true} to wipe the entire database")

    # Drop every collection in the DB (preserves the DB itself)
    cols = await db.list_collection_names()
    for c in cols:
        try:
            await db.drop_collection(c)
        except Exception as e:
            logger.warning(f"reset: drop {c} failed: {e}")
    await seed()
    await _seed_templates()
    await _seed_services()

    counts = {
        "users":           await db.users.count_documents({}),
        "staff":           await db.staff.count_documents({}),
        "patients":        await db.patients.count_documents({}),
        "vendors":         await db.vendors.count_documents({}),
        "leads":           await db.leads.count_documents({}),
        "bookings":        await db.bookings.count_documents({}),
        "bills":           await db.bills.count_documents({}),
        "ambulance_calls": await db.ambulance_calls.count_documents({}),
        "assets":          await db.assets.count_documents({}),
        "notif_templates": await db.notif_templates.count_documents({}),
        "services":        await db.services.count_documents({}),
        "patient_wallets":         await db.patient_wallets.count_documents({}),
        "wallet_transactions":     await db.wallet_transactions.count_documents({}),
        "wallet_refund_requests":  await db.wallet_refund_requests.count_documents({}),
        "booking_history":         await db.booking_history.count_documents({}),
    }
    return {
        "message": "Database wiped and re-seeded successfully",
        "database": db_name,
        "dropped_collections": cols,
        "seeded_counts": counts,
    }

# ────────────────────────────────────────────────────────────────────────────
# WALLET — patient prepaid balance, transactions, refund requests, reports
# ────────────────────────────────────────────────────────────────────────────
@api.post("/wallet/admin/bulk-credit")
async def admin_bulk_credit(body: Dict[str, Any], user=Depends(current_user)):
    """Admin-only: credit multiple wallets at once.

    Body: {"entries": [{"patient_id": 1, "amount": 5000, "remarks": "..."}], "remarks": "default"}
    or matching by reg_number: [{"reg_number": "RO-PAT-001", "amount": 5000}]
    Each entry creates an ADJUSTMENT/CREDIT wallet_transaction and updates balance.
    Returns a per-row report. Idempotency: each row gets a unique tx, so calling twice
    will credit twice — use carefully.
    """
    if not is_super_admin(user):
        raise HTTPException(403, "Only Super Admin can bulk-credit wallets")
    entries = body.get("entries") or []
    if not isinstance(entries, list) or not entries:
        raise HTTPException(400, "entries must be a non-empty list")
    default_remarks = body.get("remarks") or "Bulk credit (admin)"
    results = []
    pmap_by_reg = None
    for i, e in enumerate(entries):
        try:
            pid = e.get("patient_id")
            if not pid and e.get("reg_number"):
                if pmap_by_reg is None:
                    pmap_by_reg = {p["reg_number"]: p["id"] for p in await list_col("patients") if p.get("reg_number")}
                pid = pmap_by_reg.get(e["reg_number"])
            amount = float(e.get("amount") or 0)
            if not pid or amount <= 0:
                results.append({"row": i, "patient_id": pid, "status": "skipped",
                                "reason": "missing patient_id/reg_number or non-positive amount"})
                continue
            await _ensure_wallet(int(pid))
            tx = await _wallet_tx(
                int(pid), "ADJUSTMENT", amount,
                "Bulk Credit", None,
                e.get("remarks") or default_remarks,
                user,
            )
            results.append({"row": i, "patient_id": pid, "status": "credited",
                            "amount": amount, "tx_id": tx["id"],
                            "balance_after": tx["balance_after"]})
        except Exception as ex:
            results.append({"row": i, "patient_id": e.get("patient_id"),
                            "status": "error", "reason": str(ex)})
    await audit(user, "wallet_bulk_credit", "wallet", None, None,
                {"count": len(entries), "credited": sum(1 for r in results if r["status"]=="credited")})
    return {
        "message": f"Bulk credit complete — {sum(1 for r in results if r['status']=='credited')} of {len(entries)} credited",
        "results": results,
    }

@api.post("/wallet/admin/recalculate")
async def admin_recalculate_wallets(user=Depends(current_user)):
    """Admin-only: rebuild wallet balances from the transaction ledger and
    backfill any missing credits from historical Stopped/Converted/Cancelled
    bookings. Safe & idempotent — run anytime balances look wrong."""
    if not is_super_admin(user):
        raise HTTPException(403, "Only Super Admin can recalculate wallets")
    backfill = await backfill_wallets() or {}
    recon     = await reconcile_wallet_credits_from_bookings() or {}
    recon_bil = await reconcile_wallet_credits_from_bills() or {}
    recompute = await recompute_wallet_balances_from_transactions() or {}
    await audit(user, "wallet_recalculate", "wallet", None, None,
                {"reconciliation": recon, "bill_reconciliation": recon_bil, "recompute": recompute})
    return {
        "message": "Wallet recalculation complete",
        "reconciliation": recon,
        "bill_reconciliation": recon_bil,
        "balance_recompute": recompute,
    }

@api.get("/wallet/dashboard-stats")
async def wallet_dashboard_stats(user=Depends(current_user)):
    a = await db.patient_wallets.aggregate([{"$group":{"_id":None,"v":{"$sum":"$current_balance"}}}]).to_list(1)
    total_balance = a[0]["v"] if a else 0
    month_start = dt_date.today().replace(day=1).isoformat()
    cm = await db.wallet_transactions.aggregate([
        {"$match": {"transaction_type": {"$in": ["CREDIT","ADJUSTMENT"]}, "created_at": {"$gte": month_start}}},
        {"$group": {"_id": None, "v": {"$sum": "$amount"}}}
    ]).to_list(1)
    dm = await db.wallet_transactions.aggregate([
        {"$match": {"transaction_type": {"$in": ["DEBIT","REFUND"]}, "created_at": {"$gte": month_start}}},
        {"$group": {"_id": None, "v": {"$sum": "$amount"}}}
    ]).to_list(1)
    return {
        "totalWalletBalance":     round(float(total_balance or 0), 2),
        "pendingRefundRequests":  await db.wallet_refund_requests.count_documents({"status": "Pending"}),
        "approvedRefundRequests": await db.wallet_refund_requests.count_documents({"status": "Approved"}),
        "walletCreditsThisMonth": round(float(cm[0]["v"] if cm else 0), 2),
        "walletDebitsThisMonth":  round(float(dm[0]["v"] if dm else 0), 2),
        "patientsWithBalance":    await db.patient_wallets.count_documents({"current_balance": {"$gt": 0}}),
    }

@api.get("/wallets")
async def list_wallets(min_balance: Optional[float]=None,
                       search: Optional[str]=None,
                       user=Depends(current_user)):
    """Wallet overview list (admin/manager/accountant).

    Returns one row per Active patient. If a patient has no wallet record yet,
    one is auto-created with zero balances (idempotent, safe). This ensures
    every patient appears in the Wallet module regardless of whether they have
    transacted yet — matching the original Emergent backend behavior.
    """
    if user.get("role") not in ("admin","manager","accountant"):
        raise HTTPException(403, "Admin/Manager/Accountant only")

    # 1. Load all Active patients
    patients = await list_col("patients", {"status": "Active"})

    # 2. Load all wallets and index by patient_id
    wallets = await list_col("patient_wallets", {})
    wmap = {w.get("patient_id"): w for w in wallets}

    # 3. Auto-create wallet docs for any patient missing one (in-memory + DB)
    missing = [p for p in patients if p["id"] not in wmap]
    if missing:
        for p in missing:
            w = await _ensure_wallet(p["id"])
            wmap[p["id"]] = w

    # 4. Build the response list — one row per patient, enriched
    out = []
    min_b = float(min_balance) if min_balance is not None else None
    s = (search or "").strip().lower()
    for p in patients:
        w = wmap.get(p["id"]) or {}
        bal = float(w.get("current_balance") or 0)
        if min_b is not None and bal < min_b:
            continue
        row = {
            "id": w.get("id"),
            "patient_id": p["id"],
            "patient_name":   p.get("name", ""),
            "patient_mobile": p.get("mobile", ""),
            "reg_number":     p.get("reg_number", ""),
            "current_balance": bal,
            "total_credited":  float(w.get("total_credited") or 0),
            "total_debited":   float(w.get("total_debited") or 0),
            "total_refunded":  float(w.get("total_refunded") or 0),
            "created_at":      w.get("created_at"),
            "updated_at":      w.get("updated_at"),
        }
        if s:
            hay = f"{row['patient_name']} {row['patient_mobile']} {row['reg_number']}".lower()
            if s not in hay:
                continue
        out.append(row)

    # Sort: highest balance first, then by patient name
    out.sort(key=lambda r: (-r["current_balance"], r["patient_name"].lower()))
    return out

# ── Refund Request listing/status (declared BEFORE /wallet/{pid} to avoid
#    FastAPI route shadowing — otherwise /wallet/refund-requests is matched
#    against /wallet/{pid:int} and returns 422.)
@api.get("/wallet/refund-requests")
async def list_refund_requests(status: Optional[str]=None,
                               patient_id: Optional[int]=None,
                               user=Depends(current_user)):
    q = {}
    if status: q["status"] = status
    if patient_id: q["patient_id"] = patient_id
    rows = await list_col("wallet_refund_requests", q)
    pmap = {p["id"]: p for p in await list_col("patients")}
    for r in rows:
        p = pmap.get(r.get("patient_id"), {})
        r["patient_name"]   = p.get("name", "")
        r["patient_mobile"] = p.get("mobile", "")
        r["reg_number"]     = p.get("reg_number", "")
    return rows

@api.patch("/wallet/refund-requests/{rid}/status")
async def update_refund_request(rid: int, body: Dict[str, Any], user=Depends(current_user)):
    if not is_super_admin(user):
        raise HTTPException(403, "Only Super Admin can update refund request status")
    cur = await db.wallet_refund_requests.find_one({"id": rid})
    if not cur:
        raise HTTPException(404, "Refund request not found")
    new_status = body.get("status")
    if new_status not in ("Approved", "Rejected", "Completed"):
        raise HTTPException(400, "status must be Approved, Rejected, or Completed")
    if cur.get("status") in ("Completed", "Rejected"):
        raise HTTPException(400, f"Already {cur.get('status')}")

    update = {"status": new_status, "updated_at": now_iso(),
              "actioned_by": user.get("name"), "actioned_by_role": user.get("role")}
    if new_status == "Approved":
        update["approved_at"] = now_iso()
        update["approval_remarks"] = body.get("remarks") or ""
    elif new_status == "Rejected":
        update["rejected_at"] = now_iso()
        update["rejection_reason"] = body.get("remarks") or "Rejected by admin"
    elif new_status == "Completed":
        if cur.get("status") not in ("Pending", "Approved"):
            raise HTTPException(400, "Must be Pending or Approved before Completed")
        tx = await _wallet_tx(cur["patient_id"], "REFUND", cur["amount"],
                              "Refund Request", rid,
                              f"Refund completed (mode={cur.get('payment_mode','-')}, ref={cur.get('bank_ref','-')})",
                              user)
        update["completed_at"] = now_iso()
        update["wallet_transaction_id"] = tx["id"]

    await db.wallet_refund_requests.update_one({"id": rid}, {"$set": update})
    await audit(user, "wallet_refund_request_update", "wallet_refund_request", rid, cur, update)
    return {"message": f"Refund request {new_status}"}

@api.get("/wallet/{pid}")
async def get_wallet(pid: int, user=Depends(current_user)):
    w = await _ensure_wallet(pid)
    p = await db.patients.find_one({"id": pid}, {"_id": 0})
    w.pop("_id", None)
    return {**w,
            "patient_name":   (p or {}).get("name"),
            "patient_mobile": (p or {}).get("mobile"),
            "reg_number":     (p or {}).get("reg_number")}

@api.get("/wallet/{pid}/transactions")
async def wallet_transactions(pid: int,
                              tx_type: Optional[str] = None,
                              frm: Optional[str] = Query(None, alias="from"),
                              to:  Optional[str] = None,
                              user=Depends(current_user)):
    q = {"patient_id": pid}
    if tx_type:
        q["transaction_type"] = tx_type.upper()
    if frm:
        q["created_at"] = {"$gte": frm}
    if to:
        q.setdefault("created_at", {})["$lte"] = to + "T23:59:59"
    return await list_col("wallet_transactions", q, sort=("id", -1))

@api.post("/wallet/{pid}/adjust")
async def adjust_wallet(pid: int, body: Dict[str, Any], user=Depends(current_user)):
    """Manual wallet adjustment — Super Admin only."""
    if not is_super_admin(user):
        raise HTTPException(403, "Only Super Admin can adjust wallet")
    direction = (body.get("direction") or "credit").lower()
    amount = float(body.get("amount") or 0)
    if amount <= 0:
        raise HTTPException(400, "amount must be > 0")
    remarks = body.get("remarks") or "Manual adjustment"
    tx_type = "ADJUSTMENT" if direction == "credit" else "DEBIT"
    tx = await _wallet_tx(pid, tx_type, amount, "Manual Adjustment", None, remarks, user)
    await audit(user, "wallet_adjust", "patient_wallet", pid, None, tx)
    return {"message": f"Wallet {'credited' if direction=='credit' else 'debited'} by ₹{amount:.2f}", "transaction": tx}

# ── Refund Request workflow (Pending → Approved → Completed | Rejected) ──
@api.post("/wallet/{pid}/refund-request")
async def create_refund_request(pid: int, body: Dict[str, Any], user=Depends(current_user)):
    w = await _ensure_wallet(pid)
    amt = float(body.get("amount") or 0)
    if amt <= 0:
        raise HTTPException(400, "Refund amount must be > 0")
    if amt > float(w.get("current_balance") or 0) + 1e-6:
        raise HTTPException(400, f"Refund exceeds wallet balance ₹{float(w.get('current_balance') or 0):.2f}")
    doc = {
        "id": await next_id("wallet_refund_requests"),
        "patient_id": pid,
        "amount": round(amt, 2),
        "reason":          body.get("reason") or "",
        "payment_mode":    body.get("payment_mode") or "Bank Transfer",
        "bank_ref":        body.get("bank_ref") or "",
        "account_name":    body.get("account_name") or "",
        "account_number":  body.get("account_number") or "",
        "ifsc":            body.get("ifsc") or "",
        "upi_id":          body.get("upi_id") or "",
        "remarks":         body.get("remarks") or "",
        "status":          "Pending",
        "requested_by":    user.get("name"),
        "requested_by_role": user.get("role"),
        "created_at":      now_iso(),
    }
    await db.wallet_refund_requests.insert_one(doc)
    await audit(user, "wallet_refund_request_create", "wallet_refund_request", doc["id"], None, doc)
    return {"id": doc["id"], "message": "Refund request created (Pending approval)"}

# ── Booking lifecycle: STOP (credit wallet) & CONVERT (recalc + new booking) ──
@api.post("/bookings/{bid}/stop")
async def stop_booking(bid: int, body: Dict[str, Any], user=Depends(current_user)):
    if user.get("role") not in COORDINATOR_ROLES:
        raise HTTPException(403, "Not allowed to stop a booking")
    booking = await db.bookings.find_one({"id": bid})
    if not booking:
        raise HTTPException(404, "Booking not found")
    if booking.get("status") in ("Completed", "Cancelled", "Stopped", "Converted"):
        raise HTTPException(400, f"Already {booking.get('status')}")

    stop_date = body.get("stop_date") or today()
    reason    = body.get("reason") or "Service stopped"
    paid      = float(booking.get("paid_amount") or 0)
    consumed  = _calc_consumed_amount(booking, stop_date)
    if consumed > paid:
        consumed = paid
    refundable = round(paid - consumed, 2)

    update = {
        "status": "Stopped",
        "stopped_at": now_iso(),
        "stopped_by": user.get("name"),
        "stop_reason": reason,
        "stop_date":  stop_date,
        "consumed_amount":   consumed,
        "refundable_amount": refundable,
        "end_date":  stop_date,
    }
    await db.bookings.update_one({"id": bid}, {"$set": update})

    await db.booking_history.insert_one({
        "id": await next_id("booking_history"),
        "booking_id": bid, "action": "stopped",
        "before": _sanitize({"status": booking.get("status"), "end_date": booking.get("end_date")}),
        "after":  {"status": "Stopped", "end_date": stop_date,
                   "consumed": consumed, "refundable": refundable},
        "edited_by": user.get("name"), "edited_by_role": user.get("role"),
        "reason": reason, "created_at": now_iso(),
    })

    tx = None
    if refundable > 0 and booking.get("patient_id"):
        tx = await _wallet_tx(booking["patient_id"], "CREDIT", refundable,
                              "Service Cancellation", bid,
                              f"Service {booking.get('booking_id')} stopped on {stop_date}. Consumed ₹{consumed:.2f} of paid ₹{paid:.2f}",
                              user)
        await db.notifications.insert_one({
            "id": await next_id("notifications"),
            "recipient_type": "patient", "recipient_id": booking["patient_id"],
            "title":  "Wallet Credited",
            "message": f"Dear Patient, ₹{refundable:.2f} has been credited to your Reach Out Wallet and can be used for future services.",
            "channel": "in-app", "status": "Pending",
            "template": "wallet_credit", "amount": refundable,
            "created_at": now_iso(),
        })
    await audit(user, "booking_stop", "booking", bid, booking, update)
    return {
        "message": (f"₹{refundable:.2f} transferred to patient's wallet." if refundable > 0
                    else "Service stopped (no balance to credit)"),
        "consumed": consumed,
        "refundable": refundable,
        "transaction": tx,
    }

@api.post("/bookings/{bid}/convert")
async def convert_booking(bid: int, body: Dict[str, Any], user=Depends(current_user)):
    if not is_manager_or_admin(user):
        raise HTTPException(403, "Only Super Admin / Manager can convert a service")
    cur = await db.bookings.find_one({"id": bid})
    if not cur:
        raise HTTPException(404, "Booking not found")
    if cur.get("status") in ("Completed","Cancelled","Stopped","Converted"):
        raise HTTPException(400, f"Cannot convert {cur.get('status')} booking")

    new_service_category = body.get("service_category") or cur.get("service_category")
    new_service_name     = body.get("service_name")     or cur.get("service_name")
    try:
        new_rate = float(body.get("rate_per_shift") or 0)
    except Exception:
        raise HTTPException(400, "rate_per_shift must be numeric")
    if new_rate <= 0:
        raise HTTPException(400, "rate_per_shift is required and > 0")
    conversion_date = body.get("conversion_date") or today()
    reason = body.get("reason") or "Service converted"

    paid     = float(cur.get("paid_amount") or 0)
    consumed = _calc_consumed_amount(cur, conversion_date)
    if consumed > paid: consumed = paid
    refundable = round(paid - consumed, 2)

    # 1) Credit unused portion to wallet
    tx_credit = None
    if refundable > 0 and cur.get("patient_id"):
        tx_credit = await _wallet_tx(cur["patient_id"], "CREDIT", refundable,
                                     "Service Conversion", bid,
                                     f"Service converted from {cur.get('service_name')} to {new_service_name} on {conversion_date}",
                                     user)

    # 2) Close out original
    update_old = {
        "status": "Converted",
        "end_date": conversion_date,
        "consumed_amount": consumed,
        "refundable_amount": refundable,
        "converted_at": now_iso(),
        "converted_by": user.get("name"),
        "conversion_reason": reason,
        "converted_to": new_service_name,
    }
    await db.bookings.update_one({"id": bid}, {"$set": update_old})

    # 3) Create the new booking
    try:
        new_shifts = int(body.get("total_shifts") or 0)
    except Exception:
        new_shifts = 0
    new_amount = float(body.get("amount") or (new_rate * new_shifts) or 0)
    new_start  = body.get("start_date") or conversion_date
    new_end    = body.get("end_date")
    use_wallet = bool(body.get("use_wallet"))

    new_paid = 0.0
    tx_debit = None
    if use_wallet and new_amount > 0 and cur.get("patient_id"):
        w = await _ensure_wallet(cur["patient_id"])
        to_use = round(min(float(w.get("current_balance") or 0), new_amount), 2)
        if to_use > 0:
            tx_debit = await _wallet_tx(cur["patient_id"], "DEBIT", to_use,
                                        "Service Booking", None,
                                        f"Used wallet for converted booking", user)
            new_paid = to_use

    new_bid_str = f"BK-{datetime.now().strftime('%Y%m%d')}-{random.randint(1000,9999)}"
    new_bid_int = await next_id("bookings")
    new_doc = {
        "id": new_bid_int, "booking_id": new_bid_str,
        "patient_id": cur.get("patient_id"),
        "service_category": new_service_category,
        "service_name": new_service_name,
        "rate_per_shift": new_rate, "total_shifts": new_shifts,
        "start_date": new_start, "end_date": new_end,
        "shift":     body.get("shift")    or cur.get("shift"),
        "staff_id":  body.get("staff_id") or cur.get("staff_id"),
        "status":    "Active",
        "amount":      new_amount,
        "paid_amount": new_paid,
        "balance":     round(new_amount - new_paid, 2),
        "wallet_used": new_paid,
        "payment_mode": "Wallet" if new_paid > 0 else (body.get("payment_mode") or ""),
        "payment_status": ("Paid"    if abs(new_paid - new_amount) < 1e-6 and new_amount > 0
                           else "Partial" if new_paid > 0 else "Pending"),
        "created_by":      user.get("name"),
        "created_by_role": user.get("role"),
        "created_at":      now_iso(),
        "expires_at":      in_days(30),
        "converted_from_booking_id": cur.get("booking_id"),
        "parent_booking_id":         bid,
    }
    await db.bookings.insert_one(new_doc)
    new_doc.pop("_id", None)
    if tx_debit:
        await db.wallet_transactions.update_one({"id": tx_debit["id"]},
                                                {"$set": {"reference_id": new_bid_int}})

    await db.booking_history.insert_one({
        "id": await next_id("booking_history"),
        "booking_id": bid, "action": "converted",
        "before": _sanitize({"service_name": cur.get("service_name"),
                   "rate_per_shift": cur.get("rate_per_shift"),
                   "amount": cur.get("amount")}),
        "after":  {"service_name": new_service_name,
                   "rate_per_shift": new_rate, "amount": new_amount,
                   "new_booking_id": new_bid_str},
        "edited_by": user.get("name"), "edited_by_role": user.get("role"),
        "reason": reason, "created_at": now_iso(),
    })
    await audit(user, "booking_convert", "booking", bid, cur, {**update_old, "new_booking_id": new_bid_int})
    return {
        "message": "Service converted successfully",
        "old_booking_id": bid,
        "new_booking_id": new_bid_int,
        "new_booking":    new_doc,
        "wallet_credited": refundable,
        "wallet_used":     (tx_debit["amount"] if tx_debit else 0),
        "consumed":        consumed,
    }

@api.get("/bookings/{bid}/history")
async def get_booking_history(bid: int, user=Depends(current_user)):
    return await list_col("booking_history", {"booking_id": bid}, sort=("id", -1))

# ── Wallet reports ─────────────────────────────────────────────────────────
@api.get("/reports/wallet")
async def wallet_report(frm: Optional[str] = Query(None, alias="from"),
                        to:  Optional[str] = None,
                        patient_id: Optional[int] = None,
                        tx_type:    Optional[str] = None,
                        user=Depends(current_user)):
    q: Dict[str, Any] = {}
    if frm: q["created_at"] = {"$gte": frm}
    if to:  q.setdefault("created_at", {})["$lte"] = to + "T23:59:59"
    if patient_id: q["patient_id"] = patient_id
    if tx_type:    q["transaction_type"] = tx_type.upper()
    rows = await list_col("wallet_transactions", q, sort=("id", -1), limit=20000)
    pmap = {p["id"]: p for p in await list_col("patients")}
    for r in rows:
        p = pmap.get(r.get("patient_id"), {})
        r["patient_name"]   = p.get("name", "")
        r["patient_mobile"] = p.get("mobile", "")
        r["reg_number"]     = p.get("reg_number", "")
    credits = round(sum(r["amount"] for r in rows if r["transaction_type"] in ("CREDIT","ADJUSTMENT")), 2)
    debits  = round(sum(r["amount"] for r in rows if r["transaction_type"] in ("DEBIT","REFUND")), 2)
    return {"rows": rows,
            "totals": {"credits": credits, "debits": debits, "net": round(credits - debits, 2), "count": len(rows)}}


# ────────────────────────────────────────────────────────────────────────────
# AUDIT LOGS
# ────────────────────────────────────────────────────────────────────────────
@api.get("/audit-logs")
async def list_audit(target_type: Optional[str]=None, action: Optional[str]=None,
                     user_id: Optional[int]=None, frm: Optional[str]=Query(None, alias="from"),
                     to: Optional[str]=None, limit: int=Query(200, le=2000),
                     user=Depends(current_user)):
    if user.get("role") not in ("admin", "manager"): raise HTTPException(403, "Admin/Manager only")
    q = {}
    if target_type: q["target_type"] = target_type
    if action: q["action"] = action
    if user_id: q["user_id"] = user_id
    if frm: q["created_at"] = {"$gte": frm}
    if to: q.setdefault("created_at", {})["$lte"] = to
    rows = await db.audit_logs.find(q, {"_id":0}).sort("id", -1).limit(limit).to_list(limit)
    return [_sanitize(r) for r in rows]

# ────────────────────────────────────────────────────────────────────────────
# EXPORTS — CSV / Excel
# ────────────────────────────────────────────────────────────────────────────
import csv, io
from fastapi.responses import StreamingResponse, Response

EXPORT_SOURCES = {
    "staff": ("staff", ["id","code","name","role","category","vendor","duty_tag","status","rating","mobile","address","qualification","experience","employment_type","salary","joining_date"]),
    "patients": ("patients", ["id","reg_number","sgrh_reg","name","age","gender","mobile","address","hospital","diagnosis","doctor_name","service_location","category","status","blood_group"]),
    "bookings": ("bookings", ["id","booking_id","patient_id","service_category","service_name","start_date","end_date","shift","staff_id","status","amount","paid_amount","balance","payment_status","created_by","created_at"]),
    "bills":   ("bills", ["id","receipt_number","booking_id","patient_id","patient_name","service","amount","paid_amount","balance","payment_mode","payment_status","date"]),
    "refunds": ("refunds", ["id","patient_id","amount","mode","reason","reason_category","status","initiator","verifier","approver","utr","bank_account","ifsc","initiated_at","approved_at"]),
    "attendance": ("attendance", ["id","staff_id","date","login_time","logout_time","hours_worked","status"]),
    "ambulance": ("ambulance_calls", ["id","call_number","caller_name","caller_mobile","patient_name","pickup_address","drop_address","call_type","ambulance_type","priority","assigned_driver","assigned_vehicle","status","amount","payment_status","created_at"]),
    "leads": ("leads", ["id","caller_name","caller_mobile","relation","source","patient_name","patient_age","patient_gender","patient_address","diagnosis","service_needed","urgency","status","follow_up_date","created_at"]),
    "audit_logs": ("audit_logs", ["id","user_id","user_name","user_role","action","target_type","target_id","notes","created_at"]),
    "wallet_transactions": ("wallet_transactions", ["id","patient_id","transaction_type","amount","reference_type","reference_id","balance_before","balance_after","remarks","created_by","created_by_role","created_at"]),
    "wallet_refunds": ("wallet_refund_requests", ["id","patient_id","amount","status","reason","payment_mode","bank_ref","account_name","account_number","ifsc","upi_id","requested_by","approved_at","completed_at","rejection_reason","created_at"]),
    "patient_wallets": ("patient_wallets", ["id","patient_id","current_balance","total_credited","total_debited","total_refunded","created_at","updated_at"]),
    "booking_history": ("booking_history", ["id","booking_id","action","edited_by","edited_by_role","reason","created_at"]),
}

@api.get("/exports/{entity}.csv")
async def export_csv(entity: str, user=Depends(current_user)):
    if entity not in EXPORT_SOURCES: raise HTTPException(404, "Unknown entity")
    col, cols = EXPORT_SOURCES[entity]
    rows = await db[col].find({}, {"_id":0}).to_list(20000)
    buf = io.StringIO(); w = csv.writer(buf); w.writerow(cols)
    for r in rows: w.writerow([r.get(c, "") for c in cols])
    await audit(user, "export", entity, notes="csv")
    return Response(content=buf.getvalue(), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{entity}-{today()}.csv"'})

@api.get("/exports/{entity}.xlsx")
async def export_xlsx(entity: str, user=Depends(current_user)):
    if entity not in EXPORT_SOURCES: raise HTTPException(404, "Unknown entity")
    from openpyxl import Workbook
    col, cols = EXPORT_SOURCES[entity]
    rows = await db[col].find({}, {"_id":0}).to_list(20000)
    wb = Workbook(); ws = wb.active; ws.title = entity[:31]
    ws.append([c.replace("_"," ").title() for c in cols])
    for r in rows: ws.append([r.get(c, "") if not isinstance(r.get(c), (dict, list)) else json.dumps(r.get(c)) for c in cols])
    for i, _ in enumerate(cols, 1):
        ws.column_dimensions[chr(64+i) if i<=26 else "AA"].width = 18
    buf = io.BytesIO(); wb.save(buf); buf.seek(0)
    await audit(user, "export", entity, notes="xlsx")
    return StreamingResponse(buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{entity}-{today()}.xlsx"'})

# ────────────────────────────────────────────────────────────────────────────
# PDF — Receipts, Payslips, Reports
# ────────────────────────────────────────────────────────────────────────────
def _pdf_bytes(builder):
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, Spacer
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18*mm, rightMargin=18*mm, topMargin=15*mm, bottomMargin=15*mm)
    styles = getSampleStyleSheet()
    builder(doc, styles, {"P":Paragraph,"T":Table,"TS":TableStyle,"S":Spacer,"colors":colors,"mm":mm,"H":ParagraphStyle})
    buf.seek(0); return buf

def _brand_header(P, styles):
    """Branded header for all PDFs — embeds logo.png if present, falls back to text-only."""
    from reportlab.platypus import Image, Table, TableStyle
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    logo_path = ROOT_DIR.parent / "frontend" / "public" / "logo.png"
    text = P(
        "<para align='left'><font size=16 color='#1E3A8A'><b>Reach Out</b></font><br/>"
        "<font size=9 color='#DC2626'><b>An initiative of Sir Ganga Ram Trust Society</b></font><br/>"
        "<font size=8 color='#1E40AF'><i>Care At Your Doorstep — Home Healthcare Services</i></font></para>",
        styles["Normal"]
    )
    if logo_path.exists():
        try:
            img = Image(str(logo_path), width=28*mm, height=28*mm)
            tbl = Table([[img, text]], colWidths=[32*mm, 138*mm])
            tbl.setStyle(TableStyle([
                ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
                ("LEFTPADDING",(0,0),(-1,-1),0),
                ("RIGHTPADDING",(0,0),(-1,-1),0),
                ("LINEBELOW",(0,0),(-1,-1),0.8,colors.HexColor("#1E3A8A")),
                ("BOTTOMPADDING",(0,0),(-1,-1),6),
            ]))
            return [tbl]
        except Exception:
            pass
    # Text-only fallback with underline
    tbl = Table([[text]], colWidths=[170*mm])
    tbl.setStyle(TableStyle([
        ("LEFTPADDING",(0,0),(-1,-1),0), ("RIGHTPADDING",(0,0),(-1,-1),0),
        ("LINEBELOW",(0,0),(-1,-1),0.8,colors.HexColor("#1E3A8A")),
        ("BOTTOMPADDING",(0,0),(-1,-1),4),
    ]))
    return [tbl]

@api.get("/pdf/receipt/{bill_id}")
async def pdf_receipt(bill_id: int, user=Depends(current_user)):
    bill = await db.bills.find_one({"id": bill_id}, {"_id":0})
    if not bill: raise HTTPException(404, "Bill not found")
    patient = await db.patients.find_one({"id": bill.get("patient_id")}, {"_id":0}) or {}
    watermark = bill.get("watermark","")
    def build(doc, styles, k):
        story = []
        story += _brand_header(k["P"], styles)
        story.append(k["S"](1, 6*k["mm"]))
        story.append(k["P"](f"<para align='center'><font size=14><b>PAYMENT RECEIPT</b></font></para>", styles["Normal"]))
        if watermark:
            story.append(k["P"](f"<para align='center'><font color='#DC2626' size=22><b>{watermark}</b></font></para>", styles["Normal"]))
        story.append(k["S"](1, 4*k["mm"]))
        meta = [
            ["Receipt No", bill.get("receipt_number",""), "Date", bill.get("date","")],
            ["Booking ID", bill.get("booking_id",""), "Status", bill.get("payment_status","")],
            ["Patient", patient.get("name", bill.get("patient_name","")), "Reg No", patient.get("reg_number","")],
            ["Mobile", patient.get("mobile",""), "Mode", bill.get("payment_mode","")],
        ]
        t = k["T"](meta, colWidths=[30*k["mm"], 55*k["mm"], 25*k["mm"], 55*k["mm"]])
        t.setStyle(k["TS"]([("FONTSIZE",(0,0),(-1,-1),9),("GRID",(0,0),(-1,-1),0.3,k["colors"].grey),("BACKGROUND",(0,0),(0,-1),k["colors"].HexColor("#F3F4F6")),("BACKGROUND",(2,0),(2,-1),k["colors"].HexColor("#F3F4F6"))]))
        story.append(t)
        story.append(k["S"](1, 5*k["mm"]))
        rows = [["#","Description","Amount (INR)"],["1", bill.get("service",""), f"{bill.get('amount',0):,.2f}"]]
        rows += [["", "Paid", f"{bill.get('paid_amount',0):,.2f}"], ["", "Balance", f"{bill.get('balance',0):,.2f}"]]
        t2 = k["T"](rows, colWidths=[15*k["mm"], 115*k["mm"], 35*k["mm"]])
        t2.setStyle(k["TS"]([("FONTSIZE",(0,0),(-1,-1),9),("GRID",(0,0),(-1,-1),0.3,k["colors"].grey),("BACKGROUND",(0,0),(-1,0),k["colors"].HexColor("#7C3AED")),("TEXTCOLOR",(0,0),(-1,0),k["colors"].white),("ALIGN",(2,0),(2,-1),"RIGHT")]))
        story.append(t2)
        story.append(k["S"](1, 8*k["mm"]))
        story.append(k["P"]("<font size=8 color='#6B7280'>This is a system-generated receipt. For queries, contact Reach Out support.</font>", styles["Normal"]))
        doc.build(story)
    buf = _pdf_bytes(build)
    await audit(user, "export", "receipt", bill_id, notes="pdf")
    return StreamingResponse(buf, media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="receipt-{bill.get("receipt_number","")}.pdf"'})

@api.get("/pdf/payslip/{staff_id}")
async def pdf_payslip(staff_id: int, month: str = Query(...), user=Depends(current_user)):
    s = await db.staff.find_one({"id": staff_id}, {"_id":0})
    if not s: raise HTTPException(404, "Staff not found")
    rec = await db.payroll_records.find_one({"staff_id": staff_id, "month": month}, {"_id":0})
    if not rec:
        # On-the-fly
        att = await db.attendance.find({"staff_id": staff_id, "date": {"$regex": f"^{month}"}}).to_list(200)
        present = sum(1 for a in att if a.get("status")=="Present")
        monthly = _parse_salary(s.get("salary"))
        gross = round((monthly / 26) * present) if present else 0
        rec = {"month": month, "gross_pay": gross, "deductions": round(gross*0.02), "net_pay": gross - round(gross*0.02),
               "days_payable": present, "total_hours": round(sum(a.get("hours_worked") or 0 for a in att), 2)}
    def build(doc, styles, k):
        story = _brand_header(k["P"], styles)
        story.append(k["S"](1, 5*k["mm"]))
        story.append(k["P"](f"<para align='center'><font size=14><b>PAYSLIP &mdash; {month}</b></font></para>", styles["Normal"]))
        story.append(k["S"](1, 4*k["mm"]))
        meta = [["Employee Code", s.get("code",""), "Name", s.get("name","")],
                ["Role", s.get("role",""), "Vendor", s.get("vendor","")],
                ["Employment Type", s.get("employment_type",""), "Mobile", s.get("mobile","")]]
        t = k["T"](meta, colWidths=[35*k["mm"], 55*k["mm"], 25*k["mm"], 50*k["mm"]])
        t.setStyle(k["TS"]([("FONTSIZE",(0,0),(-1,-1),9),("GRID",(0,0),(-1,-1),0.3,k["colors"].grey),("BACKGROUND",(0,0),(0,-1),k["colors"].HexColor("#F3F4F6")),("BACKGROUND",(2,0),(2,-1),k["colors"].HexColor("#F3F4F6"))]))
        story.append(t); story.append(k["S"](1, 5*k["mm"]))
        earn = [["Earnings","Amount (INR)"],["Basic / Gross Pay", f"{rec.get('gross_pay',0):,.2f}"]]
        dedu = [["Deductions","Amount (INR)"],["Statutory Deductions", f"{rec.get('deductions',0):,.2f}"]]
        et = k["T"](earn, colWidths=[80*k["mm"], 40*k["mm"]])
        et.setStyle(k["TS"]([("FONTSIZE",(0,0),(-1,-1),9),("GRID",(0,0),(-1,-1),0.3,k["colors"].grey),("BACKGROUND",(0,0),(-1,0),k["colors"].HexColor("#10B981")),("TEXTCOLOR",(0,0),(-1,0),k["colors"].white),("ALIGN",(1,0),(1,-1),"RIGHT")]))
        dt = k["T"](dedu, colWidths=[80*k["mm"], 40*k["mm"]])
        dt.setStyle(k["TS"]([("FONTSIZE",(0,0),(-1,-1),9),("GRID",(0,0),(-1,-1),0.3,k["colors"].grey),("BACKGROUND",(0,0),(-1,0),k["colors"].HexColor("#EF4444")),("TEXTCOLOR",(0,0),(-1,0),k["colors"].white),("ALIGN",(1,0),(1,-1),"RIGHT")]))
        story.append(et); story.append(k["S"](1, 3*k["mm"])); story.append(dt); story.append(k["S"](1, 5*k["mm"]))
        net = k["T"]([["Net Pay", f"{rec.get('net_pay',0):,.2f}"]], colWidths=[80*k["mm"], 40*k["mm"]])
        net.setStyle(k["TS"]([("FONTSIZE",(0,0),(-1,-1),11),("GRID",(0,0),(-1,-1),0.5,k["colors"].black),("BACKGROUND",(0,0),(-1,0),k["colors"].HexColor("#7C3AED")),("TEXTCOLOR",(0,0),(-1,0),k["colors"].white),("ALIGN",(1,0),(1,-1),"RIGHT"),("FONTNAME",(0,0),(-1,-1),"Helvetica-Bold")]))
        story.append(net); story.append(k["S"](1, 6*k["mm"]))
        story.append(k["P"](f"<font size=9>Days Payable: <b>{rec.get('days_payable',0)}</b> &nbsp;&nbsp; Total Hours: <b>{rec.get('total_hours',0)}</b></font>", styles["Normal"]))
        story.append(k["S"](1, 8*k["mm"]))
        story.append(k["P"]("<font size=8 color='#6B7280'>This is a system-generated payslip and does not require a signature.</font>", styles["Normal"]))
        doc.build(story)
    buf = _pdf_bytes(build)
    await audit(user, "export", "payslip", staff_id, notes=month)
    return StreamingResponse(buf, media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="payslip-{s.get("code","")}-{month}.pdf"'})

@api.get("/pdf/report/{kind}")
async def pdf_report(kind: str, frm: Optional[str]=Query(None, alias="from"), to: Optional[str]=None, user=Depends(current_user)):
    if kind not in ("staff-summary","patient-summary","revenue-summary"):
        raise HTTPException(404, "Unknown report")
    if kind == "staff-summary":
        rows = await staff_summary(frm=frm, to=to, vendor=None, user=user)
        cols = [("name","Name"),("code","Code"),("role","Role"),("vendor","Vendor"),("days_worked","Days"),("total_hours","Hours"),("total_bookings","Bookings"),("rating","Rating")]
        title = "Staff Summary Report"
    elif kind == "patient-summary":
        rows = await patient_summary(user=user)
        cols = [("service_location","Location"),("category","Category"),("status","Status"),("count","Count")]
        title = "Patient Summary Report"
    else:
        rows = await revenue_summary(frm=frm, to=to, user=user)
        cols = [("month","Month"),("total_bills","Bills"),("total_billed","Billed"),("total_collected","Collected"),("total_pending","Pending"),("paid_count","Paid"),("pending_count","Unpaid")]
        title = "Revenue Summary Report"

    def build(doc, styles, k):
        story = _brand_header(k["P"], styles); story.append(k["S"](1, 5*k["mm"]))
        story.append(k["P"](f"<para align='center'><font size=14><b>{title}</b></font></para>", styles["Normal"]))
        period = f"{frm or 'Start'} → {to or today()}"
        story.append(k["P"](f"<para align='center'><font size=9 color='#6B7280'>Period: {period} &nbsp;|&nbsp; Generated: {now_iso()[:19]}</font></para>", styles["Normal"]))
        story.append(k["S"](1, 5*k["mm"]))
        header = [c[1] for c in cols]
        data = [header] + [[(r.get(c[0]) if r.get(c[0]) is not None else "") for c in cols] for r in rows]
        t = k["T"](data, repeatRows=1)
        t.setStyle(k["TS"]([("FONTSIZE",(0,0),(-1,-1),8),("GRID",(0,0),(-1,-1),0.3,k["colors"].grey),("BACKGROUND",(0,0),(-1,0),k["colors"].HexColor("#7C3AED")),("TEXTCOLOR",(0,0),(-1,0),k["colors"].white),("ROWBACKGROUNDS",(0,1),(-1,-1),[k["colors"].white, k["colors"].HexColor("#F9FAFB")])]))
        story.append(t)
        doc.build(story)
    buf = _pdf_bytes(build)
    await audit(user, "export", kind, notes="pdf")
    return StreamingResponse(buf, media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{kind}-{today()}.pdf"'})

@api.get("/pdf/patient/{pid}")
async def pdf_patient(pid: int, user=Depends(current_user)):
    """Generates a patient summary card PDF — registration details, diagnosis, medications, recent vitals."""
    p = await db.patients.find_one({"id": pid}, {"_id":0})
    if not p: raise HTTPException(404, "Patient not found")
    bookings = await db.bookings.find({"patient_id": pid}, {"_id":0}).sort("id", -1).limit(5).to_list(5)
    bills = await db.bills.find({"patient_id": pid}, {"_id":0}).to_list(20)
    total_billed = sum(b.get("amount", 0) for b in bills)
    total_paid = sum(b.get("paid_amount", 0) for b in bills)
    latest_vitals = await db.medical_charts.find({"patient_id": pid, "chart_type": "vitals"}, {"_id":0}).sort("id", -1).limit(1).to_list(1)
    vitals_data = {}
    if latest_vitals:
        try: vitals_data = json.loads(latest_vitals[0].get("chart_data") or "{}")
        except: vitals_data = {}

    def build(doc, styles, k):
        story = _brand_header(k["P"], styles)
        story.append(k["S"](1, 5*k["mm"]))
        story.append(k["P"](f"<para align='center'><font size=14><b>PATIENT HEALTH SUMMARY</b></font></para>", styles["Normal"]))
        story.append(k["S"](1, 4*k["mm"]))

        # Identity card
        ident = [
            ["Reg No", p.get("reg_number",""), "SGRH No", p.get("sgrh_reg","-")],
            ["Patient Name", p.get("name",""), "Age / Gender", f"{p.get('age','-')} / {p.get('gender','-')}"],
            ["Mobile", p.get("mobile",""), "Blood Group", p.get("blood_group","-")],
            ["Address", p.get("address","") or "-", "Status", p.get("status","Active")],
        ]
        t = k["T"](ident, colWidths=[30*k["mm"], 65*k["mm"], 30*k["mm"], 50*k["mm"]])
        t.setStyle(k["TS"]([("FONTSIZE",(0,0),(-1,-1),9),("GRID",(0,0),(-1,-1),0.3,k["colors"].grey),
            ("BACKGROUND",(0,0),(0,-1),k["colors"].HexColor("#F3F4F6")),
            ("BACKGROUND",(2,0),(2,-1),k["colors"].HexColor("#F3F4F6")),
            ("VALIGN",(0,0),(-1,-1),"TOP")]))
        story.append(t); story.append(k["S"](1, 5*k["mm"]))

        # Medical info
        story.append(k["P"]("<font size=11 color='#1E40AF'><b>Medical Information</b></font>", styles["Normal"]))
        story.append(k["S"](1, 2*k["mm"]))
        med = [
            ["Diagnosis", p.get("diagnosis","-")],
            ["Treating Doctor", p.get("doctor_name","-")],
            ["Hospital", p.get("hospital","-")],
            ["Service Location", f"{p.get('service_location','-')} / {p.get('category','-')}"],
            ["Current Medications", p.get("current_medications","-")],
            ["Allergies", p.get("allergies","None")],
        ]
        t2 = k["T"](med, colWidths=[45*k["mm"], 130*k["mm"]])
        t2.setStyle(k["TS"]([("FONTSIZE",(0,0),(-1,-1),9),("GRID",(0,0),(-1,-1),0.3,k["colors"].grey),
            ("BACKGROUND",(0,0),(0,-1),k["colors"].HexColor("#EFF6FF")),("VALIGN",(0,0),(-1,-1),"TOP")]))
        story.append(t2); story.append(k["S"](1, 5*k["mm"]))

        # Latest vitals
        if vitals_data:
            story.append(k["P"]("<font size=11 color='#16A34A'><b>Latest Vitals</b></font>", styles["Normal"]))
            story.append(k["S"](1, 2*k["mm"]))
            v_rows = [[
                f"Temp: {vitals_data.get('temperature','-')}°F",
                f"BP: {vitals_data.get('bp','-')}",
                f"Pulse: {vitals_data.get('pulse','-')}",
                f"SpO2: {vitals_data.get('spo2','-')}%",
            ]]
            tv = k["T"](v_rows, colWidths=[44*k["mm"]]*4)
            tv.setStyle(k["TS"]([("FONTSIZE",(0,0),(-1,-1),9),("GRID",(0,0),(-1,-1),0.3,k["colors"].grey),
                ("BACKGROUND",(0,0),(-1,-1),k["colors"].HexColor("#F0FDF4")),("ALIGN",(0,0),(-1,-1),"CENTER")]))
            story.append(tv); story.append(k["S"](1, 4*k["mm"]))

        # Recent bookings
        if bookings:
            story.append(k["P"]("<font size=11 color='#7C3AED'><b>Recent Bookings (last 5)</b></font>", styles["Normal"]))
            story.append(k["S"](1, 2*k["mm"]))
            rows = [["Booking ID","Service","From","To","Status"]]
            for b in bookings:
                rows.append([b.get("booking_id",""), b.get("service_name","")[:30], b.get("start_date",""), b.get("end_date",""), b.get("status","")])
            tb = k["T"](rows, colWidths=[32*k["mm"], 55*k["mm"], 28*k["mm"], 28*k["mm"], 22*k["mm"]])
            tb.setStyle(k["TS"]([("FONTSIZE",(0,0),(-1,-1),8),("GRID",(0,0),(-1,-1),0.3,k["colors"].grey),
                ("BACKGROUND",(0,0),(-1,0),k["colors"].HexColor("#7C3AED")),("TEXTCOLOR",(0,0),(-1,0),k["colors"].white)]))
            story.append(tb); story.append(k["S"](1, 4*k["mm"]))

        # Billing summary
        story.append(k["P"]("<font size=11 color='#DC2626'><b>Billing Summary</b></font>", styles["Normal"]))
        story.append(k["S"](1, 2*k["mm"]))
        bsum = [["Total Billed", f"₹{total_billed:,.0f}", "Total Paid", f"₹{total_paid:,.0f}", "Outstanding", f"₹{total_billed-total_paid:,.0f}"]]
        tbs = k["T"](bsum, colWidths=[30*k["mm"]]*6)
        tbs.setStyle(k["TS"]([("FONTSIZE",(0,0),(-1,-1),9),("GRID",(0,0),(-1,-1),0.3,k["colors"].grey),
            ("BACKGROUND",(0,0),(0,-1),k["colors"].HexColor("#FEF2F2")),
            ("BACKGROUND",(2,0),(2,-1),k["colors"].HexColor("#FEF2F2")),
            ("BACKGROUND",(4,0),(4,-1),k["colors"].HexColor("#FEF2F2")),
            ("ALIGN",(1,0),(-1,-1),"RIGHT")]))
        story.append(tbs)
        story.append(k["S"](1, 8*k["mm"]))
        story.append(k["P"](f"<font size=7 color='#6B7280'>Generated {now_iso()[:19]} • System-generated document • For internal use only</font>", styles["Normal"]))
        doc.build(story)
    buf = _pdf_bytes(build)
    await audit(user, "export", "patient_summary", pid, notes="pdf")
    return StreamingResponse(buf, media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="patient-{p.get("reg_number","")}.pdf"'})

# ────────────────────────────────────────────────────────────────────────────
# CONSENT PDF — 8 clinical templates (Reach Out HOMS standard)
# ────────────────────────────────────────────────────────────────────────────
CONSENT_TYPES = [
    "Ryle's Tube Insertion / Care",
    "Blood Sample Collection",
    "IV Device Care",
    "Wound Dressing Assessment",
    "Stoma Care",
    "Suture Removal",
    "Supportive Healthcare Services",  # master legal consent
    "General Consent",
]

def _consent_meta_table(k, c, p):
    """Standard patient details table used at top of every consent PDF."""
    rows = [
        ["Patient Name", p.get("name", c.get("patient_name","")), "Patient ID / UHID", p.get("reg_number","")],
        ["Age / Gender", f"{p.get('age','—')} / {p.get('gender','—')}", "Mobile", p.get("mobile","")],
        ["Diagnosis", p.get("diagnosis","—"), "Date", (c.get("signed_at") or c.get("created_at") or "")[:10]],
        ["Address / Location", p.get("address", p.get("service_location","—")), "Time", (c.get("signed_at") or c.get("created_at") or "")[11:16]],
        ["Done By", c.get("done_by", c.get("nurse_name","—")), "Designation", c.get("designation","Nurse")],
    ]
    t = k["T"](rows, colWidths=[35*k["mm"], 55*k["mm"], 35*k["mm"], 45*k["mm"]])
    t.setStyle(k["TS"]([
        ("FONTSIZE",(0,0),(-1,-1),8.5),
        ("GRID",(0,0),(-1,-1),0.3,k["colors"].grey),
        ("BACKGROUND",(0,0),(0,-1),k["colors"].HexColor("#EEF2FF")),
        ("BACKGROUND",(2,0),(2,-1),k["colors"].HexColor("#EEF2FF")),
        ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
        ("FONTNAME",(0,0),(0,-1),"Helvetica-Bold"),
        ("FONTNAME",(2,0),(2,-1),"Helvetica-Bold"),
    ]))
    return t

def _section_heading(k, styles, text, num=None):
    label = f"{num}. {text}" if num else text
    return k["P"](f"<para spaceBefore=8 spaceAfter=4><font size=10 color='#1E3A8A'><b>{label}</b></font></para>", styles["Normal"])

def _kv_table(k, rows, label_w=55, val_w=125):
    """Render a 2-column key/value table."""
    t = k["T"]([[r[0], r[1] or "________________________"] for r in rows], colWidths=[label_w*k["mm"], val_w*k["mm"]])
    t.setStyle(k["TS"]([
        ("FONTSIZE",(0,0),(-1,-1),8.5),
        ("GRID",(0,0),(-1,-1),0.25,k["colors"].grey),
        ("BACKGROUND",(0,0),(0,-1),k["colors"].HexColor("#F9FAFB")),
        ("VALIGN",(0,0),(-1,-1),"TOP"),
        ("FONTNAME",(0,0),(0,-1),"Helvetica-Bold"),
        ("LEFTPADDING",(0,0),(-1,-1),5),("RIGHTPADDING",(0,0),(-1,-1),5),
        ("TOPPADDING",(0,0),(-1,-1),3),("BOTTOMPADDING",(0,0),(-1,-1),3),
    ]))
    return t

def _checkbox_row(k, items, fd, cols=2):
    """Render checkboxes for a list of items. fd is form_data dict (item_key -> True/False)."""
    rows = []
    row = []
    for i, it in enumerate(items):
        key = it.lower().replace(" ","_").replace("/","_").replace("(","").replace(")","")
        chk = "☑" if fd.get(key) else "☐"
        row.append(f"{chk}  {it}")
        if len(row) == cols:
            rows.append(row); row = []
    if row:
        while len(row) < cols: row.append("")
        rows.append(row)
    t = k["T"](rows, colWidths=[90*k["mm"]]*cols if cols==2 else [60*k["mm"]]*cols)
    t.setStyle(k["TS"]([
        ("FONTSIZE",(0,0),(-1,-1),9),
        ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
        ("LEFTPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),3),
    ]))
    return t

def _bmw_section(k, styles, fd):
    """Biomedical Waste Management section common to most procedure forms."""
    rows = [
        ["Waste Segregated Properly", "Yes" if fd.get("bmw_segregated") else "No"],
        ["Yellow Bag Carried", "Yes" if fd.get("bmw_yellow_bag") else "No"],
        ["Waste Disposed as per Protocol", "Yes" if fd.get("bmw_disposed") else "No"],
    ]
    return _kv_table(k, rows, label_w=80, val_w=80)

def _feedback_section(k, styles, c):
    """Patient/Family feedback box."""
    fb = c.get("form_data",{}).get("feedback") or c.get("feedback","")
    return k["P"](
        f"<para><font size=9><b>Patient / Family Feedback:</b></font><br/><font size=9>{fb or '_____________________________________________________________________________________________'}</font></para>",
        styles["Normal"]
    )

def _signature_block(k, c, p, roles=("Patient / Guardian","Nurse","Witness")):
    """Standard signature block."""
    head = ["Role", "Name", "Signature", "Date"]
    rows = [head]
    for r in roles:
        if r.startswith("Patient"):
            name = c.get("signed_by") or p.get("name","")
        elif r.startswith("Nurse") or r.startswith("Done"):
            name = c.get("done_by") or c.get("nurse_name","")
        elif r.startswith("Witness"):
            name = c.get("witness_name","")
        elif r.startswith("Supervisor"):
            name = c.get("supervisor_name","")
        else:
            name = ""
        rows.append([r, name or "________________", "________________", (c.get("signed_at") or c.get("created_at") or "")[:10]])
    t = k["T"](rows, colWidths=[42*k["mm"], 50*k["mm"], 45*k["mm"], 33*k["mm"]])
    t.setStyle(k["TS"]([
        ("FONTSIZE",(0,0),(-1,-1),9),
        ("GRID",(0,0),(-1,-1),0.3,k["colors"].grey),
        ("BACKGROUND",(0,0),(-1,0),k["colors"].HexColor("#1E3A8A")),
        ("TEXTCOLOR",(0,0),(-1,0),k["colors"].white),
        ("FONTNAME",(0,0),(-1,0),"Helvetica-Bold"),
        ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
        ("FONTNAME",(0,1),(0,-1),"Helvetica-Bold"),
        ("TOPPADDING",(0,0),(-1,-1),6),("BOTTOMPADDING",(0,0),(-1,-1),6),
    ]))
    return t

# ── Template 1: Ryle's Tube ──
def _render_ryles_tube(k, styles, c, p, fd):
    s = []
    s += [_section_heading(k, styles, "RYLE'S TUBE (NG TUBE) INSERTION", 2),
          _kv_table(k, [
              ["Indication for NG Tube", fd.get("indication","")],
              ["Tube Size (Fr)", fd.get("tube_size","")],
              ["Insertion Length (cm)", fd.get("insertion_length","")],
              ["Method of Confirmation", fd.get("confirmation_method","Auscultation / X-ray / Aspirate")],
              ["Aspirate Appearance", fd.get("aspirate_appearance","")],
          ]),
          _section_heading(k, styles, "RYLE'S TUBE CARE", 3),
          _kv_table(k, [
              ["Tube Secured Properly", "Yes" if fd.get("tube_secured") else "No"],
              ["Feeding Type", fd.get("feeding_type","Bolus / Continuous")],
              ["Flushing Done", "Yes" if fd.get("flushing_done") else "No"],
              ["Patient Tolerance", fd.get("tolerance","No vomiting / discomfort")],
          ]),
          _section_heading(k, styles, "BIOMEDICAL WASTE MANAGEMENT (BMW)", 4),
          _bmw_section(k, styles, fd),
          _section_heading(k, styles, "FEEDBACK", 5),
          _feedback_section(k, styles, c),
    ]
    return s

# ── Template 2: Blood Sample Collection ──
def _render_blood_sample(k, styles, c, p, fd):
    s = []
    s += [_section_heading(k, styles, "BLOOD SAMPLING DETAILS", 2),
          _kv_table(k, [
              ["Site of Collection", fd.get("site","")],
              ["Sample Collection Time", fd.get("collection_time","")],
              ["Number of Pricks", str(fd.get("num_pricks","") or "")],
              ["Used Medium", fd.get("medium","Vacutainer / Syringe")],
          ]),
          _section_heading(k, styles, "POST SAMPLING OBSERVATION", 3),
          _kv_table(k, [
              ["Oozing", "Yes" if fd.get("oozing") else "No"],
              ["Bleeding", "Yes" if fd.get("bleeding") else "No"],
              ["Hematoma", "Yes" if fd.get("hematoma") else "No"],
              ["Bruising", "Yes" if fd.get("bruising") else "No"],
              ["Remarks", fd.get("remarks","")],
          ]),
          _section_heading(k, styles, "SAMPLE DETAILS", 4),
          _kv_table(k, [
              ["Sample Transportation", fd.get("transportation","")],
              ["Sample Carrier", fd.get("carrier","")],
              ["Cold Pack", "Yes" if fd.get("cold_pack") else "No"],
              ["Sample Arrival Time", fd.get("arrival_time","")],
          ]),
          _section_heading(k, styles, "BIOMEDICAL WASTE MANAGEMENT (BMW)", 5),
          _bmw_section(k, styles, fd),
          _section_heading(k, styles, "FEEDBACK", 6),
          _feedback_section(k, styles, c),
    ]
    return s

# ── Template 3: IV Device Care ──
def _render_iv_device(k, styles, c, p, fd):
    s = []
    s += [_section_heading(k, styles, "IV DEVICE DETAILS", 2),
          _checkbox_row(k, ["Peripheral IV Cannula","PICC Line","Central Venous Catheter","Implanted Port","Midline Catheter","Other"], fd, cols=2),
          k["S"](1, 3*k["mm"]),
          _kv_table(k, [
              ["Device Detail", fd.get("device_detail","")],
              ["Insertion Date", fd.get("insertion_date","")],
              ["Insertion Site", fd.get("insertion_site","")],
          ]),
          _section_heading(k, styles, "CARE PROVIDED", 3),
          _checkbox_row(k, ["IV medication / fluids administration","Dressing and site care","Line flushing and maintenance","Monitoring for complications"], fd, cols=2),
          _section_heading(k, styles, "IV SITE — POSSIBLE RISKS", 4),
          _checkbox_row(k, ["Infection","Bleeding / bruising","Line blockage or dislodgement","Pain / discomfort"], fd, cols=2),
          _section_heading(k, styles, "BIOMEDICAL WASTE MANAGEMENT (BMW)", 5),
          _bmw_section(k, styles, fd),
          _section_heading(k, styles, "FEEDBACK", 6),
          _feedback_section(k, styles, c),
          k["S"](1, 4*k["mm"]),
          _section_heading(k, styles, "CONSENT", 7),
          k["P"]("<para><font size=9.5>I hereby confirm that the procedure, benefits, and risks have been explained to me. I give my consent for <b>IV device care at home</b>.</font></para>", styles["Normal"]),
    ]
    return s

# ── Template 4: Wound Dressing ──
def _render_wound_dressing(k, styles, c, p, fd):
    s = []
    s += [_section_heading(k, styles, "WOUND INFORMATION", 2),
          _kv_table(k, [
              ["Type of Wound", fd.get("wound_type","Surgical / Pressure / Diabetic / Traumatic / Burn / Other")],
              ["Location of Wound", fd.get("wound_location","")],
              ["Length (cm)", str(fd.get("length","") or "")],
              ["Width (cm)", str(fd.get("width","") or "")],
              ["Depth (cm)", str(fd.get("depth","") or "")],
          ]),
          _section_heading(k, styles, "WOUND ASSESSMENT", 3),
          _kv_table(k, [
              ["Wound Bed", fd.get("wound_bed","Granulation / Slough / Necrotic / Epithelial")],
              ["Surrounding Skin", fd.get("surrounding_skin","Normal / Redness / Swelling / Maceration")],
          ]),
          _section_heading(k, styles, "DISCHARGE / PUS ASSESSMENT", 4),
          _kv_table(k, [
              ["Type", fd.get("discharge_type","None / Serous / Serosanguineous / Purulent / Bloody")],
              ["Amount", fd.get("discharge_amount","Scanty / Moderate / Heavy")],
              ["Color", fd.get("discharge_color","")],
              ["Odor", fd.get("discharge_odor","")],
          ]),
          _section_heading(k, styles, "PAIN ASSESSMENT", 5),
          _kv_table(k, [["Pain Score (0–10)", str(fd.get("pain_score","") or "")]]),
          _section_heading(k, styles, "DRESSING PROCEDURE", 6),
          _kv_table(k, [
              ["Hand Hygiene Done", "Yes" if fd.get("hand_hygiene") else "No"],
              ["Cleaning Solution", fd.get("cleaning_solution","NS / Betadine / Chlorhexidine / H2O2")],
              ["Medication Applied", fd.get("medication","")],
              ["Type of Dressing", fd.get("dressing_type","Gauze / Foam / Hydrocolloid / NPWT / Other")],
          ]),
          _section_heading(k, styles, "ADDITIONAL PROCEDURES", 7),
          _checkbox_row(k, ["Debridement","Drain Present","Sutures / Staples","Packing Done","Culture Taken"], fd, cols=2),
          _section_heading(k, styles, "POST DRESSING NOTES", 8),
          _kv_table(k, [
              ["Patient Condition After Dressing", fd.get("condition_after","")],
              ["Next Dressing Date", fd.get("next_dressing_date","")],
          ]),
          _section_heading(k, styles, "BIOMEDICAL WASTE MANAGEMENT (BMW)", 9),
          _bmw_section(k, styles, fd),
          _section_heading(k, styles, "FEEDBACK", 10),
          _feedback_section(k, styles, c),
    ]
    return s

# ── Template 5: Stoma Care ──
def _render_stoma_care(k, styles, c, p, fd):
    s = []
    s += [_section_heading(k, styles, "INFORMED CONSENT", 2),
          k["P"]("<para><font size=9.5>I have been informed about the <b>stoma care procedure</b>, its purpose, benefits, and risks. I understand the procedure and give my consent.</font></para>", styles["Normal"]),
          k["S"](1, 3*k["mm"]),
          _kv_table(k, [
              ["Type of Stoma", fd.get("stoma_type","Colostomy / Ileostomy / Urostomy / Other")],
              ["Date of Surgery", fd.get("surgery_date","")],
              ["Surgeon Name", fd.get("surgeon_name","")],
          ]),
          _section_heading(k, styles, "STOMA ASSESSMENT", 3),
          _kv_table(k, [
              ["Location", fd.get("stoma_location","")],
              ["Size", fd.get("stoma_size","")],
              ["Shape", fd.get("stoma_shape","Round / Oval / Irregular")],
              ["Color", fd.get("stoma_color","Pink / Red / Pale / Dusky / Black")],
              ["Moisture", fd.get("stoma_moisture","Moist / Dry")],
              ["Protrusion", fd.get("protrusion","Flush / Protruding / Retracted")],
              ["Output Type", fd.get("output_type","Solid / Semi-solid / Liquid / Urine")],
              ["Peristomal Skin", fd.get("peristomal_skin","Intact / Red / Irritated / Ulcerated")],
          ]),
          _section_heading(k, styles, "PROCEDURE CHECKLIST", 4),
          _checkbox_row(k, ["Hand hygiene performed","Old appliance removed","Gloves worn","Skin cleaned & dried","Skin barrier applied","New appliance applied"], fd, cols=2),
          _section_heading(k, styles, "COMPLICATIONS", 5),
          _checkbox_row(k, ["Skin irritation","Bleeding","Prolapse","Hernia","Infection","Retraction","Necrosis","Other"], fd, cols=2),
          _section_heading(k, styles, "EDUCATION", 6),
          _checkbox_row(k, ["Stoma care explained","Diet advice given","Appliance change taught","Complications explained"], fd, cols=2),
          _kv_table(k, [["Understanding Level", fd.get("understanding","Good / Fair / Poor")]]),
          _section_heading(k, styles, "EVALUATION", 7),
          _kv_table(k, [
              ["Stoma Improved", "Yes" if fd.get("stoma_improved") else "No"],
              ["Patient Independent", fd.get("patient_independent","Yes / No / Needs help")],
              ["Next Review Date", fd.get("next_review","")],
          ]),
          _section_heading(k, styles, "BIOMEDICAL WASTE MANAGEMENT (BMW)", 8),
          _bmw_section(k, styles, fd),
          _section_heading(k, styles, "FEEDBACK", 9),
          _feedback_section(k, styles, c),
    ]
    return s

# ── Template 6: Suture Removal ──
def _render_suture_removal(k, styles, c, p, fd):
    s = []
    s += [_section_heading(k, styles, "CLINICAL INFORMATION", 2),
          _kv_table(k, [
              ["Diagnosis", p.get("diagnosis", fd.get("diagnosis",""))],
              ["Wound Location", fd.get("wound_location","")],
              ["Date of Suturing", fd.get("suturing_date","")],
              ["Type of Sutures", fd.get("suture_type","")],
              ["Indication", fd.get("indication","")],
          ]),
          _section_heading(k, styles, "PRE-REMOVAL ASSESSMENT", 3),
          _kv_table(k, [
              ["Wound Healing", fd.get("wound_healing","Adequate / Delayed")],
              ["Signs of Infection", "Yes" if fd.get("infection_signs") else "No"],
              ["Pain Score (0–10)", str(fd.get("pain_score","") or "")],
              ["Allergies", fd.get("allergies","Nil")],
              ["Medications", fd.get("medications","")],
              ["Bleeding Disorder", "Yes" if fd.get("bleeding_disorder") else "No"],
          ]),
          _section_heading(k, styles, "PROCEDURE SUMMARY", 4),
          _checkbox_row(k, ["Aseptic cleaning of wound","Sterile instruments used","Sutures removed","Wound reassessed","Dressing applied (if needed)"], fd, cols=2),
          _section_heading(k, styles, "RISKS EXPLAINED", 5),
          _checkbox_row(k, ["Pain / discomfort","Bleeding","Infection","Wound dehiscence","Scarring"], fd, cols=2),
          _section_heading(k, styles, "POST-REMOVAL INSTRUCTIONS", 6),
          k["P"]("<para><font size=9>• Keep wound clean &amp; dry<br/>• Avoid strain on site<br/>• Watch for redness, swelling, discharge, fever<br/>• Follow-up if advised</font></para>", styles["Normal"]),
          _section_heading(k, styles, "CONSENT", 7),
          k["P"](f"<para><font size=9.5>I, <b>{c.get('signed_by') or p.get('name','')}</b>, have understood the procedure, risks, and benefits. I give consent for <b>suture removal</b>.</font></para>", styles["Normal"]),
          _section_heading(k, styles, "FINAL CHECKLIST (STAFF USE)", 8),
          _checkbox_row(k, ["Identity verified","Consent obtained","PPE used","Wound assessed","Procedure completed","Patient educated"], fd, cols=2),
          _section_heading(k, styles, "FEEDBACK", 9),
          _feedback_section(k, styles, c),
    ]
    return s

# ── Template 7: SUPPORTIVE HEALTHCARE SERVICES (the big master legal consent) ──
def _render_supportive_services(k, styles, c, p, fd):
    s = []
    relation = c.get("relation") or fd.get("relation","Self")
    relative_name = c.get("signed_by") or fd.get("relative_name") or ""
    doctor = fd.get("doctor_name","_________________________")
    hospital = fd.get("hospital_name","Sir Ganga Ram Hospital")
    address = p.get("address", fd.get("address","_________________________"))
    mobile = p.get("mobile", fd.get("mobile",""))
    email = fd.get("email","_______________________________")

    s += [
        k["P"]("<para align='center'><font size=13 color='#1E3A8A'><b>CONSENT FOR AVAILING SUPPORTIVE HEALTHCARE SERVICES</b></font><br/><font size=10 color='#DC2626'><b>WITH LIMITED LIABILITY</b></font></para>", styles["Normal"]),
        k["S"](1, 4*k["mm"]),
        _section_heading(k, styles, "DECLARATION BY PATIENT / RELATIVE SEEKING SERVICES", 1),
        k["P"](f"<para><font size=9.5>I, <b>{relative_name or '_________________________'}</b>, have come / brought my relative <b>{p.get('name','_________________________')}</b>, resident of <b>{address}</b>. "
               f"Mobile No.: <b>{mobile or '________________'}</b> &nbsp;&nbsp; Email ID: <b>{email}</b>. "
               f"Under the treatment of Dr. <b>{doctor}</b> at <b>{hospital}</b>.</font></para>", styles["Normal"]),
        _section_heading(k, styles, "NATURE OF HOSPITAL DISCHARGE", 2),
        _checkbox_row(k, ["Normal Discharge","Discharge on Request (DOR) / LAMA"], fd, cols=2),
        k["P"]("<para><font size=9>I understand that the patient has been discharged from the Hospital under the above-mentioned category and that home healthcare services are supportive in nature only.</font></para>", styles["Normal"]),
        _section_heading(k, styles, "SERVICES REQUESTED", 3),
        k["P"]("<para><font size=9>I am aware that <b>Reach Out Home Health Care</b> (an initiative of Sir Ganga Ram Hospital) provides supportive healthcare services at home. I would like to avail the following services:</font></para>", styles["Normal"]),
        _checkbox_row(k, ["Critical Care Nursing","Geriatric Care","Palliative Care Nursing","General Duty Assistant (GDA)","Nursing Support","Mother & Baby Care","Doctor Home Visit (Pre-booked Routine Visit Only)"], fd, cols=2),
        _section_heading(k, styles, "DECLARATION AND CONSENT", 4),
        k["P"]("<para><font size=9>I hereby <b>voluntarily give my consent</b> to avail the above-mentioned services, fully understanding that these services are <b>supportive in nature</b> and cannot be equated with the complete facilities, infrastructure, emergency response systems, monitoring standards, infection control systems, or multidisciplinary medical care available in a hospital setup.</font></para>", styles["Normal"]),
        _section_heading(k, styles, "COMPLIANCE WITH MEDICAL ADVICE", 5),
        k["P"]("<para><font size=9>I undertake to comply with all instructions, medications, treatment plans, and precautions advised by the concerned healthcare personnel and treating consultant.</font></para>", styles["Normal"]),
        _section_heading(k, styles, "LIMITATION OF EMERGENCY RESPONSIBILITIES", 6),
        k["P"]("<para><font size=9>I understand and agree that:<br/>"
               "<b>a.</b> Reach Out home healthcare services are <b>not emergency medical services</b>.<br/>"
               "<b>b.</b> Doctor home visits are strictly <b>pre-booked</b> and scheduled routine visits only.<br/>"
               "<b>c.</b> Doctors visiting through Reach Out shall <b>not attend distress calls, emergency calls, or acute life-threatening situations</b> at home.<br/>"
               "<b>d.</b> In case of any medical emergency, deterioration in patient condition, cardiac arrest, respiratory distress, uncontrolled bleeding, sudden unconsciousness, seizure, or any life-threatening condition, it shall be the <b>sole responsibility of the patient / family</b> to immediately contact emergency services, ambulance services, or shift the patient to the nearest hospital.</font></para>", styles["Normal"]),
        _section_heading(k, styles, "LIMITATION OF LIABILITY AND INDEMNITY", 7),
        k["P"]("<para><font size=9>I undertake <b>not to hold Sir Ganga Ram Hospital, Reach Out Initiative, its doctors, nurses, GDAs, healthcare workers, coordinators, or any associated personnel liable</b> for:<br/>"
               "a. Any unforeseen deterioration in patient condition;<br/>"
               "b. Delay in emergency response;<br/>"
               "c. Complications arising due to limitations of home care setup;<br/>"
               "d. Any mishap, disability, infection, injury, cardiac event, respiratory event, or death occurring during home care management which is beyond the reasonable control of healthcare personnel;<br/>"
               "e. Any condition or complication which cannot reasonably be managed within the limitations of a home healthcare environment.<br/><br/>"
               "I further agree to <b>indemnify</b> and keep indemnified Reach Out Initiative, Sir Ganga Ram Hospital, and its personnel against any legal claims, disputes, liabilities, or proceedings arising out of circumstances beyond the scope and limitations of supportive home healthcare services.</font></para>", styles["Normal"]),
        _section_heading(k, styles, "SPECIALIZED PROCEDURES", 8),
        k["P"]("<para><font size=9>I clearly understand that certain procedures require specialized expertise, sterile precautions, and hospital-level infection control measures. Therefore, the following procedures shall only be performed by specially trained personnel arranged through Reach Out or hospital-authorized professionals and <b>not by the routine assigned staff</b>:<br/>"
               "a. Ryle's Tube insertion / reinsertion<br/>"
               "b. Foley's catheter insertion / replacement<br/>"
               "c. Difficult IV cannulation or difficult venous access<br/>"
               "d. Tracheostomy tube change<br/>"
               "e. Stoma bag change and specialized stoma care<br/>"
               "f. Any invasive or sterile procedure requiring advanced clinical expertise<br/><br/>"
               "I understand that <b>additional charges may apply</b> for such specialized services.</font></para>", styles["Normal"]),
        _section_heading(k, styles, "LIMITATIONS OF HOME HEALTHCARE SETUP", 9),
        k["P"]("<para><font size=9>I acknowledge that home healthcare has inherent limitations and that despite best possible care and professional efforts, certain medical complications may not be manageable in a home care environment due to lack of ICU setup, emergency equipment, immediate investigations, blood products, ventilatory backup, specialist availability, and other hospital-based support systems.</font></para>", styles["Normal"]),
        _section_heading(k, styles, "SPECIAL CONSENT FOR PALLIATIVE CARE PATIENTS", 10),
        k["P"]("<para><font size=9>In case the patient is receiving palliative care services, I hereby confirm that:<br/>"
               "a. The patient / family has been adequately explained about the nature of the illness, poor prognosis, advanced disease condition, and limited chances of recovery.<br/>"
               "b. The objective of palliative care is primarily comfort care, symptom relief, dignity, and supportive management rather than curative treatment.<br/>"
               "c. I understand that the patient's clinical condition may deteriorate unpredictably despite appropriate supportive care.<br/>"
               "d. I undertake not to hold Sir Ganga Ram Hospital, Reach Out Initiative, its doctors, nurses, or healthcare workers liable for any deterioration, medical complication, cardiac arrest, respiratory arrest, or death occurring during the course of home-based palliative care.</font></para>", styles["Normal"]),
        _section_heading(k, styles, "GENERAL UNDERTAKING", 11),
        k["P"]("<para><font size=9>I confirm that:<br/>"
               "a. The contents of this consent form have been read over and explained to me in a language understood by me.<br/>"
               "b. I have understood all risks, limitations, responsibilities, and conditions associated with home healthcare services.<br/>"
               "c. This consent is given voluntarily without any pressure, force, misrepresentation, or coercion from any side.</font></para>", styles["Normal"]),
        _section_heading(k, styles, "STAFF SAFETY, DIGNITY, AND CONDUCT POLICY", 12),
        k["P"]("<para><font size=9>The patient, relatives, family members, attendants, and visitors shall ensure that all Reach Out healthcare personnel — including doctors, nurses, GDAs, coordinators, and support staff — are treated with <b>dignity, respect, and professionalism</b> at all times.<br/><br/>"
               "Any form of:<br/>"
               "a. Physical assault &nbsp; b. Verbal abuse &nbsp; c. Threatening behaviour &nbsp; d. Harassment<br/>"
               "e. Misconduct &nbsp; f. Sexual harassment or sexual assault &nbsp; g. Intimidation, humiliation, or unsafe working conditions<br/><br/>"
               "towards Reach Out personnel shall be considered a <b>serious violation</b> of this agreement. In such circumstances, Reach Out reserves the right to <b>immediately withdraw services</b> without prior notice, and appropriate legal action — including filing of police complaints and initiation of legal proceedings — may be undertaken against the concerned individual(s) as per applicable law.<br/><br/>"
               "The patient / family also undertakes to provide a safe and secure working environment for all healthcare personnel deputed for home care services.</font></para>", styles["Normal"]),
        _section_heading(k, styles, "PAYMENT POLICY", 13),
        k["P"]("<para><font size=9>"
               "a. Advance payment for <b>05 days</b> must be made before commencement of services.<br/>"
               "b. Full <b>15 days' advance payment</b> must be made for package bookings.</font></para>", styles["Normal"]),
        _section_heading(k, styles, "ELIGIBILITY CRITERIA FOR REFUND", 14),
        k["P"]("<para><font size=9>Refunds may be considered under the following circumstances:<br/>"
               "a. Refusal to adjust payment against another service or no further requirement of services.<br/>"
               "b. Cancellation informed at least <b>24 hours in advance</b>.<br/>"
               "c. Compassionate grounds such as death.<br/>"
               "d. Assigned staff proceeding on urgent leave for personal reasons and the patient / family declining replacement staff.<br/>"
               "e. Dissatisfaction with service quality where continuation of services is not feasible despite reasonable efforts.</font></para>", styles["Normal"]),
        _section_heading(k, styles, "REFUND TERMS", 15),
        k["P"]("<para><font size=9>"
               "a. If services are discontinued during the package period, package rates shall be recalculated as per original non-package charges.<br/>"
               "b. A deduction of <b>10% towards administrative charges</b> shall be made from the refundable amount under all circumstances.<br/>"
               "c. Refunds shall be processed within <b>10 working days</b>.</font></para>", styles["Normal"]),
        _section_heading(k, styles, "SERVICE CONDITIONS", 16),
        k["P"]("<para><font size=9>"
               "a. Duties of Reach Out personnel shall remain strictly limited to <b>professional healthcare services only</b>.<br/>"
               "b. Domestic work, housekeeping, cooking, cleaning, attendant duties unrelated to patient care, or household chores shall not be entertained and may result in withdrawal of services.<br/>"
               "c. In case of any technical or operational issue, Reach Out personnel shall make reasonable efforts to resolve the matter at the earliest possible time.</font></para>", styles["Normal"]),
        _section_heading(k, styles, "DISCLAIMER", 17),
        k["P"]("<para><font size=9>The Sir Ganga Ram Trust Society through Sir Ganga Ram Hospital and its Reach Out Initiative hereby clarifies that the <i>\"Care at Your Doorstep\"</i> program is an <b>independent supportive healthcare service with limited liability</b>. The patient / family clearly understands and accepts that home healthcare services are rendered under circumstances different from hospital-based treatment and that all reasonable professional care shall be exercised within the practical limitations of home care services.</font></para>", styles["Normal"]),
    ]
    return s

# ── Template 8: Generic / Other consents (fallback) ──
def _render_general_consent(k, styles, c, p, fd):
    s = []
    body = c.get("signed_text") or (
        f"I, <b>{c.get('signed_by') or p.get('name','')}</b> (relation: <b>{c.get('relation','Self')}</b>), hereby give my <b>informed consent</b> for the procedure / service described as <b>{c.get('consent_type','')}</b> to be administered to the patient <b>{p.get('name','')}</b> (Reg No: {p.get('reg_number','')}).<br/><br/>"
        "I have been explained the nature, purpose, expected benefits and potential risks of this service in a language I understand. I have had the opportunity to ask questions, and all my queries have been answered satisfactorily.<br/><br/>"
        "I understand that I may withdraw my consent at any time, and I authorize the Reach Out clinical team — an initiative of Sir Ganga Ram Trust Society — to deliver the service in accordance with applicable medical standards."
    )
    s.append(k["P"](f"<para><font size=10>{body}</font></para>", styles["Normal"]))
    if c.get("notes"):
        s.append(k["S"](1, 4*k["mm"]))
        s.append(k["P"](f"<font size=9 color='#6B7280'><b>Notes:</b> {c.get('notes','')}</font>", styles["Normal"]))
    return s

CONSENT_RENDERERS = {
    "Ryle's Tube Insertion / Care": _render_ryles_tube,
    "Blood Sample Collection": _render_blood_sample,
    "IV Device Care": _render_iv_device,
    "Wound Dressing Assessment": _render_wound_dressing,
    "Stoma Care": _render_stoma_care,
    "Suture Removal": _render_suture_removal,
    "Supportive Healthcare Services": _render_supportive_services,
    "General Consent": _render_general_consent,
}

@api.get("/consent-types")
async def list_consent_types(user=Depends(current_user)):
    return [{"value": t, "label": t} for t in CONSENT_TYPES]

@api.get("/pdf/consent/{cid}")
async def pdf_consent(cid: int, user=Depends(current_user)):
    """Generates a clinical consent PDF in the appropriate Reach Out HOMS template."""
    c = await db.consents.find_one({"id": cid}, {"_id":0})
    if not c: raise HTTPException(404, "Consent not found")
    p = await db.patients.find_one({"id": c.get("patient_id")}, {"_id":0}) or {}
    ctype = c.get("consent_type","General Consent")
    fd = c.get("form_data",{}) or {}
    renderer = CONSENT_RENDERERS.get(ctype, _render_general_consent)

    def build(doc, styles, k):
        story = _brand_header(k["P"], styles)
        story.append(k["S"](1, 3*k["mm"]))
        # Title block
        story.append(k["P"](
            f"<para align='center'><font size=13 color='#1E3A8A'><b>{ctype.upper()}</b></font>"
            f"<br/><font size=8 color='#6B7280'>Consent ID: RO-CON-{c.get('id'):04d}  •  Generated: {now_iso()[:19]}</font></para>",
            styles["Normal"]
        ))
        story.append(k["S"](1, 4*k["mm"]))
        # Patient details (section 1 — always)
        story.append(_section_heading(k, styles, "PATIENT DETAILS", 1))
        story.append(_consent_meta_table(k, c, p))
        story.append(k["S"](1, 3*k["mm"]))
        # Body
        story += renderer(k, styles, c, p, fd)
        story.append(k["S"](1, 6*k["mm"]))
        # Signatures
        roles = ("Patient / Guardian","Nurse","Witness")
        if ctype == "Supportive Healthcare Services":
            roles = ("Patient / Relative","Witness 1","Witness 2")
        story.append(_section_heading(k, styles, "SIGNATURES"))
        story.append(_signature_block(k, c, p, roles=roles))
        story.append(k["S"](1, 4*k["mm"]))
        story.append(k["P"](f"<para align='center'><font size=7 color='#6B7280'>Reach Out Healthcare — Care At Your Doorstep  •  An initiative of Sir Ganga Ram Trust Society  •  Document: RO-CON-{c.get('id'):04d}</font></para>", styles["Normal"]))
        doc.build(story)

    buf = _pdf_bytes(build)
    await audit(user, "export", "consent", cid, notes=f"pdf:{ctype}")
    return StreamingResponse(buf, media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="consent-{cid}-{ctype.replace(chr(32),chr(45)).replace(chr(47),chr(45))}.pdf"'})

# ════════════════════════════════════════════════════════════════════════════
# PHASE 2: Missing-feature build-out
# ════════════════════════════════════════════════════════════════════════════
import math as _math

def _haversine_m(lat1, lng1, lat2, lng2):
    if None in (lat1, lng1, lat2, lng2): return None
    R = 6371000
    p1, p2 = _math.radians(lat1), _math.radians(lat2)
    dp, dl = _math.radians(lat2-lat1), _math.radians(lng2-lng1)
    a = _math.sin(dp/2)**2 + _math.cos(p1)*_math.cos(p2)*_math.sin(dl/2)**2
    return 2 * R * _math.asin(_math.sqrt(a))

# ────────────────────────────────────────────────────────────────────────────
# NOTIFICATION TEMPLATES + QUEUE (WhatsApp / SMS / Email / In-App)
# ────────────────────────────────────────────────────────────────────────────
DEFAULT_TEMPLATES = [
    ("booking_confirm","Booking Confirmation","whatsapp","Hi {{name}}, your booking {{booking_id}} for {{service}} is confirmed from {{start_date}} to {{end_date}}. Amount: ₹{{amount}}. — Reach Out"),
    ("payment_reminder","Payment Reminder","sms","Dear {{name}}, your booking {{booking_id}} has a pending balance of ₹{{balance}}. Please pay at your earliest. — Reach Out"),
    ("doc_expiry","Document Expiry","whatsapp","Dear {{staff_name}} ({{code}}), your {{document_type}} expires on {{expiry_date}}. Please renew. — Reach Out"),
    ("refund_approved","Refund Approved","sms","Dear {{name}}, refund of ₹{{amount}} for booking {{booking_id}} has been approved (UTR: {{utr}}). — Reach Out"),
    ("roster_assigned","Duty Assignment","whatsapp","Hi {{staff_name}}, you are assigned to {{patient_name}} on {{date}} ({{shift}}). Address: {{address}}. — Reach Out"),
    ("otp_login","Login OTP","sms","Your Reach Out OTP is {{otp}}. Valid for 5 minutes. Do not share."),
    ("feedback_request","Feedback Request","whatsapp","Hi {{name}}, please rate your recent service: {{link}}. — Reach Out"),
]

async def _seed_templates():
    if await db.notif_templates.count_documents({}) == 0:
        for code, name, channel, body in DEFAULT_TEMPLATES:
            await db.notif_templates.insert_one({"id": await next_id("notif_templates"),
                "code": code, "name": name, "channel": channel, "body": body,
                "status":"Active", "created_at": now_iso()})

def render_template(body: str, ctx: Dict[str, Any]) -> str:
    out = body
    for k, v in (ctx or {}).items():
        out = out.replace("{{"+str(k)+"}}", str(v) if v is not None else "")
    return re.sub(r"\{\{[^}]+\}\}", "", out)

@api.get("/notif-templates")
async def list_templates(user=Depends(current_user)):
    return await list_col("notif_templates", sort=("code", 1))

@api.post("/notif-templates")
async def add_template(d: Dict[str, Any], user=Depends(current_user)):
    if user.get("role") not in ("admin","manager"): raise HTTPException(403, "Admin/Manager only")
    tid = await next_id("notif_templates")
    await db.notif_templates.insert_one({"id": tid, "status":"Active", "created_at": now_iso(), **d})
    await audit(user, "create", "notif_template", tid, after=d); return {"id": tid, "message":"Template created"}

@api.put("/notif-templates/{tid}")
async def upd_template(tid: int, d: Dict[str, Any], user=Depends(current_user)):
    if user.get("role") not in ("admin","manager"): raise HTTPException(403, "Admin/Manager only")
    d.pop("id", None); d.pop("_id", None)
    await db.notif_templates.update_one({"id": tid}, {"$set": d})
    await audit(user, "update", "notif_template", tid, after=d); return {"message":"Template updated"}

@api.post("/notifications/send")
async def send_notification(d: Dict[str, Any], user=Depends(current_user)):
    """Render template and enqueue. Supports whatsapp/sms/email/in-app channels."""
    tpl = None
    if d.get("template_code"): tpl = await db.notif_templates.find_one({"code": d["template_code"]})
    elif d.get("template_id"): tpl = await db.notif_templates.find_one({"id": d["template_id"]})
    if tpl:
        body = render_template(tpl.get("body",""), d.get("variables") or {})
        channel = d.get("channel") or tpl.get("channel","in-app")
    else:
        body = d.get("body","")
        channel = d.get("channel","in-app")
    nid = await next_id("notifications")
    rec = {"id": nid, "channel": channel, "recipient_type": d.get("recipient_type","patient"),
           "recipient_id": d.get("recipient_id"), "recipient_phone": d.get("recipient_phone"),
           "recipient_email": d.get("recipient_email"), "title": d.get("title",""),
           "message": body, "template_id": (tpl or {}).get("id"),
           "status":"Pending", "attempts": 0, "created_at": now_iso()}
    await db.notifications.insert_one(rec)
    return {"id": nid, "channel": channel, "preview": body, "message":"Queued"}

@api.post("/notifications/dispatch")
async def dispatch_queue(user=Depends(current_user)):
    """Mock dispatcher — flips Pending notifications to Sent. Real WhatsApp/SMS providers plug in here."""
    if user.get("role") not in ("admin","manager"): raise HTTPException(403, "Admin/Manager only")
    pending = await db.notifications.find({"status":"Pending"}).to_list(500)
    sent = 0
    for n in pending:
        # In production: call WhatsApp Cloud API / Twilio / SendGrid here based on n["channel"]
        await db.notifications.update_one({"id": n["id"]}, {"$set": {
            "status":"Sent","sent_at": now_iso(),"provider_ref": f"MOCK-{n['id']}-{int(datetime.now().timestamp())}",
            "attempts": (n.get("attempts") or 0) + 1}})
        sent += 1
    await audit(user, "dispatch", "notification_queue", notes=f"sent {sent}")
    return {"dispatched": sent, "channel_breakdown": {c: sum(1 for n in pending if n.get("channel")==c) for c in ["whatsapp","sms","email","in-app"]}}

@api.get("/notifications/queue")
async def queue_status(status: Optional[str]=None, user=Depends(current_user)):
    q = {}
    if status: q["status"] = status
    rows = await db.notifications.find(q, {"_id":0}).sort("id", -1).limit(200).to_list(200)
    counts = await db.notifications.aggregate([{"$group":{"_id":"$status","n":{"$sum":1}}}]).to_list(10)
    return {"items": rows, "counts": {c["_id"]: c["n"] for c in counts}}

# ────────────────────────────────────────────────────────────────────────────
# OTP SERVICE  (for Patient App / Staff App login)
# ────────────────────────────────────────────────────────────────────────────
OTP_STORE: Dict[str, Dict[str, Any]] = {}  # phone -> {otp, exp, attempts}

@api.post("/otp/send")
async def otp_send(body: Dict[str, Any]):
    phone = (body.get("phone") or "").strip()
    if not re.match(r"^\d{10,15}$", phone): raise HTTPException(400, "Valid phone required")
    code = f"{random.randint(0, 999999):06d}"
    OTP_STORE[phone] = {"otp": code, "exp": (datetime.now(timezone.utc)+timedelta(minutes=5)).isoformat(), "attempts": 0}
    # Enqueue OTP via template
    tpl = await db.notif_templates.find_one({"code":"otp_login"})
    msg = render_template((tpl or {}).get("body","Your Reach Out OTP is {{otp}}"), {"otp": code})
    await db.notifications.insert_one({"id": await next_id("notifications"), "channel":"sms",
        "recipient_phone": phone, "message": msg, "title":"Login OTP",
        "status":"Pending", "created_at": now_iso()})
    return {"message":"OTP sent", "dev_otp": code if os.environ.get("EXPOSE_OTP","1") == "1" else None}

@api.post("/otp/verify")
async def otp_verify(body: Dict[str, Any]):
    phone, otp = (body.get("phone") or "").strip(), (body.get("otp") or "").strip()
    rec = OTP_STORE.get(phone)
    if not rec: raise HTTPException(400, "OTP not requested")
    if datetime.now(timezone.utc) > datetime.fromisoformat(rec["exp"]):
        OTP_STORE.pop(phone, None); raise HTTPException(400, "OTP expired")
    rec["attempts"] = rec.get("attempts",0) + 1
    if rec["attempts"] > 5: OTP_STORE.pop(phone, None); raise HTTPException(429, "Too many attempts")
    if otp != rec["otp"]: raise HTTPException(401, "Wrong OTP")
    OTP_STORE.pop(phone, None)
    # Find patient or staff
    patient = await db.patients.find_one({"mobile": phone})
    staff = await db.staff.find_one({"mobile": phone})
    if patient:
        token = make_token({"id": patient["id"], "role":"patient", "name": patient.get("name")})
        return {"token": token, "role":"patient", "id": patient["id"], "name": patient.get("name"), "reg_number": patient.get("reg_number")}
    if staff:
        token = make_token({"id": staff["id"], "role":"staff", "name": staff.get("name")})
        return {"token": token, "role":"staff", "id": staff["id"], "name": staff.get("name"), "code": staff.get("code")}
    raise HTTPException(404, "No patient or staff registered with this number")

# ────────────────────────────────────────────────────────────────────────────
# AUTO ROSTER / SMART STAFF ALLOCATION ENGINE
# ────────────────────────────────────────────────────────────────────────────
@api.post("/roster/auto-allocate")
async def auto_allocate(d: Dict[str, Any], user=Depends(current_user)):
    """Suggest best staff for a booking using weighted scoring:
       40% rating, 25% availability, 20% vendor match, 10% role match, 5% location proximity."""
    patient_id = d.get("patient_id")
    start_date = d.get("start_date") or today()
    end_date = d.get("end_date") or start_date
    shift = d.get("shift","Morning")
    role = d.get("role"); vendor_pref = d.get("vendor")
    commit = bool(d.get("commit", False))
    patient = await db.patients.find_one({"id": patient_id}) if patient_id else None
    q = {"status":"Active","duty_tag":{"$nin":["Suspended","Terminated","On Leave"]}}
    if role: q["role"] = role
    staff_list = await list_col("staff", q)
    suggestions = []
    for s in staff_list:
        # availability: check overlapping roster
        clash = await db.roster.count_documents({"staff_id": s["id"], "date": {"$gte": start_date, "$lte": end_date}, "shift": shift})
        active_bk = await db.bookings.count_documents({"staff_id": s["id"], "status":"Active"})
        if clash > 0: continue
        rating_score = (float(s.get("rating") or 0) / 5.0) * 40
        avail_score = 25 if s.get("duty_tag")=="Available" else (12 if active_bk == 0 else 0)
        vendor_score = 20 if vendor_pref and s.get("vendor")==vendor_pref else (10 if not vendor_pref else 0)
        role_score = 10 if (not role or s.get("role")==role) else 0
        loc_score = 0
        if patient and s.get("address") and patient.get("address"):
            # crude proximity: substring city match
            tokens_p = set(re.findall(r"\w+", (patient.get("address") or "").lower()))
            tokens_s = set(re.findall(r"\w+", (s.get("address") or "").lower()))
            shared = len(tokens_p & tokens_s)
            loc_score = min(5, shared)
        total = rating_score + avail_score + vendor_score + role_score + loc_score
        suggestions.append({"id": s["id"], "code": s.get("code"), "name": s.get("name"),
            "role": s.get("role"), "vendor": s.get("vendor"), "rating": s.get("rating",0),
            "duty_tag": s.get("duty_tag"), "active_bookings": active_bk,
            "score": round(total, 2),
            "breakdown": {"rating": round(rating_score,1), "availability": avail_score,
                          "vendor_match": vendor_score, "role_match": role_score, "location": loc_score}})
    suggestions.sort(key=lambda x: x["score"], reverse=True)
    top = suggestions[:int(d.get("top", 5))]
    created = []
    if commit and top:
        chosen = top[0]
        cur = start_date
        while cur <= end_date:
            try:
                await db.roster.insert_one({"id": await next_id("roster"), "staff_id": chosen["id"],
                    "patient_id": patient_id, "date": cur, "shift": shift,
                    "status":"Scheduled", "service": d.get("service_name"),
                    "auto_allocated": True, "created_at": now_iso()})
                created.append(cur)
            except Exception: pass
            cur = (datetime.fromisoformat(cur) + timedelta(days=1)).date().isoformat()
        await audit(user, "auto_allocate", "roster", chosen["id"], after={"dates": created, "patient_id": patient_id})
    return {"suggestions": top, "committed": created}

# ────────────────────────────────────────────────────────────────────────────
# GEOFENCING — store fence per roster, validate on attendance
# ────────────────────────────────────────────────────────────────────────────
@api.patch("/roster/{rid}/geofence")
async def set_geofence(rid: int, body: Dict[str, Any], user=Depends(current_user)):
    lat = float(body.get("lat")); lng = float(body.get("lng")); radius = int(body.get("radius_m", 200))
    await db.roster.update_one({"id": rid}, {"$set": {"geofence": {"lat": lat, "lng": lng, "radius_m": radius}}})
    return {"message": "Geofence set", "lat": lat, "lng": lng, "radius_m": radius}

@api.post("/attendance/login-geo")
async def att_login_geo(staff_id: int = Form(...), lat: float = Form(...), lng: float = Form(...),
                        roster_id: Optional[int] = Form(None), photo: Optional[UploadFile] = File(None)):
    """Geofenced attendance login. Rejects if outside fence."""
    d = today()
    if await db.attendance.find_one({"staff_id": staff_id, "date": d, "logout_time": None}):
        raise HTTPException(400, "Already clocked in today")
    distance = None; status = "Present"
    if roster_id:
        r = await db.roster.find_one({"id": roster_id})
        gf = (r or {}).get("geofence")
        if gf:
            distance = _haversine_m(lat, lng, gf["lat"], gf["lng"])
            if distance and distance > gf.get("radius_m", 200):
                raise HTTPException(400, f"Outside geofence: {distance:.0f}m from site (allowed: {gf['radius_m']}m)")
    pp = ""
    if photo:
        path = UPLOAD_DIR / "staff" / f"clock-{staff_id}-{int(datetime.now().timestamp()*1000)}.jpg"
        path.write_bytes(await photo.read()); pp = str(path.relative_to(ROOT_DIR))
    aid = await next_id("attendance")
    await db.attendance.insert_one({"id": aid, "staff_id": staff_id, "date": d, "login_time": now_iso(),
        "login_lat": lat, "login_lng": lng, "login_photo": pp,
        "roster_id": roster_id, "distance_from_site_m": round(distance) if distance else None,
        "status": status})
    await db.staff.update_one({"id": staff_id}, {"$set": {"duty_tag":"On Duty"}})
    return {"id": aid, "distance_m": round(distance) if distance else None, "message":"Clocked in"}

# ────────────────────────────────────────────────────────────────────────────
# NPS + REVENUE FORECAST
# ────────────────────────────────────────────────────────────────────────────
@api.get("/analytics/nps")
async def nps(user=Depends(current_user)):
    """NPS from feedback.service_rating (5=promoter, 4=passive, ≤3=detractor)."""
    pipe = [{"$match":{"service_rating":{"$exists":True}}},
            {"$group":{"_id":None,
                "promoters":{"$sum":{"$cond":[{"$gte":["$service_rating",5]},1,0]}},
                "passives":{"$sum":{"$cond":[{"$eq":["$service_rating",4]},1,0]}},
                "detractors":{"$sum":{"$cond":[{"$lte":["$service_rating",3]},1,0]}},
                "total":{"$sum":1}}}]
    a = await db.feedback.aggregate(pipe).to_list(1)
    if not a: return {"nps": None, "promoters":0, "passives":0, "detractors":0, "total":0}
    r = a[0]; t = r["total"] or 1
    nps_score = round(((r["promoters"] - r["detractors"]) / t) * 100, 1)
    return {"nps": nps_score, "promoters": r["promoters"], "passives": r["passives"],
            "detractors": r["detractors"], "total": r["total"],
            "promoter_pct": round(r["promoters"]/t*100,1),
            "detractor_pct": round(r["detractors"]/t*100,1)}

@api.get("/analytics/revenue-forecast")
async def revenue_forecast(months: int = Query(3, ge=1, le=12), user=Depends(current_user)):
    """Simple linear regression on monthly revenue → forecast next N months."""
    hist = await monthly_rev(user)
    hist = list(reversed(hist))[-12:]  # ascending, last 12
    if len(hist) < 2:
        return {"history": hist, "forecast": [], "note": "Need 2+ months of data"}
    n = len(hist); xs = list(range(n)); ys = [h["revenue"] for h in hist]
    mean_x = sum(xs)/n; mean_y = sum(ys)/n
    num = sum((xs[i]-mean_x)*(ys[i]-mean_y) for i in range(n))
    den = sum((xs[i]-mean_x)**2 for i in range(n)) or 1
    slope = num/den; intercept = mean_y - slope*mean_x
    last_month = datetime.strptime(hist[-1]["month"], "%Y-%m")
    forecast = []
    for i in range(1, months+1):
        nxt = last_month + timedelta(days=32*i); nxt = nxt.replace(day=1)
        pred = max(0, round(slope*(n+i-1) + intercept))
        forecast.append({"month": nxt.strftime("%Y-%m"), "predicted_revenue": pred,
                         "confidence": "high" if n >= 6 else "low"})
    return {"history": hist, "forecast": forecast,
            "trend": "growing" if slope > 0 else "declining", "slope_per_month": round(slope, 2)}

@api.get("/analytics/staff-demand-forecast")
async def staff_demand(user=Depends(current_user)):
    """Forecast staff required from booking pipeline."""
    pipe = [{"$match":{"status":{"$in":["Active","Pending"]}}},
            {"$group":{"_id":"$service_category","bookings":{"$sum":1},"revenue":{"$sum":"$amount"}}}]
    rows = await db.bookings.aggregate(pipe).to_list(50)
    total = sum(r["bookings"] for r in rows) or 1
    out = []
    for r in rows:
        avg_staff_per_booking = 1.2 if "Nursing" in (r["_id"] or "") else 1.0
        out.append({"service_category": r["_id"], "active_bookings": r["bookings"],
                    "revenue": r["revenue"], "est_staff_needed": _math.ceil(r["bookings"]*avg_staff_per_booking),
                    "pct_of_pipeline": round(r["bookings"]/total*100,1)})
    return out

# ────────────────────────────────────────────────────────────────────────────
# INVENTORY + EQUIPMENT LENDING
# ────────────────────────────────────────────────────────────────────────────
@api.get("/inventory")
async def list_inventory(category: Optional[str]=None, status: Optional[str]=None, user=Depends(current_user)):
    q = {}
    if category: q["category"] = category
    if status: q["status"] = status
    return await list_col("inventory_items", q, sort=("name", 1))

@api.post("/inventory")
async def add_inventory(d: Dict[str, Any], user=Depends(current_user)):
    if user.get("role") not in ("admin","manager"): raise HTTPException(403, "Admin/Manager only")
    iid = await next_id("inventory_items")
    code = f"INV-{int(datetime.now().timestamp())}"
    total_qty = int(d.get("total_qty", 1))
    doc = {"id": iid, "item_code": code, "status":"Active", "total_qty": total_qty,
           "available_qty": total_qty, "lent_qty": 0, "created_at": now_iso(),
           **{k:v for k,v in d.items() if k not in ("id","item_code","available_qty","lent_qty")}}
    await db.inventory_items.insert_one(doc)
    await audit(user, "create", "inventory_item", iid, after={"name": d.get("name")})
    return {"id": iid, "item_code": code, "message": "Inventory item added"}

@api.put("/inventory/{iid}")
async def upd_inventory(iid: int, d: Dict[str, Any], user=Depends(current_user)):
    d.pop("id", None); d.pop("_id", None); d.pop("available_qty", None); d.pop("lent_qty", None)
    await db.inventory_items.update_one({"id": iid}, {"$set": d})
    return {"message":"Updated"}

@api.get("/lendings")
async def list_lendings(status: Optional[str]=None, patient_id: Optional[int]=None, user=Depends(current_user)):
    q = {}
    if status: q["status"] = status
    if patient_id: q["patient_id"] = patient_id
    rows = await list_col("lendings", q, sort=("id", -1))
    pmap = {p["id"]: p for p in await list_col("patients")}
    imap = {i["id"]: i for i in await list_col("inventory_items")}
    for r in rows:
        r["patient_name"] = pmap.get(r.get("patient_id"), {}).get("name")
        item = imap.get(r.get("item_id"), {})
        r["item_name"] = item.get("name"); r["item_code"] = item.get("item_code")
    return rows

@api.post("/lendings")
async def add_lending(d: Dict[str, Any], user=Depends(current_user)):
    item = await db.inventory_items.find_one({"id": d.get("item_id")})
    if not item: raise HTTPException(404, "Item not found")
    qty = int(d.get("qty", 1))
    if item.get("available_qty", 0) < qty: raise HTTPException(400, "Insufficient stock")
    lid = await next_id("lendings")
    await db.lendings.insert_one({"id": lid, "item_id": d["item_id"], "patient_id": d.get("patient_id"),
        "booking_id": d.get("booking_id"), "qty": qty, "issued_date": d.get("issued_date") or today(),
        "expected_return": d.get("expected_return"), "deposit": d.get("deposit", 0),
        "condition_at_issue": d.get("condition_at_issue","Good"), "issued_by": user.get("name"),
        "status":"Issued", "created_at": now_iso()})
    await db.inventory_items.update_one({"id": d["item_id"]}, {"$inc": {"available_qty": -qty, "lent_qty": qty}})
    await audit(user, "create", "lending", lid, after={"item_id": d["item_id"], "patient_id": d.get("patient_id")})
    return {"id": lid, "message":"Equipment lent"}

@api.patch("/lendings/{lid}/return")
async def return_lending(lid: int, body: Dict[str, Any], user=Depends(current_user)):
    l = await db.lendings.find_one({"id": lid})
    if not l or l.get("status") != "Issued": raise HTTPException(400, "Not an active lending")
    cond = body.get("condition_at_return","Good")
    damage = float(body.get("damage_charge", 0) or 0)
    refund = max(0, float(l.get("deposit",0)) - damage)
    await db.lendings.update_one({"id": lid}, {"$set": {
        "actual_return": today(), "condition_at_return": cond, "damage_charge": damage,
        "refund_amount": refund, "received_by": user.get("name"), "status":"Returned"}})
    await db.inventory_items.update_one({"id": l["item_id"]}, {"$inc": {"available_qty": l["qty"], "lent_qty": -l["qty"]}})
    return {"message":"Returned", "refund_amount": refund, "damage_charge": damage}

# ────────────────────────────────────────────────────────────────────────────
# INCIDENT WORKFLOW
# ────────────────────────────────────────────────────────────────────────────
@api.post("/incidents/{iid}/assign-investigator")
async def assign_inv(iid: int, body: Dict[str, Any], user=Depends(current_user)):
    if user.get("role") not in ("admin","manager","supervisor"): raise HTTPException(403, "Forbidden")
    await db.incidents.update_one({"id": iid}, {"$set": {"investigator_id": body.get("investigator_id"),
        "investigator_name": body.get("investigator_name"), "status":"Under Investigation",
        "assigned_at": now_iso()}})
    await audit(user, "assign", "incident", iid, after=body); return {"message":"Investigator assigned"}

@api.post("/incidents/{iid}/findings")
async def inc_findings(iid: int, body: Dict[str, Any], user=Depends(current_user)):
    await db.incidents.update_one({"id": iid}, {"$set": {"findings": body.get("findings",""),
        "root_cause": body.get("root_cause",""), "corrective_action": body.get("corrective_action",""),
        "findings_at": now_iso()}})
    return {"message":"Findings recorded"}

@api.post("/incidents/{iid}/close")
async def inc_close(iid: int, body: Dict[str, Any], user=Depends(current_user)):
    if user.get("role") not in ("admin","manager"): raise HTTPException(403, "Admin/Manager only")
    await db.incidents.update_one({"id": iid}, {"$set": {"status":"Closed",
        "resolution": body.get("resolution",""), "closed_by": user.get("name"), "closed_at": now_iso()}})
    await audit(user, "close", "incident", iid); return {"message":"Incident closed"}

# ────────────────────────────────────────────────────────────────────────────
# ADVANCED PAYROLL — Detailed breakdown
# ────────────────────────────────────────────────────────────────────────────
@api.get("/payroll/{staff_id}/details")
async def payroll_details(staff_id: int, month: str = Query(...), user=Depends(current_user)):
    s = await db.staff.find_one({"id": staff_id}, {"_id":0})
    if not s: raise HTTPException(404, "Staff not found")
    att = await db.attendance.find({"staff_id": staff_id, "date": {"$regex": f"^{month}"}}).to_list(200)
    present = sum(1 for a in att if a.get("status")=="Present")
    absent = sum(1 for a in att if a.get("status")=="Absent")
    total_hrs = round(sum(a.get("hours_worked") or 0 for a in att), 2)
    std_hours = present * 8
    overtime_hrs = max(0, total_hrs - std_hours)
    monthly = _parse_salary(s.get("salary"))
    per_day = monthly / 26 if monthly else 0
    per_hour = per_day / 8 if per_day else 0
    basic = round(per_day * present)
    hra = round(basic * 0.10)
    conveyance = round(basic * 0.05)
    overtime_pay = round(overtime_hrs * per_hour * 1.5)
    gross = basic + hra + conveyance + overtime_pay
    pf = round(basic * 0.12)
    esi = round(gross * 0.0075) if gross < 21000 else 0
    tds = 0  # No TDS for low-income staff
    pt = 200 if gross > 15000 else 0  # Professional tax
    deductions = pf + esi + tds + pt
    leave_deduction = round(per_day * absent)
    net_pay = gross - deductions - leave_deduction
    return {
        "staff": {"id": s["id"], "code": s.get("code"), "name": s.get("name"),
                  "role": s.get("role"), "vendor": s.get("vendor"),
                  "employment_type": s.get("employment_type")},
        "month": month,
        "attendance": {"days_present": present, "days_absent": absent,
                       "total_hours": total_hrs, "std_hours": std_hours, "overtime_hrs": overtime_hrs},
        "earnings": {"basic": basic, "hra": hra, "conveyance": conveyance,
                     "overtime_pay": overtime_pay, "gross": gross},
        "deductions": {"pf": pf, "esi": esi, "professional_tax": pt, "tds": tds,
                       "leave_deduction": leave_deduction, "total": deductions + leave_deduction},
        "net_pay": net_pay,
    }

# ────────────────────────────────────────────────────────────────────────────
# PATIENT APP — Self-service endpoints
# ────────────────────────────────────────────────────────────────────────────
async def patient_only(user=Depends(current_user)):
    if user.get("role") != "patient": raise HTTPException(403, "Patient app only")
    return user

@api.get("/patient-app/me")
async def pa_me(user=Depends(patient_only)):
    p = await db.patients.find_one({"id": user.get("id")}, {"_id":0})
    if not p: raise HTTPException(404, "Patient not found")
    return p

@api.get("/patient-app/my-bookings")
async def pa_bookings(user=Depends(patient_only)):
    rows = await db.bookings.find({"patient_id": user.get("id")}, {"_id":0}).sort("id", -1).to_list(100)
    smap = {s["id"]: s for s in await list_col("staff")}
    for r in rows:
        s = smap.get(r.get("staff_id"), {})
        r["staff_name"] = s.get("name"); r["staff_mobile"] = s.get("mobile"); r["staff_rating"] = s.get("rating")
    return rows

@api.get("/patient-app/my-bills")
async def pa_bills(user=Depends(patient_only)):
    return await db.bills.find({"patient_id": user.get("id")}, {"_id":0}).sort("id", -1).to_list(100)

@api.get("/patient-app/my-charts")
async def pa_charts(user=Depends(patient_only)):
    rows = await db.medical_charts.find({"patient_id": user.get("id")}, {"_id":0}).sort("visit_date", -1).limit(60).to_list(60)
    for r in rows:
        try: r["data"] = json.loads(r.get("chart_data") or "{}")
        except: r["data"] = {}
    return rows

@api.post("/patient-app/request-service")
async def pa_request(d: Dict[str, Any], user=Depends(patient_only)):
    p = await db.patients.find_one({"id": user.get("id")})
    lid = await next_id("leads")
    await db.leads.insert_one({"id": lid, "caller_name": p.get("name"), "caller_mobile": p.get("mobile"),
        "relation":"Self", "source":"Patient App", "patient_name": p.get("name"),
        "patient_age": p.get("age"), "patient_gender": p.get("gender"), "patient_address": p.get("address"),
        "diagnosis": p.get("diagnosis"), "service_needed": d.get("service_needed"),
        "urgency": d.get("urgency","Planned"), "status":"New", "notes": d.get("notes",""),
        "created_at": now_iso()})
    await db.notifications.insert_one({"id": await next_id("notifications"), "channel":"in-app",
        "title":"New Patient App Request", "message": f"{p.get('name')} requested {d.get('service_needed')}",
        "recipient_type":"admin", "status":"Pending", "created_at": now_iso()})
    return {"id": lid, "message":"Service request submitted"}

@api.post("/patient-app/feedback")
async def pa_feedback(d: Dict[str, Any], user=Depends(patient_only)):
    fid = await next_id("feedback")
    await db.feedback.insert_one({"id": fid, "patient_id": user.get("id"), "staff_id": d.get("staff_id"),
        "booking_id": d.get("booking_id"), "service_rating": d.get("service_rating"),
        "staff_rating": d.get("staff_rating"), "comments": d.get("comments",""),
        "source":"Patient App", "created_at": now_iso()})
    if d.get("staff_id") and d.get("staff_rating"):
        await db.staff_ratings.insert_one({"id": await next_id("staff_ratings"),
            "staff_id": d["staff_id"], "patient_id": user.get("id"),
            "source":"Patient Feedback", "score": d["staff_rating"],
            "comment": d.get("comments",""), "rated_at": now_iso()})
        await recalc_weighted_rating(d["staff_id"])
    return {"id": fid, "message":"Thank you for your feedback"}

@api.post("/patient-app/consent")
async def pa_consent(d: Dict[str, Any], user=Depends(patient_only)):
    cid = await next_id("consents")
    await db.consents.insert_one({"id": cid, "patient_id": user.get("id"),
        "consent_type": d.get("consent_type"), "signed_text": d.get("signed_text"),
        "signature_method": d.get("signature_method","Digital Click"),
        "status":"Signed", "signed_at": now_iso(), "created_at": now_iso()})
    return {"id": cid, "message":"Consent recorded"}

# ────────────────────────────────────────────────────────────────────────────
# STAFF APP — Mobile endpoints
# ────────────────────────────────────────────────────────────────────────────
async def staff_only(user=Depends(current_user)):
    if user.get("role") not in ("staff","admin"): raise HTTPException(403, "Staff app only")
    return user

@api.get("/staff-app/me")
async def sa_me(user=Depends(staff_only)):
    s = await db.staff.find_one({"id": user.get("id")}, {"_id":0})
    if not s: raise HTTPException(404, "Staff not found")
    docs = await list_col("staff_documents", {"staff_id": user.get("id")})
    comp = compute_compliance(s, docs)
    return {**s, "compliance": comp}

@api.get("/staff-app/my-roster")
async def sa_roster(frm: Optional[str]=Query(None, alias="from"), to: Optional[str]=None, user=Depends(staff_only)):
    q = {"staff_id": user.get("id")}
    if frm: q["date"] = {"$gte": frm}
    if to: q.setdefault("date", {})["$lte"] = to
    rows = await db.roster.find(q, {"_id":0}).sort("date", 1).to_list(200)
    pmap = {p["id"]: p for p in await list_col("patients")}
    for r in rows:
        p = pmap.get(r.get("patient_id"), {})
        r["patient_name"] = p.get("name"); r["patient_mobile"] = p.get("mobile")
        r["patient_address"] = p.get("address"); r["diagnosis"] = p.get("diagnosis")
    return rows

@api.get("/staff-app/my-payslips")
async def sa_payslips(user=Depends(staff_only)):
    return await db.payroll_records.find({"staff_id": user.get("id")}, {"_id":0}).sort("month", -1).to_list(24)

@api.get("/staff-app/my-trainings")
async def sa_trainings(user=Depends(staff_only)):
    return await db.training.find({"staff_id": user.get("id")}, {"_id":0}).sort("id", -1).to_list(50)

@api.post("/staff-app/raise-incident")
async def sa_incident(d: Dict[str, Any], user=Depends(staff_only)):
    iid = await next_id("incidents")
    await db.incidents.insert_one({"id": iid, "staff_id": user.get("id"),
        "patient_id": d.get("patient_id"), "incident_type": d.get("incident_type"),
        "severity": d.get("severity","Medium"), "description": d.get("description",""),
        "status":"Open", "reported_at": now_iso(), "reporter_name": user.get("name")})
    return {"id": iid, "message":"Incident reported"}

@api.post("/staff-app/submit-chart")
async def sa_chart(d: Dict[str, Any], user=Depends(staff_only)):
    cid = await next_id("medical_charts")
    data = d.get("chart_data")
    if isinstance(data, dict): data = json.dumps(data)
    await db.medical_charts.insert_one({"id": cid, "booking_id": d.get("booking_id"),
        "patient_id": d.get("patient_id"), "staff_id": user.get("id"),
        "chart_type": d.get("chart_type"), "chart_data": data,
        "visit_date": d.get("visit_date") or today(), "created_at": now_iso()})
    return {"id": cid, "message":"Chart submitted"}

# ── Run additional seeds ───────────────────────────────────────────────────
@app.on_event("startup")
async def _seed_phase2():
    await _seed_templates()
    await _seed_services()

# ════════════════════════════════════════════════════════════════════════════
# SERVICE CATALOG  +  PAYMENT RECEIPT  +  TOTAL INVOICE  +  REFUND DETAILS
# ════════════════════════════════════════════════════════════════════════════

# Pre-loaded service catalog covering the user's 23 services.
# All rates are placeholders — admin can edit any time in the Services module.
DEFAULT_SERVICES = [
    # Nursing & Care (per-shift / per-day)
    {"code":"RO-NUR-001","category":"Nursing & Care","name":"24 Hrs Nursing Service","unit":"shift","package_rate":1800,"standard_rate":2000,"ppe_included":True},
    {"code":"RO-NUR-002","category":"Nursing & Care","name":"12 Hrs Nursing Service","unit":"shift","package_rate":1200,"standard_rate":1400,"ppe_included":True},
    {"code":"RO-NUR-003","category":"Nursing & Care","name":"Baby Care","unit":"shift","package_rate":1500,"standard_rate":1700,"ppe_included":True},
    {"code":"RO-NUR-004","category":"Nursing & Care","name":"GDA Support — 24 Hrs","unit":"shift","package_rate":1200,"standard_rate":1400,"ppe_included":False},
    {"code":"RO-NUR-005","category":"Nursing & Care","name":"GDA Support — 12 Hrs","unit":"shift","package_rate":900,"standard_rate":1100,"ppe_included":False},
    {"code":"RO-NUR-006","category":"Nursing & Care","name":"In-Hospital Nursing (24x7)","unit":"shift","package_rate":1800,"standard_rate":2000,"ppe_included":True},
    {"code":"RO-NUR-007","category":"Nursing & Care","name":"In-Hospital GDA Support","unit":"shift","package_rate":1200,"standard_rate":1400,"ppe_included":False},
    {"code":"RO-NUR-008","category":"Nursing & Care","name":"Critical Care Nursing","unit":"shift","package_rate":2500,"standard_rate":2800,"ppe_included":True},
    {"code":"RO-NUR-009","category":"Nursing & Care","name":"Palliative Care Nursing","unit":"shift","package_rate":2200,"standard_rate":2500,"ppe_included":True},
    # Procedures (per visit)
    {"code":"RO-PRO-001","category":"Procedures","name":"Foley's Catheterization","unit":"visit","package_rate":1500,"standard_rate":1800,"ppe_included":True},
    {"code":"RO-PRO-002","category":"Procedures","name":"Ryle's Tube Insertion","unit":"visit","package_rate":1500,"standard_rate":1800,"ppe_included":True},
    {"code":"RO-PRO-003","category":"Procedures","name":"Central Line / PICC Care","unit":"visit","package_rate":1200,"standard_rate":1500,"ppe_included":True},
    {"code":"RO-PRO-004","category":"Procedures","name":"Chemo Port Care","unit":"visit","package_rate":1500,"standard_rate":1800,"ppe_included":True},
    {"code":"RO-PRO-005","category":"Procedures","name":"Peripheral IV Cannulation","unit":"visit","package_rate":600,"standard_rate":800,"ppe_included":True},
    {"code":"RO-PRO-006","category":"Procedures","name":"IV / IM / S-C Medication","unit":"visit","package_rate":500,"standard_rate":700,"ppe_included":True},
    {"code":"RO-PRO-007","category":"Procedures","name":"Wound / Surgical Dressing","unit":"visit","package_rate":700,"standard_rate":900,"ppe_included":True},
    {"code":"RO-PRO-008","category":"Procedures","name":"Stoma Dressing","unit":"visit","package_rate":800,"standard_rate":1000,"ppe_included":True},
    {"code":"RO-PRO-009","category":"Procedures","name":"Back / Bedsore Care","unit":"visit","package_rate":700,"standard_rate":900,"ppe_included":True},
    {"code":"RO-PRO-010","category":"Procedures","name":"Diabetic Foot Care","unit":"visit","package_rate":800,"standard_rate":1000,"ppe_included":True},
    {"code":"RO-PRO-011","category":"Procedures","name":"Suture Removal","unit":"visit","package_rate":600,"standard_rate":800,"ppe_included":True},
    {"code":"RO-PRO-012","category":"Procedures","name":"POP Removal","unit":"visit","package_rate":800,"standard_rate":1000,"ppe_included":True},
    # Diagnostics
    {"code":"RO-DIA-001","category":"Diagnostics","name":"Home Sample Collection — Blood","unit":"visit","package_rate":300,"standard_rate":400,"ppe_included":True},
    {"code":"RO-DIA-002","category":"Diagnostics","name":"Home Sample Collection — Urine / Body Fluids","unit":"visit","package_rate":300,"standard_rate":400,"ppe_included":True},
    {"code":"RO-DIA-003","category":"Diagnostics","name":"Portable Digital X-Ray at Home","unit":"visit","package_rate":1500,"standard_rate":1800,"ppe_included":True},
    {"code":"RO-DIA-004","category":"Diagnostics","name":"Portable ECG at Home","unit":"visit","package_rate":600,"standard_rate":800,"ppe_included":True},
    # Therapy & Counselling
    {"code":"RO-THR-001","category":"Therapy","name":"Physiotherapy — General","unit":"visit","package_rate":700,"standard_rate":900,"ppe_included":False},
    {"code":"RO-THR-002","category":"Therapy","name":"Physiotherapy — Specialized","unit":"visit","package_rate":900,"standard_rate":1200,"ppe_included":False},
    {"code":"RO-THR-003","category":"Therapy","name":"Physiotherapy — Chest","unit":"visit","package_rate":900,"standard_rate":1200,"ppe_included":False},
    {"code":"RO-THR-004","category":"Therapy","name":"Nutrition & Diet Counselling","unit":"session","package_rate":800,"standard_rate":1000,"ppe_included":False},
    # Doctor & Equipment
    {"code":"RO-DOC-001","category":"Doctor & Equipment","name":"Doctor Visit @ Home","unit":"visit","package_rate":1500,"standard_rate":2000,"ppe_included":False},
    {"code":"RO-DOC-002","category":"Doctor & Equipment","name":"Arrangement of Medical Equipment","unit":"each","package_rate":0,"standard_rate":0,"ppe_included":False,"description":"As per actuals"},
    # Ambulance & Transport
    {"code":"RO-AMB-001","category":"Ambulance & Transport","name":"Comprehensive Ambulance (24x7)","unit":"trip","package_rate":2500,"standard_rate":3000,"ppe_included":True},
    {"code":"RO-AMB-002","category":"Ambulance & Transport","name":"ACLS Ambulance","unit":"trip","package_rate":4500,"standard_rate":5000,"ppe_included":True},
    {"code":"RO-AMB-003","category":"Ambulance & Transport","name":"BLS Ambulance","unit":"trip","package_rate":2500,"standard_rate":3000,"ppe_included":True},
    {"code":"RO-AMB-004","category":"Ambulance & Transport","name":"Air Transportation","unit":"trip","package_rate":0,"standard_rate":0,"ppe_included":False,"description":"As per actuals"},
    {"code":"RO-AMB-005","category":"Ambulance & Transport","name":"Rail Transportation","unit":"trip","package_rate":0,"standard_rate":0,"ppe_included":False,"description":"As per actuals"},
    {"code":"RO-AMB-006","category":"Ambulance & Transport","name":"Last Journey (Hearse Van)","unit":"trip","package_rate":3500,"standard_rate":4000,"ppe_included":True},
    {"code":"RO-AMB-007","category":"Ambulance & Transport","name":"Motorized Wheelchair","unit":"day","package_rate":500,"standard_rate":700,"ppe_included":False},
    {"code":"RO-AMB-008","category":"Ambulance & Transport","name":"Pick & Drop","unit":"trip","package_rate":1500,"standard_rate":1800,"ppe_included":False},
    {"code":"RO-AMB-009","category":"Ambulance & Transport","name":"Guide Service","unit":"day","package_rate":1500,"standard_rate":1800,"ppe_included":False},
]

async def _seed_services():
    """Seed service catalog if collection is empty."""
    if await db.services.count_documents({}) > 0:
        return
    docs = []
    for i, s in enumerate(DEFAULT_SERVICES, start=1):
        docs.append({
            "id": i,
            "code": s["code"], "category": s["category"], "name": s["name"],
            "unit": s["unit"],
            "package_rate": s["package_rate"], "standard_rate": s["standard_rate"],
            "ppe_included": s.get("ppe_included", False),
            "gst_pct": 0, "hsn_code": "999316",  # Healthcare HSN
            "description": s.get("description",""),
            "is_active": True,
            "created_at": now_iso(), "updated_at": now_iso(),
        })
    if docs:
        await db.services.insert_many(docs)

class ServiceIn(dict):
    pass

@api.get("/services")
async def list_services(category: Optional[str] = None, active_only: bool = True, user=Depends(current_user)):
    q = {}
    if category: q["category"] = category
    if active_only: q["is_active"] = True
    rows = await db.services.find(q, {"_id":0}).sort([("category",1),("name",1)]).to_list(500)
    return rows

@api.get("/services/categories")
async def list_service_categories(user=Depends(current_user)):
    cats = await db.services.distinct("category", {"is_active": True})
    return sorted(cats)

@api.post("/services")
async def create_service(body: dict, user=Depends(current_user)):
    if user.get("role") not in ("admin","manager","accountant"):
        raise HTTPException(403, "Only admin/manager/accountant can manage services")
    if not body.get("name") or not body.get("category"):
        raise HTTPException(400, "name and category are required")
    next_sid = await next_id("services")
    code = body.get("code") or f"RO-SVC-{next_sid:03d}"
    doc = {
        "id": next_sid, "code": code,
        "category": body.get("category"), "name": body.get("name"),
        "unit": body.get("unit","visit"),
        "package_rate": float(body.get("package_rate") or 0),
        "standard_rate": float(body.get("standard_rate") or 0),
        "ppe_included": bool(body.get("ppe_included", False)),
        "gst_pct": float(body.get("gst_pct") or 0),
        "hsn_code": body.get("hsn_code","999316"),
        "description": body.get("description",""),
        "is_active": bool(body.get("is_active", True)),
        "created_at": now_iso(), "updated_at": now_iso(),
    }
    await db.services.insert_one(doc)
    await audit(user, "create", "service", next_sid, notes=body.get("name",""))
    return {"id": next_sid, "message": "Service added"}

@api.put("/services/{sid}")
async def update_service(sid: int, body: dict, user=Depends(current_user)):
    if user.get("role") not in ("admin","manager","accountant"):
        raise HTTPException(403, "Only admin/manager/accountant can manage services")
    allowed = ["code","category","name","unit","package_rate","standard_rate","ppe_included","gst_pct","hsn_code","description","is_active"]
    upd = {k: body[k] for k in allowed if k in body}
    for f in ("package_rate","standard_rate","gst_pct"):
        if f in upd: upd[f] = float(upd[f] or 0)
    if "ppe_included" in upd: upd["ppe_included"] = bool(upd["ppe_included"])
    if "is_active" in upd: upd["is_active"] = bool(upd["is_active"])
    upd["updated_at"] = now_iso()
    r = await db.services.update_one({"id": sid}, {"$set": upd})
    if r.matched_count == 0: raise HTTPException(404, "Service not found")
    await audit(user, "update", "service", sid, notes=body.get("name",""))
    return {"message": "Service updated"}

@api.delete("/services/{sid}")
async def delete_service(sid: int, user=Depends(current_user)):
    if user.get("role") != "admin":
        raise HTTPException(403, "Only admin can delete services")
    # Soft delete (preserve historical bills referencing this)
    r = await db.services.update_one({"id": sid}, {"$set": {"is_active": False, "updated_at": now_iso()}})
    if r.matched_count == 0: raise HTTPException(404, "Service not found")
    await audit(user, "delete", "service", sid)
    return {"message": "Service deactivated"}

# ── Receipt Number Generator ──────────────────────────────────────────────
# Starts from 00001 — 5-digit zero-padded sequential
RECEIPT_PREFIX = "RO-RCP-"

async def _next_receipt_number():
    counter = await db.counters.find_one_and_update(
        {"_id": "receipt_number"},
        {"$inc": {"seq": 1}},
        upsert=True, return_document=True
    )
    seq = (counter or {}).get("seq", 1)
    return f"{seq:05d}"  # 00001, 00002, …

# ── Helper to convert amount to words ─────────────────────────────────────
def _num_to_words_inr(n):
    """Indian numbering: returns rupees in words."""
    try:
        n = int(round(float(n)))
    except Exception:
        return ""
    if n == 0: return "Zero"
    ones = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine",
            "Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen",
            "Seventeen","Eighteen","Nineteen"]
    tens = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"]
    def two(x):
        if x < 20: return ones[x]
        return tens[x//10] + (" " + ones[x%10] if x%10 else "")
    def three(x):
        h = x // 100; r = x % 100
        return (ones[h] + " Hundred" + (" " + two(r) if r else "")) if h else two(r)
    parts = []
    crore = n // 10000000; n %= 10000000
    lakh = n // 100000; n %= 100000
    thousand = n // 1000; n %= 1000
    hundred = n
    if crore: parts.append(two(crore) + " Crore")
    if lakh: parts.append(two(lakh) + " Lakh")
    if thousand: parts.append(two(thousand) + " Thousand")
    if hundred: parts.append(three(hundred))
    return " ".join(parts) + " Only"

# ── NEW: Receipt PDF in user's exact format ──────────────────────────────
@api.get("/pdf/receipt-v2/{bill_id}")
async def pdf_receipt_v2(bill_id: int, payment_idx: int = 0, user=Depends(current_user)):
    """Clean tabular receipt — matches user's physical receipt book."""
    b = await db.bills.find_one({"id": bill_id}, {"_id":0})
    if not b: raise HTTPException(404, "Bill not found")
    p = await db.patients.find_one({"id": b.get("patient_id")}, {"_id":0}) or {}
    payments = b.get("payments") or []
    pay = payments[payment_idx] if 0 <= payment_idx < len(payments) else {
        "amount": b.get("paid_amount",0), "mode": b.get("payment_method","Cash"),
        "reference": b.get("transaction_ref","")
    }
    amount = float(pay.get("amount") or b.get("paid_amount") or 0)
    rcpt_no = pay.get("receipt_number") or b.get("receipt_number") or f"{bill_id:05d}"
    rcpt_date = (pay.get("date") or b.get("created_at") or now_iso())[:10]
    service_line = (b.get("service_description") or
                    ", ".join([f"{li.get('service_name','')} × {li.get('qty',1):g} {li.get('unit','')}" for li in (b.get("line_items") or [])]) or
                    b.get("service_type","Service"))
    payer = b.get("payer_name") or p.get("name","")
    pay_mode = (pay.get("mode") or "Cash").upper()

    def build(doc, styles, k):
        story = _brand_header(k["P"], styles)
        story.append(k["S"](1, 4*k["mm"]))
        # Title bar
        story.append(k["P"]("<para align='center'><font size=18 color='#1E3A8A'><b>RECEIPT</b></font></para>", styles["Normal"]))
        story.append(k["S"](1, 2*k["mm"]))

        # No / Date row — clean two-column table
        meta = k["T"]([
            [k["P"](f"<font size=11><b>No.</b> &nbsp;&nbsp; <font color='#7C3AED'><b>{rcpt_no}</b></font></font>", styles["Normal"]),
             k["P"](f"<para align='right'><font size=11><b>Dated</b> &nbsp;&nbsp; {rcpt_date}</font></para>", styles["Normal"])]
        ], colWidths=[85*k["mm"], 85*k["mm"]])
        meta.setStyle(k["TS"]([
            ("LEFTPADDING",(0,0),(-1,-1),0), ("RIGHTPADDING",(0,0),(-1,-1),0),
            ("BOTTOMPADDING",(0,0),(-1,-1),4),
            ("LINEBELOW",(0,0),(-1,-1),0.5,k["colors"].HexColor("#A78BFA")),
        ]))
        story.append(meta); story.append(k["S"](1, 5*k["mm"]))

        # Patient block — clean 2x2 grid
        det = k["T"]([
            ["Patient Regn. No.", p.get("reg_number", b.get("patient_reg","")), "Patient Name", p.get("name", b.get("patient_name",""))],
            ["Contact No.", p.get("mobile","—"), "Service Period", f"{b.get('service_from','—')} to {b.get('service_to','—')}"],
        ], colWidths=[35*k["mm"], 50*k["mm"], 35*k["mm"], 50*k["mm"]])
        det.setStyle(k["TS"]([
            ("FONTSIZE",(0,0),(-1,-1),10),
            ("GRID",(0,0),(-1,-1),0.4,k["colors"].HexColor("#C4B5FD")),
            ("BACKGROUND",(0,0),(0,-1),k["colors"].HexColor("#EEF2FF")),
            ("BACKGROUND",(2,0),(2,-1),k["colors"].HexColor("#EEF2FF")),
            ("FONTNAME",(0,0),(0,-1),"Helvetica-Bold"),
            ("FONTNAME",(2,0),(2,-1),"Helvetica-Bold"),
            ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
            ("TOPPADDING",(0,0),(-1,-1),7),("BOTTOMPADDING",(0,0),(-1,-1),7),
            ("LEFTPADDING",(0,0),(-1,-1),8),("RIGHTPADDING",(0,0),(-1,-1),8),
        ]))
        story.append(det); story.append(k["S"](1, 6*k["mm"]))

        # "Received with thanks from" — on its own line, no overlap
        story.append(k["P"](
            f"<para><font size=11>Received with thanks from &nbsp; <u><b>{payer or '_________________________'}</b></u></font></para>",
            styles["Normal"]
        ))
        story.append(k["S"](1, 4*k["mm"]))

        # Amount in words + figures — prominent
        words = _num_to_words_inr(amount)
        amt_box = k["T"]([
            [k["P"](f"<font size=11>a sum of Rupees</font>", styles["Normal"]),
             k["P"](f"<font size=11.5 color='#1E3A8A'><b><u>{words}</u></b></font>", styles["Normal"]),
             k["P"](f"<para align='right'><font size=14 color='#7C3AED'><b>₹ {amount:,.0f}/-</b></font></para>", styles["Normal"])],
        ], colWidths=[28*k["mm"], 110*k["mm"], 32*k["mm"]])
        amt_box.setStyle(k["TS"]([
            ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
            ("LEFTPADDING",(0,0),(-1,-1),0),("RIGHTPADDING",(0,0),(-1,-1),0),
            ("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5),
            ("BACKGROUND",(0,0),(-1,-1),k["colors"].HexColor("#F5F3FF")),
            ("BOX",(0,0),(-1,-1),0.4,k["colors"].HexColor("#A78BFA")),
        ]))
        story.append(amt_box); story.append(k["S"](1, 5*k["mm"]))

        # Payment mode — proper big checkboxes in a row
        modes = [("CASH","Cash"),("CARD","Card"),("ECS","ECS"),("UPI","UPI"),("NEFT","NEFT/RTGS"),("CHEQUE","Cheque")]
        mode_cells = []
        for label, key in modes:
            checked = (pay_mode == key.upper()) or (label in pay_mode.upper())
            mark = '<font size=13 color="#10B981"><b>☑</b></font>' if checked else '<font size=13 color="#9CA3AF">☐</font>'
            mode_cells.append(k["P"](f"<font size=10>{mark} &nbsp; <b>{label}</b></font>", styles["Normal"]))
        # Layout in single row
        mode_tbl = k["T"]([["by Mode:"] + mode_cells], colWidths=[20*k["mm"]] + [25*k["mm"]]*len(mode_cells))
        mode_tbl.setStyle(k["TS"]([
            ("FONTSIZE",(0,0),(0,0),10),("FONTNAME",(0,0),(0,0),"Helvetica-Bold"),
            ("VALIGN",(0,0),(-1,-1),"MIDDLE"),("LEFTPADDING",(0,0),(-1,-1),3),("RIGHTPADDING",(0,0),(-1,-1),3),
            ("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),4),
        ]))
        story.append(mode_tbl)
        if pay.get("reference"):
            story.append(k["P"](f"<para><font size=9 color='#6B7280'>Transaction Ref: <b>{pay.get('reference','')}</b></font></para>", styles["Normal"]))
        story.append(k["S"](1, 5*k["mm"]))

        # On account of — proper labeled box
        svc_box = k["T"]([
            [k["P"](f"<font size=10><b>on account of</b> &nbsp; <font color='#6B7280'>(Physio / Doctor / X-Ray / ECG / Nursing / Other)</font></font>", styles["Normal"])],
            [k["P"](f"<font size=11 color='#1E3A8A'><b>{service_line}</b></font>", styles["Normal"])],
        ], colWidths=[170*k["mm"]])
        svc_box.setStyle(k["TS"]([
            ("LEFTPADDING",(0,0),(-1,-1),10),("RIGHTPADDING",(0,0),(-1,-1),10),
            ("TOPPADDING",(0,0),(-1,-1),6),("BOTTOMPADDING",(0,0),(-1,-1),6),
            ("BACKGROUND",(0,0),(-1,-1),k["colors"].HexColor("#FAFAFA")),
            ("BOX",(0,0),(-1,-1),0.3,k["colors"].HexColor("#D1D5DB")),
        ]))
        story.append(svc_box); story.append(k["S"](1, 14*k["mm"]))

        # Signature line right-aligned
        sig = k["T"]([
            ["", "_____________________"],
            ["", k["P"]("<para align='center'><font size=10><b>Authorised Signatory</b></font></para>", styles["Normal"])],
        ], colWidths=[105*k["mm"], 65*k["mm"]])
        sig.setStyle(k["TS"]([("LEFTPADDING",(0,0),(-1,-1),0),("ALIGN",(1,0),(1,-1),"CENTER")]))
        story.append(sig)
        story.append(k["S"](1, 8*k["mm"]))

        # Footer with separator line
        story.append(k["P"]("<para align='center'><font size=8 color='#6B7280'>"
            "<font color='#A78BFA'>____________________________________________________________</font><br/><br/>"
            "<b>Sir Ganga Ram Hospital</b>, Rajender Nagar, New Delhi-110060 &nbsp;|&nbsp; reachout.sgrh@gmail.com  &nbsp;|&nbsp;  www.reachoutsgrh.in<br/>"
            "Helpline: (011) 42251111, 42253333 &nbsp;|&nbsp; 7290058768"
            "</font></para>", styles["Normal"]))
        doc.build(story)

    buf = _pdf_bytes(build)
    await audit(user, "export", "receipt", bill_id, notes=f"v2 idx={payment_idx}")
    return StreamingResponse(buf, media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="receipt-{rcpt_no}.pdf"'})

# ── NEW: Total Services Invoice (final patient bill) ─────────────────────
@api.get("/pdf/invoice/{patient_id}")
async def pdf_total_invoice(patient_id: int, user=Depends(current_user)):
    """Aggregates ALL bills for a patient into one itemized invoice."""
    p = await db.patients.find_one({"id": patient_id}, {"_id":0})
    if not p: raise HTTPException(404, "Patient not found")
    bills = await db.bills.find({"patient_id": patient_id}, {"_id":0}).sort([("created_at",1)]).to_list(500)
    refunds = await db.refunds.find({"patient_id": patient_id, "status": "Approved"}, {"_id":0}).to_list(200)
    
    # Aggregate line items across bills
    all_lines = []
    grand_subtotal = 0.0
    grand_paid = 0.0
    for b in bills:
        lines = b.get("line_items") or []
        if lines:
            for li in lines:
                all_lines.append({
                    "date": (b.get("created_at") or "")[:10],
                    "code": li.get("code",""),
                    "name": li.get("service_name") or li.get("name") or b.get("service_type",""),
                    "qty": float(li.get("qty",1)),
                    "rate": float(li.get("rate",0)),
                    "amount": float(li.get("subtotal", float(li.get("qty",1)) * float(li.get("rate",0)))),
                    "rate_type": li.get("rate_type","standard"),
                })
        else:
            # Fall-back single-line legacy bill
            amt = float(b.get("total_amount") or 0)
            all_lines.append({"date":(b.get("created_at") or "")[:10], "code":"", "name": b.get("service_type") or b.get("service_description","Service"),
                              "qty":1, "rate":amt, "amount":amt, "rate_type":"standard"})
        grand_subtotal += float(b.get("total_amount") or 0)
        grand_paid += float(b.get("paid_amount") or 0)
    grand_refund = sum(float(r.get("net_refund_amount") or r.get("amount") or 0) for r in refunds)
    net_due = grand_subtotal - grand_paid + grand_refund  # +refund = paid less, due more  // refunds are already deducted from paid

    def build(doc, styles, k):
        story = _brand_header(k["P"], styles)
        story.append(k["S"](1, 4*k["mm"]))
        story.append(k["P"]("<para align='center'><font size=16 color='#1E3A8A'><b>TOTAL SERVICES INVOICE</b></font></para>", styles["Normal"]))
        story.append(k["S"](1, 3*k["mm"]))
        story.append(k["P"](f"<para align='center'><font size=8 color='#6B7280'>Invoice No: RO-INV-{patient_id:05d}-{datetime.now(timezone.utc).strftime('%Y%m%d')}  •  Generated: {now_iso()[:19]}</font></para>", styles["Normal"]))
        story.append(k["S"](1, 5*k["mm"]))
        # Patient details
        rows = [
            ["Patient Name", p.get("name",""), "Reg No.", p.get("reg_number","")],
            ["Age / Gender", f"{p.get('age','—')} / {p.get('gender','—')}", "Mobile", p.get("mobile","")],
            ["Address", p.get("address","—"), "Diagnosis", p.get("diagnosis","—")],
        ]
        t = k["T"](rows, colWidths=[30*k["mm"], 60*k["mm"], 25*k["mm"], 55*k["mm"]])
        t.setStyle(k["TS"]([("FONTSIZE",(0,0),(-1,-1),9),("GRID",(0,0),(-1,-1),0.3,k["colors"].grey),
            ("BACKGROUND",(0,0),(0,-1),k["colors"].HexColor("#EEF2FF")),
            ("BACKGROUND",(2,0),(2,-1),k["colors"].HexColor("#EEF2FF")),
            ("FONTNAME",(0,0),(0,-1),"Helvetica-Bold"),("FONTNAME",(2,0),(2,-1),"Helvetica-Bold")]))
        story.append(t); story.append(k["S"](1, 6*k["mm"]))

        # Itemized table
        header = ["Date","Code","Service","Qty","Rate (₹)","Amount (₹)"]
        data = [header]
        for li in all_lines:
            data.append([li["date"], li["code"], li["name"], f"{li['qty']:g}",
                         f"{li['rate']:,.0f}", f"{li['amount']:,.0f}"])
        # Totals
        data.append(["","","",""," ",""])
        data.append(["","","","","Subtotal", f"₹ {grand_subtotal:,.0f}"])
        data.append(["","","","","Paid",     f"₹ {grand_paid:,.0f}"])
        if grand_refund:
            data.append(["","","","","Refunded", f"₹ {grand_refund:,.0f}"])
        data.append(["","","","","Net Due",  f"₹ {max(0, net_due):,.0f}"])

        col_w = [20*k["mm"], 22*k["mm"], 70*k["mm"], 12*k["mm"], 25*k["mm"], 25*k["mm"]]
        t2 = k["T"](data, colWidths=col_w)
        t2.setStyle(k["TS"]([
            ("FONTSIZE",(0,0),(-1,-1),8.5),
            ("GRID",(0,0),(-1,-2),0.25,k["colors"].grey),
            ("BACKGROUND",(0,0),(-1,0),k["colors"].HexColor("#1E3A8A")),
            ("TEXTCOLOR",(0,0),(-1,0),k["colors"].white),
            ("FONTNAME",(0,0),(-1,0),"Helvetica-Bold"),
            ("ALIGN",(3,1),(5,-1),"RIGHT"),
            ("FONTNAME",(4,-4),(5,-1),"Helvetica-Bold"),
            ("BACKGROUND",(4,-4),(5,-1),k["colors"].HexColor("#F3F4F6")),
            ("LINEABOVE",(0,-4),(-1,-4),0.6,k["colors"].black),
            ("FONTSIZE",(4,-1),(5,-1),10),
            ("TEXTCOLOR",(4,-1),(5,-1),k["colors"].HexColor("#1E3A8A")),
        ]))
        story.append(t2); story.append(k["S"](1, 6*k["mm"]))

        # Payment summary
        story.append(k["P"](f"<para><font size=10><b>Amount in words:</b> {_num_to_words_inr(grand_paid)}</font></para>", styles["Normal"]))
        story.append(k["S"](1, 8*k["mm"]))

        # Signatures
        sig = k["T"]([
            ["Prepared By","Verified By","Authorised Signatory"],
            ["________________","________________","________________"],
            [f"{user.get('full_name','')}","",""],
        ], colWidths=[55*k["mm"], 55*k["mm"], 60*k["mm"]])
        sig.setStyle(k["TS"]([("FONTSIZE",(0,0),(-1,-1),9),("ALIGN",(0,0),(-1,-1),"CENTER"),
            ("FONTNAME",(0,0),(-1,0),"Helvetica-Bold"),("TOPPADDING",(0,1),(-1,1),12)]))
        story.append(sig)
        story.append(k["S"](1, 6*k["mm"]))
        story.append(k["P"]("<para align='center'><font size=7 color='#6B7280'>"
            "Sir Ganga Ram Hospital, Rajender Nagar, New Delhi-110060  •  reachout.sgrh@gmail.com  •  www.reachoutsgrh.in"
            "</font></para>", styles["Normal"]))
        doc.build(story)

    buf = _pdf_bytes(build)
    await audit(user, "export", "invoice", patient_id, notes="total")
    return StreamingResponse(buf, media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="invoice-{p.get("reg_number","PAT")}-{patient_id}.pdf"'})

# ── NEW: Refund Details PDF — exact REACH OUT format ─────────────────────
@api.get("/pdf/refund-details/{refund_id}")
async def pdf_refund_details(refund_id: int, user=Depends(current_user)):
    r = await db.refunds.find_one({"id": refund_id}, {"_id":0})
    if not r: raise HTTPException(404, "Refund not found")
    p = await db.patients.find_one({"id": r.get("patient_id")}, {"_id":0}) or {}
    bill = await db.bills.find_one({"id": r.get("receipt_id")}, {"_id":0}) or {}

    package_rate = float(r.get("package_rate") or r.get("charges_per_unit") or 0)
    standard_rate = float(r.get("standard_rate") or package_rate * 1.1)
    shifts_booked = int(r.get("total_shifts_booked") or 0)
    shifts_availed = int(r.get("num_shifts_availed") or 0)
    total_charged = float(r.get("total_charged") or (shifts_booked * package_rate))
    amount_deducted = float(r.get("amount_deducted") or (shifts_availed * standard_rate))
    balanced = total_charged - amount_deducted
    admin_pct = float(r.get("admin_deduction_pct") or 10)
    admin_amount = balanced * admin_pct / 100
    net_refund = balanced - admin_amount

    def build(doc, styles, k):
        story = _brand_header(k["P"], styles)
        story.append(k["S"](1, 4*k["mm"]))
        story.append(k["P"]("<para align='center'><font size=15 color='#1E3A8A'><b>REACH OUT REFUND DETAILS</b></font></para>", styles["Normal"]))
        story.append(k["S"](1, 2*k["mm"]))
        story.append(k["P"](f"<para align='right'><font size=10><b>DATE:</b> {(r.get('initiated_at') or now_iso())[:10]}</font></para>", styles["Normal"]))
        story.append(k["S"](1, 4*k["mm"]))

        last_receipt = bill.get("receipt_number") or r.get("last_payment_receipt","")
        last_service = r.get("last_service_date") or bill.get("service_to") or "—"

        rows = [
            ["Patient Name", p.get("name", r.get("patient_name",""))],
            ["Registration Number", p.get("reg_number","")],
            ["Service Availed", r.get("service_name") or bill.get("service_type","")],
            ["Charges/shift & PPE cost", f"₹ {package_rate:,.0f}/- Per {r.get('unit','shift')}"],
            ["Last service given on", last_service],
            ["Last Payment with Receipt Number", f"₹ {total_charged:,.0f}/- ({last_receipt})"],
            ["Total shift charged for", f"{shifts_booked} {r.get('unit','shifts')} ({shifts_booked} × ₹{package_rate:,.0f} = ₹{total_charged:,.0f})"],
            ["Number of services availed", str(shifts_availed)],
            ["Amount Deducted for availed service", f"{shifts_availed} × ₹{standard_rate:,.0f} = ₹{amount_deducted:,.0f}"],
            ["Balanced Amount", f"₹ {total_charged:,.0f} − ₹ {amount_deducted:,.0f} = ₹ {balanced:,.0f}/-"],
            ["Amount to be refunded (before admin charges)", f"₹ {balanced:,.0f}/-"],
            ["Admin Deduction", f"{admin_pct:g}% of ₹{balanced:,.0f} = ₹ {admin_amount:,.0f}/-"],
            ["NET REFUND AMOUNT", f"₹ {net_refund:,.0f}/-"],
            ["Refund from (Account Name)", r.get("refund_account_name") or "RO Account"],
            ["Refund from (Account Number)", r.get("refund_account_number","91112010078080")],
            ["Special Notes", r.get("reason") or f"{admin_pct:g}% deducted from the refund amount as administrative charges."],
        ]
        t = k["T"](rows, colWidths=[70*k["mm"], 100*k["mm"]])
        t.setStyle(k["TS"]([
            ("FONTSIZE",(0,0),(-1,-1),9.5),
            ("GRID",(0,0),(-1,-1),0.3,k["colors"].grey),
            ("BACKGROUND",(0,0),(0,-1),k["colors"].HexColor("#EEF2FF")),
            ("FONTNAME",(0,0),(0,-1),"Helvetica-Bold"),
            ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
            ("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5),
            # Highlight Net Refund row
            ("BACKGROUND",(0,12),(1,12),k["colors"].HexColor("#1E3A8A")),
            ("TEXTCOLOR",(0,12),(1,12),k["colors"].white),
            ("FONTSIZE",(0,12),(1,12),11),
            ("FONTNAME",(0,12),(1,12),"Helvetica-Bold"),
        ]))
        story.append(t)
        story.append(k["S"](1, 10*k["mm"]))

        # Signatures
        sig = k["T"]([
            ["Prepared by", "Verified by", "Approved by"],
            ["________________","________________","________________"],
            [r.get("initiator",""), r.get("verifier","__________"), r.get("approver","__________")],
        ], colWidths=[55*k["mm"], 55*k["mm"], 60*k["mm"]])
        sig.setStyle(k["TS"]([("FONTSIZE",(0,0),(-1,-1),9),("ALIGN",(0,0),(-1,-1),"CENTER"),
            ("FONTNAME",(0,0),(-1,0),"Helvetica-Bold"),("TOPPADDING",(0,1),(-1,1),12)]))
        story.append(sig)
        story.append(k["S"](1, 8*k["mm"]))

        story.append(k["P"]("<para><font size=9 color='#6B7280'><i>Required documents: Refund letter from the patient or family, ID proof &amp; account details.</i></font></para>", styles["Normal"]))
        story.append(k["S"](1, 4*k["mm"]))
        story.append(k["P"]("<para align='center'><font size=7 color='#6B7280'>"
            "Reach Out, an initiative of Sir Ganga Ram Trust Society  •  Care At Your Doorstep"
            "</font></para>", styles["Normal"]))
        doc.build(story)

    buf = _pdf_bytes(build)
    await audit(user, "export", "refund", refund_id, notes="details")
    return StreamingResponse(buf, media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="refund-RO-RFD-{refund_id:04d}.pdf"'})

# ── Helper for refunds: compute refund from a bill (used by frontend preview) ──
@api.get("/refunds/preview/{bill_id}")
async def refund_preview(bill_id: int, shifts_availed: int = 0, admin_pct: float = 10, user=Depends(current_user)):
    """Returns a preview of the refund calculation using package vs standard rate."""
    b = await db.bills.find_one({"id": bill_id}, {"_id":0})
    if not b: raise HTTPException(404, "Bill not found")
    lines = b.get("line_items") or []
    if not lines:
        return {"error": "Bill has no service line items"}
    # Use first line as the dominant service (most refunds are single-service packages)
    li = lines[0]
    svc = await db.services.find_one({"id": li.get("service_id")}, {"_id":0}) or {}
    package_rate = float(li.get("rate") or svc.get("package_rate") or 0)
    standard_rate = float(svc.get("standard_rate") or package_rate * 1.1)
    shifts_booked = int(li.get("qty",1))
    total_charged = package_rate * shifts_booked
    amount_deducted = standard_rate * max(0, min(shifts_availed, shifts_booked))
    balanced = max(0, total_charged - amount_deducted)
    admin_amount = balanced * admin_pct / 100
    net_refund = balanced - admin_amount
    return {
        "service_id": svc.get("id"), "service_name": svc.get("name") or li.get("service_name",""),
        "unit": svc.get("unit","shift"),
        "package_rate": package_rate, "standard_rate": standard_rate,
        "total_shifts_booked": shifts_booked, "num_shifts_availed": shifts_availed,
        "total_charged": total_charged, "amount_deducted": amount_deducted,
        "balanced_amount": balanced, "admin_deduction_pct": admin_pct,
        "admin_deduction_amount": admin_amount, "net_refund_amount": net_refund,
        "last_payment_receipt": b.get("receipt_number",""),
    }

# ── Mount static & API ─────────────────────────────────────────────────────
app.include_router(api)
app.mount("/api/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

app.add_middleware(CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS","*").split(","),
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

@app.on_event("shutdown")
async def shutdown(): client.close()
