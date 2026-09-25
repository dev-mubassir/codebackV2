-- Admin rebuild, Gate 6: plan features, terms-bought snapshots on
-- entitlements, admin bonus quota, coupons.
--
-- Additive: new nullable columns / defaults and two new tables. The old code
-- never reads any of them.
--
-- BACKFILL: every existing entitlement with a plan gets the terms of that
-- plan AS THEY ARE TODAY, so a later admin edit to a plan cannot change what
-- an existing customer already bought.
--
-- REVERSE (manual):
--   DROP TABLE "coupon_redemptions"; DROP TABLE "coupons";
--   ALTER TABLE "entitlements" DROP COLUMN "bonus_classifications_cycle",
--     DROP COLUMN "term_auto_reply_bank_cap", DROP COLUMN "term_classification_cap_cycle",
--     DROP COLUMN "term_classification_throttle_per_hour", DROP COLUMN "term_ig_account_limit",
--     DROP COLUMN "terms_snapshot_at";
--   ALTER TABLE "billing_plans" DROP COLUMN "features";

-- AlterTable
ALTER TABLE "billing_plans" ADD COLUMN     "features" JSONB;

-- AlterTable
ALTER TABLE "entitlements" ADD COLUMN     "bonus_classifications_cycle" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "term_auto_reply_bank_cap" INTEGER,
ADD COLUMN     "term_classification_cap_cycle" INTEGER,
ADD COLUMN     "term_classification_throttle_per_hour" INTEGER,
ADD COLUMN     "term_ig_account_limit" INTEGER,
ADD COLUMN     "terms_snapshot_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "coupons" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "discount_type" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "currency" TEXT,
    "max_uses" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3),
    "influencer_tag" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" TEXT NOT NULL,
    "coupon_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "redeemed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE INDEX "coupons_influencer_tag_idx" ON "coupons"("influencer_tag");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_user_id_key" ON "coupon_redemptions"("user_id");

-- CreateIndex
CREATE INDEX "coupon_redemptions_coupon_id_idx" ON "coupon_redemptions"("coupon_id");

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill the terms bought.
UPDATE "entitlements" e
SET "term_classification_cap_cycle" = p."classification_cap_cycle",
    "term_classification_throttle_per_hour" = p."classification_throttle_per_hour",
    "term_auto_reply_bank_cap" = p."auto_reply_bank_cap",
    "term_ig_account_limit" = p."ig_account_limit",
    "terms_snapshot_at" = CURRENT_TIMESTAMP
FROM "billing_plans" p
WHERE p."code" = e."plan_code";
