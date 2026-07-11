# Security and Production Hardening

DurinDoor stores provider credentials and routes model traffic. Treat it as sensitive infrastructure.

## Production Baseline

Before exposing DurinDoor outside localhost:

1. Set a strong `INITIAL_PASSWORD`.
2. Set stable random `JWT_SECRET` and `API_KEY_SECRET` values.
3. Use HTTPS.
4. Restrict dashboard access with a VPN, firewall, reverse proxy auth, or trusted network.
5. Create separate DurinDoor API keys for each tool or user.
6. Keep `ENABLE_REQUEST_LOGS=false` unless debugging.
7. Back up `DATA_DIR`.
8. Monitor usage logs for unexpected traffic.

## Dashboard Access

The dashboard can create API keys, add upstream provider credentials, configure tunnels, and inspect usage. Do not expose it publicly with only the default password.

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

The published schema order is fixed: v4 adds API-key daily limits, v5 adds nullable expiry, v6 adds API-key policy and lifetime usage totals, and v7 adds provider quota snapshots plus separate fetch outcomes. The v7 quota DDL is frozen in its versioned migration and guarded by an independent fingerprint; later schema work must allocate a new migration. Startup supports fresh databases and skip-version upgrades, including a compatible expiry column left by a partial historical migration. Quota table and named-index definitions are compared with the canonical v7 DDL, and orphan foreign-key rows fail closed. An incompatible pre-existing expiry or quota object stops startup before backup or schema mutation; a missing safe index triggers the same checkpoint/backup path as a missing table, is recreated, and is verified after additive synchronization.

Database export/import, automatic pre-upgrade backups, and legacy JSON migration preserve the literal key bytes, name, machine ID, active state, combo access, daily limit, policy, expiry, creation time, and lifetime totals. The versioned quota export subtree contains only normalized, non-secret observations and fetch status; its identity, provenance, metadata values, and unknown-field errors cannot retain or echo credential-like or raw input. Import validation rejects duplicates, dangling connections, provider mismatches, unsupported versions, source-watermark inconsistencies, aggregate/per-source row-limit violations, oversized streamed request bodies, and observation/fetch timestamps beyond the bounded clock-skew policy before destructive replacement. Portable export reads every linked table in one transaction and refuses orphan or source-inconsistent quota rows rather than silently omitting them. Imports accept historical expired API-key timestamps but reject local-only or malformed timestamps atomically. Upgrades and restores do not rotate existing keys.

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

## Request Logs

Detailed request logs may include prompts, responses, tool output, filenames, URLs, source code, and customer data.

Use:

```bash
ENABLE_REQUEST_LOGS=false
```

Enable detailed logs only for short debugging windows. If logs must be retained, define retention, access, and deletion policies.

## Tunnels and Public URLs

Tunnels are convenient for tools that cannot reach localhost. They also make your gateway reachable from another network.

When using tunnels:

- Use HTTPS tunnel URLs.
- Keep dashboard authentication enabled.
- Prefer dedicated API keys for tunnel-connected tools.
- Watch request logs after enabling a tunnel.
- Disable the tunnel when not needed.

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
