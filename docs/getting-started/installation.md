# Installation

DurinDoor can be installed from npm, run from source, or deployed in a container. All methods produce the same local gateway and dashboard.

## Requirements

| Requirement | Value |
|---|---|
| Node.js | 20.20.2 (bundled in Docker image) |
| npm | 10.8.2 |
| Browser | For the dashboard and OAuth flows |
| Persistent disk | For the database, credentials, logs, and runtime files |
| Network | For remote provider calls and OAuth token exchange |

## Install with npm

```bash
npm install -g durindoor
durindoor
```

## Run with npx

```bash
npx durindoor
```

Use `npx` for quick evaluation. For daily use, install globally or run from source.

## Run from source

```bash
git clone https://github.com/bloodf/durindoor.git
cd durindoor
npm install --no-audit --no-fund
npm run build
npm start
```

For development:

```bash
npm run dev
```

The development server uses port `20127`. Production uses `20128`.

## Docker

```bash
docker run -d \
  --name durindoor \
  -p 20128:20128 \
  -v "$HOME/.durindoor:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="change-me" \
  -e INITIAL_PASSWORD="change-me" \
  ghcr.io/bloodf/durindoor:latest
```

Use a version tag in production:

```bash
ghcr.io/bloodf/durindoor:3.9.0
```

See [Cloud Deployment](../deployment/cloud.md) for the full production compose setup.

## Data Directory

`DATA_DIR` is where DurinDoor stores persistent state. Set it explicitly at deployment time.

| Platform | Default path |
|---|---|
| macOS / Linux | `~/.9router` |
| Windows | `%APPDATA%\9router` |
| Docker container | `/app/data` |

Layout:

```
DATA_DIR/
├── db/
│   ├── data.sqlite       # main SQLite database
│   └── backups/          # automatic pre-upgrade backups
├── auth/
├── logs/
├── mitm/
└── runtime/
```

## Environment Variables

See [Environment Variables](../reference/environment.md) for the full reference.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `20128` | HTTP port for the production gateway |
| `HOSTNAME` | `127.0.0.1` | Network interface to bind. Use `0.0.0.0` in containers |
| `DATA_DIR` | `~/.9router` | Persistent data directory |
| `JWT_SECRET` | generated | Dashboard session signing secret. Set explicitly in production |
| `INITIAL_PASSWORD` | local default | Initial dashboard password |
| `API_KEY_SECRET` | generated | API key validation secret. Set explicitly when keys must survive redeploys |
| `BASE_URL` | local URL | Server-side base URL used by callbacks and selected routes |
| `NEXT_PUBLIC_BASE_URL` | local URL | Browser-visible base URL |
| `HEADROOM_URL` | unset | Optional Headroom token-saver proxy URL |

## Upgrading

See [Upgrading](../operations/upgrading.md) for the full procedure. Always back up `DATA_DIR` first.

## Migration from 9Router

DurinDoor can reuse an existing 9Router data directory. Before migrating:

1. Stop the old service
2. Back up the data directory
3. Start DurinDoor with the same `DATA_DIR`
4. Verify providers, API keys, combos, and usage in the dashboard

## Verification

```bash
curl http://localhost:20128/api/health
```

A healthy response means the server is running. Then test the API:

```bash
curl http://localhost:20128/v1/models \
  -H "Authorization: Bearer YOUR_DURINDOOR_API_KEY"
```

## Related pages

- [Quick Start](quick-start.md)
- [Startup and Runtime Operations](../operations/startup.md)
- [Security](../operations/security.md)
- [Upgrading](../operations/upgrading.md)
- [Data Management](../operations/data-management.md)
- [Environment Variables](../reference/environment.md)
- [API Reference](../reference/api.md)
