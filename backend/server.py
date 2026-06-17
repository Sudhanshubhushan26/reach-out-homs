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
async def audit(user, action: str, target_type: str, target_id=None, before=None, after=None, notes: str = ""):
    try:
        await db.audit_logs.insert_one({
            "id": await next_id("audit_logs"),
            "user_id": user.get("id"), "user_name": user.get("name"), "user_role": user.get("role"),
            "action": action, "target_type": target_type, "target_id": target_id,
            "before": before, "after": after, "notes": notes,
            "created_at": now_iso(),
        })
    except Exception as e:
        logger.warning(f"audit failed: {e}")

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
    logger.info("Reach Out HOMS backend started")

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
    bid = f"BK-{now.strftime('%Y%m%d')}-{random.randint(1000,9999)}"
    bid_int = await next_id("bookings")
    amount = float(d.get("amount") or 0); paid = float(d.get("paid_amount") or 0)
    doc = {"id": bid_int, "booking_id": bid, "status": d.get("status","Pending"),
           "amount": amount, "paid_amount": paid, "balance": amount - paid,
           "payment_status": d.get("payment_status","Pending"),
           "created_by": user.get("name","Admin"), "created_at": now_iso(),
           "expires_at": in_days(30), **{k:v for k,v in d.items() if k not in ("id","booking_id")}}
    await db.bookings.insert_one(doc)
    if paid > 0:
        p = await db.patients.find_one({"id": d.get("patient_id")})
        await db.bills.insert_one({"id": await next_id("bills"),
            "receipt_number": f"RO-RCP-{int(datetime.now().timestamp())}",
            "booking_id": bid, "patient_id": d.get("patient_id"),
            "patient_name": p.get("name") if p else "",
            "service": d.get("service_name"), "amount": amount,
            "paid_amount": paid, "balance": amount-paid,
            "payment_mode": d.get("payment_mode"),
            "payment_status": d.get("payment_status","Pending"),
            "date": today(), "refund_amount": 0})
    await db.notifications.insert_one({"id": await next_id("notifications"), "recipient_type":"patient",
        "recipient_id": d.get("patient_id"), "title":"Booking Confirmed",
        "message": f"Booking {bid} created for {d.get('service_name')}",
        "channel":"in-app", "status":"Pending", "created_at": now_iso()})
    return {"id": bid_int, "booking_id": bid, "message": "Booking Created"}

@api.put("/bookings/{bid}")
async def upd_booking(bid: int, d: Dict[str, Any], user=Depends(current_user)):
    d.pop("id", None); d.pop("_id", None)
    await db.bookings.update_one({"id": bid}, {"$set": d})
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

@api.post("/bills/{bid}/pay")
async def pay_bill(bid: int, body: Dict[str, Any], user=Depends(current_user)):
    b = await db.bills.find_one({"id": bid})
    if not b: raise HTTPException(404, "Not found")
    paid = float(b.get("paid_amount") or 0) + float(body.get("amount") or 0)
    bal = float(b.get("amount") or 0) - paid
    st = "Paid" if bal <= 0 else "Partial"
    await db.bills.update_one({"id": bid}, {"$set": {"paid_amount": paid, "balance": bal,
        "payment_status": st, "payment_mode": body.get("mode")}})
    return {"message": "Payment recorded"}

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
@api.get("/services")
async def services(user=Depends(current_user)):
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
    return await list_col("consents", q)

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
    return rows

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
    logo_path = ROOT_DIR.parent / "frontend" / "public" / "logo.svg"
    # ReportLab needs raster — use the embedded SVG fallback path
    return [
        P("<para align='center'><font size=18 color='#1E3A8A'><b>Reach Out</b></font><br/><font size=10 color='#DC2626'><b>An initiative of Sir Ganga Ram Trust Society</b></font><br/><font size=9 color='#1E40AF'><i>Care At Your Doorstep</i></font></para>", styles["Normal"]),
    ]

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

# ── Mount static & API ─────────────────────────────────────────────────────
app.include_router(api)
app.mount("/api/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

app.add_middleware(CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS","*").split(","),
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

@app.on_event("shutdown")
async def shutdown(): client.close()
