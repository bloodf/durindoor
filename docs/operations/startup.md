# Startup and Runtime Operations

This page explains how to start, stop, verify, and operate DurinDoor in common environments.

## Runtime Modes

| Mode | Command | Best for |
| --- | --- | --- |
| Global CLI | `durindoor` | Personal desktop use and local tools. |
| `npx` | `npx durindoor` | Quick evaluation without global install. |
| Source development | `npm run dev` | Contributor development. |
| Source production | `npm run build && npm start` | Manual server deployments. |
| Docker | `docker run ...` or Docker Compose | VPS, home server, and team deployments. |

## First Startup

1. Install DurinDoor or clone the repository.
2. Choose a persistent `DATA_DIR`.
3. Start the server.
4. Open `http://localhost:20128/dashboard`.
5. Sign in with the initial password.
6. Change the password.
7. Create a DurinDoor API key.
8. Add at least one provider connection.
9. Send a test request.

## CLI Startup

```bash
durindoor
```

Useful options:

```bash
durindoor --port 8080
durindoor --no-browser
durindoor --skip-update
durindoor --help
```

The CLI starts the Next.js server, opens the dashboard unless disabled, and stores runtime helper files under `DATA_DIR`.

## Source Startup

Development:

```bash
npm install --no-audit --no-fund
npm run dev
```

Production from source:

```bash
npm install --no-audit --no-fund
npm run build
npm start
```

Development uses port `20127`. Production uses `PORT`, defaulting to `20128`.

## Docker Startup

Replace `<version>` with a published release image tag, for example `0.5.18`.

```bash
docker run -d \
  --name durindoor \
  -p 20128:20128 \
  -e PORT=20128 \
  -e HOSTNAME=0.0.0.0 \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="CHANGE_ME_LONG_RANDOM_VALUE" \
  -e API_KEY_SECRET="CHANGE_ME_LONG_RANDOM_VALUE" \
  -e INITIAL_PASSWORD="CHANGE_ME_STRONG_PASSWORD" \
  -v durindoor-data:/app/data \
  ghcr.io/bloodf/durindoor:<version>
```

Check logs:

```bash
docker logs -f durindoor
```

Stop and start:

```bash
docker stop durindoor
docker start durindoor
```

## Health Checks

Use the health endpoint for uptime checks:

```bash
curl http://localhost:20128/api/health
```

Use `/v1/models` to verify authentication and provider/model visibility:

```bash
curl http://localhost:20128/v1/models \
  -H "Authorization: Bearer YOUR_DURINDOOR_API_KEY"
```

## Smoke Test

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Authorization: Bearer YOUR_DURINDOOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MODEL_ID_OR_COMBO",
    "messages": [
      {"role": "user", "content": "Reply with OK."}
    ],
    "max_tokens": 16
  }'
```

## Graceful Shutdown

For CLI or source starts, press `Ctrl+C`.

For Docker:

```bash
docker stop durindoor
```

If `SHUTDOWN_SECRET` is configured, automation can call the shutdown API with the configured secret. Prefer normal process-manager stop commands when possible.

## Restart After Configuration Changes

Restart DurinDoor after changing:

- `PORT`
- `HOSTNAME`
- `DATA_DIR`
- `JWT_SECRET`
- `API_KEY_SECRET`
- proxy environment variables
- OAuth client overrides
- build-related variables

Dashboard settings stored in the database usually do not require a process restart.

## Common Startup Failures

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Port already in use | Another process owns `20128` | Start with `--port`, set `PORT`, or stop the conflicting process. |
| Dashboard login loops | Cookie or `JWT_SECRET` issue | Use stable `JWT_SECRET`; set `AUTH_COOKIE_SECURE=true` only behind HTTPS. |
| Data disappears after container restart | Missing persistent volume | Mount a volume and set `DATA_DIR=/app/data`. |
| OAuth callback fails | Wrong public URL | Set `BASE_URL`, `NEXT_PUBLIC_BASE_URL`, or `MCP_GATEWAY_OAUTH_PUBLIC_URL` as needed. |
| API keys stop validating after redeploy | `API_KEY_SECRET` changed | Keep `API_KEY_SECRET` stable. |
