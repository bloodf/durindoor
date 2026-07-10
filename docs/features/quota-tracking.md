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
