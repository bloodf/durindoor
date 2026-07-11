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

Expiry values are stored as canonical UTC timestamps. Custom dashboard/CLI input is interpreted in the operator's local timezone, and displays use local time. Selecting **Never expires** during an edit explicitly clears the value. Enforcement uses server time and treats `now == expiresAt` as expired. Missing expiry on an older key means it never expires; malformed stored expiry fails closed. Expired, inactive, and otherwise invalid credentials intentionally share the same generic unauthorized response.

### Upgrade and backup compatibility

The published API-key schema order is fixed: v4 adds daily limits, v5 adds nullable expiry, and v6 adds policy and lifetime usage totals. Startup supports fresh databases and upgrades from v3, v4, or v5, including a compatible expiry column left by a partial historical migration. An incompatible pre-existing expiry column stops startup before backup or schema mutation.

Database export/import, automatic pre-upgrade backups, and legacy JSON migration preserve the literal key bytes, name, machine ID, active state, combo access, daily limit, policy, expiry, creation time, and lifetime totals. Imports accept historical expired timestamps but reject local-only or malformed timestamps atomically. Upgrades and restores do not rotate existing keys.

## Provider Credentials

Provider API keys, OAuth tokens, refresh tokens, and cookies are sensitive. They are stored under `DATA_DIR`.

Protect:

- `DATA_DIR/db/data.sqlite`
- `DATA_DIR/auth/`
- `DATA_DIR/mitm/`
- database backups
- exported logs

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
