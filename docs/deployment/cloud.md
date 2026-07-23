# Cloud and Docker Deployment

This is the canonical production deployment guide. For local single-machine use, see [Local Deployment](localhost.md).

## Before you start

Prepare before exposing DurinDoor outside localhost:

1. Set `JWT_SECRET` — generate with `node -e "console.log(crypto.randomBytes(32).toString('hex'))"`
2. Set `API_KEY_SECRET` — same command; keeps generated API keys valid across redeploys
3. Set `INITIAL_PASSWORD` to a strong value
4. Set `DATA_DIR` to a persistent path
5. Plan HTTPS — reverse proxy or TLS termination is required for remote access
6. Restrict dashboard access — VPN, firewall, reverse proxy auth, or trusted network
7. Back up `DATA_DIR`

Read [Environment Variables](../reference/environment.md) and [Security](../operations/security.md) before going live.

## Docker

### Image tags

- `ghcr.io/bloodf/durindoor:latest` — tracks the latest release; convenient for evaluation
- `ghcr.io/bloodf/durindoor:3.9.0` — version-pinned; recommended for production

Pin production deployments to a version tag. The `latest` tag moves forward and can introduce unexpected changes.

### docker run

```bash
docker run -d \
  --name durindoor \
  -p 20128:20128 \
  -e PORT=20128 \
  -e HOSTNAME=0.0.0.0 \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="CHANGE_ME" \
  -e API_KEY_SECRET="CHANGE_ME" \
  -e INITIAL_PASSWORD="CHANGE_ME" \
  -v durindoor-data:/app/data \
  ghcr.io/bloodf/durindoor:3.9.0
```

### docker-compose.yml

```yaml
services:
  durindoor:
    image: ghcr.io/bloodf/durindoor:3.9.0
    container_name: durindoor
    restart: always
    ports:
      - "20128:20128"
    environment:
      PORT: "20128"
      HOSTNAME: "0.0.0.0"
      DATA_DIR: /app/data
      JWT_SECRET: CHANGE_ME_LONG_RANDOM_VALUE
      API_KEY_SECRET: CHANGE_ME_LONG_RANDOM_VALUE
      INITIAL_PASSWORD: CHANGE_ME_STRONG_PASSWORD
      NODE_ENV: production
    volumes:
      - durindoor-data:/app/data

volumes:
  durindoor-data:
    name: durindoor-data
```


Set all `CHANGE_ME` values in a `.env` file loaded via `env_file` rather than hardcoding secrets in the compose file.

## Persistent storage

The named volume `durindoor-data` survives container removal and restart. Without it, all data is lost when the container is removed.

On a new host, copy the volume contents to the new machine before starting:

```bash
# On old host
docker run --rm -v durindoor-data:/data -v "$PWD:/backup" alpine \
  tar czf /backup/durindoor-data.tar.gz -C /data .

# On new host
docker volume create durindoor-data
docker run --rm -v durindoor-data:/data -v "$PWD:/backup" alpine \
  tar xzf /backup/durindoor-data.tar.gz -C /data
```

## Headroom sidecar

Headroom is an optional token-saver proxy that runs as a separate service alongside DurinDoor. To enable it, add the Headroom service to your compose file:

```yaml
services:
  durindoor:
    image: ghcr.io/bloodf/durindoor:3.9.0
    # ... existing durindoor config ...
    environment:
      # ... existing env ...
      # Add HEADROOM_URL only when Headroom is enabled:
      HEADROOM_URL: http://headroom:8787
    depends_on:
      - headroom

  headroom:
    image: ghcr.io/chopratejas/headroom:latest
    restart: always
    # No host port — Headroom is internal to the compose network.
    # Do not publish port 8787 to the host unless the port is protected.
```

After starting, open the dashboard → Token Saver → Headroom, confirm the URL, recheck status, then enable.

## Reverse proxy and TLS

Place DurinDoor behind a reverse proxy for TLS termination and host-based routing.

### Nginx

```nginx
location / {
  proxy_pass http://127.0.0.1:20128;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_read_timeout  600s;
  proxy_send_timeout  600s;
}
```

Long-running model streams need generous timeouts.

## Health checks

```bash
curl https://your-domain/api/health
```

In `docker-compose.yml` add a healthcheck:

```yaml
healthcheck:
  test: ["CMD", "wget", "-qO-", "http://localhost:20128/api/health"]
  interval: 30s
  timeout: 10s
  retries: 3
```

## Logs

```bash
docker logs -f durindoor
```

For structured log analysis, enable `ENABLE_REQUEST_LOGS=true` temporarily and collect the output.

## Upgrades

1. Back up `DATA_DIR` — see [Data Management](../operations/data-management.md)
2. Update the image tag in `docker-compose.yml`
3. `docker compose pull`
4. `docker compose up -d`
5. Verify: `curl http://localhost:20128/api/health`

Full upgrade steps: [Upgrading](../operations/upgrading.md).

## Rollback preparation

Before upgrading, record the current image tag:

```bash
docker inspect durindoor --format '{{.Config.Image}}'
```

To roll back:

```bash
docker compose down
docker pull ghcr.io/bloodf/durindoor:<prior-version>
# Update image tag in compose file
docker compose up -d
```

If the database was migrated, restore from the pre-upgrade backup before starting the old image.

## Backups

Back up `DATA_DIR/db/data.sqlite` and the whole `DATA_DIR/auth/` directory. Store backups on a separate machine or disk. Full procedure: [Data Management](../operations/data-management.md).

## Related pages

- [Data Management](../operations/data-management.md)
- [Upgrading](../operations/upgrading.md)
- [Startup](../operations/startup.md)
- [Security](../operations/security.md)
- [Environment Variables](../reference/environment.md)
