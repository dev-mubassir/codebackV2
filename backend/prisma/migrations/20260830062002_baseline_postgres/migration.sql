-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "password_hash" TEXT,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "is_suspended" BOOLEAN NOT NULL DEFAULT false,
    "onboarding_completed" BOOLEAN NOT NULL DEFAULT false,
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "business_name" TEXT,
    "business_types" TEXT,
    "primary_category" TEXT,
    "description" TEXT,
    "products_services" TEXT,
    "pricing_info" TEXT,
    "target_audience" TEXT,
    "location_delivery" TEXT,
    "payment_methods" TEXT,
    "faq_data" TEXT,
    "policies" TEXT,
    "contact_preferences" TEXT,
    "ai_instructions" TEXT,
    "prohibited_topics" TEXT,
    "tone" TEXT NOT NULL DEFAULT 'friendly',
    "auto_reply_mode" TEXT NOT NULL DEFAULT 'human_only',
    "min_confidence_score" INTEGER NOT NULL DEFAULT 75,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instagram_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ig_user_id" TEXT NOT NULL,
    "ig_username" TEXT,
    "ig_name" TEXT,
    "ig_profile_pic" TEXT,
    "access_token" TEXT NOT NULL,
    "token_expires_at" TIMESTAMP(3),
    "token_status" TEXT NOT NULL DEFAULT 'VALID',
    "connection_status" TEXT NOT NULL DEFAULT 'CONNECTED',
    "disconnected_at" TIMESTAMP(3),
    "last_webhook_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instagram_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "instagram_account_id" TEXT NOT NULL,
    "igsid" TEXT NOT NULL,
    "username" TEXT,
    "name" TEXT,
    "profile_pic_url" TEXT,
    "last_fetched_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "instagram_account_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "category" TEXT,
    "intent" TEXT,
    "customer_type" TEXT,
    "lead_quality" INTEGER,
    "purchase_intent" INTEGER,
    "risk_level" TEXT NOT NULL DEFAULT 'low',
    "scam_probability" INTEGER NOT NULL DEFAULT 0,
    "ai_explanation" TEXT,
    "recommended_action" TEXT,
    "needs_human" BOOLEAN NOT NULL DEFAULT false,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "priority_score" INTEGER NOT NULL DEFAULT 0,
    "needs_attention" BOOLEAN NOT NULL DEFAULT false,
    "unread" BOOLEAN NOT NULL DEFAULT true,
    "auto_reply_enabled" BOOLEAN,
    "auto_reply_prompt" TEXT,
    "auto_reply_claimed_at" TIMESTAMP(3),
    "last_message" TEXT,
    "last_message_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "ig_message_id" TEXT,
    "direction" TEXT NOT NULL,
    "content" TEXT,
    "category" TEXT,
    "suggested_reply" TEXT,
    "message_type" TEXT NOT NULL DEFAULT 'text',
    "attachment_url" TEXT,
    "ig_timestamp" TIMESTAMP(3),
    "ai_status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "analyzed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_analyses" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "trigger_message_id" TEXT,
    "category" TEXT NOT NULL,
    "intent" TEXT,
    "customer_type" TEXT,
    "lead_quality" INTEGER,
    "purchase_intent" INTEGER,
    "risk_level" TEXT,
    "scam_probability" INTEGER,
    "should_auto_reply" BOOLEAN NOT NULL DEFAULT false,
    "recommended_action" TEXT,
    "priority" TEXT NOT NULL,
    "priority_score" INTEGER NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "needs_attention" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT,
    "reason" TEXT,
    "model" TEXT,
    "raw_response" TEXT,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_summaries" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "stage" TEXT,
    "last_summarized_message_id" TEXT,
    "message_count_at_summary" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_deals" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "instagram_account_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "brand_name" TEXT,
    "campaign" TEXT,
    "budget_amount" DOUBLE PRECISION,
    "budget_currency" TEXT,
    "deliverables" TEXT,
    "deadline" TEXT,
    "contact_email" TEXT,
    "website" TEXT,
    "usage_rights" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'new',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reply_generations" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "context_ref" TEXT,
    "instructions" TEXT,
    "generated_text" TEXT NOT NULL,
    "model" TEXT,
    "was_sent" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reply_generations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creator_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "brand_deals_priority" TEXT NOT NULL DEFAULT 'high',
    "collaborations_priority" TEXT NOT NULL DEFAULT 'high',
    "customers_priority" TEXT NOT NULL DEFAULT 'high',
    "fan_priority" TEXT NOT NULL DEFAULT 'normal',
    "questions_priority" TEXT NOT NULL DEFAULT 'normal',
    "spam_priority" TEXT NOT NULL DEFAULT 'low',
    "tone" TEXT NOT NULL DEFAULT 'friendly',
    "custom_instructions" TEXT,
    "auto_generate_summary" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creator_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "conversation_id" TEXT,
    "brand_deal_id" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "status" TEXT NOT NULL DEFAULT 'trial',
    "trial_ends_at" TIMESTAMP(3),
    "current_period_end" TIMESTAMP(3),
    "provider" TEXT,
    "provider_customer_id" TEXT,
    "provider_subscription_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_logs" (
    "id" TEXT NOT NULL,
    "admin_user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "details" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_logs" (
    "id" TEXT NOT NULL,
    "instagram_account_id" TEXT,
    "ig_user_id" TEXT,
    "event_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payload" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "business_profiles_user_id_key" ON "business_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "instagram_accounts_ig_user_id_key" ON "instagram_accounts"("ig_user_id");

-- CreateIndex
CREATE INDEX "instagram_accounts_user_id_idx" ON "instagram_accounts"("user_id");

-- CreateIndex
CREATE INDEX "contacts_instagram_account_id_idx" ON "contacts"("instagram_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_instagram_account_id_igsid_key" ON "contacts"("instagram_account_id", "igsid");

-- CreateIndex
CREATE INDEX "conversations_instagram_account_id_last_message_at_idx" ON "conversations"("instagram_account_id", "last_message_at");

-- CreateIndex
CREATE INDEX "conversations_contact_id_idx" ON "conversations"("contact_id");

-- CreateIndex
CREATE INDEX "conversations_priority_idx" ON "conversations"("priority");

-- CreateIndex
CREATE INDEX "conversations_category_idx" ON "conversations"("category");

-- CreateIndex
CREATE INDEX "conversations_customer_type_idx" ON "conversations"("customer_type");

-- CreateIndex
CREATE INDEX "conversations_intent_idx" ON "conversations"("intent");

-- CreateIndex
CREATE INDEX "conversations_risk_level_idx" ON "conversations"("risk_level");

-- CreateIndex
CREATE INDEX "conversations_unread_idx" ON "conversations"("unread");

-- CreateIndex
CREATE INDEX "conversations_needs_attention_idx" ON "conversations"("needs_attention");

-- CreateIndex
CREATE INDEX "conversations_needs_human_idx" ON "conversations"("needs_human");

-- CreateIndex
CREATE INDEX "conversations_auto_reply_enabled_idx" ON "conversations"("auto_reply_enabled");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_instagram_account_id_contact_id_key" ON "conversations"("instagram_account_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_ig_message_id_key" ON "messages"("ig_message_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_ai_status_idx" ON "messages"("ai_status");

-- CreateIndex
CREATE INDEX "ai_analyses_conversation_id_created_at_idx" ON "ai_analyses"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_summaries_conversation_id_key" ON "conversation_summaries"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "brand_deals_conversation_id_key" ON "brand_deals"("conversation_id");

-- CreateIndex
CREATE INDEX "brand_deals_user_id_status_idx" ON "brand_deals"("user_id", "status");

-- CreateIndex
CREATE INDEX "brand_deals_instagram_account_id_idx" ON "brand_deals"("instagram_account_id");

-- CreateIndex
CREATE INDEX "reply_generations_conversation_id_created_at_idx" ON "reply_generations"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "reply_generations_user_id_idx" ON "reply_generations"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "creator_preferences_user_id_key" ON "creator_preferences"("user_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_created_at_idx" ON "notifications"("user_id", "is_read", "created_at");

-- CreateIndex
CREATE INDEX "usage_events_user_id_type_created_at_idx" ON "usage_events"("user_id", "type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_user_id_key" ON "subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- CreateIndex
CREATE INDEX "admin_logs_admin_user_id_idx" ON "admin_logs"("admin_user_id");

-- CreateIndex
CREATE INDEX "webhook_logs_instagram_account_id_idx" ON "webhook_logs"("instagram_account_id");

-- CreateIndex
CREATE INDEX "webhook_logs_status_created_at_idx" ON "webhook_logs"("status", "created_at");

-- AddForeignKey
ALTER TABLE "business_profiles" ADD CONSTRAINT "business_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instagram_accounts" ADD CONSTRAINT "instagram_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_instagram_account_id_fkey" FOREIGN KEY ("instagram_account_id") REFERENCES "instagram_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_instagram_account_id_fkey" FOREIGN KEY ("instagram_account_id") REFERENCES "instagram_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_summaries" ADD CONSTRAINT "conversation_summaries_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_deals" ADD CONSTRAINT "brand_deals_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_deals" ADD CONSTRAINT "brand_deals_instagram_account_id_fkey" FOREIGN KEY ("instagram_account_id") REFERENCES "instagram_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_deals" ADD CONSTRAINT "brand_deals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reply_generations" ADD CONSTRAINT "reply_generations_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reply_generations" ADD CONSTRAINT "reply_generations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_preferences" ADD CONSTRAINT "creator_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_logs" ADD CONSTRAINT "admin_logs_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_logs" ADD CONSTRAINT "webhook_logs_instagram_account_id_fkey" FOREIGN KEY ("instagram_account_id") REFERENCES "instagram_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
