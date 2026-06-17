# Reach Out Healthcare Operations Management System — PRD

## Problem
Migrate from Node.js/SQLite to FastAPI + MongoDB + React and complete all production-critical features including mobile-ready Patient/Staff app endpoints, smart allocation, notifications, payroll, geofencing.

## Architecture
- Backend: FastAPI + Motor (async MongoDB) + JWT/bcrypt + ReportLab + openpyxl
- Frontend: React 19 (existing App.jsx preserved)
- Storage: MongoDB collections + filesystem uploads

## All Modules Delivered

### Phase 1 — Core (done)
1. ✅ Authentication & Multi-Role RBAC (5 roles: admin, manager, supervisor, accountant, foe)
2. ✅ Staff Management — profile, RO### code, documents, ratings (weighted), duty tags, vendor mapping
3. ✅ Patient Management — reg numbers, freeze/unfreeze (admin-only), categorization, documents
4. ✅ Leads & Service Booking — Lead→Booking→Bill→Reassignment with 30-day BookingID
5. ✅ Billing & Refunds — 3-tier refund (initiate→verify→approve), identity+bank capture, masked storage
6. ✅ Roster Engine — conflict detection, summary aggregation
7. ✅ Medical Charts — 6 types (vitals/BP/sugar/I-O/MAR/notes), trends, latest-vitals
8. ✅ Compliance Engine — role-based required docs, expiry alerts, AMC/CMC
9. ✅ Analytics — revenue, demand, performance, ambulance, categories
10. ✅ Reports — staff/patient/revenue summaries, date+vendor filters
11. ✅ Audit Logs — every write tracked with user/role/before/after
12. ✅ PDF/CSV/XLSX exports — receipts, payslips, reports, all major entities
13. ✅ Ambulance — call logging, ALS/BLS/transport, payment tracking
14. ✅ Assets — inventory, AMC/CMC dates, expiry alerts
15. ✅ Training + MCQ — question bank, scoring, rating contribution

### Phase 2 — Missing-feature build-out (just delivered)
16. ✅ **Notification Templates + Queue** — 7 seeded templates (booking/payment/expiry/refund/roster/OTP/feedback), `/api/notif-templates` CRUD, `/api/notifications/send` (template-driven), `/api/notifications/dispatch` (mock dispatcher across whatsapp/sms/email/in-app)
17. ✅ **OTP Service** — `/api/otp/send` + `/api/otp/verify` with 6-digit code, 5-min expiry, 5-attempt cap. Auto-detects patient vs staff by mobile and returns scoped JWT
18. ✅ **Auto Roster Allocation Engine** — `/api/roster/auto-allocate` with weighted scoring (40% rating, 25% availability, 20% vendor match, 10% role match, 5% location proximity) + optional commit
19. ✅ **Geofencing** — `/api/roster/{rid}/geofence` to set fence; `/api/attendance/login-geo` validates GPS via Haversine
20. ✅ **NPS Analytics** — `/api/analytics/nps` (promoter/passive/detractor) from feedback
21. ✅ **Predictive Analytics** — `/api/analytics/revenue-forecast` (linear regression, 1–12 month horizon) + `/api/analytics/staff-demand-forecast`
22. ✅ **Inventory + Equipment Lending** — `/api/inventory`, `/api/lendings` with stock decrement on lend, deposit/damage/refund on return
23. ✅ **Advanced Payroll Breakdown** — `/api/payroll/{staff_id}/details?month=...` with basic+HRA+conveyance+overtime / PF+ESI+PT+TDS+leave_deduction
24. ✅ **Incident Workflow** — `/api/incidents/{id}/assign-investigator`, `/findings`, `/close`
25. ✅ **Patient App** (mobile-ready) — `/api/patient-app/{me, my-bookings, my-bills, my-charts, request-service, feedback, consent}`
26. ✅ **Staff App** (mobile-ready) — `/api/staff-app/{me, my-roster, my-payslips, my-trainings, raise-incident, submit-chart}` + geofenced attendance

## Test Credentials
admin/Admin@1234 • manager/Manager@1234 • supervisor/Super@1234 • accountant/Account@1234 • foe/Foe@1234

Patient/Staff app login via OTP on registered mobile (e.g., 9811001001 = Nitin Gupta).

## Stats
- 130+ API endpoints under `/api`
- 25 MongoDB collections (users, staff, patients, bookings, bills, refunds, leads, ambulance, vendors, assets, roster, attendance, medical_charts, notifications, notif_templates, audit_logs, training, mcq_questions, mcq_results, payroll_records, consents, feedback, incidents, inventory_items, lendings, counters, freeze_log, ratings, documents)

## Pending (Future Sprints)
- **P0** — Real provider plug-ins: WhatsApp Cloud API (Meta), Twilio/MSG91 SMS, Razorpay live keys + webhook. All hook points are wired — only credentials + provider client wrappers needed.
- **P1** — Native mobile apps (React Native) — endpoints exist, UI to be built
- **P1** — Live GPS tracking during duty (websocket-based)
- **P2** — Hospital GAB system integration
- **P3** — AI predictive analytics add-on (separately priced)
