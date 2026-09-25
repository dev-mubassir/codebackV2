# Siffty super-admin panel

> Gate 1 version. Gate 8 extends this with AI provider keys, the uptime
> monitor, and the privacy-policy reminder.

The admin panel lives at `/admin` on the app domain. Its API is `/api/admin/*`
on the API domain. Admins are **not** Siffty customers: they are rows in the
`admin_users` table, created only by the owner-run scripts below. No HTTP route
creates an admin, there is no signup, and Google sign-in never grants admin.

## How admin sign-in works

- Sign in with email and password only.
- **Lockout:** 5 wrong passwords lock the account for 15 minutes. Wrong
  passwords typed into the step-up dialog count toward the same 5. A lockout
  also signs out every session of that admin.
- **Rate limit:** a separate limit of 10 attempts per 15 minutes per IP.
- **No enumeration:** every failure (unknown email, wrong password, locked)
  gives the same answer.
- **Alert emails:** every successful sign-in, and every lockout, emails the
  admin's own address with the time, IP and browser. These alerts have their
  own quota of 10 per day, separate from customer mail.
- **Separate session:**
  - The cookie is `siffty.admin.sid`: HttpOnly, Secure in production,
    SameSite=Strict, Path=`/api/admin`.
  - It is stored in its own table (`admin_sessions`).
  - It ends after **30 minutes without activity**, or **8 hours after sign-in**,
    whichever comes first.
  - Activity means a real click, keystroke or page change in the panel.
    Background refreshes do not count.
- **Step-up:** CSV exports, clearing delivery logs and issuing refunds ask for
  your password again. It stays confirmed for 5 minutes.
- **Reasons:** every action that changes a customer asks for a written reason.
  The reason goes into the audit log (`admin_audit_logs`), which records every
  sign-in attempt and every change.
- **Not an admin:** anyone who isn't a signed-in admin, including a signed-in
  customer, gets a plain `404` from every admin API route.

## Create the first admin (production)

You run this yourself, **interactively**, in a shell on the running production
backend. This is the same Northflank **service shell** the deployment runbook
uses for `prisma migrate deploy` (see `docs/DEPLOYMENT-RUNBOOK.md`, Phase 4).
`DATABASE_URL` is already set in that shell's environment. The script reads it
and **never prints it**; any error text is scrubbed of connection strings.

1. Deploy the code, then apply the migration in the service shell:
   ```bash
   ./node_modules/.bin/prisma migrate deploy
   ```
   The backend refuses to start until
   `20260924120000_admin_users_audit_sessions` is applied (the migration
   guard). That is expected.
2. In the same shell:
   ```bash
   node scripts/create-admin.js
   ```
3. Type the admin email. The password is asked twice, **hidden**, and must be
   at least 16 characters. Nothing is echoed or saved to shell history.
4. Sign in at `https://app.siffty.com/admin/login`.

The script needs a real terminal, because the password is read with echo off.
Do **not** run it as a Northflank job or with the password in an environment
variable or command argument. Both would leave the password readable in the
dashboard, the job logs or the process list.

Locally it is the same command from `backend/`, and it uses `backend/.env`.

## Reset a lost admin password

Also owner-run, in the same service shell:

```bash
node scripts/reset-admin-password.js
```

It asks for the email and a new password (hidden, twice, at least 16
characters). It also clears any lockout and **signs out every session of that
admin**.

## Change your own password

Go to Admin → Settings → "Change your password". It needs your current
password. The session you use stays signed in; every other session of your
admin account is signed out.

## Environment variables

The admin panel needs **no** environment variables of its own. The admin
cookie's signing key is derived from `SESSION_SECRET`, so rotating
`SESSION_SECRET` also signs admins out.

These old variables are **no longer read**. Delete them from Northflank; the
server logs a warning at boot while any of them is still set:

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `ADMIN_PASSWORD_HASH`
- `ADMIN_EMAILS`

## Legacy admin rows in `users`

The old panel could make a *customer* row an admin (`users.role = 'ADMIN'`),
and it created a fake `admin@codeback.internal` customer. Those rows grant
nothing now. To see them, as ids and emails only (read-only):

```bash
node scripts/list-legacy-admin-users.js
```

The cleanup migration waits for approval in
`backend/prisma/pending-approval/20260924130000_retire_legacy_admin_users/`.
It copies their old audit history into `admin_audit_logs`, demotes them to
`USER`, and suspends the fake row. It deletes nothing.
