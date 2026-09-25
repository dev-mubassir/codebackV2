-- Admin rebuild, Gate 4: the admin-selected AI provider/model.
-- Additive. No row is seeded: with the table empty, the code default
-- (gemini / gemini-flash-lite-latest) applies — the pre-Gate-4 behaviour.
--
-- REVERSE (manual):
--   DROP TABLE "ai_config";

CREATE TABLE "ai_config" (
    "id" TEXT NOT NULL DEFAULT 'active',
    "active_provider" TEXT NOT NULL,
    "active_model" TEXT NOT NULL,
    "fallback_provider" TEXT,
    "fallback_model" TEXT,
    "fallback_enabled" BOOLEAN NOT NULL DEFAULT false,
    "previous_provider" TEXT,
    "previous_model" TEXT,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_config_pkey" PRIMARY KEY ("id")
);
