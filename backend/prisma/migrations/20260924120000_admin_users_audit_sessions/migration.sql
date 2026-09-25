-- Super-admin rebuild, Gate 1: a separate admin identity, its audit trail,
-- and its own session store.
--
--   admin_users        the only admin identity (see schema.prisma AdminUser).
--                      Created by scripts/create-admin.js, never over HTTP.
--   admin_audit_logs   every admin login attempt and every admin mutation.
--                      admin_id SET NULL on delete: removing an admin must not
--                      erase what that admin did.
--   admin_sessions     connect-pg-simple's default shape, separate from
--                      user_sessions so customer-session cleanup can never
--                      reach an admin session and vice versa.
--
-- Additive only. The old admin_logs table and every existing users row
-- (including any role = 'ADMIN' row) are left untouched; what to do with
-- those is a separate, owner-approved migration.
--
-- Deliberately does NOT include the subscriptions_legacy_20260914 drop that
-- `prisma migrate diff` also reports — that one lives in
-- prisma/pending-approval/ and is still awaiting approval.
--
-- REVERSE (manual):
--   DROP TABLE "admin_audit_logs";
--   DROP TABLE "admin_sessions";
--   DROP TABLE "admin_users";

CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "last_login_ip" TEXT,
    "password_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_audit_logs" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_sessions" (
    "sid" VARCHAR NOT NULL,
    "sess" JSON NOT NULL,
    "expire" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("sid")
);

CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

CREATE INDEX "admin_audit_logs_created_at_idx" ON "admin_audit_logs"("created_at");

CREATE INDEX "admin_audit_logs_admin_id_created_at_idx" ON "admin_audit_logs"("admin_id", "created_at");

CREATE INDEX "admin_audit_logs_action_created_at_idx" ON "admin_audit_logs"("action", "created_at");

CREATE INDEX "IDX_admin_session_expire" ON "admin_sessions"("expire");

ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
