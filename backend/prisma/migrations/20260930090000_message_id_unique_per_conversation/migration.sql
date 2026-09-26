-- F2 (tenant isolation): Instagram message ids become unique PER CONVERSATION
-- instead of globally. Two Siffty tenants DMing each other both store the
-- message; before, the recipient's inbound copy collided with the sender's
-- outbound row and was dropped.
--
-- Order matters: the new unique index is created FIRST, so there is no moment
-- without a uniqueness guarantee; only then is the global one dropped. Every
-- existing row already satisfies the new (looser) constraint. No data changes.
CREATE UNIQUE INDEX "messages_conversation_id_ig_message_id_key" ON "messages"("conversation_id", "ig_message_id");
CREATE INDEX "messages_ig_message_id_idx" ON "messages"("ig_message_id");
DROP INDEX "messages_ig_message_id_key";
