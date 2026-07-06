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

## Cost Estimates

Cost estimates require pricing data and usage data. If either is missing, cost may be blank or approximate.

Use cost estimates for:

- Comparing provider mix.
- Detecting accidental use of expensive models.
- Validating combo behavior.
- Creating budget review reports.

Do not treat estimates as invoices. The upstream provider remains the billing authority.

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
