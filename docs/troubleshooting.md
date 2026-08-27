# Troubleshooting

Isolate common DurinDoor failures. Start with the local gateway, then check client configuration, then provider configuration.

## Quick checks

```bash
curl http://localhost:20128/api/health
curl http://localhost:20128/v1/models \
  -H "Authorization: Bearer YOUR_DURINDOOR_API_KEY"
```

If health fails, DurinDoor is not reachable. If the model list fails, check the API key and dashboard state.

## Connection refused

- Confirm DurinDoor is running.
- Confirm the port is correct.
- Confirm the client includes `/v1` for API requests.
- Check firewall or container networking.
- In Docker, confirm the port is published (`-p 20128:20128`).

## Invalid API key

- Use a DurinDoor API key, not an upstream provider key.
- Copy the whole key from the dashboard.
- Regenerate if it was rotated or deleted.
- Confirm `API_KEY_SECRET` did not change between deployments.

## Model not found

- Call `/v1/models` and use the exact model ID.
- Use a combo name for stable client configuration.
- Confirm the provider connection is active.
- Check whether the model is valid for the endpoint type.

## Provider authentication failure

- Open the provider in the dashboard.
- Reconnect OAuth providers.
- Rotate or replace API keys.
- Check whether the upstream account revoked access.
- For unavailable connections, read the dashboard error detail before reconnecting. Transport failures retain safe diagnostics such as `fetch failed (ECONNREFUSED)`; use the code to check DNS, firewall, proxy, and upstream reachability.

## Rate limits or quota exhaustion

- Check Usage and Provider Limits in the dashboard.
- Wait for the upstream reset window.
- Add another connection or a combo fallback.

## Streaming problems

- Increase reverse proxy read and send timeouts.
- Test without the proxy on localhost.
- Try non-streaming mode if the client supports it.
- Check whether the selected provider supports streaming.

## Dashboard login problems

- Confirm the correct `INITIAL_PASSWORD` or current password.
- Confirm cookies are accepted by the browser.
- Check `JWT_SECRET` consistency across restarts.
- If behind a reverse proxy, confirm `X-Forwarded-Proto` is set correctly and `AUTH_COOKIE_SECURE=true` is set when using HTTPS.

## Docker networking

- Use a Docker network service name for another container.
- Use `host.docker.internal` on macOS and Windows.
- On Linux, add `extra_hosts: - "host.docker.internal:host-gateway"`.

## MITM Proxy, Root CA, Redirect, or Startup Lock Errors

Symptoms:

- MITM fails with a Root CA generation or read error on first start.
- `MITM server is already starting` from another request in this process.
- `MITM server is already starting (lock contention)` from another process.
- Startup reports that PF is disabled, an iptables rule failed, Windows firewall isolation failed, or the authenticated public-port check failed.
- A restart says that a fresh sudo credential or UAC-approved start is needed.
- `MITM_PRIVILEGED_OPERATION_UNCERTAIN` after a sudo/UAC timeout or an interrupted redirect installation.
- A live legacy integer `.mitm.pid` is refused after an upgrade.

Fixes:

1. Run DurinDoor as a standard user. The full Node.js proxy is never elevated. Only the exact certificate, hosts-file, firewall, or port-redirect mutation is delegated to sudo/UAC.
2. On macOS and Linux the proxy listens on `127.0.0.1:8443`; an owner-scoped kernel rule redirects that user's `127.0.0.1:443` traffic. macOS PF must already be enabled; Linux requires sudo plus iptables with `owner`, `multiport`, and `comment` matches.
3. On Windows the standard-user proxy binds `127.0.0.1:443` directly. DurinDoor uses a narrow UAC operation to install an owner-conditioned outbound firewall rule.
4. The proxy independently verifies the OS owner of every new loopback connection. Mutating MITM controls require a valid dashboard JWT or the machine-bound CLI token.
5. Sudo passwords are memory-only. DurinDoor clears legacy `mitmSudoEncrypted` settings and never writes a replacement secret.
6. Stop removes only exact tagged hosts entries while the verified proxy is available, then stops the process, removes only the current user's exact redirect or firewall identity, and finally removes PID metadata.
7. The redirect journal is global to the OS user, not to `DATA_DIR`: `~/.durindoor-mitm-state/redirect.json` on macOS/Linux and `%USERPROFILE%\AppData\Local\DurinDoor\mitm-state\redirect.json` on Windows.
8. A live integer-only `.mitm.pid` came from the previous privileged-launcher design. Stop MITM with the old DurinDoor version before updating. If that is no longer possible, close DurinDoor and reboot. Never raw-kill the recorded PID because it may have been reused by an unrelated process.

### Recover an uncertain privileged MITM operation

An `installing` or `uncertain` redirect journal is a quarantine marker. Close every DurinDoor process and reboot. Reboot is the boundary that proves the unconfirmed privileged process tree has ended. Then inspect and remove only the current user's exact DurinDoor rule, verify absence, and delete the user's `redirect.json` path. Preserve `.mitm.pid`, Root CA files, and trust-rotation journals.

## Upgrades

If problems appeared after an upgrade:

1. Back up `DATA_DIR` and restore from the pre-upgrade backup.
2. Check [CHANGELOG.md](../CHANGELOG.md) for breaking changes.
3. Confirm `API_KEY_SECRET` and `JWT_SECRET` are stable.
4. Verify providers and keys in the dashboard.

See [Upgrading](operations/upgrading.md) for the full procedure.

## Still stuck

1. Collect logs: `docker logs durindoor` or runtime logs from `DATA_DIR/logs/`.
2. Check [Startup](operations/startup.md) for health check and verification steps.
3. Check [Data Management](operations/data-management.md) if data is missing or corrupt.
4. Search [GitHub Issues](https://github.com/bloodf/durindoor/issues) for similar reports.

## Related pages

- [Startup](operations/startup.md)
- [Security](operations/security.md)
- [Upgrading](operations/upgrading.md)
- [Data Management](operations/data-management.md)
