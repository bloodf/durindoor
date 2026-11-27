# Codex credential quota bootstrap — #2034

## Source and comparison

Read pinned public sources from router-for-me/CLIProxyAPI (MIT), comparing
`b2e331626229f4bff380545303077596e0fe10df` with
`dbe641f286a489ecb39e3c041c554371e6add864`. All nine files below are byte-identical
at these refs. This is a remaining parity port, not a claim of a new change in
that interval. Attribution: CLIProxyAPI contributors; the structured billing
classifier and bootstrap commitment policy are adapted from these MIT sources.

- [codex_executor_stream.go](https://github.com/router-for-me/CLIProxyAPI/blob/dbe641f286a489ecb39e3c041c554371e6add864/internal/runtime/executor/codex_executor_stream.go)
- [codex_executor_terminal.go](https://github.com/router-for-me/CLIProxyAPI/blob/dbe641f286a489ecb39e3c041c554371e6add864/internal/runtime/executor/codex_executor_terminal.go)
- [codex_websockets_errors.go](https://github.com/router-for-me/CLIProxyAPI/blob/dbe641f286a489ecb39e3c041c554371e6add864/internal/runtime/executor/codex_websockets_errors.go)
- [codex_websockets_stream.go](https://github.com/router-for-me/CLIProxyAPI/blob/dbe641f286a489ecb39e3c041c554371e6add864/internal/runtime/executor/codex_websockets_stream.go)
- [codex_stream_bootstrap_buffering_test.go](https://github.com/router-for-me/CLIProxyAPI/blob/dbe641f286a489ecb39e3c041c554371e6add864/internal/runtime/executor/codex_stream_bootstrap_buffering_test.go)
- [codex_websockets_duplex_bootstrap_input_test.go](https://github.com/router-for-me/CLIProxyAPI/blob/dbe641f286a489ecb39e3c041c554371e6add864/internal/runtime/executor/codex_websockets_duplex_bootstrap_input_test.go)
- [codex_billing_failover_test.go](https://github.com/router-for-me/CLIProxyAPI/blob/dbe641f286a489ecb39e3c041c554371e6add864/test/codex_billing_failover_test.go)
- [codex_quota_failover_test.go](https://github.com/router-for-me/CLIProxyAPI/blob/dbe641f286a489ecb39e3c041c554371e6add864/test/codex_quota_failover_test.go)
- [codex_stream_disconnect_failover_test.go](https://github.com/router-for-me/CLIProxyAPI/blob/dbe641f286a489ecb39e3c041c554371e6add864/test/codex_stream_disconnect_failover_test.go)

`codex_executor_terminal.go` recognizes `insufficient_quota` in type or code and
`credit_balance_exhausted` in code, at root, error, body.error and response.error.
It assigns credential-scoped 429 regardless of upstream model cooling. Its closed
bootstrap preamble list releases unknown events because hosted tool work can have
side effects before a text token. HTTP/SSE and Responses WebSocket loops share
that policy. The failover tests distinguish key exhaustion from OAuth eligibility
and forbid replay after observable output.

The supplied EasyCLIProxyAPI `29567ead8164a00724dfdc2087f02a23895636ee` and OmniRoute
`b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523` dispositions require no runtime port in
this lane. This report's source comparison is confined to CLIProxyAPI.

## Existing behavior and remaining gaps

DurinDoor already bounds the Codex SSE peek by bytes and time, replays buffered
bytes through the same reader under backpressure, cancels that reader on abort,
and selects eligible accounts in the single-model account loop. Existing
translators already deliver trailing streaming failures without account replay.
These mechanisms remain in use; old tests are unchanged.

Missing behavior was structured billing classification, safe propagation of its
identity through HTTP error redaction, credential-wide scope, and the quota-specific
same-chunk commitment boundary. Non-streaming clients had another reachable gap:
the Responses SSE-to-JSON conversion collapsed a trailing quota failure into a
502 and the account loop replayed the generation. New route contracts exposed it.

The changes reuse the existing account loop. Billing codes normalize to 429 and
retain only an executor-built safe envelope. `postProcess` supplies the account
lock scope instead of the model scope. The bounded bootstrap returns an uncommitted
quota rejection for ordinary eligible-account selection; generated text, arguments,
thoughts and unknown hosted-tool events commit the account. Empty model-authored
announcements can still precede failover. The JSON conversion returns a terminal
billing failure flagged as partial output when output preceded it.

Two necessary seams outside the initial path list are `open-sse/utils/error.js`
(safe billing identity would otherwise be discarded for every 429) and
`open-sse/handlers/chatCore/sseToJsonHandler.js` (the demonstrated JSON replay).
Both changes are Codex-specific. No generic retry policy or post-output fallback
is expanded. Quota duration classification and stored credential secrets are unchanged.

## WebSocket applicability

DurinDoor's Codex credential executor uses HTTP Responses with SSE. It does not
implement CLIProxyAPI's raw Responses WebSocket executor. The separate
`codex-app-server` provider connects to an operator-configured CLI session using
its capability token; it does not select or present the API-key/OAuth accounts
used by `codex`. Rotating those accounts after an app-server failure would change
an unrelated identity without changing the CLI session. No credential bootstrap
is added there. Its existing mock WebSocket tests verify terminal errors, session
policy, capability isolation and cancellation. Raw Responses WebSocket credential
failover remains inapplicable until such a transport exists in this repository.

## Evidence

`tests/unit/cpa-codex-quota-parity.test.js` uses disposable HOME/DATA_DIR and real
SQLite, account selection, executors, translators and `handleChat` route dispatch.
Provider fetches are mocked and socket dials are refused. Both codes cover:

- HTTP and SSE zero-output API-key-to-OAuth failover through OpenAI chat,
  Anthropic messages and Responses routes, for streaming and JSON requests.
- First text, tool arguments and thought output followed by failure in the same
  network chunk: one selected-account send, terminal error, no sibling replay,
  no successful usage write.
- Credential-wide locks and sibling-model selection independent of model locks;
  safe HTTP error identity, malformed/plain-text data, empty announcements and
  unknown hosted-tool traffic.
- Cancellation while the actual routes await bootstrap: one send, upstream reader
  cancellation and no sibling or successful usage write.

Existing Codex capacity, model rejection, Claude Responses error and app-server
WebSocket suites are run unchanged. The existing capacity suite also checks byte
bounds, split frames, backpressure replay and exact cancellation reasons.

Final validation:

- Requested evidence command: `cd tests && test -f unit/cpa-codex-quota-parity.test.js && node node_modules/vitest/vitest.mjs run unit/cpa-codex-quota-parity.test.js --maxWorkers=2` — 81 passed.
- Combined parity and four unchanged compatibility suites — 124 passed before
  the final three malformed-HTTP route contracts were added; the final parity
  rerun includes those contracts and the stronger single usage-write assertion.
- Scoped ESLint and scoped oxlint anti-slop — passed for all six changed JS files.
- `git diff --check` and commit-message commitlint — passed.

Vitest reports a process beforeExit MaxListeners warning during repeated module
resets; assertions and process exit pass. Existing files and the failure baseline
remain unchanged. No full CI,
real accounts, browser, Docker, publishing or deployment is part of this evidence.
The failure baseline is unchanged.
