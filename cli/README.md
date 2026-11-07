# DurinDoor CLI

The `durindoor` package installs and runs the self-hosted DurinDoor AI gateway.

Requires Node.js `>=24.22.2 <25`; the package installs with npm. Start a local instance with an explicit loopback address:

```bash
export JWT_SECRET="$(openssl rand -hex 32)"
export INITIAL_PASSWORD="CHANGE_ME_STRONG_PASSWORD"
npm install --global durindoor
durindoor --host 127.0.0.1
```

Replace the password before running the command. Keep the signing secret stable across restarts. Open `http://localhost:20128/dashboard`, sign in, connect a provider, and create a gateway key.

For unattended startup, use `durindoor --headless --skip-update --host 127.0.0.1`.
`--headless` disables the browser, tray preparation and tray launch, and interactive menu.
It overrides `--tray` regardless of flag order and clears inherited `TRAY_MODE`.
Worker crash restarts, validated handoff and MITM recovery remain active in headless mode.
Without `--headless`, detached `--skip-update` launches retain the existing tray fallback;
`--no-browser` keeps its existing meaning and does not select headless mode.
Tray preparation runs when the interactive or tray UI initializes. A loadable tray
implementation already supplied through the package or `NODE_PATH` avoids runtime installation.
Headless mode still checks required SQLite fallback assets. It does not promise offline
startup when SQL.js WASM or other selected runtime dependencies are missing.

The CLI performs startup cleanup before launching. Use the [CLI reference](../docs/reference/cli.mdx) for flags, updates, tray behavior, port handling, and recovery. Follow [Installation](../docs/getting-started/installation.mdx) for other install methods and first-run configuration.

- [First request](../docs/getting-started/first-request.mdx)
- [npm package](https://www.npmjs.com/package/durindoor)
- [Docker image](https://github.com/bloodf/durindoor/pkgs/container/durindoor)
- [MIT license](LICENSE)
