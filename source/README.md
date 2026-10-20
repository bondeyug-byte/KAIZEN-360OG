# Campus360 source

- `app/` — the React + Vite app. `cd app && npm install && npm test && npm run build:single`, then copy
  `app/dist-single/index.html` to the repo root as `index.html` and add
  `<script src="/reviews-sync.js"></script>` right after `<head>` (keeps the review sync script).
- `server-tests/` — tests for `api/app.js` against an in-memory Postgres. `cd server-tests && npm install && npm test`.
- This folder is excluded from Vercel deployments by `.vercelignore`.

## Server settings (Vercel → Settings → Environment Variables)
| Name | Purpose |
|---|---|
| `MINIMOTH_API_KEY` | Phone OTP sign-in (server only) |
| `DATABASE_URL` | Neon Postgres connection (server only) |
| `TEACHER_PHONES` | Teacher numbers: `9876543210=Name|D2A:Subject,D1EC:Subject;...` |
| `ADMIN_PHONES` | HOD/admin numbers, comma-separated |
| `GEMINI_API_KEY` | AI assistant (optional) |

## Database
Tables are created automatically on the first API call (`api/_migrations.js`, tracked in `schema_migrations`).
Migrations only add tables; existing tables (`users`, `rides`, `kaizen_reviews`) are not touched.
