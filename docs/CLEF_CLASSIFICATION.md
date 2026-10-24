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
- **Static / Environment Variable**:
  1. Add `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in your environment (e.g. Northflank secret group).
  2. Set `CLASSIFICATION_PROVIDER=clef`.
  3. Redeploy `api`.
  4. To roll back via env: set `CLASSIFICATION_PROVIDER=gemini` (or unset it).
- **Runtime Override (Zero-Redeploy via Super Admin Panel)**:
  - You can toggle between `clef` and `gemini` dynamically from the Super Admin Panel under **Admin -> AI** without restarting or redeploying the backend.

## Runtime Override & Super Admin Management

### Resolution Precedence
At runtime, each DM classification call determines the provider using the following priority:
1. **DB Setting (`classification_provider`)**: Stored in `app_settings` via `setSetting('classification_provider', ...)`.
2. **Environment Variable (`CLASSIFICATION_PROVIDER`)**: Configured in environment/secrets (`clef` or `gemini`).
3. **Default**: Falls back to `gemini`.

*Safety Fallback*: If `clef` is selected (via DB override or env var) but `CLOUDFLARE_ACCOUNT_ID` or `CLOUDFLARE_API_TOKEN` is missing, the resolver automatically falls back to `gemini` with reason `missing_credentials`.

### In-Memory Caching & Metrics
- **Provider Override Cache**: Cached in-memory for 15 seconds to prevent database load on high-throughput webhook bursts. Cache is immediately invalidated when an admin updates the provider via the API.
- **Rolling Window Metrics**: An in-memory ring buffer tracks the last 500 classification calls:
  - Total calls, Clef calls, Gemini calls, Fallback calls.
  - Fallback rate percentage.
  - p50 and p95 latencies (calculated via nearest-rank percentile).
  - Breakdown of fallback reasons (e.g., `rate_limit_429`, `auth_error`, `upstream_5xx`, `timeout`, `json_parse_error`, `circuit_open`, `missing_credentials`).
  - Active in-flight concurrency gauge.

### Admin REST API Endpoints
All endpoints require Super Admin authentication (`requireAdmin`, `adminOriginGuard`, `trackAdminActivity`):

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/classification/status` | Returns provider resolution, credentials status (`hasAccountId`, `hasApiToken`), circuit breaker state, rolling 500-call metrics, and in-flight concurrency. |
| `POST` | `/api/admin/classification/provider` | Sets runtime provider override (`{"provider": "clef" \| "gemini"}`). Clears memory cache and records an audit log (`CLASSIFICATION_PROVIDER_SET`). |
| `POST` | `/api/admin/classification/test` | Runs a fixed built-in synthetic test probe against the active classifier. Strictly rate-limited to 6 calls/minute. Strictly rejects any custom message payload. |
| `POST` | `/api/admin/classification/circuit-breaker/reset` | Resets consecutive failures to 0 and closes the breaker. Records an audit log (`CLASSIFICATION_CIRCUIT_BREAKER_RESET`). |

