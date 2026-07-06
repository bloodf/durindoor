# Local Deployment

Local deployment is the default way to use DurinDoor for personal tools and desktop development. The gateway runs on your machine, stores data locally, and exposes an API for local clients.

## Start Locally

```bash
durindoor
```

Default URLs:

| Surface | URL |
| --- | --- |
| Dashboard | `http://localhost:20128/dashboard` |
| API base | `http://localhost:20128/v1` |
| Health check | `http://localhost:20128/api/health` |

## Development Server

When working on the source code:

```bash
npm install --no-audit --no-fund
npm run dev
```

The development server uses port `20127` by default.

## Local Data

Unless `DATA_DIR` is set, DurinDoor uses the compatibility data path:

| Platform | Default path |
| --- | --- |
| macOS and Linux | `~/.9router` |
| Windows | `%APPDATA%\9router` |

The main database is stored at `DATA_DIR/db/data.sqlite`.

## Change the Port

```bash
PORT=8080 durindoor
```

Then use:

```text
Dashboard: http://localhost:8080/dashboard
API base:  http://localhost:8080/v1
```

Update all client tools when the port changes.

## Local Security

Localhost is safer than a public deployment, but it still needs basic care:

- Change the default or initial dashboard password.
- Do not paste upstream provider keys into untrusted browser sessions.
- Create separate DurinDoor API keys for different tools.
- Disable detailed request logs unless debugging.
- Back up `DATA_DIR` before upgrades or migrations.

## Stopping DurinDoor

Press `Ctrl+C` in the terminal where DurinDoor is running. If it is running as a background process, stop it with your process manager.

## Backing Up Data

```bash
cp -R ~/.9router ~/.9router.backup
```

If `DATA_DIR` is custom, back up that directory instead.

## Local Network Access

To reach DurinDoor from another device, bind to a reachable interface and make sure the network firewall allows the port. Do not expose the dashboard to a shared network without a strong password and trusted network controls.

For remote access, prefer a VPN, SSH tunnel, Tailscale, Cloudflare Tunnel, or a reverse proxy with HTTPS and authentication.
