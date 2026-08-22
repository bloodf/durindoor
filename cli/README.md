# DurinDoor CLI

The `durindoor` package installs and runs the DurinDoor self-hosted AI gateway.

- [Full documentation](../docs/README.md)
- [Installation](../docs/getting-started/installation.md)
- [CLI package on npm](https://www.npmjs.com/package/durindoor)
- [Container image](https://github.com/bloodf/durindoor/pkgs/container/durindoor)

## Requirements

- Node.js `20.20.2`
- npm `10.8.2`

## Install and start

```bash
npm install --global durindoor
durindoor
```

The dashboard opens at `http://localhost:20128/dashboard`. Create an API key, connect a provider, then configure clients with:

```text
Base URL: http://localhost:20128/v1
API key:  YOUR_DURINDOOR_API_KEY
Model:    choose an ID returned by GET /v1/models
```

Use `npx durindoor` for a one-time run without a global install.

## Options

```text
-p, --port <port>   Port to run the server (default: 20128)
-H, --host <host>   Host to bind (default: 0.0.0.0)
-n, --no-browser    Do not open the browser automatically
-l, --log           Show server logs
-t, --tray          Run in system tray mode
    --skip-update   Skip the update check
-h, --help          Show help
-v, --version       Show version
```

Run `durindoor --help` for the installed version's authoritative option list.

## Memory limit

The server starts with a 6 GB V8 heap cap. Set `NINEROUTER_MAX_OLD_SPACE_SIZE`
to a positive integer in MB to override it, or `0` to let Node size the heap:

```bash
NINEROUTER_MAX_OLD_SPACE_SIZE=8192 durindoor
NINEROUTER_MAX_OLD_SPACE_SIZE=0 durindoor
```

An existing `--max-old-space-size` setting in `NODE_OPTIONS` also suppresses
the default CLI heap flag.

## DNS resolution

CLI-started server and detached tray processes pass Node's
`--dns-result-order=ipv4first` flag so undici prefers IPv4 when a hostname also
returns an unreachable IPv6 address. This flag is independent of the heap
setting above and remains active when heap sizing comes from `NODE_OPTIONS` or
when `NINEROUTER_MAX_OLD_SPACE_SIZE=0`.

## Data

Native installations use these defaults when `DATA_DIR` is not set:

- macOS/Linux: `~/.9router`
- Windows: `%APPDATA%\9router`

Docker deployments normally set `DATA_DIR=/app/data` and mount a persistent host directory or named volume there. See [Data Management](../docs/operations/data-management.md) before moving, restoring, or deleting data.

## Updating

```bash
npm update --global durindoor
```

Read the [changelog](../CHANGELOG.md) and [upgrade guide](../docs/operations/upgrading.md), then back up `DATA_DIR` before updating.

## License

[MIT](LICENSE)
