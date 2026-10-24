# Cloudflare Workers AI Clef Flash DM Classification

## Overview
DM classification in Siffty can be routed to Cloudflare Workers AI Clef Flash (`@cf/cloudflare/clef-flash`), while Gemini continues handling all text generation (auto-reply, draft replies, and conversation summaries) untouched.

## Configuration & Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `CLASSIFICATION_PROVIDER` | No | `gemini` | Set to `clef` to route DM classification to Clef Flash. Set to `gemini` (or unset) to use the existing Gemini classifier. |
| `CLOUDFLARE_ACCOUNT_ID` | When `clef` | None | Cloudflare Account ID from dashboard. |
| `CLOUDFLARE_API_TOKEN` | When `clef` | None | Cloudflare Workers AI API Token. |
| `CLEF_MAX_CONCURRENCY` | No | `5` | Maximum concurrent requests in-flight to Clef Flash per instance. |

## Resilience & Automatic Fallback
The Clef Flash integration is strictly fail-open to the existing Gemini classifier:
1. **Fallback on Any Error**: If credentials are missing, HTTP 401/403, 429, 5xx, timeout (4s limit), daily free allocation exceeded, malformed response, or an unrecognized category label occurs, traffic instantly falls back to the existing Gemini classifier. The caller never experiences an error from the Clef path.
2. **Retries**: At most 1 quick retry for network/5xx errors before falling back. 4xx errors (including 401/403/429) do not retry.
3. **Circuit Breaker**: After 5 consecutive failures, Clef Flash is skipped for 60 seconds (circuit open). Following 60 seconds, the next call retries Clef.
4. **Structured Logging**: Each call emits one structured log line (`{"tag":"dm_classification","provider":"...","latencyMs":...,"fallbackReason":...}`) without message text or secrets.
5. **Output Contract**: Results from Clef Flash return in the exact shape and types expected by the pipeline and database transaction.

## Rollout & Rollback
- **To Enable**:
  1. Add `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in your environment (e.g. Northflank secret group).
  2. Set `CLASSIFICATION_PROVIDER=clef`.
  3. Redeploy `api`.
- **To Disable / Rollback**:
  - Set `CLASSIFICATION_PROVIDER=gemini` (or unset it) and restart/redeploy `api`.
