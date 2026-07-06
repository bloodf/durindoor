# Docker

Run DurinDoor in a container with persistent storage. The container exposes the same dashboard and API as the CLI runtime.

## Quick Start

```bash
docker run -d \
  --name durindoor \
  -p 20128:20128 \
  -e PORT=20128 \
  -e HOSTNAME=0.0.0.0 \
  -e DATA_DIR=/app/data \
  -v durindoor-data:/app/data \
  ghcr.io/bloodf/durindoor:latest
```

Open:

```text
http://localhost:20128/dashboard
```

API base:

```text
http://localhost:20128/v1
```

## Production Example

Set explicit secrets before exposing the service outside localhost.

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
  ghcr.io/bloodf/durindoor:latest
```

## Docker Compose

```yaml
services:
  durindoor:
    image: ghcr.io/bloodf/durindoor:latest
    container_name: durindoor
    restart: unless-stopped
    ports:
      - "20128:20128"
    environment:
      PORT: "20128"
      HOSTNAME: 0.0.0.0
      DATA_DIR: /app/data
      JWT_SECRET: CHANGE_ME_LONG_RANDOM_VALUE
      API_KEY_SECRET: CHANGE_ME_LONG_RANDOM_VALUE
      INITIAL_PASSWORD: CHANGE_ME_STRONG_PASSWORD
    volumes:
      - durindoor-data:/app/data

volumes:
  durindoor-data:
```

## Data Persistence

Always mount or create persistent storage for `DATA_DIR`.

```text
/app/data/
  db/
    data.sqlite
    backups/
  auth/
  logs/
  mitm/
  runtime/
```

The default non-container data path remains `~/.9router` for compatibility, but containers should use `DATA_DIR=/app/data` with a volume.

## Manage the Container

```bash
docker logs -f durindoor
docker stop durindoor
docker start durindoor
docker rm -f durindoor
```

## Upgrade

```bash
docker pull ghcr.io/bloodf/durindoor:latest
docker rm -f durindoor
# Run the container again with the same volume and environment.
```

Back up the data volume before upgrades.

## Headroom Sidecar

DurinDoor can point at an external Headroom service when token-saver workflows require it.

```yaml
services:
  durindoor:
    image: ghcr.io/bloodf/durindoor:latest
    ports:
      - "20128:20128"
    environment:
      DATA_DIR: /app/data
      HEADROOM_URL: http://headroom:8787
    volumes:
      - durindoor-data:/app/data
    depends_on:
      - headroom

  headroom:
    image: ghcr.io/chopratejas/headroom:latest
    ports:
      - "8787:8787"
```

If Headroom runs on the Docker host, use a host-reachable address such as `host.docker.internal` where supported.

## More Documentation

- [Cloud and Docker Deployment](docs/deployment/cloud.md)
- [Installation](docs/getting-started/installation.md)
- [Troubleshooting](docs/troubleshooting.md)
