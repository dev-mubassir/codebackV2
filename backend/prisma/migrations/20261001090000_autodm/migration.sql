-- Auto DM (comment-to-DM). ADDITIVE ONLY: four new tables, their indexes, and
-- foreign keys FROM the new tables. No existing table, column, index or
-- constraint is altered. Rolling the app back leaves these tables unread.
--
-- Every row cascades from users / instagram_accounts, so account purge, the
-- Meta data-deletion callback and user deletion remove Auto DM data too.
-- The FK creation briefly locks the referenced tables; the new tables are
-- empty, so validation is instant.

-- CreateTable
CREATE TABLE "autodm_account_states" (
    "id" TEXT NOT NULL,
    "instagram_account_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "granted_scopes" TEXT,
    "comments_granted" BOOLEAN NOT NULL DEFAULT false,
    "comments_subscribed_at" TIMESTAMP(3),
    "poll_cursor_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "autodm_account_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autodm_automations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "instagram_account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "post_scope" TEXT NOT NULL DEFAULT 'ANY',
    "media_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "trigger_type" TEXT NOT NULL DEFAULT 'ANY_COMMENT',
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "exclude_keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "public_reply_enabled" BOOLEAN NOT NULL DEFAULT false,
    "public_replies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "opener_text" TEXT NOT NULL,
    "opener_button_label" TEXT NOT NULL,
    "fallback_keyword" TEXT NOT NULL,
    "main_text" TEXT NOT NULL,
    "link_url" TEXT,
    "link_label" TEXT,
    "follow_gate_enabled" BOOLEAN NOT NULL DEFAULT false,
    "follow_prompt_text" TEXT,
    "follow_button_label" TEXT,
    "follow_fail_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "autodm_automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autodm_runs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "instagram_account_id" TEXT NOT NULL,
    "automation_id" TEXT NOT NULL,
    "comment_id" TEXT NOT NULL,
    "commenter_id" TEXT NOT NULL,
    "commenter_username" TEXT,
    "comment_text" TEXT,
    "media_id" TEXT,
    "source" TEXT NOT NULL DEFAULT 'webhook',
    "igsid" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "pending_action" TEXT,
    "follow_checks" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "claimed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "comment_created_at" TIMESTAMP(3) NOT NULL,
    "public_reply_at" TIMESTAMP(3),
    "opener_sent_at" TIMESTAMP(3),
    "main_image_sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "autodm_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autodm_images" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "automation_id" TEXT,
    "content_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "autodm_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "autodm_account_states_instagram_account_id_key" ON "autodm_account_states"("instagram_account_id");

-- CreateIndex
CREATE INDEX "autodm_account_states_user_id_idx" ON "autodm_account_states"("user_id");

-- CreateIndex
CREATE INDEX "autodm_automations_instagram_account_id_status_idx" ON "autodm_automations"("instagram_account_id", "status");

-- CreateIndex
CREATE INDEX "autodm_automations_user_id_idx" ON "autodm_automations"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "autodm_runs_comment_id_key" ON "autodm_runs"("comment_id");

-- CreateIndex
CREATE INDEX "autodm_runs_pending_action_next_attempt_at_idx" ON "autodm_runs"("pending_action", "next_attempt_at");

-- CreateIndex
CREATE INDEX "autodm_runs_instagram_account_id_igsid_idx" ON "autodm_runs"("instagram_account_id", "igsid");

-- CreateIndex
CREATE INDEX "autodm_runs_automation_id_created_at_idx" ON "autodm_runs"("automation_id", "created_at");

-- CreateIndex
CREATE INDEX "autodm_runs_user_id_idx" ON "autodm_runs"("user_id");

-- CreateIndex
CREATE INDEX "autodm_runs_created_at_idx" ON "autodm_runs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "autodm_runs_automation_id_commenter_id_key" ON "autodm_runs"("automation_id", "commenter_id");

-- CreateIndex
CREATE UNIQUE INDEX "autodm_images_automation_id_key" ON "autodm_images"("automation_id");

-- CreateIndex
CREATE INDEX "autodm_images_user_id_created_at_idx" ON "autodm_images"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "autodm_account_states" ADD CONSTRAINT "autodm_account_states_instagram_account_id_fkey" FOREIGN KEY ("instagram_account_id") REFERENCES "instagram_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autodm_account_states" ADD CONSTRAINT "autodm_account_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autodm_automations" ADD CONSTRAINT "autodm_automations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autodm_automations" ADD CONSTRAINT "autodm_automations_instagram_account_id_fkey" FOREIGN KEY ("instagram_account_id") REFERENCES "instagram_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autodm_runs" ADD CONSTRAINT "autodm_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autodm_runs" ADD CONSTRAINT "autodm_runs_instagram_account_id_fkey" FOREIGN KEY ("instagram_account_id") REFERENCES "instagram_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autodm_runs" ADD CONSTRAINT "autodm_runs_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "autodm_automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autodm_images" ADD CONSTRAINT "autodm_images_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autodm_images" ADD CONSTRAINT "autodm_images_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "autodm_automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

