-- Runtime settings (admin rebuild, Gate 2; extended by Gate 7).
--
-- One row per key; no rows are seeded, so every key falls back to its code
-- default in lib/settings.js and behaviour is unchanged until an admin edits
-- one. Additive only.
--
-- REVERSE (manual):
--   DROP TABLE "app_settings";

CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);
