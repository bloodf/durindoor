# Proxy Timeline

The Timeline page records redacted hops and client frames for proxy calls. Capture is off by default.

## Settings

In **Settings** (`/dashboard/profile`):

| Key | Default | Meaning |
| --- | --- | --- |
| `enableProxyTimeline` | `false` | Write traces to the sidecar database. |
| `proxyTimelineRetentionDays` | `1` | Keep traces for 1, 3, or 7 days. |

These are flat settings keys. They are not nested and they are not in `PROTECTED_SETTING_KEYS`.

`enableObservability` still controls Usage → Details snapshots. The two switches are independent. The stored `enableObservability2` key is migrated into `enableObservability` once and then dropped.

## Storage

Traces live in `${currentDbDir()}/proxy-timeline.sqlite` next to the main database. The sidecar is not included in backups. Secrets in headers and payloads are always stored as `[redacted]`.

## Dashboard

- **Timeline** (`/dashboard/timeline`) lists traces and can live-tail new events.
- Live updates are coalesced so streamed frames do not trigger one full list reload each.
- A trace detail page shows oldest-first hops. Consecutive `sse_chunk` events collapse as "N chunks" until expanded.
- Provider and connection rows expose **View all**, which opens Timeline filtered to that provider or `connectionId`.
- Usage → Details is unchanged. Timeline does not read `requestDetails`.
