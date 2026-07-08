# DurinDoor CLI

The DurinDoor CLI starts the local gateway, opens the dashboard, and provides helper menus for settings, providers, API keys, combos, CLI tools, and tray integration.

## Install

```bash
npm install -g durindoor
```

## Start

```bash
durindoor
```

The legacy `9router` command is still provided for migration compatibility.

Default URLs:

```text
Dashboard: http://localhost:20128/dashboard
API base:  http://localhost:20128/v1
```

## Common Options

```bash
durindoor --port 8080
durindoor --no-browser
durindoor --skip-update
durindoor --help
```

> `--help` and `--version` (`-h`, `-v`) are evaluated above all runtime
> hooks (SQLite self-heal, tray runtime, MITM hosts cleanup, settings
> lookup), so a cold `durindoor --help` / `durindoor --version` does not
> initialise native deps or open any network calls — they exit before
> anything else has a chance to run.

## Data Location

Unless `DATA_DIR` is set, the CLI uses the compatibility data directory:

- macOS and Linux: `~/.9router`
- Windows: `%APPDATA%\9router`

The main database is `DATA_DIR/db/data.sqlite`.

## Runtime Dependencies

Some optional native dependencies are installed into the runtime data directory instead of being bundled directly with the CLI package. This reduces update issues on platforms that lock native modules while the process is running.

## Documentation

Read the canonical documentation in [`../docs/README.md`](../docs/README.md).

Useful CLI-focused pages:

- [Quick Start](../docs/getting-started/quick-start.md)
- [Startup and Runtime Operations](../docs/operations/startup.md)
- [Environment Variables](../docs/reference/environment.md)
- [Usage Guide](../docs/guides/usage.md)
