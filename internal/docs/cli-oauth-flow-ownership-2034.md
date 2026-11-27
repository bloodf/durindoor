# Shipped terminal sign-in ownership (#2034)

The npm bin is `cli/cli.js`; its terminal entry loads
`cli/src/cli/terminalUI.js`, which loads `menus/providers.js`. The existing
provider catalogue selects five browser modes (Claude, Codex, Gemini CLI,
Antigravity, iFlow) and three device modes (GitHub, Qwen, Kiro). This change does
not add wizard entries or modify provider/model metadata.

## Current source contract

At base d62248bead65, `src/app/api/oauth/[provider]/[action]/route.js`
`beginAuthorization` returns `authUrl`, `state`, `flowId` and `expiresAt`.
`completeAuthorization` requires code, matching state and flowId; the stored
flow supplies the verifier, redirect and client metadata. `beginDeviceCode`
returns public instructions, interval, expiry and flowId; device_code and
verifier are deliberately private. `pollDeviceCode` requires flowId and loads
all private credentials from the server flow. The old CLI's requirement for a
public device_code and its forwarding of codeVerifier/extraData were obsolete.
No server ownership checks have been changed.

`src/lib/oauth/providers.js` Claude `exchangeToken` supports `code#state`.
`src/lib/oauth/redirectUri.js` registers Claude's manual-code callback at
https://platform.claude.com/oauth/code/callback; the CLI now requests that
redirect instead of its generic loopback. URL callbacks must match the
redirect in the server-issued authorization URL (including Antigravity's
server-selected desktop redirect). The CLI does not substitute remembered
state for missing callback state, accept raw credentials, or submit a callback
twice. Only code/state/flowId are sent; server-held client context is reused.

Device polling unwraps application-level success independently from HTTP
success, preserves pending results, follows a positive finite interval and the
server expiresAt, and adds five seconds to subsequent intervals on slow_down.
Esc/Ctrl+C cancels the bound flow and prevents further polls; cancellation
also settles an in-flight client wait, while the server commit guard prevents
late token persistence. Terminal failures display fixed recovery guidance,
without raw upstream messages.

## Verification and continuity

`tests/unit/cli-oauth-flow-ownership.test.js` runs the actual CommonJS menu,
helper and API client through an intercepted `http.request` into the actual
public GET/POST handlers and real flow store/completion code. Provider network,
authorization fixtures, UI, clipboard and credential files are mocked; no real
sockets, browser or secret store is used. CommonJS UI dependencies are supplied
through require.cache, rather than ineffective ESM-only mocks. Existing test
files are unchanged. Focused regression runs also include the server-bound
flow suite and CLI tests, with at most two workers.

This is a first-attempt unit, as clarified by the owner: there is no prior
candidate or gate JSON to carry forward. The implementation starts from the
prepared branch at d62248bead65 and preserves all existing checkout tests; no
previous test scenario was removed or weakened. Dependency installs and tests
use a private /var/tmp HOME, DATA_DIR, TMPDIR and caches under an empty child
environment; install lifecycle scripts are disabled to avoid unrelated runtime
installation. No full-suite, live-provider, browser, Docker or remote changes
are part of this unit.

Final scoped validation: 115 assertions passed across nine files:
cli-oauth-flow-ownership (34), cli-providers-auto-ping (22),
oauth-route-bound-flow (12), oauth-flow-store (10), oauth-flow-lifecycle (6),
cli-fast-path (4), cli-admin-combos (15), cli-api-key-expiry (4), and
root-cli-advisories (8). Explicit ESLint checks on the changed JavaScript files
and `git diff --check` passed. No baseline changes.
