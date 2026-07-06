# Cloud and Docker Deployment

Cloud deployment is for teams, remote editors, mobile clients, or tools that cannot reach a local `localhost` endpoint. A production deployment should use persistent storage, HTTPS, explicit secrets, and restricted dashboard access.

## Production Checklist

Before exposing DurinDoor outside your machine:

1. Set `JWT_SECRET`.
2. Set `API_KEY_SECRET` if generated API keys must survive redeploys.
3. Set `INITIAL_PASSWORD` to a strong value for first login.
4. Set `DATA_DIR` to persistent storage.
5. Use HTTPS.
6. Restrict dashboard access with a firewall, VPN, reverse proxy auth, or trusted network.
7. Disable request body logging unless debugging.
8. Back up `DATA_DIR/db/data.sqlite`.

Read [Environment Variables](../reference/environment.md) and [Security and Production Hardening](../operations/security.md) before publishing a public endpoint.

## Docker

DurinDoor images are published for versioned release tags. Replace `<version>` with a published version tag, for example `0.5.18`. Do not assume `latest` exists or points at the newest release.

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

Open `http://SERVER_HOST:20128/dashboard`, sign in, change the password if required, and create API keys for client tools.

## Docker Compose

```yaml
services:
  durindoor:
    image: ghcr.io/bloodf/durindoor:<version>
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

## Reverse Proxy

Place DurinDoor behind a reverse proxy for TLS and host-based routing.

Example Nginx location:

```nginx
location / {
  proxy_pass http://127.0.0.1:20128;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 600s;
  proxy_send_timeout 600s;
}
```

Long-running model streams need generous proxy timeouts.

## Tunnels

DurinDoor includes tunnel-related dashboard surfaces for supported tunnel providers. Tunnels are useful when a local instance must be reachable by a tool that does not support localhost.

Operational rules:

- Use HTTPS tunnel URLs.
- Treat tunnel URLs as sensitive.
- Keep dashboard authentication enabled.
- Prefer per-tool API keys.
- Monitor request logs after exposing a tunnel.

## Cloudflare Worker Proxy Pools

Proxy pools can deploy or use Cloudflare Workers as upstream request relays when configured. This is separate from hosting DurinDoor itself. A Worker relay forwards provider traffic; it does not replace the DurinDoor server, dashboard, or database.

## Backups

Back up the full `DATA_DIR`, especially:

```text
DATA_DIR/db/data.sqlite
DATA_DIR/db/backups/
DATA_DIR/auth/
DATA_DIR/mitm/     # only if MITM is configured
```

Store backups securely because they can contain provider credentials and client API keys.

## Upgrades

1. Back up `DATA_DIR`.
2. Pull the new image or source revision.
3. Restart with the same environment and volume.
4. Check `/api/health`.
5. Open the dashboard and verify providers, keys, combos, and usage.
6. Send a small test request through the public endpoint.

## Related Pages

- [Startup and Runtime Operations](../operations/startup.md)
- [Environment Variables](../reference/environment.md)
- [Security and Production Hardening](../operations/security.md)
- [Troubleshooting](../troubleshooting.md)
