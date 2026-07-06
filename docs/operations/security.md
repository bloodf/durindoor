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
- Revoke unused keys.
- Do not share provider API keys with client tools.
- Rotate keys after exposure.
- Keep `API_KEY_SECRET` stable so generated keys remain valid.

## Provider Credentials

Provider API keys, OAuth tokens, refresh tokens, and cookies are sensitive. They are stored under `DATA_DIR`.

Protect:

- `DATA_DIR/db/data.sqlite`
- `DATA_DIR/auth/`
- `DATA_DIR/mitm/`
- database backups
- exported logs

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

