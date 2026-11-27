# DurinDoor CLI

The `durindoor` package installs and runs the self-hosted DurinDoor AI gateway.

Requires Node.js `>=24.22.2 <25`; the package installs with npm. Start a local instance with an explicit loopback address:

```bash
export JWT_SECRET="$(openssl rand -hex 32)"
export INITIAL_PASSWORD="CHANGE_ME_STRONG_PASSWORD"
npm install --global durindoor
durindoor --host 127.0.0.1
```

Launcher options include `--host <host>` (`-H`) and `--port <port>` (`-p`). Both
require a value; the port must be an integer from 1 through 65535. Use
`--headless` to run without a browser, tray or interactive menu.

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

## Read a local combo from scripts

With the gateway already running, use its combo ID (not its name):

```bash
durindoor admin combos get <id>
durindoor admin combos get <id> --port 20129
```

This prints the existing `/api/combos/{id}` response as JSON to stdout. IDs are
encoded as a single path parameter. Errors are JSON on stderr: exit status `1`
means an API or connection failure, and `2` means invalid arguments. Use
`durindoor admin --help` for syntax.

The command uses loopback HTTP and the existing local CLI management token from
the same `DATA_DIR` as the server. It does not start the gateway, run updates, or
contact model providers. Remote profiles and credential provisioning remain
outside this command's scope. Launcher flags such as `--host` are not accepted.

### Provider sign-in in the terminal

The Providers menu supports browser authorization for Claude Code, Codex,
Gemini CLI, Antigravity and iFlow, and device authorization for GitHub Copilot,
Qwen Code and Kiro. For browser authorization, paste the complete callback URL,
including its `code` and `state`. Claude also accepts the `code#state` shown by
its authorization page. A missing or mismatched state is rejected; start a new
sign-in instead of reusing an old callback. Raw access tokens are not accepted
in this wizard.

The CLI retains the server-issued sign-in flow ID through completion. Device
sign-in follows the provider's polling interval, slows down when requested,
and stops when the server session expires. Press Esc or Ctrl+C while waiting
to cancel. If sign-in expires, is declined, or has already been used, restart
it from Add New Connection. Keep the CLI and server up to date together.
