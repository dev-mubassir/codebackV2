-- Auto DM plan limits, usage and poller state (Gate 9B). ADDITIVE ONLY: four new
-- tables, their indexes, foreign keys FROM them (cascade), and one new index on
-- the Auto DM runs table (itself new in this release). No existing table is
-- altered and no row is written: the plan-limit defaults live in code
-- (features/autodm/limits.js) until an admin edits a plan. The enforcement
-- switch is a row in the existing app_settings table (key autodm_enforcement).

-- CreateTable
CREATE TABLE "autodm_plan_limits" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "max_automations" INTEGER NOT NULL,
    "monthly_dms" INTEGER NOT NULL,
    "display_unlimited" BOOLEAN NOT NULL DEFAULT false,
    "updated_by_admin_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "autodm_plan_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autodm_usage" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "plan_code" TEXT,
    "used" INTEGER NOT NULL DEFAULT 0,
    "warned_80_at" TIMESTAMP(3),
    "warned_100_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "autodm_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autodm_exemptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "granted_by_admin_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "autodm_exemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autodm_media_states" (
    "id" TEXT NOT NULL,
    "instagram_account_id" TEXT NOT NULL,
    "media_id" TEXT NOT NULL,
    "media_created_at" TIMESTAMP(3),
    "last_polled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "autodm_media_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "autodm_plan_limits_plan_id_key" ON "autodm_plan_limits"("plan_id");

-- CreateIndex
CREATE INDEX "autodm_usage_period_start_idx" ON "autodm_usage"("period_start");

-- CreateIndex
CREATE UNIQUE INDEX "autodm_usage_user_id_period_start_key" ON "autodm_usage"("user_id", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "autodm_exemptions_user_id_key" ON "autodm_exemptions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "autodm_media_states_instagram_account_id_media_id_key" ON "autodm_media_states"("instagram_account_id", "media_id");

-- CreateIndex
CREATE INDEX "autodm_runs_status_user_id_idx" ON "autodm_runs"("status", "user_id");

-- AddForeignKey
ALTER TABLE "autodm_plan_limits" ADD CONSTRAINT "autodm_plan_limits_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "billing_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autodm_usage" ADD CONSTRAINT "autodm_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autodm_exemptions" ADD CONSTRAINT "autodm_exemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autodm_media_states" ADD CONSTRAINT "autodm_media_states_instagram_account_id_fkey" FOREIGN KEY ("instagram_account_id") REFERENCES "instagram_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

