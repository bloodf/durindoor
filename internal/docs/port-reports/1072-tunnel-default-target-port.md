# Tunnel default target port (#1072)

Reviewed 2026-11-20 against local base `10d342106075` on branch `orq/tornf6/port9r-tunnel-default-target-port-a1`, following the qualified review commit `389e7d871` (`docs(upstream): record remaining 9router dispositions`), which recorded the tunnel residual as: *"#5354: the tunnel and funnel forward to a hardcoded 20128 while dev listens on 20127 (src/lib/tunnel)."*

## Source disposition

Source: [decolua/9router#5354](https://github.com/decolua/9router/pull/5354) — *fix: tunnel dev port, SSE keepalive/thinking deltas, qwen3.8-flash-next 262K window, model-catalog sync, Codex lane*, head `638d6fb4e014319723798524115867456ddb5b62`, open and mergeable against `master`.

The upstream pull request is a mixed release-batch change. Its final diff touches the model catalog, the Codex executor and CLI, the OpenAI Responses translator, SSE stream helpers, thinking-level tables, provider capabilities, and the managed tunnel. Only the **tunnel target-port behavior** is in scope for this port; every other behavior in that diff is a separate residual and stays recorded as such (the Gemini `MINIMAL` thinking tier and the `qwen3.8-flash-next` 1M window are the two tunnel-adjacent ones already itemized in `389e7d871`; the catalog, Codex, translator and stream changes were never part of this fork's intake).

The upstream tunnel behavior is three hunks:

- `src/shared/constants/config.js` gains a `getAppPort()` resolver that reads `process.env.PORT` and falls back to the canonical `UPDATER_CONFIG.appPort`;
- `src/lib/tunnel/cloudflare/manager.js` changes `enableTunnel(localPort = 20128)` to `enableTunnel(localPort = getAppPort())`;
- `src/lib/tunnel/tailscale/manager.js` changes `enableTailscale(localPort = 20128)` to `enableTailscale(localPort = getAppPort())`.

**Disposition: ported, scoped to the local target-port default.** The fork had no `getAppPort` resolver of its own — the pre-existing pattern was an inline `process.env.PORT || UPDATER_CONFIG.appPort` in unrelated modules (`src/lib/appUpdater.js`, `src/app/api/providers/[id]/test-models/route.js`). The resolver is therefore added in the same file and with the same shape upstream uses, so the manager change stays a one-line default swap rather than a fork-specific mechanism.

## Behavior contract

`getAppPort()` resolves the port the app server is actually listening on:

| `process.env.PORT` | resolved port |
| --- | --- |
| unset | `20128` (canonical production port) |
| `20127` | `20127` (dev server) |
| `3100` | `3100` (operator-chosen port) |
| empty, non-numeric, `0`, negative | `20128` (fallback) |

`process.env.PORT` is authoritative because Next.js writes the resolved listen port into it at server startup for both `next dev --port` and `next start --port` (`next/dist/server/lib/start-server.js`), and the CLI launcher sets it explicitly (`cli/cli.js` passes `PORT` to the spawned server).

Both managed tunnel managers now use that resolver **only as the default value of their `localPort` parameter**:

- `enableTunnel(localPort = getAppPort())` — the resolved port reaches `spawnQuickTunnel(localPort, …)`, which forwards to `cloudflared tunnel --url http://127.0.0.1:<port>`.
- `enableTailscale(localPort = getAppPort())` — the resolved port reaches `startFunnel(localPort)`, which runs `tailscale funnel --bg <port>`.

## Preserved behavior

- **Explicit port wins.** A caller that passes `localPort` still overrides the resolved port; the resolver is only the default. `enableTunnel(9090)` still targets `9090` regardless of `PORT`.
- **Default production port unchanged.** With `PORT` unset the tunnel still targets `20128`, so a default install behaves exactly as before.
- **Configured host unchanged.** The Cloudflare target stays `http://127.0.0.1:<port>` and the Tailscale funnel keeps its bare-port argument (no host is added to the CLI invocation). Only the port number moves.
- **Operator workflow unchanged.** The dashboard enable routes (`/api/tunnel/enable`, `/api/tunnel/tailscale-enable`), the CLI settings menu and the watchdog auto-restart in `src/shared/services/initializeApp.js` all call the managers without an argument, so they inherit the resolved port with no call-site change. The watchdog's daemon-alive funnel recovery still reuses `svc.activeLocalPort`, and Tailscale status reporting still resolves the funnel URL from `process.env.PORT`.
- **Security and compatibility controls untouched.** No credential, auth, admission, quota or routing path is involved. No schema, dependency, workflow, Docker or test-baseline file changed.

## Change

- `src/shared/constants/config.js` — add `getAppPort()` next to `UPDATER_CONFIG`.
- `src/lib/tunnel/cloudflare/manager.js` — default `enableTunnel` to `getAppPort()`.
- `src/lib/tunnel/tailscale/manager.js` — default `enableTailscale` to `getAppPort()`.
- `tests/unit/tunnel-local-port-5354.test.js` — new focused coverage.
- `internal/docs/port-reports/1072-tunnel-default-target-port.md` — this report.

No other file is modified. `src/lib/tunnel/cloudflare/cloudflared.js` and `src/lib/tunnel/tailscale/tailscale.js` keep their target construction; they were read to confirm the host and the funnel argument shape.

## Rejected alternatives

- **Resolving the port at each call site.** The dashboard routes, the CLI menu and the watchdog would each have had to compute and pass a port. That spreads the resolution rule over four files and lets a future call site silently regress to a hardcoded default — the upstream one-line default keeps a single owner.
- **Reading `process.env.PORT` inline in the managers.** Duplicates the fallback rule in two modules and leaves the canonical `20128` in two more places; `getAppPort()` keeps the rule in the constants module that already owns `UPDATER_CONFIG.appPort`.
- **Falling back to `20127` when `PORT` is unset.** `20127` is the dev-server port, not a product default; unset `PORT` means a normal production install, which listens on `20128`.
- **Widening the port to every tunnel consumer.** `src/app/(dashboard)/dashboard/endpoint/page.js`, `src/app/api/providers/[id]/test-models/route.js` and `src/lib/appUpdater.js` already resolve `process.env.PORT` inline. Rewriting them is outside the target-port default and would broaden the diff past the recorded residual.

## Evidence

`tests/unit/tunnel-local-port-5354.test.js` covers, with stubs only:

- `getAppPort()`: unset → `20128`, `20127` → `20127`, `3100` → `3100`, and empty / non-numeric / `0` / `-1` → `20128`;
- `enableTunnel()` with `PORT=20127` → `spawnQuickTunnel` receives `20127`; with `PORT` unset → `20128`; with `enableTunnel(9090)` → `9090` (explicit override wins over the resolved port);
- `enableTailscale()` with `PORT=20127` → `startFunnel` receives `20127`; with `PORT` unset → `20128`; with `enableTailscale(9090)` → `9090`; and the funnel call still carries exactly one argument, so no host was added;
- the real `src/lib/tunnel/cloudflare/cloudflared.js` module loaded with a stubbed `fs`/`child_process`, asserting the spawned argv contains `http://127.0.0.1:20127` and not `http://127.0.0.1:20128` — the configured host is preserved and only the port moves.

Focused evidence: `test -s tests/unit/tunnel-local-port-5354.test.js && test -s internal/docs/port-reports/1072-tunnel-default-target-port.md && (cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/tunnel-local-port-5354.test.js)` passes (15 tests). The pre-existing tunnel suites (`tunnel-manager-health-fallback`, `tunnel-shortid-contract`, `tunnel-shortid-csprng`, `tunnel-health-candidates`, `tailscale-funnel-url`, `tailscale-socket-probe`, `proxy-connect-tunnel`) still pass (26 tests). Root lint passes.

## Verification limits

No tunnel was started and no process, listener, discovery, DNS lookup, browser or external service was involved: `cloudflared`, `tailscale`, the health probes and the relay registration are all stubbed at the module boundary. The port is asserted as the value that reaches the spawn/funnel call, not as an observed public endpoint — proving the published URL answers on that port needs a real tunnel, which is out of scope here. The full suite remains the integration gate's responsibility.
