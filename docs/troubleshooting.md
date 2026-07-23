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
