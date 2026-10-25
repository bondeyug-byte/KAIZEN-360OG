# Google sign-in (Firebase Authentication): setup and rules

Campus360 signs people in with **Continue with Google** through Firebase Authentication. Phone OTP (MiniMoth) has
been removed from the code.

## Who can sign in where

| Portal | Google account | Plus |
|---|---|---|
| Student | exactly `…@ves.ac.in`, email verified by Google | a class is joined and approved separately (unchanged) |
| Teacher | exactly `…@ves.ac.in` | the HOD has added this account as a teacher (HOD portal → Teachers) |
| HOD | exactly `…@ves.ac.in` | listed in the `HOD_EMAILS` setting for a branch |
| Parent | any verified Google account (Gmail, Outlook, …) | the student added this email and their class teacher or HOD confirmed it |

- The server checks the domain with an exact match (`user@ves.ac.in.example.com`, `user@mail.ves.ac.in` and
  personal Gmail are refused for Student/Teacher/HOD). It reads the email from the verified Firebase ID token,
  never from a form or the browser.
- A college email never makes anyone a teacher or HOD by itself. Roles come from the database / `HOD_EMAILS`, and
  are looked up again on **every** API request (removing a teacher or a parent link takes effect immediately).
- Parents see only the student(s) confirmed for their account, read-only. Teachers and class reps see parent
  emails masked (`pa•••@gmail.com`). If a parent changes Google account, the student removes the old one and adds
  the new one, and the teacher confirms it again; access is never moved because a name or number matches.
- Sessions: an HttpOnly, Secure, SameSite=Strict cookie signed with `SESSION_SECRET`, valid 7 days. Signing out ends
  the session on every device. No Google or Firebase token is kept in the page.

## Firebase Console (needs the owner's Google account)

No Firebase project was found in this repository, so one has to be created (or the college's existing one used).

1. https://console.firebase.google.com → **Add project** (e.g. *Campus360*) or open the college's project.
   Google Analytics is not needed.
2. **Project settings → General → Your apps → Add app → Web (`</>`)**. Name it *Campus360 web*. Firebase Hosting is
   not needed (the site stays on Vercel). Copy `apiKey`, `authDomain`, `projectId`, `appId`.
3. **Build → Authentication → Get started → Sign-in method → Add new provider → Google → Enable**. Choose the
   project support email. Save.
4. **Authentication → Settings → Authorized domains → Add domain** for each address the site is opened from:
   - `kaizen-360og.vercel.app` (production)
   - the preview address you test on, e.g. `kaizen-360og-git-audit-2026-10-kaizen-99b7.vercel.app`
   - `localhost` is listed by default.

   Add exact host names only. A domain that isn't listed shows "This web address isn't on the app's list of
   allowed sign-in domains".

## Google Cloud Console (same project; Firebase created it)

5. https://console.cloud.google.com → select the Firebase project → **APIs & Services → OAuth consent screen**
   (Google Auth Platform → Branding / Audience):
   - App name *Campus360*, user support email, developer contact email.
   - **Audience: External.** "Internal" would only allow the college's Google Workspace, which would lock out
     parents using Gmail.
   - Scopes: only the defaults Firebase uses (`openid`, `email`, `profile`). Do not add Gmail, Drive or other
     scopes. Campus360 asks for nothing else.
   - While the app is in **Testing**, only listed test users can sign in. Publish it (**In production**) for
     everyone. Check Google's current rules for consent-screen verification and branding before launch.
6. **APIs & Services → Credentials**: Firebase made an OAuth client *"Web client (auto created by Google Service)"*
   whose redirect URI is `https://<project-id>.firebaseapp.com/__/auth/handler`. Leave it as generated.
7. Optional hardening: on the **Browser key** (the `apiKey`), add *Website restrictions* for the domains above.

## Vercel settings (Project → Settings → Environment Variables), then redeploy

| Name | Value |
|---|---|
| `FIREBASE_PROJECT_ID` | from step 2 |
| `FIREBASE_WEB_API_KEY` | `apiKey` from step 2 (public by design) |
| `FIREBASE_AUTH_DOMAIN` | `authDomain` from step 2 (`<project-id>.firebaseapp.com`) |
| `FIREBASE_APP_ID` | `appId` from step 2 |
| `SESSION_SECRET` | **secret**: 32+ random characters (`openssl rand -base64 48`). Changing it signs everyone out. |
| `HOD_EMAILS` | `hod.cmpn@ves.ac.in=CMPN;hod.aids@ves.ac.in=AIDS` (real HOD accounts, one entry per branch) |
| `DATABASE_URL` | unchanged |

Remove the settings that no longer do anything: `MINIMOTH_API_KEY`, `MINIMOTH_REFRESH_MAX_AGE`, `HOD_PHONES`,
`TEACHER_PHONES`, `ADMIN_PHONES`. None of these settings may start with `VITE_`.

Check: `https://<site>/api/auth/health` should show `"configured": true` and `"missing": []`. If something is
missing, the sign-in page names the missing setting (never its value).

## Phones and Safari

Sign-in opens a Google popup. If the browser blocks popups, the page switches to a full-page redirect and finishes
when it comes back. Some browsers that partition third-party storage (recent Safari, Chrome with that setting) can
fail the redirect when `authDomain` is `firebaseapp.com`. If that happens, serve Firebase's handler from the site
itself: add a rewrite `{"source": "/__/auth/:path*", "destination": "https://<project-id>.firebaseapp.com/__/auth/:path*"}`
to `vercel.json`, set `FIREBASE_AUTH_DOMAIN` to `kaizen-360og.vercel.app`, and add
`https://kaizen-360og.vercel.app/__/auth/handler` to the OAuth client's redirect URIs (step 6).

## Existing accounts from phone sign-in

Nothing was deleted. Accounts, classes, attendance and marks created with phone sign-in stay in the database
(migration 6 only widened the identity column so it also accepts emails). A Google account is a **new** account:

- HODs: listed again in `HOD_EMAILS`.
- Teachers: the HOD adds them again with their `…@ves.ac.in` account and assigns divisions.
- Students: sign in with Google and request their class again; a teacher approves.
- Parents: the student adds the parent's Google email; the teacher confirms.

Old phone-account records are **not** merged into the new accounts automatically, because nothing proves that a
Google account and an old phone number belong to the same person. If the college needs old attendance moved, that
should be a separate HOD-run tool where the HOD confirms the match in person. It isn't built yet.
