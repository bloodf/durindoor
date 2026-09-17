# DurinDoor Docker

Run DurinDoor in a container. Image: [`ghcr.io/bloodf/durindoor`](https://github.com/bloodf/durindoor/pkgs/container/durindoor), multi-platform `linux/amd64` and `linux/arm64`.

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
```

This binds to localhost only and generates random secrets. For production compose, see [Docker](docs/deployment/docker.mdx). For systemd and TLS, see [VPS and cloud](docs/deployment/cloud.mdx).

Open http://localhost:20128 and sign in. Change the password, add a provider, then create an API key.

## Docker Compose

```bash
curl -fsSL https://raw.githubusercontent.com/bloodf/durindoor/main/docker-compose.yml -o docker-compose.yml
```

Or copy from this repository's `docker-compose.yml`. Review the file and set all secrets in `.env` before `docker compose up -d`.

For production compose with TLS and secrets, see [Docker](docs/deployment/docker.mdx) and [VPS and cloud](docs/deployment/cloud.mdx).

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

See [Data management](docs/operations/data-management.md) for backup, restore, and volume guidance.

## Configure 429 account backoff

Rate-limit fallback temporarily locks the affected account/model with exponential backoff. Defaults remain 2 seconds, doubling to a 5-minute cap, for at most 15 levels. Override the schedule in `docker run` or Compose:

```bash
-e BACKOFF_BASE_MS=2000 \
-e BACKOFF_MAX_MS=300000 \
-e BACKOFF_MAX_LEVEL=15
```

Each optional value must be a positive integer. Invalid values keep that key's default, and the maximum delay is capped at 7 days. If the resolved maximum is below the resolved base, the whole schedule uses defaults. Settings affect fallback locks, not provider retry-delay or RPM logic.

Per-account RPM admission (Providers, then the provider page, then RPM / account) is persisted in `settings.rpmByProvider`; it is not an environment variable. Blank uses the provider default (NVIDIA: 40 RPM; others: unlimited), while `0` explicitly disables the cap. Counters are process-local, so each Docker replica enforces its own budget (decolua/9router#3203).

## Update

```bash
docker pull ghcr.io/bloodf/durindoor:latest
docker stop durindoor && docker rm durindoor
# re-run the one-command above
```

Pin to a version tag (for example `3.9.0`) for production. `latest` is convenient for a quick evaluation.

## Headroom sidecar (optional)

Headroom is an optional token-saver proxy. Setup lives in [Headroom](docs/HEADROOM.md). Do not publish port `8787` to the host unless the port is protected by authentication.

## Logs

```bash
docker logs -f durindoor
```

- [Docker](docs/deployment/docker.mdx): Compose, volumes, env, upgrades
- [VPS and cloud](docs/deployment/cloud.mdx): systemd, HOSTNAME, TLS
- [Data management](docs/operations/data-management.md): backup, restore, migration for bind mounts and named volumes
- [Security](docs/operations/security.md): dashboard access, API keys, secrets
