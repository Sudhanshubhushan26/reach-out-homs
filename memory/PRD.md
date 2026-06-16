# Reach Out Healthcare Operations Management System

## Problem
Full migration of existing Node.js/SQLite + React app to FastAPI + MongoDB + React, completing all 10 production-critical modules described in the requirements doc.

## Architecture
- Backend: FastAPI + Motor (async MongoDB) + JWT auth + bcrypt
- Frontend: React 19 (preserved from existing App.jsx, only API URL switched to env)
- Storage: MongoDB collections (staff, patients, bookings, bills, refunds, etc.)
- Uploads: filesystem under /app/backend/uploads, served via /api/uploads

## Modules Delivered (all 10)
1. ✅ Staff Allocation Engine — `/api/staff/available`, `/api/roster/available-staff` (location, vendor, skill, duty, rating)
2. ✅ Roster Engine — weekly + monthly views, conflict detection, drag-and-drop (existing UI)
3. ✅ Medical Charts — vitals/BP/sugar/I-O/MAR/nursing/physio + trends per patient
4. ✅ Payroll — auto compute from attendance, monthly generation, payslip, vendor-wise
5. ✅ Booking Lifecycle — Lead → Patient → Booking → Bill → Reassignment → Feedback (30-day BookingID)
6. ✅ Notification Engine — in-app queue + hook stubs for WhatsApp/SMS
7. ✅ Compliance Engine — required docs per role, expiry alerts, AMC/CMC alerts, dashboard
8. ✅ Analytics — P&L, revenue trends, service demand, staff performance, ambulance stats
9. ✅ Reports — staff summary, patient summary, revenue summary (date filters, vendor filters)
10. ✅ Payment Integration — Razorpay placeholders (balance management, refund 3-tier workflow)

## What's Implemented
- 95+ FastAPI endpoints, all under `/api`
- 10 staff + 7 patients + 2 bookings + 2 ambulance calls + 5 leads seeded
- JWT auth with bcrypt-hashed admin user
- Full CRUD for staff/patients/leads/bookings/bills/refunds/assets/vendors/roster/charts
- Compliance engine computes required docs per role
- Payroll auto-generates from attendance
- File uploads for staff/patient documents and photos

## Test Credentials
admin / Admin@1234

## Backlog / Future
- P1: Real WhatsApp Cloud API + SMS gateway wiring (currently queue-only)
- P1: Real Razorpay key integration (currently placeholder workflow)
- P2: PDF payslip generation
- P2: Predictive analytics (AI add-on)
- P2: Mobile staff/patient apps
