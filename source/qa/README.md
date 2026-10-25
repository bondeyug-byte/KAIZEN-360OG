# Browser end-to-end checks

`local-server.cjs` runs the real `api/` handlers on a local port with Postgres replaced by PGlite. Google's
Firebase token certificates are replaced by a locally generated test key, and `/__test/idtoken` (this test server
only) mints ID tokens "as Google would". The server still verifies every token with the real code in
`api/_firebase.js`. It also sends the headers from `vercel.json`.

The app is built with `--mode e2e`: like the college build (no demo sign-in), plus a hook that lets the test press
"Continue with Google" without Google's popup. That hook is compiled out of every other build.

- `google-e2e.mjs`: the Google sign-in rules: @ves.ac.in only for Student/Teacher/HOD (Gmail, other domains,
  look-alikes, sub-domains and unverified emails refused), roles from the server, URL and API boundaries, refresh,
  sign-out, parents with any Google account after the class teacher confirms, CR workflow, broken-config message.
- `audit-e2e.mjs`: attendance single source and the division-change workflow.

Synthetic accounts only.

    cd source/app && npx vite build --mode e2e
    cd ../qa && npm i @electric-sql/pglite@0.2.17 @neondatabase/serverless@0.10.4 playwright
    PORT=4340 node local-server.cjs ../app/dist-e2e/index.html &
    E2E_UNSET=1 PORT=4341 node local-server.cjs ../app/dist-e2e/index.html &   # broken-config check
    CHROME_PATH=/path/to/chrome BAD_BASE=http://localhost:4341/ node google-e2e.mjs
    CHROME_PATH=/path/to/chrome node audit-e2e.mjs

A real Google account signing in through Google's own popup can only be tested on a deployed site whose domain is
in Firebase's authorised domains. See docs/GOOGLE-SIGN-IN.md.
