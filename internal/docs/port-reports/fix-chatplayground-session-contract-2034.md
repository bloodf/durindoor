# ChatPlayground session handoff (#2034)

Source freeze: 2026-11-27T23:49:25.752045Z. Read the sourceflow report
`cookie-flows/chatplayground-2034.md`; no post-freeze upstream adoption or live calls.

## Implemented boundary

`chatplaygroundSession.js` extracts the current executor's fixed Clerk exchange.
Only `__client` reaches the fixed Clerk session-token endpoint; the session JWT's
bounded, restricted `sid` selects its path. Cookies never become Bearer headers.
The resulting token goes to the current web `/api/me` and chat endpoints. The
current chat catalog remains credential-free. No legacy `app.` endpoints were added.
No code was ported from OmniRoute; its cached MIT source does not establish the
newer unified web API's identity or availability.

Each operation mints anew. There is no shared token cache or account fallback.
Explicit expired JWTs are rejected; returned expiry is capped at 60 seconds.
Opaque minted tokens remain supported for compatibility with the existing chat
contract and fixtures; they do not establish cryptographic expiry or identity.
Acquisition is bounded to ten seconds and 256 KiB of JSON; cancellation also
bounds transports that ignore signals. Diagnostics contain fixed reason strings,
never upstream bodies, exception text, redirect locations, cookies or token URLs.
No retry is introduced, including after a chat dispatch of unknown outcome.

The exported `inspectChatPlaygroundConnection(credentials, fetcher, options)` is
nonbillable and requires the selected connection's proxy-bound fetcher. It checks
`/me` for a nonempty string `id`, otherwise returns exactly
`unsupported_me_identity_shape`. Discovery additionally requires an array catalog,
otherwise `unsupported_catalog_shape`. These checks establish only the local
protocol contract, not live sign-in. A 200 HTML challenge cannot pass readiness.
The existing compatibility wrappers remain available; registration must activate
the new helper, rather than interpreting those wrappers as strict readiness.

Machine-readable activation instructions are in
`open-sse/executors/chatplayground-session-handoff.json` for register-cookie-repairs.
No shared registration, models, test or validation wiring changed here.

## Bounded reproductions for registration owner

The sourceflow report's existing immutable integration test remains the exact
reproduction harness. Its reported base is `4819aba30dd` (38 assertions passed).
Run only with mocked network, isolated environment, and at most two workers:
`node node_modules/vitest/vitest.mjs run unit/cookie-flow-chatplayground-2034.test.js --maxWorkers=2`.

1. In its chat or `/v1/models` case, after the bounded 100 ms warm-up, inspect
   catalog calls: the generic resolver sends
   `Authorization: Bearer __client=synthetic-client-bravo...` to web `/api/models`.
   Required repair is exclusion from both generic Bearer resolvers, then selected
   connection discovery through the helper. The malformed header is not accepted
   behavior and no new passing assertion endorses it.
2. Test and validate issue one raw-Cookie `/api/me` call without minting. Under the
   mocked chat contract they return `valid:false`, although mint then Bearer `/me`
   succeeds. Both need the new readiness helper and selected proxy snapshot.
3. Dashboard discovery's request has `redirect:undefined`; it needs the new helper
   so each request uses `manual` and a 3xx cannot become successful discovery.

## Validation and limits

Added `tests/unit/fix-chatplayground-session-contract-2034.test.js`: real helper/executor with
network mocks, account/proxy closure snapshots, repeated acquisition, explicit
expiry, cookie echo rejection, denial/redirect/HTML/oversize/unknown shape,
abort/stalled body, fixed origins, and one chat dispatch after unknown work.
All existing tests, baseline and test configuration are unchanged.

Syntax checks passed for both executors and the added test. A dependency-free
helper smoke passed mint Cookie scope, Bearer readiness and stalled-body deadline
under `env -i`, explicit PATH/LANG/CI, a unique mode-700 `/var/tmp` HOME/DATA_DIR/
TMPDIR/cache, and a 60 second ceiling. No credentials were inherited.
Root and tests dependencies are absent; no installs or borrowed-dependency edits
were performed. Vitest and repository gates have **not run**; native isolated gate
setup must run the new test and existing ChatPlayground/cookie-flow/redirect suites,
then required full CI. CodeGraph wrapper reported required version unavailable;
bounded exact-file reads were used instead. No claim of live protocol parity.

## Evidence failure correction

The supplied gate rejection contained exit 1 without a command or diagnostic.
Independent reproduction found a concrete exit-1 defect in the pre-aborted path:
`withChatPlaygroundSessionDeadline` rejected its deadline promise, then returned
before attaching `Promise.race`. Node reported unhandled `session_aborted` after
the caller had already received `{ ok:false, status:408 }`.

The helper now returns before constructing that promise when the caller signal is
already aborted. The new regression exercises both acquisition and readiness and
waits one event-loop turn so the test runner can observe unhandled rejections.
No network dispatch occurs on this path.

Before correction, an isolated native Node reproduction exited 1 with the
unhandled rejection. After correction, the same scenario passed with
`--unhandled-rejections=strict`, repeated ten times for both entry points, plus
active abort, stalled-body timeout and normal mint/readiness checks. The run used
`env -i`, explicit PATH/LANG/CI, a unique private `/var/tmp` HOME/DATA_DIR/TMPDIR/
cache and `timeout 60s`. Syntax and diff-whitespace checks passed. Vitest/full CI
remain unavailable locally because dependency directories are absent; the exact
external evidence gate has not been rerun or claimed passing.

## Required evidence path correction

Read the orchestrator's `gate-1.json` at the explicit path supplied by the owner.
It records successful setup and evidence exit 1 on head
`06ebd179f68f4cfb44cc0571440eeecad2b6d7d5`, with an outside-paths flag for
this unit's original test and report locations. The owner confirmed the silent
`test -f unit/fix-chatplayground-session-contract-2034.test.js` guard failed
before Vitest. This was a path mismatch, not a product-test failure. The prior
pre-abort correction fixes a separately reproduced defect; it does not explain
the gate-1 rejection.

Renamed the entire test to the exact required filename, preserving every case,
and moved this report to its required location. The exported helper and JSON
handoff are unchanged. No evidence command, runner, dependency graph or shared
setup was modified. Required file-presence, test syntax and whitespace checks
passed. Dependencies remain absent in this checkout, so no Vitest run or duplicate
install was attempted; the native gate must supply its isolated setup and run the
exact named evidence. No result is claimed for gate-2.

## Carried forward and verified (attempt 3)

The three prior commits (`06ebd179f68`, `2ca1af0ee55`, `56eff9497c8`) were
cherry-picked onto this branch unchanged. Helper and executor code were not
reimplemented.

Review found no product defect in the helper. It did find one handoff gap: the
helper accepts `/me` only with a nonempty string `id`. No source proves that
claim, and the repository's own mocks (`cookie-flow-chatplayground-2034`,
`port-omni-20375`) answer `/me` with `{ user: {} }`. Once registration wires
the helper, those flows will fail closed with `unsupported_me_identity_shape`.
This is intended: the identity is unknown, so the probe fails closed. The
handoff JSON now states this under `protocolCaveat`, and lists the three
reproductions with file, case, observed and required behavior.

New cases in the evidence test (no existing case changed or removed):

- session ids `../x`, `a/b`, `a?b` and empty are refused with 401 and no request sent;
- a `/me` 302 is refused without following it. Only the fixed Clerk and web
  URLs are requested, and the result carries no location, cookie or token;
- with no selected-connection transport, the helper returns
  `selected_connection_transport_required` and global `fetch` is never called.

### Vitest results

Dependencies were borrowed read-only from the main checkout. A private
`/var/tmp` copy of `HEAD` got its own `node_modules` directory of links. The
borrowed root has stale links into a deleted worktree. Those were not touched.
The private links point straight to the same versions in its `.pnpm` store.
The runs used `env -i` with explicit PATH, LANG and CI. HOME, DATA_DIR, TMPDIR
and XDG_CACHE_HOME were unique private `/var/tmp` paths. Each run had a
300 second ceiling and `--maxWorkers=2`.

- `unit/fix-chatplayground-session-contract-2034.test.js`: 18/18 passed.
- With `cookie-flow-chatplayground-2034` (38), `chatplayground-provider`,
  `port-omni-20375-chatplayground-unified-api`, `review-x-chatplayground`,
  `web-session-redirects`, `review-x-executor-send-3` and `arch-c2309`, the
  8 files passed: 179/179 including the new cases (173/173 before them).

The full `test:ci` run was not performed in this unit.

## Gate 3 retry

Carried checkpoint `1f6e62d53ced3dd8f4179c21d84be95cc7ffb42b` as four
unchanged commits before this correction; all 18 evidence cases remain unchanged.
Replaced all four runtime `typeof` checks in the helper with the existing
`isString` / `isFunction` project predicates, preserving primitive-string and
function validation without lint suppression. The `/me.id` guard remains an
unverified local guard, not a source-backed field contract.

Activation owner is **register-cookie-repairs**. Classify
`unsupported_me_identity_shape` as **unverified/unsupported**, never as invalid
credentials or healthy. Preserve the existing chat path independently of this
strict readiness guard. No provider response-field evidence was obtained.

Actual retained gate-3 JSON was read from the coordinator's unit directory.
Evidence passed (18/18); checks and their retry exited 1 with the retained tail
showing `no-runtime-typeof` on `sid` and `token`. No earlier diagnostics are
available in that retained tail.

Retry verification used `/var/tmp/chatplayground-gate3-i9fxy2b_/repo`, an archive
of the carried head with the three corrected files overlaid. All eight exact
previous suite paths ran from `tests/` with `node node_modules/vitest/vitest.mjs
run ... --maxWorkers=2`: **179/179 passed**, including **18/18 unchanged own
cases**. Environment was `env -i` with explicit PATH/LANG/CI and private
HOME/DATA_DIR/TMPDIR/cache/store, with a 300 second command ceiling.

The scratch copy initially used read-only borrowed package links. Invoking
`pnpm run lint` unexpectedly triggered pnpm's automatic dependency setup in
that private copy before lint. Its `.pnpm` is a private directory; the borrowed
store remains separate and was not repaired, deleted or relinked. No explicit
install command was issued. The tls-client-node install hook attempted GitHub
metadata access and reported HTTP 403; no provider call or credential was used.
This setup deviation is recorded rather than represented as an install-free run.

`pnpm run lint` exited **0**: root ESLint reported 0 errors / 348 warnings;
the actual bundled anti-slop gate reported **0 diagnostics across 3696 files**.
The complete full checkpoint (build and complete CI inventory) was not rerun
in this unit; these focused results do not replace the independent full gate.

Exact related-suite command (from the private copy's `tests/`, under the
isolated environment described above):

```sh
node node_modules/vitest/vitest.mjs run \
  unit/fix-chatplayground-session-contract-2034.test.js \
  unit/cookie-flow-chatplayground-2034.test.js \
  unit/chatplayground-provider.test.js \
  unit/port-omni-20375-chatplayground-unified-api.test.js \
  unit/review-x-chatplayground.test.js \
  unit/web-session-redirects.test.js \
  unit/review-x-executor-send-3.test.js \
  unit/arch-c2309.test.js --maxWorkers=2
```

The own evidence test is byte-identical to checkpoint `1f6e62d53ce`. The
executor is also unchanged from that checkpoint. Only the helper predicates,
helper JSDoc and report/JSON handoff changed in the retry correction.
