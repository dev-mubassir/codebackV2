-- Additive migration: comprehensive AI usage tracking log (ai_usage_logs).
-- Metadata ONLY: never stores DM text or prompts.
--
-- REVERSE (manual):
--   DROP TABLE "ai_usage_logs";

-- CreateTable
CREATE TABLE "ai_usage_logs" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" TEXT,
    "tenant_id" TEXT,
    "feature" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "attempt_no" INTEGER NOT NULL DEFAULT 1,
    "is_fallback" BOOLEAN NOT NULL DEFAULT false,
    "fallback_reason" TEXT,
    "status" TEXT NOT NULL,
    "http_status" INTEGER,
    "latency_ms" INTEGER NOT NULL,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "reasoning_tokens" INTEGER,
    "cached_tokens" INTEGER,
    "total_tokens" INTEGER,
    "estimated_cost_usd" DOUBLE PRECISION,
    "provider_request_id" TEXT,
    "error_message" TEXT,
    "conversation_id" TEXT,
    "message_id" TEXT,

    CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_usage_logs_created_at_idx" ON "ai_usage_logs"("created_at");

-- CreateIndex
CREATE INDEX "ai_usage_logs_user_id_idx" ON "ai_usage_logs"("user_id");

-- CreateIndex
CREATE INDEX "ai_usage_logs_provider_idx" ON "ai_usage_logs"("provider");

-- CreateIndex
CREATE INDEX "ai_usage_logs_feature_idx" ON "ai_usage_logs"("feature");

-- CreateIndex
CREATE INDEX "ai_usage_logs_status_idx" ON "ai_usage_logs"("status");

