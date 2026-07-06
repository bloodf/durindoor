# Installation

DurinDoor can run as a globally installed CLI, from source, or in a container. All methods produce the same local gateway and dashboard.

## Requirements

| Requirement | Notes |
| --- | --- |
| Node.js | Use a modern Node.js release compatible with Next.js 16. Node.js 20 or newer is recommended; Node.js 22 or newer can use the built-in SQLite fallback. |
| npm | Required for global installs and source builds. |
| Browser | Required for the dashboard and OAuth flows. |
| Network access | Required for remote provider calls and OAuth token exchange. |
| Persistent disk | Required for the local database, credentials, logs, and generated runtime files. |

## Install with npm

```bash
npm install -g durindoor
durindoor
```

The package also provides a legacy `9router` command. Prefer `durindoor` for new setup.

## Run with npx

```bash
npx durindoor
```

Use `npx` for quick evaluation. For daily use, install globally or run from source.

## Run from Source

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

The development server uses port `20127`. The production CLI and Docker runtime use `20128` unless `PORT` is changed.

## Run with Docker

Use the repository Dockerfile or the published image for server deployments. The runtime must persist `DATA_DIR`.

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

If your deployment still uses an upstream 9Router image or compose file, treat it as migration work and verify image names before publishing.

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `20128` | HTTP port for the production gateway. |
| `HOSTNAME` | runtime dependent | Network interface to bind. Use `0.0.0.0` in containers. |
| `DATA_DIR` | `~/.9router` or `%APPDATA%\\9router` | Persistent data directory. The legacy name is intentional for compatibility. |
| `JWT_SECRET` | generated or configured | Secret used for dashboard session signing. Set explicitly in production. |
| `INITIAL_PASSWORD` | local default if unset | Initial dashboard password. Set explicitly before remote exposure. |
| `API_KEY_SECRET` | built-in default | Secret used to validate the CRC section of generated API keys. Set explicitly when keys must survive redeploys. |
| `BASE_URL` | local URL | Server-side base URL used by selected routes and callbacks. |
| `NEXT_PUBLIC_BASE_URL` | local URL | Browser-visible base URL. |
| `CLOUD_URL` | project default | Optional remote cloud endpoint. |
| `NEXT_PUBLIC_CLOUD_URL` | project default | Browser-visible cloud endpoint. |
| `ENABLE_REQUEST_LOGS` | `false` | Enables additional request logging. Use carefully because prompts may contain sensitive data. |
| `DEBUG` | unset | Enables verbose runtime logs in selected modules. |
| `HEADROOM_URL` | unset | Optional external token-saver proxy URL. |

## Data Directory

DurinDoor stores persistent state under `DATA_DIR`. The main database is SQLite:

```text
DATA_DIR/
  db/
    data.sqlite
    backups/
  auth/
  logs/
  mitm/
  runtime/
```

Legacy JSON files may still exist after migration. Do not delete them until you have verified that the SQLite database contains your current providers, keys, settings, and usage.

## Upgrading

For npm installs:

```bash
npm update -g durindoor
```

For source installs:

```bash
git pull
npm install --no-audit --no-fund
npm run build
npm start
```

For Docker:

```bash
docker pull ghcr.io/bloodf/durindoor:latest
docker rm -f durindoor
# Run the container again with the same volume and DATA_DIR.
```

## Migration from 9Router

DurinDoor keeps several 9Router-compatible identifiers to avoid breaking existing users. This includes the default data directory name, some config sections, API key compatibility, and CLI aliases. If an existing 9Router data directory is found, DurinDoor can migrate or reuse it depending on the runtime path.

Before migration:

1. Stop the old service.
2. Back up the data directory.
3. Start DurinDoor with the same `DATA_DIR` or a copied directory.
4. Verify providers, API keys, combos, and usage in the dashboard.

## Verification

```bash
curl http://localhost:20128/api/health
curl http://localhost:20128/v1/models \
  -H "Authorization: Bearer YOUR_DURINDOOR_API_KEY"
```

A healthy install should return JSON from both endpoints. The model list depends on configured providers.
