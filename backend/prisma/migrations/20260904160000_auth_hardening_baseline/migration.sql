-- =====================================================================
-- AUTH HARDENING BASELINE — one migration for all seven phases.
--
-- SELF-DEFENDING BY DESIGN. This migration asserts its preconditions BEFORE
-- it changes anything destructive, and fails loudly with the offending row
-- count rather than applying partially. Prisma wraps the whole file in a
-- transaction, so a RAISE EXCEPTION rolls everything back and leaves the
-- database exactly as it was.
--
-- Structure:
--   SECTION 0  preconditions   — assert, or abort with counts
--   SECTION 1  enums
--   SECTION 2  additive columns
--   SECTION 3  new tables
--   SECTION 4  indexes + foreign keys
--   SECTION 5  uniqueness rework on instagram_accounts (the destructive part)
--   SECTION 6  data backfill
--   SECTION 7  postconditions  — verify what we just did
--
-- NOT INCLUDED, DELIBERATELY (see the Gate 1 notes):
--   * encrypting plaintext access tokens   -> needs AES, Node script, Gate 2
--   * emailVerifiedAt grandfathering       -> requires per-environment human
--                                             review of the affected list
--   * dropping instagram_accounts.access_token and the crypto.js passthrough
--                                          -> FINDINGS.md D3, a LATER migration
--                                             after prod verification
-- =====================================================================


-- =====================================================================
-- SECTION 0 — PRECONDITIONS
-- =====================================================================

-- 0.1 The only check that can actually fail this migration.
-- ig_one_active_link permits one CONNECTED row per Instagram account. If any
-- account already has two, CREATE UNIQUE INDEX would fail mid-migration.
-- Fail here instead, with the offending ids, while nothing has changed yet.
DO $$
DECLARE
  conflict_count INTEGER;
  offending TEXT;
BEGIN
  SELECT COUNT(*), COALESCE(STRING_AGG(ig_user_id, ', '), '')
    INTO conflict_count, offending
  FROM (
    SELECT ig_user_id
    FROM "instagram_accounts"
    WHERE "connection_status" = 'CONNECTED'
    GROUP BY ig_user_id
    HAVING COUNT(*) > 1
  ) AS dupes;

  IF conflict_count > 0 THEN
    RAISE EXCEPTION
      'ABORT: % Instagram account(s) already have more than one CONNECTED row, so the ig_one_active_link unique index cannot be created. Offending ig_user_id values: %. Resolve these (disconnect the stale duplicates) and re-run.',
      conflict_count, offending;
  END IF;

  RAISE NOTICE 'precondition 0.1 OK: no ig_user_id has more than one CONNECTED row.';
END $$;

-- 0.2 The new @@unique([userId, igUserId]) cannot be created if a user somehow
-- holds two rows for the same Instagram account. Impossible under the old
-- global unique, but assert rather than assume — the global unique is about
-- to be dropped and this is the last moment it is guaranteed to have held.
DO $$
DECLARE
  pair_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO pair_count
  FROM (
    SELECT "user_id", "ig_user_id"
    FROM "instagram_accounts"
    GROUP BY "user_id", "ig_user_id"
    HAVING COUNT(*) > 1
  ) AS dupes;

  IF pair_count > 0 THEN
    RAISE EXCEPTION
      'ABORT: % duplicate (user_id, ig_user_id) pair(s) exist, so the instagram_accounts_user_id_ig_user_id_key unique index cannot be created.',
      pair_count;
  END IF;

  RAISE NOTICE 'precondition 0.2 OK: no duplicate (user_id, ig_user_id) pairs.';
END $$;

-- 0.3 NON-BLOCKING report on plaintext tokens.
-- Deliberately a NOTICE, not an EXCEPTION: plaintext rows must NOT stop the
-- migration. They keep working via the legacy passthrough in lib/crypto.js
-- and are encrypted later by the Node backfill (FINDINGS.md D3). Blocking
-- here would make the migration undeployable on any environment that still
-- has one.
DO $$
DECLARE
  plaintext_count INTEGER;
  total_count INTEGER;
BEGIN
  SELECT
    COUNT(*) FILTER (
      WHERE LENGTH("access_token") - LENGTH(REPLACE("access_token", ':', '')) <> 2
    ),
    COUNT(*)
  INTO plaintext_count, total_count
  FROM "instagram_accounts";

  IF plaintext_count > 0 THEN
    RAISE WARNING
      'ATTENTION: % of % instagram_accounts rows hold a NON-ENCRYPTED access_token. They are NOT migrated to the split columns by this migration. Run scripts/backfill-token-encryption.js, verify zero remain in EVERY environment, and only THEN drop access_token and the crypto.js passthrough.',
      plaintext_count, total_count;
  ELSE
    RAISE NOTICE 'precondition 0.3 OK: all % access_token value(s) are in iv:ciphertext:tag form.', total_count;
  END IF;
END $$;


-- =====================================================================
-- SECTION 1 — ENUMS
-- =====================================================================

CREATE TYPE "AuthTokenType" AS ENUM ('PASSWORD_RESET', 'EMAIL_VERIFY');
CREATE TYPE "AuthProvider" AS ENUM ('GOOGLE');
-- Discriminates the two OAuth flows. Both sign with the same
-- OAUTH_STATE_SECRET, so without this a state token minted for Google login is
-- structurally valid at the Instagram callback.
CREATE TYPE "OAuthPurpose" AS ENUM ('GOOGLE_LOGIN', 'INSTAGRAM_CONNECT');
CREATE TYPE "SubscriptionStatus" AS ENUM ('NONE', 'TRIALING', 'TRIAL_EXPIRED');
CREATE TYPE "DeletionRequestStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'COMPLETED', 'FAILED');


-- =====================================================================
-- SECTION 2 — ADDITIVE COLUMNS
-- All nullable or defaulted, so existing rows are untouched.
-- =====================================================================

ALTER TABLE "users"
  ADD COLUMN "email_verified_at" TIMESTAMP(3),
  ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "instagram_accounts"
  ADD COLUMN "token_ciphertext"  TEXT,
  ADD COLUMN "token_iv"          TEXT,
  ADD COLUMN "token_auth_tag"    TEXT,
  ADD COLUMN "token_key_version" INTEGER NOT NULL DEFAULT 1;


-- =====================================================================
-- SECTION 3 — NEW TABLES
-- =====================================================================

CREATE TABLE "auth_tokens" (
    "id"         TEXT NOT NULL,
    "user_id"    TEXT NOT NULL,
    "type"       "AuthTokenType" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at"    TIMESTAMP(3),
    "request_ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_identities" (
    "id"                  TEXT NOT NULL,
    "user_id"             TEXT NOT NULL,
    "provider"            "AuthProvider" NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "email"               TEXT NOT NULL,
    "email_verified"      BOOLEAN NOT NULL DEFAULT false,
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at"        TIMESTAMP(3),

    CONSTRAINT "auth_identities_pkey" PRIMARY KEY ("id")
);

-- No user_id, no foreign key, no cascade — INTENTIONAL. This ledger must
-- survive account deletion or it cannot detect a deleted-and-recreated
-- account re-claiming a trial. It stores only an HMAC of the Instagram id.
CREATE TABLE "instagram_identities" (
    "id"                TEXT NOT NULL,
    "ig_user_id_hash"   TEXT NOT NULL,
    "first_seen_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trial_consumed_at" TIMESTAMP(3),
    "link_count"        INTEGER NOT NULL DEFAULT 0,
    "blocked_at"        TIMESTAMP(3),
    "purge_after"       TIMESTAMP(3),

    CONSTRAINT "instagram_identities_pkey" PRIMARY KEY ("id")
);

-- user_id is nullable and unconstrained: a Google sign-in legitimately begins
-- with no session, so there is no user to attribute the nonce to yet.
CREATE TABLE "oauth_nonces" (
    "id"         TEXT NOT NULL,
    "purpose"    "OAuthPurpose" NOT NULL,
    "nonce"      TEXT NOT NULL,
    "user_id"    TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_at"    TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_nonces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "deletion_requests" (
    "id"              TEXT NOT NULL,
    "code"            TEXT NOT NULL,
    "ig_user_id_hash" TEXT NOT NULL,
    "status"          "DeletionRequestStatus" NOT NULL DEFAULT 'RECEIVED',
    "requested_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at"    TIMESTAMP(3),

    CONSTRAINT "deletion_requests_pkey" PRIMARY KEY ("id")
);

-- DELIVERY-level webhook idempotency for Meta. Purely additive: no data, no
-- reference to any existing table, and it does not touch SECTION 5.
--
-- The key is SHA-256 of the RAW REQUEST BODY, not (entry.id, entry.time):
-- two genuinely different deliveries for one account inside the same second
-- would collide on that pair and the second real message would be silently
-- dropped. A body hash cannot collide across different deliveries, and if Meta
-- re-serializes a retry the hash merely differs and we fall through to
-- message-level dedupe — today's behaviour. Failure direction is safe.
--
-- NEW NAME, not `processed_webhook_events`: that orphan still exists on any
-- database that applied the phantom Cashfree migrations, so recreating it here
-- would make this migration fail exactly where it is most needed. The orphan
-- is dropped separately in the cleanup path.
--
-- GROWS UNBOUNDED — every inbound DM writes a row. received_at is indexed for
-- the mandatory 7-day purge job (Gate 4).
CREATE TABLE "webhook_deliveries" (
    "id"            TEXT NOT NULL,
    "provider"      TEXT NOT NULL DEFAULT 'meta',
    "delivery_hash" TEXT NOT NULL,
    "received_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- status DEFAULT 'NONE' is the safety property: creating a row cannot grant
-- a trial. The previous incarnation of this table defaulted to 'trial'.
CREATE TABLE "subscriptions" (
    "id"               TEXT NOT NULL,
    "user_id"          TEXT NOT NULL,
    "status"           "SubscriptionStatus" NOT NULL DEFAULT 'NONE',
    "trial_started_at" TIMESTAMP(3),
    "trial_ends_at"    TIMESTAMP(3),
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);


-- =====================================================================
-- SECTION 4 — INDEXES AND FOREIGN KEYS ON THE NEW TABLES
-- =====================================================================

CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "auth_tokens"("token_hash");
CREATE INDEX "auth_tokens_user_id_type_idx" ON "auth_tokens"("user_id", "type");
CREATE INDEX "auth_tokens_expires_at_idx" ON "auth_tokens"("expires_at");

CREATE INDEX "auth_identities_user_id_idx" ON "auth_identities"("user_id");
CREATE UNIQUE INDEX "auth_identities_provider_provider_account_id_key"
  ON "auth_identities"("provider", "provider_account_id");

CREATE UNIQUE INDEX "instagram_identities_ig_user_id_hash_key"
  ON "instagram_identities"("ig_user_id_hash");
CREATE INDEX "instagram_identities_purge_after_idx" ON "instagram_identities"("purge_after");

CREATE UNIQUE INDEX "oauth_nonces_nonce_key" ON "oauth_nonces"("nonce");
CREATE INDEX "oauth_nonces_expires_at_idx" ON "oauth_nonces"("expires_at");

CREATE UNIQUE INDEX "deletion_requests_code_key" ON "deletion_requests"("code");
CREATE INDEX "deletion_requests_ig_user_id_hash_idx" ON "deletion_requests"("ig_user_id_hash");

CREATE UNIQUE INDEX "webhook_deliveries_provider_delivery_hash_key"
  ON "webhook_deliveries"("provider", "delivery_hash");
CREATE INDEX "webhook_deliveries_received_at_idx" ON "webhook_deliveries"("received_at");

CREATE UNIQUE INDEX "subscriptions_user_id_key" ON "subscriptions"("user_id");
CREATE INDEX "subscriptions_status_trial_ends_at_idx"
  ON "subscriptions"("status", "trial_ends_at");

ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- =====================================================================
-- SECTION 5 — UNIQUENESS REWORK ON instagram_accounts
--
-- THE DESTRUCTIVE PART. Guarded by preconditions 0.1 and 0.2 above.
--
-- Why: a GLOBAL unique on ig_user_id made a legitimate workspace-to-workspace
-- move impossible — the old row could never be retained as history while a
-- new one was created. That is precisely the case the InstagramIdentity
-- ledger exists to tell apart from trial abuse, so the constraint has to
-- allow it while still permitting only one ACTIVE link.
-- =====================================================================

DROP INDEX "instagram_accounts_ig_user_id_key";

-- One row per (user, Instagram account) link.
CREATE UNIQUE INDEX "instagram_accounts_user_id_ig_user_id_key"
  ON "instagram_accounts"("user_id", "ig_user_id");

-- Lookups by ig_user_id (the webhook hot path) lost their index when the
-- global unique was dropped. Restore it as a plain, non-unique index.
CREATE INDEX "instagram_accounts_ig_user_id_idx" ON "instagram_accounts"("ig_user_id");

-- The real rule: at most ONE CONNECTED row per Instagram account, globally.
-- Disconnected rows are history and may repeat. Prisma cannot express a
-- partial index, so this is raw SQL and must survive `prisma migrate diff`
-- comparisons — it will show as drift and that is expected.
CREATE UNIQUE INDEX "ig_one_active_link"
  ON "instagram_accounts"("ig_user_id")
  WHERE "connection_status" = 'CONNECTED';


-- =====================================================================
-- SECTION 6 — DATA BACKFILL
-- =====================================================================

-- 6.1 Split already-encrypted tokens into the new columns.
-- crypto.js stores exactly `${iv}:${ciphertext}:${tag}` (hex). Rows matching
-- that shape are split losslessly here. Rows that do NOT match are plaintext
-- and are left alone for the Node backfill — access_token remains the source
-- of truth for them until then.
UPDATE "instagram_accounts"
SET
  "token_iv"         = SPLIT_PART("access_token", ':', 1),
  "token_ciphertext" = SPLIT_PART("access_token", ':', 2),
  "token_auth_tag"   = SPLIT_PART("access_token", ':', 3),
  "token_key_version" = 1
WHERE LENGTH("access_token") - LENGTH(REPLACE("access_token", ':', '')) = 2
  AND SPLIT_PART("access_token", ':', 1) <> ''
  AND SPLIT_PART("access_token", ':', 2) <> ''
  AND SPLIT_PART("access_token", ':', 3) <> '';

-- 6.2 Subscription rows are NOT pre-created for existing users.
-- A row is created only by the explicit grant in the Instagram connect
-- transaction. Pre-creating them would be harmless today (status NONE), but
-- it would establish exactly the pattern the NONE default exists to prevent.

-- 6.3 emailVerifiedAt is NOT backfilled here — see the Gate 1 notes.
-- Grandfathering marks real people as email-verified without them ever
-- proving the address, which weakens the Google auto-link guarantee for those
-- accounts. That requires a human to review the affected list PER
-- ENVIRONMENT, so it lives in scripts/backfill-email-verified.js behind an
-- explicit confirmation flag, not in a migration that runs unattended.


-- =====================================================================
-- SECTION 7 — POSTCONDITIONS
-- =====================================================================

DO $$
DECLARE
  split_ok      INTEGER;
  split_missing INTEGER;
  has_partial   BOOLEAN;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE "token_ciphertext" IS NOT NULL),
    COUNT(*) FILTER (
      WHERE "token_ciphertext" IS NULL
        AND LENGTH("access_token") - LENGTH(REPLACE("access_token", ':', '')) = 2
    )
  INTO split_ok, split_missing
  FROM "instagram_accounts";

  -- Every well-formed encrypted row must have been split. If one was missed,
  -- the UPDATE predicate and the detection predicate disagree — abort rather
  -- than leave the two representations silently out of sync.
  IF split_missing > 0 THEN
    RAISE EXCEPTION
      'ABORT: % row(s) hold a well-formed iv:ciphertext:tag token but were not split into the new columns.',
      split_missing;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema() AND indexname = 'ig_one_active_link'
  ) INTO has_partial;

  IF NOT has_partial THEN
    RAISE EXCEPTION 'ABORT: partial unique index ig_one_active_link was not created.';
  END IF;

  RAISE NOTICE 'postcondition OK: % token(s) split, ig_one_active_link present.', split_ok;
END $$;
