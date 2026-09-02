# Base44 Dev Environment — Reach Out HOMS

## Stack
- **Backend**: FastAPI + MongoDB (motor async driver), `backend/server.py`. All routes under `/api`.
- **Frontend**: React 19 (CRA + CRACO), TailwindCSS, Radix UI, `frontend/`. Dev server via `craco start` (webpack-dev-server).
- **Auth**: JWT bearer tokens (no cookies/sessions), so separate origins work fine.

## Running
- `docker compose -f docker-compose.base44.yml up -d`
- Frontend → host port 3000 (preview entry point). Backend → host port 8000.
- Frontend reaches backend via `REACT_APP_BACKEND_URL=https://8000-${BASE44_PUBLIC_HOST_SUFFIX}` (set in compose).
- MongoDB runs as a compose service; `MONGO_URL`/`DB_NAME` are local infra creds wired via compose `environment:`.

## Required env (all local — no external secrets)
- Backend: `MONGO_URL`, `DB_NAME` (required, no defaults in code). `JWT_SECRET` has a dev default. `CORS_ORIGINS` defaults to `*`.
- Frontend: `REACT_APP_BACKEND_URL` (baked at dev-server start). `HOST=0.0.0.0`, `DANGEROUSLY_DISABLE_HOST_CHECK=true` for external preview hostname. `CHOKIDAR_USEPOLLING`/`WATCHPACK_POLLING` for bind-mount hot reload.

## Default login
- `admin` / `Admin@1234` (Super Admin). Other seeded users: `manager`/`Manager@1234`, `supervisor`/`Super@1234`, `accountant`/`Account@1234`, `foe`/`Foe@1234`.

## Notes
- Backend seeds staff, patients, bookings, leads, vendors, assets, and wallets on startup (idempotent).
- No lockfiles exist; frontend uses `yarn install` (no `--frozen-lockfile`). `legacy-peer-deps=true` in `.npmrc`.
- `node_modules` lives in a named volume (`frontend_node_modules`) to avoid host bind conflicts.
- The bcrypt `__about__` warning in backend logs is harmless (passlib version probe); bcrypt hashing works.
- Backend healthcheck hits `/docs` (FastAPI default OpenAPI UI).
