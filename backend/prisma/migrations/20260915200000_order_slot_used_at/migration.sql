-- When an extra-Instagram-account slot was first used (refund policy).
--
-- WHY: an extra account slot is refundable within 7 days only if no Instagram
-- account was ever connected using it. Instagram account rows can be deleted
-- and limits are not enforced at connect, so "was it ever used" cannot be read
-- back from history — it has to be recorded at the moment it happens.
--
--   orders.slot_used_at   set once (never cleared) by
--                         entitlementService.recordInstagramSlotUsage when the
--                         tenant's connected accounts reach the slot; NULL for
--                         every other order and for slots never used.
--
-- Additive and nullable; no backfill (no extra-account order predates it).
-- REVERSE (manual):
--   ALTER TABLE "orders" DROP COLUMN "slot_used_at";

ALTER TABLE "orders" ADD COLUMN "slot_used_at" TIMESTAMP(3);
