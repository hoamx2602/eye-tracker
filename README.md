<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Precision Eye Tracker

Web-based eye tracking (MediaPipe Face Mesh, calibration, TPS/hybrid regression). Deployable on Vercel with API + PostgreSQL.

## Run locally

**Prerequisites:** Node.js 18+

1. Install dependencies: `npm install`
2. (Optional) Set `GEMINI_API_KEY` in `.env.local` if you use Gemini features.
3. **API + DB:** Copy `.env.example` to `.env` and set `DATABASE_URL` (PostgreSQL, e.g. Neon or Supabase pooled connection).
4. Run migrations (first time or after schema change): `npm run db:migrate:dev` (or `npm run db:migrate` for production).
5. Run app: `npm run dev`

## API

- **Base URL:** Same origin `/api` (or set `VITE_API_URL` for a different host).
- **Endpoints:**
  - `GET /api/sessions` — list sessions (query: `limit`, `cursor`).
  - `POST /api/sessions` — create session (body: `config`, `validationErrors`, `meanErrorPx`, `status`).
  - `GET /api/sessions/:id` — get one session.

The frontend calls the API when calibration completes (saves config + validation errors).

## Database & migrations

- **ORM:** Prisma. Schema: `prisma/schema.prisma`.
- **Migrations:** Stored in `prisma/migrations/`. To apply on a new server or another DB:
  1. Set `DATABASE_URL` in the environment.
  2. Run `npm run db:migrate` (or `npx prisma migrate deploy`).

Use a **pooled** connection string for serverless (Neon/Supabase) to avoid connection limits.

## Deploy (Vercel)

1. Connect the repo to Vercel.
2. Add env var: `DATABASE_URL` (PostgreSQL, pooled).
3. Build runs `prisma generate && vite build`; API is under `api/` (Node 20).

No need to run migrations on Vercel at deploy time if you run them in CI or once per DB (e.g. `npm run db:migrate` in a GitHub Action or after creating a new DB).
