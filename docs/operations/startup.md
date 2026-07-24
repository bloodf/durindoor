# Startup and Runtime Operations

How to start, stop, verify, and operate DurinDoor.

## Runtime modes

| Mode | Command | Port | Best for |
|---|---|---|---|
| Global CLI | `durindoor` | 20128 | Personal desktop use |
| npx | `npx durindoor` | 20128 | Quick evaluation |
| Source dev | `npm run dev` | 20127 | Contributor development |
| Source prod | `npm run build && npm start` | 20128 | Manual server deployments |
| Docker | `docker run …` | 20128 | VPS, home server, team |

## First startup

1. Install or clone.
2. Set `DATA_DIR` to a persistent path.
3. Set `JWT_SECRET` and `INITIAL_PASSWORD` for remote exposure.
4. Start the server.
5. Open http://localhost:20128/dashboard and sign in.
6. Change the password.
7. Add a provider connection.
8. Create a DurinDoor API key.
9. Send a test request.

## CLI

```bash
durindoor
```

Options:

```bash
durindoor --port 8080
durindoor --no-browser
durindoor --skip-update
durindoor --help
```

## Source

Development:

```bash
npm install --no-audit --no-fund
npm run dev   # port 20127
```

Production:

```bash
npm install --no-audit --no-fund
npm run build
npm start    # port 20128
```

## Docker

```bash
docker run -d \
  --name durindoor \
  -p 20128:20128 \
  -v "$HOME/.durindoor:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="change-me" \
  -e INITIAL_PASSWORD="change-me" \
  ghcr.io/bloodf/durindoor:3.9.0
```

See [Cloud Deployment](../deployment/cloud.md) for the full production compose setup.

## Health checks

```bash
curl http://localhost:20128/api/health
```

Check model visibility:

```bash
curl http://localhost:20128/v1/models \
  -H "Authorization: Bearer YOUR_DURINDOOR_API_KEY"
```

## Smoke test

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Authorization: Bearer YOUR_DURINDOOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MODEL_ID_OR_COMBO",
    "messages": [{"role": "user", "content": "Reply OK."}],
    "max_tokens": 16
  }'
```

## Graceful shutdown

```bash
# CLI / source
Ctrl+C

# Docker
docker stop durindoor
```

Always stop before backing up or upgrading. See [Data Management](data-management.md).

## Restart after configuration changes

Restart after changing: `PORT`, `HOSTNAME`, `DATA_DIR`, `JWT_SECRET`, `API_KEY_SECRET`, proxy variables, or OAuth overrides.

Dashboard settings stored in the database usually do not require a restart.

## Logs

```bash
# Docker
docker logs -f durindoor

# Source / CLI
# Runtime logs go to DATA_DIR/logs/
```

## Common startup failures

| Symptom | Cause | Fix |
|---|---|---|
| Port in use | Another process owns 20128 | Stop the process or start on a different port |
| Login loops | Cookie or `JWT_SECRET` issue | Keep `JWT_SECRET` stable; set `AUTH_COOKIE_SECURE=true` behind HTTPS |
| Data disappears after restart | Missing volume mount | Mount a volume and set `DATA_DIR=/app/data` |
| OAuth callback fails | Wrong public URL | Set `BASE_URL` or `NEXT_PUBLIC_BASE_URL` |
| API keys invalid after redeploy | `API_KEY_SECRET` changed | Keep `API_KEY_SECRET` stable across deploys |
| Health check fails | DurinDoor not reachable | Confirm port, firewall, container publish |

## Next steps

- [Upgrading](upgrading.md) — release notes, backup, version changes
- [Data Management](data-management.md) — backup, restore, migration
- [Security](security.md) — dashboard access, API keys, secrets
- [Troubleshooting](../troubleshooting.md) — isolation guide for common failures
