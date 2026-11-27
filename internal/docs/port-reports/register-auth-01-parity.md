# Sign-in registration batch 1 — Refs #2034

Base: `f51dae3c22`. This first attempt starts at the prepared integration base;
there was no `register-auth-01/gate-*.json` candidate to restore.

## Sources and integration

The preserved provider reports pin MIT sources CLIProxyAPI
`dbe641f286a489ecb39e3c041c554371e6add864` and OmniRoute
`b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523`. Relevant files are CPA
`internal/auth/codex/openai_auth.go`, `sdk/auth/codex_device.go`,
`internal/auth/claude/anthropic_auth.go`, and OmniRoute
`src/lib/oauth/providers/{codex,claude}.ts`. Gemini CLI source boundaries
are recorded separately below and in its preserved profile report.
EasyCLIProxyAPI `29567ead8164a00724dfdc2087f02a23895636ee` delegates to CPA;
it supplies no additional provider wire protocol.

- Codex: register the staged fresh-login URL helper, form exchange with bounded
  abort and no fallback replay, login-mode validation and status-only device
  failures. Central registry token URL becomes `/oauth/token`. Refresh uses
  `buildCodexRefreshRequest` while retaining redirect rejection, no transport
  replay, timeout, refresh claims, workspace checks and selected proxy.
  The optional refresh scope is omitted, matching OmniRoute's documented choice.
- Claude: register the pasted-code/state parser and fixed exchange failure.
  Validation errors use the existing route validation disposition. State/PKCE,
  flow claims, owners, sessions, tenant guards and connection persistence remain
  in the existing route. No CLI browser module is imported by web code.
- Gemini CLI: register the configured-client exchange and discovery refresh
  helper. Discovery deliberately uses the raw five-argument Google refresher;
  the SSE convenience wrapper takes proxy in position four and cannot satisfy
  the manifest's fifth-argument contract. Other providers retain their wrapper.
- Antigravity: its profile report proves equivalent public handlers, so retain
  them and their 21-test public lifecycle suite without redundant registration.
- ChatGPT plan: remains a separate owner-operated, hidden provider. No SIWC
  credentials are admitted into Codex and no enrollment guards are changed.

The batch 1 manifests and staged source modules remain untouched under the
explicit forbidden-path rule. The later Copilot line-offset-only metadata
exception is recorded below. Their historical `staged` status is therefore not the runtime truth;
production imports and positive public-route assertions establish registration.
The original form-refresh staging probe now checks production form encoding;
the original fresh-login and device-body probes now check positive wiring.
All protocol, security, quota and usage scenarios are retained.

## Supported and inapplicable modes

Claude's pinned sources implement authorization code with S256 and refresh,
not RFC 8628 device authorization. Poll interval/deadline tests would invent a
protocol. Instead public tests cover browser flow expiry and cancellation,
pasted state mismatch before transport, rejected grants, unsupported device and
import actions, two accounts/proxies, one-use exchange, discovery, refresh,
and both buffered and streamed OpenAI/Anthropic requests with usage.
The existing seven helper/protocol tests remain; they are not treated as full
public-route coverage.

DurinDoor's Gemini CLI profile uses its existing operator-configured confidential
Google authorization-code client without PKCE or device authorization. The
three pinned projects do not establish an active native Gemini CLI wire contract:
CPA tests plugin OAuth storage/callbacks, EasyCLIProxyAPI lists API-key setup,
and OmniRoute marks Gemini CLI discontinued. The staged helpers repair
DurinDoor configuration/transport wiring; they do not invent plugin protocols. Antigravity has S256 in DurinDoor but no
device or refresh-token import slot. Codex supports browser, device and CLI
credential import; ChatGPT plan SIWC remains separate. Cookie/session capture
is not a supported mode for these OAuth identities and is not synthesized.

## Validation and limits

Run the five requested explicit files from `tests/` with `--maxWorkers=2`.
All upstream transport is mocked and unexpected URLs fail closed. Runtime
handlers, local disposable DB, translators and credential ownership code run
unchanged. Claude token counting is mocked separately from accepted inference,
so the no-replay assertion counts actual `/messages` submissions.

No dependency installs, live provider calls, browser, e2e, Docker, deployments,
secret stores, pushes or PR operations. Reused installed dependencies needed
local link repair because the shared root linked a removed candidate checkout.
Initial collection failures and subsequent reports are preserved privately in
`/var/tmp/register-auth-01-2jqpfwh4/reports/`. Commands use umask 077, env -i,
private HOME/DATA_DIR/TMPDIR/cache/npm cache/pnpm store, at most two workers and
five-minute limits. No full CI or baseline change.

No UI source changed. Two pending GHE Storybook scenarios declare the shared
OAuth route as a source dependency; their active SHA-256 hashes are refreshed
with the normal source-byte digest. Historical evidence and all approval fields
remain untouched. Registry generation
ran normally; the generated index has no diff because export inventory is unchanged.

Public setup remains in the Antigravity, Codex and Claude Code guides, with
Gemini CLI setup in `docs/providers/gemini-cli.mdx`. Live acceptance remains
unverified; these contracts prove local behavior against pinned source protocols.

The source-backed Codex refresh body changes from JSON to form encoding; the
existing two-account ownership test now decodes the form without reducing its
assertions, concurrency or scenarios. ESLint reuses installed packages with a
private `resolve-next.cjs` preload only to resolve the stale Next peer link.
No lint rules or repository config are changed. Initial ordinary and
preserve-symlink lint attempts are retained as failed environment evidence.

Claude usage assertions preserve `open-sse/utils/usageTracking.js`'s existing
`DEFAULT_BUFFER_TOKENS` on OpenAI responses and exact native Claude usage.
The existing `chatCore.js` 401/403 recovery permits one credential refresh and
one rejected retry; the refusal case verifies that bound. Successful requests
submit exactly once. These tests do not change translator or retry policy.

Additional scoped regression run: 55 assertions pass across Codex exchange,
Claude profile, Codex refresh identity and permanent-401 suites; two assertions
in `tests/unit/codex-refresh-token.test.js` retain the obsolete
`/api/accounts/oauth/token` plus JSON request contract. The pinned staged helper
requires `/oauth/token` with form encoding. The old endpoint/body expectations
need a source-backed update; rotation and strict proxy assertions must remain.

Final requested inventory: **5 files, 89 assertions passed**, including the
original 27 Codex, 21 Antigravity and seven Claude cases plus added public
contracts. `parity-final-3.log` records the complete command. Scoped ESLint
passes with the existing anonymous-default-export warning on the registry;
`anti-slop-final.log` records zero diagnostics with two threads.

The two explicitly authorized endpoint literals in
`tests/unit/codex-refresh-token.test.js` now match the pinned helper. The one
obsolete JSON header/body expectation is also updated under explicit scope
clarification: Content-Type is form-encoded and `URLSearchParams(...).toString()`
serializes exactly the same client ID, grant and refresh-token fields. Accept,
rotation, persistence, proxy and every other assertion/scenario are untouched.
CPA `internal/auth/codex/openai_auth.go` lines 241–247 uses `data.Encode()`,
`application/x-www-form-urlencoded` and `Accept: application/json` at TokenURL.
The failed endpoint-only run is retained as source-backed obsolete-contract
evidence in `codex-endpoint-correction.log`.

ChatGPT plan's real public enrollment handler returns 404 with zero upstream
calls when the explicit operator gate is unset. Its existing protocol and
loopback cases retain SIWC exchange, refresh and deadline coverage. No public
success is fabricated by bypassing the operator, owner, session or origin guards.

Final combined verification: **7 files, 123 assertions passed** in 21.24 seconds
(`parity-complete.log`). It includes the requested five-file inventory, the full
23-case refresh suite and the full 11-case exchange suite; the 27-case Codex
suite remains intact. Scoped ESLint exits 0 with only the pre-existing registry
export warning; anti-slop exits 0 with zero diagnostics and two threads.
`git diff --check` passes. Final Vite config/cache paths are redirected through
local dependency links into the private run directory. No dependencies installed.
The requested commit subject follows the repository contract; the installed
package inventory has no commitlint CLI, so its attempted invocation is retained
in `commitlint.log` rather than downloading a new dependency.


## Gate follow-up on f7f9edaf6b

The rejected gate identifies prior candidate `f7f9edaf6b41cdba05b259a533098d7a0b30d17b`
in the explicit local repository's `register-auth-01/gate-*.json`. This retry
retains that complete candidate and every test. No reset, replacement suite or
baseline edit occurred.

The discovery route fixture mocked `GEMINI_CONFIG` as empty and mocked the
old four-argument SSE refresher. Configure both fixture files through synthetic canonical
`GEMINI_OAUTH_CLIENT_ID`/`GEMINI_OAUTH_CLIENT_SECRET` before module imports,
restore their previous values afterward, and load the actual OAuth config.
Mock only the actual raw five-argument refresh service. Preserve the same
401 → refresh → successful retry scenario, exact bearer replacement, two
fetches and selected-proxy assertions. Assert the canonical config's exact
client identity, null logger and proxy in argument five. The project-normalization
suite gets synthetic canonical client environment variables before module
initialization; all project/protocol/request scenarios remain intact. Production's
configured-client refusal stays unchanged.

Copilot's unchanged static source-location test requires exact line references.
Only the two shifted JSON offsets are corrected (`github.pollToken` 1372 → 1312;
GHE discovery 671 → 674). All four slots, exports, status and all 19 protected
Copilot tests stay unchanged. No Copilot auth behavior is registered here.

The gate's removal-count flags are source-backed replacements, not scenario
removal: two pending Storybook SHA-256 values replace stale source digests;
the refresh test replaces only the explicitly authorized endpoint literals,
Content-Type and serialization while keeping all fields/assertions; Codex
positive wiring assertions replace the permitted staging-negative assertions,
with every protocol/security/usage scenario retained. Approval fields,
historical Storybook evidence, guard/disposition providers and failure baselines
are unchanged. These facts are recorded for review, with no gate override.

Retry verification on the final fixture/config changes: **10 files, 158 tests
passed** in 20.14 seconds, two workers. This includes the original five-file
acceptance inventory, the complete 27/23 Codex parity/refresh suites, exchange
suite, both corrected Gemini fixture suites and the unchanged 19-case Copilot
suite. Final evidence is retained in
`/var/tmp/register-auth-01-retry-pfxav5ft/reports/final-contracts.log`;
`canonical-fixtures.log` also records the focused 16-case real-config run.
Scoped ESLint and anti-slop pass (`lint.log`, `anti-slop.log`); diff whitespace
checks pass. A byte comparison against f7f9edaf6b verifies all prior parity and
refresh suites remain identical. A structured comparison verifies only two
Copilot manifest offsets changed, with all other metadata identical.

No installs, full CI, browser/e2e/Docker/provider calls, pushes or overrides.
The broad orchestrator gate has not been rerun here; its concrete failed
contracts are covered by the scoped checks above. All commands used a new
umask-077 private run directory and env-i HOME, DATA_DIR, TMPDIR, caches,
npm cache and pnpm store, with five-minute limits. Prior candidate evidence
and the complete implementation are preserved.
