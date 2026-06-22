"""
Reach Out HOMS — Wallet Migration Script
========================================

Standalone, idempotent migration that:
  1. Reads all patients from the `patients` collection.
  2. For every patient missing a `patient_wallets` doc, creates one with
       balance = 0, total_credits = 0, total_debits = 0, total_refunds = 0
  3. Preserves all existing wallet records and balances.
  4. Prints a migration report.

Run on Render (or anywhere the production DB is reachable):

    cd /app/backend && python migrate_wallets.py

Environment variables required (already present in backend/.env):
    MONGO_URL  — MongoDB connection string
    DB_NAME    — target database name
"""
import asyncio
import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def next_id(db, col: str) -> int:
    res = await db.counters.find_one_and_update(
        {"_id": col}, {"$inc": {"seq": 1}}, upsert=True, return_document=True
    )
    return res["seq"]


async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    print("=" * 70)
    print("Reach Out HOMS — Wallet Migration")
    print("=" * 70)
    print(f"MongoDB : {MONGO_URL}")
    print(f"Database: {DB_NAME}")
    print()

    # Snapshot BEFORE
    before_patients = await db.patients.count_documents({})
    before_active_patients = await db.patients.count_documents({"status": "Active"})
    before_wallets = await db.patient_wallets.count_documents({})
    before_tx = await db.wallet_transactions.count_documents({})
    before_refunds = await db.wallet_refund_requests.count_documents({})

    print("BEFORE")
    print(f"  patients (total)         : {before_patients}")
    print(f"  patients (Active)        : {before_active_patients}")
    print(f"  patient_wallets          : {before_wallets}")
    print(f"  wallet_transactions      : {before_tx}")
    print(f"  wallet_refund_requests   : {before_refunds}")
    print()

    # Index patients already having wallets
    existing_pids = set()
    async for w in db.patient_wallets.find({}, {"patient_id": 1, "_id": 0}):
        existing_pids.add(w.get("patient_id"))

    # Iterate patients and create missing wallet records
    created = 0
    skipped = 0
    errors = 0
    created_ids = []
    async for p in db.patients.find({}, {"id": 1, "name": 1, "reg_number": 1, "_id": 0}):
        pid = p.get("id")
        if pid is None:
            errors += 1
            continue
        if pid in existing_pids:
            skipped += 1
            continue
        try:
            await db.patient_wallets.insert_one({
                "id": await next_id(db, "patient_wallets"),
                "patient_id": pid,
                "current_balance": 0.0,
                "total_credited":  0.0,
                "total_debited":   0.0,
                "total_refunded":  0.0,
                "created_at": now_iso(),
                "updated_at": now_iso(),
            })
            created += 1
            created_ids.append((pid, p.get("reg_number"), p.get("name")))
        except Exception as e:
            errors += 1
            print(f"  ! failed for patient_id={pid}: {e}")

    # Snapshot AFTER
    after_wallets = await db.patient_wallets.count_documents({})

    print("MIGRATION REPORT")
    print(f"  wallets created          : {created}")
    print(f"  wallets already existed  : {skipped}")
    print(f"  errors                   : {errors}")
    print()
    if created_ids:
        print("CREATED WALLETS")
        for pid, reg, name in created_ids:
            print(f"  - patient_id={pid:<5} reg={reg or '-':<14} name={name or '-'}")
        print()

    print("AFTER")
    print(f"  patient_wallets          : {after_wallets}")
    print()
    print("Done.")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
