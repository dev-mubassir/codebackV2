# Privacy notes — for folding into the published policy

Written for the person updating `/privacy`. It states what Codeback retains
**after a deletion request**, and why. Everything here is a deliberate
exception to "delete means delete", so each one needs a lawful basis stated in
the policy rather than being quietly true.

Two of these will be read by a Meta App Reviewer. If the policy does not
mention them and a reviewer finds them, that reads as an undisclosed retention.

---

## What a deletion request actually deletes

`POST /data-deletion/instagram` (Meta's Data Deletion Callback) and
`DELETE /auth/account` both cascade through:

- the `InstagramAccount` row and its stored access token
- every `Contact` (customer usernames, display names, profile pictures)
- every `Conversation` and `Message` — the DM text itself
- every `AIAnalysis`, `ConversationSummary`, `BrandDeal`, `ReplyGeneration`
- every `WebhookLog`, including the raw payload holding customers' message text
- the `User` row itself, once no connected account remains

Deletion is immediate and irreversible. There is no soft-delete and no
recycle bin.

**Note for the policy:** a deletion request now erases **all** rows for that
Instagram id, not just the currently connected one. A disconnected row is
retained as history while the account is live, and it must not survive an
erasure request.

---

## Retention 1 — the pseudonymised abuse ledger

**Table:** `instagram_identities`
**Retained:** 18–24 months (24 in the current implementation), enforced by the
`purgeAfter` column and a scheduled purge job.
**Basis:** fraud prevention / legitimate interests.

### What is stored

| Column | Contents |
|---|---|
| `ig_user_id_hash` | HMAC-SHA256 of the Instagram user id, keyed with a server-side secret |
| `first_seen_at` | when this Instagram account first connected |
| `trial_consumed_at` | when a free trial was granted for it, if ever |
| `link_count` | how many times it has been connected |
| `blocked_at` | set manually, if the account is barred |

**No raw Instagram id, no username, no email, no message content, and no link
to a user account.** The hash is one-way and keyed, so the table cannot be
reversed into a list of Instagram accounts, and cannot be cross-referenced
against a stolen copy without also stealing the key.

### Why it survives deletion

This is the point of it. The free trial is granted per Instagram account, not
per signup. If the record were deleted along with the account, "delete your
account and sign up again" would be an unlimited free trial, and the record
would be worthless precisely when it mattered.

The row therefore has **no database relationship to the user** — it cannot
cascade even by accident.

### Suggested policy wording

> When you connect an Instagram account, we store a one-way cryptographic hash
> of its account identifier, along with the dates it was connected and whether
> a free trial has been used. We cannot recover the original identifier from
> this hash. We keep this record for up to 24 months after your last
> connection, even if you delete your Codeback account, solely to prevent
> repeated use of free trials. It contains no messages, no contact details, and
> no link to your account.

---

## Retention 2 — billing and invoice records

**Basis:** statutory. Indian GST rules require retention of tax invoices and
related records, and that obligation overrides a deletion request for the
records it covers.

**Status today: nothing to retain.** Billing was reverted before launch;
`subscriptions` currently holds only trial state (`status`,
`trialStartedAt`, `trialEndsAt`) with no plan, no price, no provider id and no
payment record, and it **is** deleted with the user.

**This section must be revisited the moment billing is re-enabled.** At that
point invoice records will need to be excluded from the deletion cascade and
retained for the statutory period, and the policy must say so before the first
payment is taken — not after.

### Suggested policy wording (for when billing is live)

> Where we have issued you a tax invoice, we are required by Indian tax law to
> retain that invoice and the associated transaction records for the statutory
> period, even after you delete your account. These records contain your
> billing details and the amounts charged. They do not contain your messages or
> your customers' data.

---

## Shorter-lived retention worth mentioning

| Data | Retained | Why |
|---|---|---|
| `WebhookLog.payload` (raw DM text) | **30 days**, then nulled; metadata row kept | Debugging delivery problems. Already implemented and already in the policy. |
| `webhook_deliveries` (SHA-256 of request bodies) | **7 days** | Prevents Meta retries being processed twice. Contains a hash, not content. |
| `auth_tokens` | Expired rows purged after 7 days | Password-reset and verification tokens, stored only as SHA-256. |
| `oauth_nonces` | Expired rows purged after 24 hours | OAuth replay protection. |
| `admin_logs` | Not currently purged | Audit trail, including impersonation start/end. **Flagged: needs a stated retention period.** |

`admin_logs` records an IP address in plain text and is not currently subject
to any purge. That should be given a defined retention period before launch.

---

## Things the policy should NOT claim

- Do not claim deletion is instantaneous across backups. Database snapshots
  taken before a deletion will still contain the data until they age out; state
  the backup retention period instead of implying otherwise.
- Do not claim we never store message content. We do: `Message.content` holds
  the DM text, and that is the product.
- Do not claim access tokens are deleted on disconnect without qualification —
  they are cleared from the row, but a permission revoke at Meta is
  best-effort and may fail. It is logged when it does.
