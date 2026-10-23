# Browser end-to-end check (audit 2026-10)

`local-server.cjs` runs the real `api/` handlers on a local port with Postgres replaced by PGlite and the
MiniMoth OTP service stubbed (any 6-digit code signs in). It also sends the headers from `vercel.json`.
`audit-e2e.mjs` then drives real browsers through: teacher records attendance → student Attendance page,
Overview and College portal show the same numbers; a correction and the HOD requirement; cross-student
access refused; a full division change (request, pending, wrong teacher refused, target teacher approves,
re-login); and no Content Security Policy violations. Synthetic numbers (91000xxxxx) only.

    cd source/app && npx vite build --mode single
    cd ../qa && npm i @electric-sql/pglite@0.2.17 @neondatabase/serverless@0.10.4 playwright
    PORT=4320 node local-server.cjs ../app/dist-single/index.html &
    CHROME_PATH=/path/to/chrome node audit-e2e.mjs
