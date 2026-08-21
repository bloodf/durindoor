# DurinDoor Docker

Run DurinDoor in a container. Image: [`ghcr.io/bloodf/durindoor`](https://github.com/bloodf/durindoor/pkgs/container/durindoor) — multi-platform `linux/amd64` + `linux/arm64`.

Requirements: Docker, persistent storage for `DATA_DIR`. Node.js is bundled in the image; the local build uses Node.js 20.20.2 and npm 10.8.2.

## One command

```bash
docker run -d \
  --name durindoor \
  -p 127.0.0.1:20128:20128 \
  -v "$HOME/.durindoor:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e INITIAL_PASSWORD="$(openssl rand -hex 16)" \
  ghcr.io/bloodf/durindoor:latest

This binds to localhost only and generates random secrets. For production, see [Cloud and Docker deployment](docs/deployment/cloud.md).
```

Open http://localhost:20128 — sign in, change the password, add a provider, create an API key.

## Docker Compose

```bash
curl -fsSL https://raw.githubusercontent.com/bloodf/durindoor/main/docker-compose.yml -o docker-compose.yml
```

Or copy from this repository's `docker-compose.yml`. Review the file and set all secrets in `.env` before `docker compose up -d`.

For production compose with TLS, secrets, and optional Headroom, see [Cloud and Docker deployment](docs/deployment/cloud.md).

## Data persistence

```text
Host path:        $HOME/.durindoor (or any bind path you choose)
Container path:   /app/data/db/data.sqlite
DATA_DIR in container: /app/data
```

Without the bind mount or named volume, data lives inside the container and is lost on removal. Always mount a volume.

Bind mount example:

```bash
-v "$HOME/.durindoor:/app/data"
```

Named volume example:

```bash
-v durindoor-data:/app/data
```

See [Data Management](docs/operations/data-management.md) for backup, restore, and volume guidance.

## Configure 429 account backoff

Rate-limit fallback temporarily locks affected account/model with exponential backoff. Defaults remain 2 seconds, doubling to 5-minute cap, for at most 15 levels. Override schedule in `docker run` or Compose:

```bash
-e BACKOFF_BASE_MS=2000 \
-e BACKOFF_MAX_MS=300000 \
-e BACKOFF_MAX_LEVEL=15
```

Each optional value must be positive integer. Invalid values retain that key's default, and maximum delay is capped at 7 days. If resolved maximum is below resolved base, whole schedule uses defaults. Settings affect fallback locks, not provider retry-delay or RPM logic.

## Update

```bash
docker pull ghcr.io/bloodf/durindoor:latest
docker stop durindoor && docker rm durindoor
# re-run the one-command above
```

Pin to a version tag (e.g. `3.9.0`) for production. `latest` is convenient for quick evaluation.

## Headroom sidecar (optional)

Headroom is an optional token-saver proxy. To enable it alongside DurinDoor, add the Headroom service to your compose file as shown in [Cloud and Docker deployment](docs/deployment/cloud.md). Do not publish port `8787` to the host unless the port is protected by authentication.

## Logs

```bash
docker logs -f durindoor
```

## Next steps

- [Cloud and Docker deployment](docs/deployment/cloud.md) — production compose, TLS, secrets, upgrades, rollback
- [Data management](docs/operations/data-management.md) — backup, restore, migration for bind mounts and named volumes
- [Security](docs/operations/security.md) — dashboard access, API keys, secrets
