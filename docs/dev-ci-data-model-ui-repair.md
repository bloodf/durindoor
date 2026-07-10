# Data, model, and provider repair notes

This repair restores the model catalog, usage dashboard, provider form, and database migrations on `dev`.

## Live model catalogs

`buildModelsList` keeps this precedence for an active connection:

1. Explicit enabled models and the static provider catalog.
2. A provider-specific live resolver, such as Kiro or GitHub Copilot.
3. An OpenAI-shaped `modelsFetcher` from the provider registry.
4. The `/models` endpoint for a local passthrough provider.

Registry fetchers accept the `openai` and `openai-compatible` response shapes. Local passthrough discovery accepts a connection without an API key and sends a Bearer header when the connection has one. Fetch errors return an empty catalog so custom models and aliases still load.

## Usage data

The `agy` provider uses the Antigravity usage handler. xAI has no stable consumer quota endpoint, so the dashboard sums DurinDoor request history for the selected connection over the closed interval from 30 days ago through the current time. Future-dated history is excluded.

The database file, legacy JSON sources, migration marker, and backup directory are all derived from the same resolved `DATA_DIR` at access time. Tests and isolated processes can switch data directories without reusing an adapter or in-flight initialization promise for a different SQLite file.

API-key statistics use a SHA-256 fingerprint for internal identity and keep the masked prefix for display. Unregistered-key labels show 12 digest characters rather than raw key material. Chart and statistics requests share the same period definitions; `90d`, `180d`, and `365d` use matching date filters and daily bucket counts.

## Account ID providers

Cloudflare Workers AI and Snowflake Cortex require `providerSpecificData.accountId`. The add and edit forms collect that value for validation and saves. Bulk rows use this required format:

```text
name|apiKey|accountId
```

The Account-ID single-add path trims IDs, rejects blank or whitespace-only values, and saves only after provider validation succeeds. Other providers retain the existing `testStatus: "unknown"` save fallback when validation is unavailable. Bulk rows reject an omitted third field. Snowflake examples use the dashed hostname form, such as `org-account`.

## Migration order and lifetime totals

The migration registry uses one version per change:

| Version | Migration |
| --- | --- |
| 4 | API-key expiry |
| 5 | Daily token limit |
| 6 | API-key policy and initial lifetime-total backfill |
| 7 | Lifetime-total repair for databases stamped at version 6 |

Migration 7 rebuilds registered-key totals from `usageHistory`. Repeated runs replace each registered row with the same aggregate. The backfill retains rollups whose API-key record no longer exists.

`saveRequestUsage` increments a registered key inside the history transaction after it inserts a new history row. A retry with the same history identity returns before the increment, which keeps request and token totals stable.

API-key create, update, read, export, and import paths preserve `policy` and `expiresAt`. Validation rejects an active key after its valid expiry timestamp while retaining its database record.

The migrations add columns and tables without changing stored key values. A version-6 database runs only migration 7 on restart, stamps version 7, and leaves totals stable on later restarts. Both legacy `sk-<8 hex>` keys and current structured `sk-...` keys retain their existing secret bytes.
