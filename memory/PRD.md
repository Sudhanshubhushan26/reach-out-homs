# Reach Out Healthcare Operations Management System — PRD

## Problem
Migrate the existing Node.js/SQLite + React Reach Out app to FastAPI + MongoDB + React and complete all 10 production-critical modules described in the requirements doc.

## Architecture
- **Backend**: FastAPI + Motor (async MongoDB) + JWT auth + bcrypt + ReportLab + openpyxl
- **Frontend**: React 19 (existing App.jsx preserved, API URL switched to env)
- **Storage**: MongoDB collections, file uploads under /app/backend/uploads served via /api/uploads

## Modules Delivered (all 10)
1. ✅ Staff Allocation Engine — location/vendor/skill/duty/availability/rating-sorted
2. ✅ Roster Engine — weekly + monthly views, conflict detection, summary aggregation
3. ✅ Medical Charts — vitals/BP/sugar/I-O/MAR/nursing/physio + per-patient trends
4. ✅ Payroll Automation — auto-compute from attendance, vendor-wise, monthly generation, PDF payslips
5. ✅ Booking Lifecycle — Lead → Patient → Booking → Bill → Reassignment → Feedback (30-day Booking ID)
6. ✅ Notification Engine — in-app queue + hook stubs for WhatsApp/SMS
7. ✅ Compliance Engine — role-based required docs, expiry alerts, AMC/CMC alerts, dashboard
8. ✅ Analytics Engine — revenue trends, service demand, staff performance, ambulance stats, patient categories
9. ✅ Reports Engine — staff/patient/revenue summaries with date+vendor filters
10. ✅ Payment Integration — Razorpay placeholders + 3-tier refund workflow with identity/bank capture

## Phase 1 Polish (just completed)
- ✅ Multi-role users (admin / manager / supervisor / accountant / foe) with permission map
- ✅ Audit logs collection — every write action recorded with user, role, target, before/after
- ✅ PDF generation — receipts, payslips, reports (ReportLab, branded purple header)
- ✅ Excel + CSV export — staff, patients, bookings, bills, refunds, attendance, ambulance, leads, audit logs
- ✅ Weighted rating formula — 40/20/15/10/10/5 source weights (patient/family/punctuality/TAT/training/supervisor)
- ✅ Refund identity + bank capture — relative name, relation, govt ID, bank/UPI, ID proof + cancelled cheque upload, masked bank account after save

## What's Implemented (Backend Surface)
- 105+ FastAPI endpoints under `/api`
- 5 seeded users across 5 roles
- 10 staff + 7 patients + 2 bookings + 2 ambulance calls + 5 leads + 4 vendors + 3 assets
- JWT + bcrypt auth, RBAC via PERMS map, audit logging on user/refund/rating/export actions
- File uploads for staff/patient/refund documents
- PDF (receipt, payslip, report) + CSV/XLSX exports per major entity

## Test Credentials
See `test_credentials.md` for all 5 role accounts.

## Backlog / Future
### P0 — Need API keys from user
- Real WhatsApp Cloud API (currently queue stub)
- Real SMS gateway / Twilio (currently queue stub)
- Real Razorpay live keys + webhook
### P1 — Mobile + Tracking (6–8 weeks)
- Patient mobile app (React Native): consent e-sign, payments, feedback, doc uploads
- Staff mobile app: attendance with selfie+GPS, offline chart sync, training, incident reporting
- Geofencing per assignment + live GPS tracking
- Push notifications
### P2 — Deep features
- Stock issue + Lending tracking
- Longitudinal patient analytics (readmission, upgrade/downgrade, conversion)
- Auto-logout after 2hrs inactivity
- Document expiry escalation L1→L2→L3 (30/15/7 day reminders)
- Hospital GAB system integration
### P3 — Optional priced add-ons
- AI predictive analytics
- AI referral pattern analytics
