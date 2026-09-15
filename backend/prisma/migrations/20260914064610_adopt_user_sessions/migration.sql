-- Adopts the session-store table connect-pg-simple already creates and
-- manages at RUNTIME (lib/session.js) into Prisma's migration history, so
-- `prisma migrate dev` stops proposing a destructive reset over
-- unexplained "drift" every time it runs (see schema.prisma's UserSession
-- model comment for the full rationale).
--
-- HOW TO APPLY THIS MIGRATION DEPENDS ON WHETHER THE TABLE ALREADY EXISTS:
--
--   - Local dev, and almost certainly production (see FINDINGS.md F11 /
--     the auth-hardening baseline — connect-pg-simple has been the
--     session store for a while): the table ALREADY EXISTS. A normal
--     `prisma migrate deploy` would fail here with "relation
--     \"user_sessions\" already exists". Adopt it instead with:
--       npx prisma migrate resolve --applied 20260914064610_adopt_user_sessions
--     which records this migration as done WITHOUT running the SQL below.
--
--   - A fresh database that has never run the app's session middleware
--     (a freshly created test DB): the table does NOT exist yet. A normal
--     `prisma migrate deploy` runs this SQL for real, which is correct —
--     it needs to be created somewhere, and this keeps it Prisma-tracked.
--
-- Column shape confirmed against the live local-dev table (`\d
-- user_sessions`) and matches connect-pg-simple's own default schema
-- exactly — "sess" is `json`, not `jsonb`.

-- CreateTable
CREATE TABLE "user_sessions" (
    "sid" VARCHAR NOT NULL,
    "sess" JSON NOT NULL,
    "expire" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("sid")
);

-- CreateIndex
CREATE INDEX "IDX_session_expire" ON "user_sessions"("expire");
