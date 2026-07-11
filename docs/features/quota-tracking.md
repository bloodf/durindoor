# Usage and Quota Tracking

DurinDoor records request activity so operators can understand traffic, cost, provider health, and quota pressure. The exact data available depends on the provider response and the connection type.

## What DurinDoor Tracks

| Data | Description |
| --- | --- |
| Request time | When the request was handled. |
| Provider and model | The resolved upstream provider and model. |
| Connection | The account or credential used when available. |
| Input tokens | Prompt tokens reported or estimated by the upstream. |
| Output tokens | Completion tokens reported or estimated by the upstream. |
| Total tokens | Combined usage when known. |
| Cost estimate | Calculated when pricing data is available. |
| Latency | Duration of the request. |
| Status | Success, provider error, client error, retry, or fallback result. |
| Error details | Normalized error text for failed requests. |

## Dashboard Views

Use the dashboard to inspect usage from several angles:

- Overview cards for high-level usage.
- Usage charts for trends over time.
- Request logs for individual calls.
- Request details for payload and provider diagnostics when logging is enabled.
- Provider limits for quota reset and cooldown information.
- Provider topology for how traffic flows through configured providers.

## Quota Reset Windows

Providers use different quota models. DurinDoor stores and displays reset information when the provider integration exposes it.

Common reset patterns:

| Pattern | Meaning |
| --- | --- |
| Rolling window | Usage expires gradually after a fixed interval. |
| Daily reset | Quota resets at a provider-defined time each day. |
| Weekly reset | Larger allowance resets once per week. |
| Monthly reset | Billing or subscription allowance resets monthly. |
| No published quota | Provider does not expose a reliable reset model. |

Treat displayed reset windows as operational hints unless the provider explicitly guarantees them.

## Durable Provider Quota Contract

Schema version 7 adds the runtime-neutral persistence boundary used by the quota integration program. It stores provider-reported observations separately from local request accounting:

- `providerQuotaSnapshots` keeps one current row for a stable connection, account/resource, and quota dimension.
- `quotaFetchStates` records whether the latest refresh succeeded, was missing or malformed, failed authentication, was rate-limited, timed out, or hit a network/provider error. Its `lastObservedAt` value is the durable whole-source watermark, including a successful refresh that returned an empty set.
- `usageHistory`, `usageDaily`, and API-key lifetime totals remain local accounting. Provider snapshots never absorb those counters, and this schema does not yet create in-flight reservations.

A snapshot distinguishes `bounded`, `unlimited`, and `unknown` limits. Missing data never silently means unlimited or exhausted. Zero is a valid limit, used amount, remaining amount, or remaining ratio. Absolute amounts and ratios are stored separately, timestamps are canonical UTC values, and a snapshot is fresh only while `observedAt <= now < staleAt`. Write and import boundaries accept at most five minutes of clock skew for observation and fetch-attempt times; retry deadlines are limited to 24 hours. Reset and cooldown timestamps can shorten freshness, but they do not make a stale observation available again without a new provider refresh.

Stable identity is based on the non-secret provider-connection ID plus namespaced account, resource, dimension, and source keys. Missing account/resource scope is represented internally as `scope:connection` / `scope:account`; provider input cannot supply or collide with that reserved namespace. Identity fields inspect both namespace and payload, reject credential, URL, email, header, query-string, opaque-token, and raw-body shapes, and never use an API key, OAuth token, token hash, display name, or array position. Each write acquires SQLite's writer lock before reading source state, so competing processes cannot upgrade a stale WAL read snapshot. A strictly newer observation replaces the source set; equal or older observations leave snapshot rows unchanged, while a newer successful attempt still updates the latest fetch outcome and success time. A delayed response cannot resurrect rows removed by a newer empty refresh. The single-row write API is an authoritative one-row source replacement; multi-dimension sources use the batch replacement API. Failures retain the last successful observation and success time. Deleting a provider connection cascades its quota state, while changing an existing connection ID to a different provider is rejected.

This first persistence batch does not change account selection, fallback, combo scoring, quota fetches, dashboard surfaces, or request accounting. Those consumers land in later serial quota batches and must use this same contract rather than creating parallel caches or truth sources.

## Provider Refresh Boundary

The second quota batch adds provider-boundary fetchers and the shared refresh tracker. It still does not change account selection, fallback, combo scoring, request preflight, usage accounting, APIs, or dashboard rendering. Those later consumers must call this tracker instead of contacting quota endpoints or creating credential-keyed caches themselves.

The stable refresh coverage is:

| Provider family | Authoritative observation |
| --- | --- |
| Gemini CLI | Google Code Assist project discovery plus `retrieveUserQuota` model fractions. |
| Antigravity and `agy` | Native Antigravity bootstrap profile (`ideType` only, with no rejected platform/plugin metadata) plus `retrieveUserQuota`; no credit-spending probe. |
| Codex | ChatGPT `wham/usage` session, weekly, code-review, and Codex Spark windows, bound with the shared account-ID resolver. |
| Claude | OAuth utilization windows plus strict legacy organization usage rows; unknown legacy allocations remain unknown rather than fabricated. Anthropic's `omelette` codename maps to `designer`. |
| GitHub Copilot | Paid entitlement, used/total, or percent-only snapshots and free-plan remaining buckets, preserving unlimited entitlements. |
| Cursor | The WorkOS-authenticated dashboard spending JSON contract; Connect/protobuf usage calls are not used for quota persistence. Redirects remain rejected by the common transport security lock. |
| Kiro | Accepted-main `ListAvailableProfiles` discovery and `GetUsageLimits` POST behavior. Legacy region casing is normalized only when constructing endpoints, while stored profile-ARN bytes remain unchanged. Draft API-key/external-IdP quota variants remain excluded until accepted upstream; the tracker rejects those modes before proxy lookup, token refresh, or provider I/O. |
| Kimi Coding | OAuth and API-key coding usage, with a stable non-secret device identity for OAuth requests. |
| GLM, GLM CN, Z.AI, and GLM T | Personal or explicitly configured organization/project quota, with distinct five-hour, weekly, and monthly-tools dimensions. |
| MiniMax and MiniMax CN | One representative text/coding-plan session and weekly window; used-versus-remaining count semantics are inferred from the payload's reported percentage, never from the endpoint URL. Ambiguous payloads and media buckets are rejected. |
| CodeBuddy CN | Stable recurring and bonus package identities ordered by expiry. |
| Bailian Coding Plan | Five-hour, weekly, and billing-month request windows. |
| Qoder | Accepted PAT-to-job-token `/api/v3/user/status` flow. Team/enterprise zero quota is pooled, not exhausted. |
| Qoder CN | Existing legacy OAuth v2 quota contract, kept as an explicitly separate source. |
| Vercel AI Gateway, Crof, and DeepSeek | Provider-reported balance or remaining observations only. Unknown allocations remain `limitKind: unknown`. |

Every endpoint is fixed HTTPS configuration. The transport rejects credential-bearing URLs and redirects, limits JSON response bodies to 1 MiB, and applies the ten-second default timeout to fetch, body reads, and cancellation-resistant streams. It maps authentication, authorization, rate limiting, network failure, timeout, malformed data, and provider failure separately. Cursor's accepted upstream implementation classifies a manual WorkOS redirect as expired authentication; DurinDoor intentionally keeps the stricter program-wide `redirect: error` rule, never follows that redirect, and reports the resulting transport failure without exposing its location. A mixed valid/malformed authoritative payload fails as a whole, so response-shape drift cannot erase the last known valid source. A valid empty source remains supported by the tracker, but an adapter must explicitly prove that empty is authoritative; known provider empty/shape-drift responses are classified as missing or malformed instead.

Successful observations are fresh for at most 60 seconds by default and never beyond their earlier reset or cooldown timestamp. Equal callers share one in-flight request. The cache key contains only provider, immutable connection ID, and connection revision; raw credentials, account IDs, device IDs, and token hashes are excluded. One caller may detach without cancelling other subscribers. When all subscribers leave, the upstream operation is aborted and repository commit guards prevent the abandoned generation from writing. A forced refresh installs a unique newer generation, and the SQLite transaction rechecks that generation immediately before writing. The tracker caches only the repository-accepted source; if another process already committed a newer watermark, the caller receives the repository-current source and the rejected attempt is not cached.

OAuth refresh is shared with the usage and auto-ping paths and coordinated once per provider connection. Cancellation before the upstream request prevents work; once a provider may have rotated a single-use refresh token, the credential operation persists independently while the cancelled quota subscriber performs no adapter or snapshot work. Individual callers have a bounded wait and may time out without abandoning that durable operation or starting a duplicate. The provider-connection transaction takes SQLite's writer lock before reading, compares a pre-request copy of the credential and issuer/routing context (including supported legacy aliases), merges onto unrelated current metadata, and keeps a concurrent credential winner rather than overwriting it. Executors receive cloned metadata and cannot mutate that comparison input. An `invalid_grant` loser briefly rereads without mutating the row so it can return a concurrently committed rotation instead of falsely requiring reauthorization. Every successful refresh must contain a bounded non-empty access token; expiry seconds accept only positive integer numbers or strict decimal strings. Generic provider metadata uses a typed allowlist, unchanged legacy metadata echoed by a provider is preserved without rewrite, top-level and nested API keys are never rewritten, malformed mixed refresh patches fail without a partial write, and refreshed quota enters cache only under the persisted connection revision. Refresh, auto-ping, and quota failure logs never retain arbitrary provider bodies, URLs, headers, or credential-bearing error text.

Local device counters, Gemini static RPM/RPD estimates, local usage history/spend, and generic cooldown counters are not provider snapshots. Qwen, iFlow, xAI, Xiaomi MiMo, Grok Web, Ollama/Ollama Cloud, Vertex billing, OpenCode variants, and providers without a stable authenticated quota API do not create Batch-2 snapshot rows. NanoGPT is not present in the current provider registry. Amazon Q is represented by Kiro. These dispositions avoid presenting estimates, scraped pages, or speculative endpoints as authoritative provider capacity.

### Backup and retention behavior

Portable database exports include a versioned `quota` section with normalized snapshots and sanitized fetch outcomes. The entire export is captured in one SQLite read transaction and fails closed on orphaned rows or snapshots that do not exactly match their durable source watermark, so its connections and quota references always describe one database snapshot. Older exports without that section remain valid and import with no provider quota state. A present but unsupported, malformed, duplicate, dangling, provider-mismatched, future-poisoned, source-inconsistent, or aggregate-over-20,000-row quota payload is rejected before any destructive import work. The authenticated HTTP import reader also enforces a 16 MiB streaming byte limit, including chunked bodies. One authoritative source refresh is capped at 5,000 snapshots before normalization. SQLite safety backups include both quota tables automatically.

Quota metadata is a small scalar allowlist; raw provider responses, URLs, headers, cookies, authorization values, API keys, and tokens are not stored there. The full database export still contains the existing provider/API-key credentials needed for restore, so protect it as a secret. Snapshot retention is distinct from freshness: stale rows remain available for diagnostics until the configured pruning boundary, which defaults to 90 days.

## Claude and Codex Auto-ping

Auto-ping is an opt-in setting for each active Claude or Codex OAuth connection. Enable it from the connection row on the provider page, the Provider Limits view, or the CLI connection actions. DurinDoor persists the choice with that connection and sends a minimal request only when the provider reports that the five-hour session window is ready to restart. Codex auto-ping also waits when a longer blocking quota is exhausted.

The scheduler rechecks both the connection and its setting immediately before sending. Disabling or deleting a connection removes its saved entry and cancels pending work where possible. A request already accepted by the upstream provider cannot be recalled. Auto-ping never applies to API-key connections or providers other than Claude and Codex.

Dashboard and CLI updates use a connection-scoped endpoint. Concurrent changes to different accounts preserve each other, and rapid changes to one dashboard toggle are serialized so the last selection wins. If an update fails, the dashboard restores the last server-confirmed value.

## Cost Estimates

Cost estimates require pricing data and usage data. If either is missing, cost may be blank or approximate.

Use cost estimates for:

- Comparing provider mix.
- Detecting accidental use of expensive models.
- Validating combo behavior.
- Creating budget review reports.

Do not treat estimates as invoices. The upstream provider remains the billing authority.

## Analytics Period Semantics

Usage analytics use one shared period contract across the dashboard, stats API, chart API, and database repository:

- `Today` starts at midnight in the DurinDoor server timezone. On daylight-saving transitions its hourly chart contains the actual 23 or 25 local hours.
- `24h` is an exact rolling 86,400,000-millisecond window ending at the current server time.
- `7D`, `30D`, `60D`, `90D`, `180D`, and `365D` are inclusive server-local calendar-day windows. For example, `7D` includes today and the six preceding local dates.
- `All` includes every retained calendar day. The chart fills gaps from the earliest retained day through today. Long histories are grouped into at most 366 deterministic buckets without dropping totals.

All bounded queries exclude future-dated records. Cached and cache-creation tokens remain subsets of input tokens and are reported separately; reasoning tokens are reported separately from normal output tokens. Chart `tokens` remains the compatible input-plus-output value, with cached, cache-creation, and reasoning values available as additive fields rather than being double-counted. Historical daily rollups created by older DurinDoor versions did not store the newer reasoning and cache-creation detail fields, so those additive fields can be zero for retained pre-upgrade days even when the compatible input/output totals and cost remain complete.

## Request Logs and Privacy

Request logs can contain sensitive prompts, responses, file names, URLs, tokens, or user data. Keep request body logging disabled unless you need it for debugging and have permission to store that content.

Recommended production settings:

- Keep `ENABLE_REQUEST_LOGS=false` unless actively debugging.
- Restrict dashboard access.
- Rotate API keys used by shared tools.
- Delete old logs according to your retention policy.
- Avoid logging credentials or session cookies.

## Provider Limits

Provider limits combine live errors, cooldowns, token refresh state, and known quota information. A provider can appear healthy while a single model or account is temporarily locked.

When traffic unexpectedly falls back:

1. Check the request log.
2. Check the selected provider connection.
3. Look for a model-specific lock.
4. Verify OAuth refresh state.
5. Confirm upstream quota or billing state.

## Resetting Usage

Use reset actions carefully. Resetting local usage does not reset upstream provider quota or billing. It only changes DurinDoor's local tracking data.

Before deleting usage data, export or back up the database if you need historical reporting.
