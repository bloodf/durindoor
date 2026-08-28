# Security and Production Hardening

DurinDoor stores provider credentials and routes model traffic. Treat it as sensitive infrastructure.

## Production Baseline

Before exposing DurinDoor outside localhost:

1. Set a strong `INITIAL_PASSWORD`.
2. Set stable random `JWT_SECRET` and `API_KEY_SECRET` values. `JWT_SECRET` is required for fresh installs (DurinDoor no longer auto-writes `DATA_DIR/jwt-secret`). Existing installs that already have that file keep working with a startup warning until you move the value into the env var.
3. Use HTTPS.
4. Restrict dashboard access with a VPN, firewall, reverse proxy auth, or trusted network.
5. Create separate DurinDoor API keys for each tool or user.
6. Keep `ENABLE_REQUEST_LOGS=false` unless debugging.
7. Back up `DATA_DIR`.
8. Monitor usage logs for unexpected traffic.

## Dashboard Access

The dashboard can create API keys, add upstream provider credentials, configure tunnels, and inspect usage. Do not expose it publicly with only the default password.

### Local MCP plugin bridges

`GET` `/api/mcp/[plugin]/sse` and `POST` `/api/mcp/[plugin]/message` spawn or talk to host stdio MCP children. They are under `LOCAL_ONLY_PATHS`: unauthenticated remote callers receive `403`. Access requires a machine-bound CLI token (`x-9r-cli-token`), or a loopback peer that satisfies the dashboard login policy (JWT when `requireLogin` is enabled; open-dashboard when it is disabled). Cowork MCP apply injects the CLI token into local `/api/mcp/...` SSE entries so legitimate desktop clients keep working. Handlers re-check the same gate in-process. SSE sessions unregister on client abort as well as stream cancel so orphaned children are reaped.

The management control endpoint `POST` `/api/mcp/control` is exempt from the loopback-only branch and instead requires CLI token, API key, or dashboard JWT (including remote). The MCP gateway (`/api/mcp-gateway`) uses gateway keys, not this LOCAL_ONLY policy.

### Database export and import

`GET`/`POST` `/api/settings/database` is always gated by the dashboard guard (JWT or machine-bound CLI token). That first factor alone is not enough: the handler also requires the current dashboard password (`x-9r-password` on export, `password` in the JSON body on import). A stolen CLI token therefore cannot dump or replace credentials remotely.

The Profile page Export/Import flow already prompts for the password and continues to work for a logged-in session. Scripted CLI backups must send both the CLI token and the password.

If the dashboard password is lost, use the loopback-only emergency path `POST /api/auth/reset-password` (CLI token or trusted local origin), then set a new password before exporting again. There is no loopback-only bypass that exports or imports with a CLI token alone.

Remote login with the built-in `123456` password is refused before a dashboard session cookie is issued. Set `INITIAL_PASSWORD` or a stored dashboard password before any remote access. The login screen surfaces the default-password hint only when `settings.password || INITIAL_PASSWORD || 123456` resolves to the literal built-in password, so a stored custom password or OIDC mode hides it.

Recommended controls:

- HTTPS only for remote access.
- Strong dashboard password.
- Reverse proxy authentication for public deployments.
- IP allowlists where possible.
- `AUTH_COOKIE_SECURE=true` behind HTTPS.
- `TRUST_PROXY=true` only when the proxy is trusted and strips spoofed forwarding headers.

## DurinDoor API Keys

DurinDoor API keys authenticate client tools to the gateway.

Best practices:

- Create one key per tool, user, or automation.
- Set the shortest practical expiry. Available presets are never, 1, 7, 30, and 90 days, plus a custom local date and time.
- Revoke unused keys.
- Do not share provider API keys with client tools.
- Rotate keys after exposure.
- Keep `API_KEY_SECRET` stable so generated keys remain valid.

The full key is returned once, in the creation response. Management list/detail responses and CLI-tool status responses redact stored credentials. Keep the creation output in a password manager; the dashboard and CLI cannot reveal an old key again.

### Model policy and committed limits

Each API key can restrict canonical runtime model identities and set lifetime committed token/cost caps. Policy enforcement runs after alias/provider/combo resolution but before provider credentials or network work. It applies to chat, Responses, images, embeddings, audio, moderation, rerank, web, music, video, native Gemini audio, batch rows, and realtime session models. Web search and fetch use distinct `provider/search` and `provider/fetch` identities; a legacy bare-provider policy remains a compatibility grant for both.

An empty `allowedModels` list is explicitly unrestricted. A non-empty list is an allowlist. Combo names are rejected from this list, because a combo is separately authorized by `allowedCombos` and each selected concrete member is checked against the model policy. Malformed stored policy fails closed. Dashboard edits omit untouched policy data and send field patches, so an expiry or combo edit cannot silently clear malformed restrictions or erase forward-compatible policy fields.

Token/cost caps are committed counters, not reservations. Requests are denied once a committed counter has reached its cap; a request already in flight can finish and cross the cap. Retry-safe server event IDs ensure the same chat completion is committed once. Reasoning is a subset of completion, cached input is a subset of input, and dedicated pricing is applied to each subset once. Direct non-negative provider cost wins over local price calculation.

The v6 backfill reconciles v3/v4/v5 history once during migration, preserves literal key bytes, and uses historical stored cost rather than recalculating it with current prices. Existing stamped-v6 databases receive missing totals without overwriting live counters. Imports with explicit totals validate non-negative numeric values and timestamps atomically. Older full backups without totals start imported keys at zero; retained analytics history has its old key attribution removed so a reused secret cannot inherit a daily or lifetime limit.

Files and local batch resources are owned by the stable API-key row ID. Other keys receive a not-found response for list/detail/content/delete/cancel/results access. The machine-bound CLI operator token has deliberate cross-owner administration. Ownerless pre-upgrade files remain local-only, and local placeholder keys remain compatible only while global API-key enforcement is disabled. Batch row execution forwards the creator's normalized credential and does not accept auth from a row body.

Current daily token limits are enforced by the chat history path. The quota program extends authoritative daily/lifetime accounting and reservation semantics across every non-chat modality; do not treat a daily-only cap as a universal media/web budget until that stage is deployed.

Expiry values are stored as canonical UTC timestamps. Custom dashboard/CLI input is interpreted in the operator's local timezone, and displays use local time. Selecting **Never expires** during an edit explicitly clears the value. Enforcement uses server time and treats `now == expiresAt` as expired. Missing expiry on an older key means it never expires; malformed stored expiry fails closed. Expired, inactive, and otherwise invalid credentials intentionally share the same generic unauthorized response.

### Upgrade and backup compatibility

The published schema order is fixed: v4 adds API-key daily limits, v5 adds nullable expiry, v6 adds API-key policy and lifetime usage totals, v7 adds provider quota snapshots plus separate fetch outcomes, and v8 adds the operational quota reservation header/items ledger. The v7 and v8 quota DDL are frozen in their versioned migrations and guarded by independent fingerprints; later schema work must allocate a new migration. Startup supports fresh databases and skip-version upgrades, including a compatible expiry column left by a partial historical migration. Existing quota table and named-index definitions are checked before backup or mutation—even if a malformed v8 object was prematurely created while the database still carries a v7 stamp—and orphan foreign-key rows fail closed. A missing safe index triggers the checkpoint/backup path, is recreated, and is verified after additive synchronization.

Database export/import, automatic pre-upgrade backups, and legacy JSON migration preserve the literal key bytes, name, machine ID, active state, combo access, daily limit, policy, expiry, creation time, and lifetime totals. The versioned quota export subtree contains only normalized, non-secret observations and fetch status; operational reservation rows are excluded. Import validation rejects duplicates, dangling connections, provider mismatches, unsupported versions, source-watermark inconsistencies, aggregate/per-source row-limit violations, oversized streamed request bodies, and observation/fetch timestamps beyond the bounded clock-skew policy before destructive replacement. The destructive import transaction takes the quota writer lock, reaps expired leases, and rejects every remaining active reservation so another process cannot acquire or dispatch between the guard and connection replacement. Portable export reads every linked table in one transaction and refuses orphan or source-inconsistent quota rows rather than silently omitting them. Raw safety backups retain reservation rows for crash recovery; owner fencing and bounded leases prevent stale process epochs from becoming new capacity. Imports accept historical expired API-key timestamps but reject local-only or malformed timestamps atomically. Upgrades and restores do not rotate existing keys.

## Provider Credentials

Provider API keys, OAuth tokens, refresh tokens, and cookies are sensitive. They are stored under `DATA_DIR`.

Protect:

- `DATA_DIR/db/data.sqlite`
- `DATA_DIR/auth/`
- `DATA_DIR/mitm/`
- database backups
- exported logs

### Provider quota fetch isolation

Provider quota refreshes use fixed HTTPS endpoint configuration, reject URL credentials and redirects, bound response size and retry deadlines, and never retain raw response bodies. Provider/account/resource identities are validated namespaced values; private upstream identifiers are one-way hashed before persistence. API keys, OAuth tokens, refresh tokens, cookies, proxy credentials, emails, raw device IDs, and token-derived cache keys are forbidden in snapshots, fetch states, cache identities, and quota export metadata.

The quota tracker shares only equal provider/connection/revision work. Subscriber cancellation propagates when the last caller leaves. Unique generation tokens, a repository-side commit predicate, and the durable source watermark prevent a delayed or forced-over generation from writing or entering cache. The tracker returns repository-current data when another process won the source race. Its cache and generation/observation state are bounded and released together.

Credential refresh is coordinated per provider connection. A caller cancelled before the provider request starts performs no work; after an OAuth rotation request starts, the shared operation completes its credential write even if that individual quota caller detaches or reaches its bounded wait deadline. This prevents a single-use replacement refresh token from being discarded after the provider invalidates the old token without issuing duplicate refreshes. The SQLite transaction acquires a writer lock before its read, compares a pre-request copy of the credential bytes and issuer/routing metadata (including supported legacy aliases), merges onto the latest row only while that context matches, and otherwise keeps the concurrent winner. Executors receive cloned metadata, unrelated connection edits do not block or get overwritten, and unchanged legacy metadata echoed by a refresher is preserved without being rewritten or allowed to veto an issued token rotation. A losing `invalid_grant` request performs a short read-only reconciliation window for a concurrent winner before requiring reauthorization. Every successful refresh must contain a bounded non-empty access token; expiry seconds accept only positive integer numbers or strict decimal strings. Only valid expiries and a typed allowlist of non-secret provider metadata can otherwise change; a malformed mixed result performs no partial write, and generic refresh metadata cannot replace top-level or nested API keys, client secrets, cookies, or other credential fields. Refresh and auto-ping logs use fixed/redacted messages and never include arbitrary upstream response bodies. Kiro region-derived AWS hosts are validated and normalized before any token, client secret, or refresh token can be sent; stored profile-ARN bytes are preserved, and unsupported Kiro quota credential modes are rejected before proxy resolution or refresh.

Google Cloud Code project IDs are account-bound and survive access-token rotation. Credential refresh therefore keeps any stored `projectId` and runs route-aware discovery only when the refreshed connection has none. A completed onboarding response without a usable project ID is terminal: the account is not provisioned, so DurinDoor returns no project ID after the discovery and onboarding requests instead of repeating the same completed operation.

### Quota preflight and runtime evidence

Credential selection reads persisted normalized snapshots while holding a provider-scoped selection turn, but it never performs provider network I/O there. Unrelated providers do not block each other, and the SQLite reservation transaction remains the capacity authority. Runtime evidence is checked first. Provider-API rows must match the provider's configured authoritative source ID and exact resource/dimension policy. `all-required`, `any-sufficient`, and `first-present` gates preserve constrained-resource, alternative-pool, and priority-bucket semantics. Missing, stale, unknown, unsupported, foreign-source, repository-error, and non-applicable states fail open. Persisted tracker backoff prevents a stale or failed source from triggering one provider refresh per request; background refresh starts only after the selection turn is released and uses the shared bounded tracker.

429 parsing consumes raw response material only inside the parser. Provider error bodies and retry probes have a 64 KiB, two-second read bound; unexpected non-SSE bodies use a 16 KiB, two-second bound. Successful non-streaming and forced stream-to-JSON chat bodies use the separately configurable `MAX_PROVIDER_BODY_BYTES` (8 MiB default) and `PROVIDER_BODY_TIMEOUT_MS` (120 seconds default) limits. Forced Responses conversion additionally caps `output_index` to `MAX_RESPONSES_OUTPUT_ITEMS` (1,024 default), requires a dense nonnegative integer sequence with no duplicates, and never allocates an array from an untrusted maximum index. Cloud Code project discovery and onboarding bodies are limited to 256 KiB and 30 seconds while retaining request cancellation through parsing. Timeout, oversize, or abort cancels the reader without waiting on a cancellation-resistant stream, and the concurrency slot remains held until the body is consumed or cancelled. Persisted evidence contains a fixed state/reason, exact non-secret connection and canonical resource identity, bounded timestamps, an empty metadata object, and a stable digest derived only from the public resource key. Raw bodies, headers, URLs, display names, emails, account IDs, tokens, cookies, proxy credentials, and arbitrary passthrough model strings are never copied into runtime quota rows, fetch states, diagnostics, or client 429 messages. Client-facing 429 text is fixed, and diagnostic URLs redact credentials plus sensitive query and fragment values. A generic 429 creates only a bounded transient cooldown. 401/403 remains the one-refresh authentication path and never creates quota evidence.

Legacy connection health writes take SQLite's writer lock, compare monotonic per-scope attempt watermarks, and extend rather than shorten active locks. Success clears are scoped and use the same attempt-start ordering. A successful request persists bounded canonical-model and account watermarks, plus authoritative empty normalized source states, even when the connection had no prior blocker. This prevents an old slow success from erasing a newer failure and prevents an old slow failure from resurrecting state after a newer success on either populated or pristine state. Unknown model strings still collapse to the single legacy `__all` scope and create no normalized source. The schema-v7 atomic record/clear path preserves the connection's existing `updatedAt`; runtime health is not a credential revision and cannot invalidate quota deduplication keys or OAuth compare-and-swap state. These writes update only health metadata; provider API keys and OAuth secret bytes are not read into diagnostics or rewritten.

Native streaming terminals are validated before runtime health can clear. SSE event labels remain attached to the matching data record across chunk and final-line boundaries. Failure/event contradictions, post-terminal data, early or duplicate `[DONE]`, malformed JSON, and truncated streams remain sticky failures in streaming, forced-JSON, and auto-ping paths. OpenAI may emit one usage-only trailer after all choices finish; Responses may emit optional `[DONE]` only after a completed or incomplete application terminal. Kiro additionally verifies AWS EventStream length/header bounds, strict header encoding, UTF-8/JSON payloads, and both prelude and message CRC32 values without logging raw payload bytes. Codex bounds the whole pre-stream SSE prefix inspection below the reservation lease, including silent bodies and endless preambles, and uses bounded reader cancellation on timeout. Cursor caps compressed and decompressed bodies, hard-destroys timed-out HTTP/2 sessions, preserves protobuf bytes in DNS bypass, authenticates the original hostname while connecting to the independently resolved IP, and delegates strict or ambient proxy routing to the common fail-closed proxy boundary. Explicit direct mode alone disables environment proxy inheritance. Quota-bearing runtime fetches reject redirects so native 307/308 handling cannot repeat a POST without a new physical-dispatch ticket. When Next.js later marks and wraps DurinDoor's global fetch, the common direct boundary invokes the transport captured before DurinDoor installed its proxy wrapper, preventing recursive proxy routing while preserving ordinary embedder fetch replacement.

Request abort is checked before model/auth/database work, before selection, before dispatch, before fallback, during retry delays, during successful/error body consumption, and during shared refresh waits. Cloud Code project discovery is subscriber-aware: the last cancelled subscriber aborts its fetch/onboarding work, an aborted entry cannot absorb a new request, and credential invalidation aborts and evicts every pending discovery for that connection so an old token cannot repopulate the cache. Once a provider may have rotated a one-time OAuth token, its shared credential transaction may still finish for account safety, but the abandoned request performs no later provider dispatch or quota/health write.

AgentRouter can report temporary user-quota exhaustion as HTTP 400 or 403 with the provider-specific `额度不足` marker. DurinDoor restates those responses to retryable 429 before fallback classification, preserving an upstream retry deadline when present and otherwise applying a 60-second retry. After restatement the new 429 is re-parsed through the same bounded `parseRateLimitEvidence` path so any `Retry-After`/reset header or body deadline carried in the original response is honored over the synthetic default. `src/sse/services/auth.js` forwards the provider id and `open-sse/services/combo.js` forwards provider id, response headers, and structured body into `checkFallbackError`, so provider-specific rules (AgentRouter 6h model-denial cooldown, quota-shaped 400/403 fallback) take effect instead of being collapsed to generic status-code classification. Model-access denials remain 403 and keep their separate cooldown behavior.

The public provider-health endpoint keeps transport reachability separate from quota eligibility. Its quota decoration is limited to a boolean decision plus fixed reason/freshness values. Quota amounts, exact resource identities, source IDs, account scope, and reset/cooldown timestamps require an authenticated management surface planned for the management batch and are not added to this endpoint.

### OAuth routing and callback state

Dashboard OAuth logins use one immutable egress mode for the whole flow:

- **Direct** disables ambient `HTTP_PROXY`, `HTTPS_PROXY`, and `ALL_PROXY` use.
- **Strict pool** re-resolves the selected active proxy pool for every authorize,
  exchange, device poll, profile lookup, token refresh, and retry. A missing,
  inactive, invalid, or failed pool stops the request; it never falls back to
  direct or ambient networking.
- **Legacy** is retained only for callers that omit the routing field. It keeps
  the historical best-effort environment/config behavior.

The selected route also applies to runtime model-catalog discovery and web
search requests, including any token refresh and retry they trigger.

Only the routing mode and pool ID are stored with a provider connection. Proxy
URLs and credentials stay in the proxy-pool record and are not returned in the
browser OAuth payload.

PKCE verifiers, provider metadata, device codes, and device client secrets are
kept in an expiring server-side flow. Exchanges and polls present an opaque flow
ID and the exact OAuth state; the server ignores client attempts to replace the
redirect URI, verifier, metadata, or proxy. Authorization codes are one-shot,
device polls are single-flight, and switching pools or closing the modal cancels
the prior flow. Codex and xAI fixed-port callbacks use the same contract while
preserving the legacy redirect fallback when no server flow is registered.

OAuth error output redacts tokens, callback code/state values, authorization
headers, client secrets, and proxy URL credentials before logging or returning
an error message. The generic OAuth API reports invalid input or state as 400,
concurrent flow ownership as 409, expired/cancelled/replayed sessions as 410,
and provider exchange or polling failures as 502.

OAuth login is supported by the local, single-process DurinDoor runtime. The
server accepts new OAuth flows only when the official launcher establishes its
single-process capability because PKCE verifiers, device codes, one-shot claims, and fixed-port
callbacks must share one trusted process. Run one DurinDoor process per data
directory; do not load-balance OAuth routes across replicas. Independent
browser sessions receive separate owner scopes, so starting a second login
cannot cancel another user's flow. Secret-bearing provider metadata is accepted
only in POST bodies and is rejected on legacy GET authorization URLs.

### Dashboard OIDC issuer discovery

`fetchOidcDiscovery` validates the configured issuer with `assertPublicUrl` before
fetching `/.well-known/openid-configuration`. Link-local, loopback, RFC1918,
`.internal` / `.local`, and similar metadata hosts are rejected for login start,
callback, and the settings discovery test (`POST /api/auth/oidc/test`). Public
issuer URLs continue to work. DNS pinning for other outbound probes lives in
`outboundUrlGuard` and is not duplicated on this path.

## Request Logs

Detailed request logs may include prompts, responses, tool output, filenames, URLs, source code, and customer data.

Use:

```bash
ENABLE_REQUEST_LOGS=false
```

### Default dashboard password

When effective dashboard password is built-in `123456`, remote login returns
`403` before a session cookie is issued. A loopback login receives a five-minute,
IP-bound, one-time proof which can only set a replacement password through
`POST /api/auth/change-password`. That endpoint creates a dashboard session only
after persisting the new password.

Enable detailed logs only for short debugging windows. If logs must be retained, define retention, access, and deletion policies.

## Tunnels and Public URLs

Tunnels are convenient for tools that cannot reach localhost. They also make your gateway reachable from another network.

Quick-tunnel public subdomains use OS-backed cryptographic randomness while preserving
the existing six-character URL format. During startup, DurinDoor accepts a successful
health response from either the preferred relay URL or the direct Cloudflare URL; both
must remain unavailable for the startup check to fail.

When using tunnels:

- Use HTTPS tunnel URLs.
- Keep dashboard authentication enabled.
- Prefer dedicated API keys for tunnel-connected tools.
- Watch request logs after enabling a tunnel.
- Disable the tunnel when not needed.
- Remote dashboard login is allowed when the browser `Origin` and the `Host` header the gateway receives share the same hostname and port (scheme is ignored, since a tunnel terminates TLS upstream). Tailscale Serve, Cloudflare Tunnel, and most reverse proxies preserve `Host`, so login works with no extra configuration. If your proxy rewrites `Host` to an internal name (e.g. `127.0.0.1`), set `BASE_URL` (and `NEXT_PUBLIC_BASE_URL`) to the public origin, e.g. `https://gateway.example.com`, so that Origin is accepted. Cross-host Origins and port mismatches are always rejected.

## MITM Mode

MITM mode intercepts selected IDE traffic and may require local certificate trust changes. Use it only on machines you control.

Security notes:

- Do not install MITM certificates on shared or untrusted machines.
- Remove certificates when no longer needed.
- Keep `DATA_DIR/mitm/` private.
- Use `DEBUG_MITM` only for troubleshooting.

## Backups

Back up the full `DATA_DIR`, then store backups as sensitive secrets.

Minimum backup targets:

```text
DATA_DIR/db/data.sqlite
DATA_DIR/db/backups/
DATA_DIR/auth/
DATA_DIR/mitm/
```

Test restore procedures before relying on backups.

## Incident Response

If a DurinDoor API key leaks:

1. Revoke the key in the dashboard.
2. Create a replacement key.
3. Update the affected client.
4. Review usage logs for unexpected traffic.

If an upstream provider credential leaks:

1. Revoke or rotate it at the provider.
2. Update the DurinDoor provider connection.
3. Check provider-side billing and audit logs.
4. Review DurinDoor usage logs.

## Related pages

- [Upgrading](upgrading.md) — release notes, backup, version changes
- [Data Management](data-management.md) — backup, restore, migration
- [Startup](startup.md) — health checks, verification, restart
