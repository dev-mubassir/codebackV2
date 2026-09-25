-- Admin rebuild, Gate 3: AI call logging, daily AI usage, job run history.
-- Additive only: three new tables, no change to any existing one.
--
-- REVERSE (manual):
--   DROP TABLE "ai_call_logs"; DROP TABLE "ai_usage_daily"; DROP TABLE "job_runs";

-- CreateTable
CREATE TABLE "ai_call_logs" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "job_type" TEXT NOT NULL,
    "tenant_id" TEXT,
    "latency_ms" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "error_code" TEXT,
    "http_status" INTEGER,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "estimated_cost" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_daily" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "job_type" TEXT NOT NULL,
    "calls" INTEGER NOT NULL,
    "failures" INTEGER NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "estimated_cost" DOUBLE PRECISION NOT NULL,
    "total_latency_ms" BIGINT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_usage_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" TEXT NOT NULL,
    "job_name" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "success" BOOLEAN,
    "error" TEXT,
    "details" JSONB,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_call_logs_created_at_idx" ON "ai_call_logs"("created_at");

-- CreateIndex
CREATE INDEX "ai_call_logs_tenant_id_created_at_idx" ON "ai_call_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_call_logs_provider_model_created_at_idx" ON "ai_call_logs"("provider", "model", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_usage_daily_day_provider_model_job_type_key" ON "ai_usage_daily"("day", "provider", "model", "job_type");

-- CreateIndex
CREATE INDEX "job_runs_job_name_started_at_idx" ON "job_runs"("job_name", "started_at");

-- CreateIndex
CREATE INDEX "job_runs_started_at_idx" ON "job_runs"("started_at");
