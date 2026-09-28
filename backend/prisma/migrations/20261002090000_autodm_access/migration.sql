-- Auto DM access grants (admin-controlled BETA rollout). ADDITIVE ONLY: one new
-- table, its unique index, and a foreign key FROM it to users (cascade on user
-- deletion). No existing table is altered. The rollout mode is a row in the
-- existing app_settings table (key autodm_rollout_mode), so no schema change there.

-- CreateTable
CREATE TABLE "autodm_access" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "granted_by_admin_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "autodm_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "autodm_access_user_id_key" ON "autodm_access"("user_id");

-- AddForeignKey
ALTER TABLE "autodm_access" ADD CONSTRAINT "autodm_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

