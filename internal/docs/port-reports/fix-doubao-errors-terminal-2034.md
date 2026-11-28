# Doubao Web error and terminal repair (#2034)

Offline repair of the D1–D4 findings in `doubao-web-2034.md`, integrated from
`3501a13be1b`. Base: `fbf30334f2dc4899e900a215252e3e020b4cbe2f`.
No post-freeze head was fetched or adopted. Carried unchanged from
`17419342d33` onto the current integration head, with only the file names corrected.
No live provider acceptance is claimed.

## Scope and behavior

The implementation changes `open-sse/executors/doubao-web.js`, the new
`tests/unit/fix-doubao-errors-terminal-2034.test.js`, and this report change.
The executor's JSDoc documents the runtime contract. Only the explicitly authorized Doubao fixtures/assertions in `arch-c2311.test.js`
are migrated on retry. Other existing suites and cookie
capture/import requirements remain unchanged, including existing `ttwid` behavior.
The test sends a synthetic `ttwid` when it is already in a stored Cookie header.

The physical POST still uses the fixed `https://www.dola.com/chat/completion` host,
selected connection's Cookie, query `fp`, payload `ext.fp`, and selected proxy.
Returned diagnostics contain only the fixed URL, a safe content-type header and
null transformed payload. Errors use fixed messages; upstream error bodies and
transport exception messages are never copied or read into the error envelope.
401/403, 429 and other upstream statuses survive; redirects remain rejected as
401. Numeric `Retry-After` survives a 429, without copying arbitrary headers.

The established sender bounds submission and owns quota dispatch. Body reads use
`readBodyWithTimeout`, `MAX_PROVIDER_BODY_BYTES`, and `PROVIDER_BODY_TIMEOUT_MS`.
Discarded response cancellation uses `cancelDiscardedResponse` and never waits for
an upstream-controlled cancel promise. No accounting or shared logger is removed.

A partial source answer followed by `STREAM_ERROR`, malformed JSON/framing, a
body read exception, or body timeout returns 502 before any output is published.
It uses the existing internal `claudeRequestScoped` result flag: despite its name,
`chatCore` passes it through failure results for every provider, and
`singleModel/postProcess` and `transientBackendRetry` both honor it before replay.
This is the existing request-scoped failure convention, with no shared changes.
No successful stop, end_turn or usage is emitted; the tests also check that the
isolated usage history contains no success row for either connection.

HTML and otherwise empty/unusable answers return a fixed 502 and retain normal
account error recording/fallback, including the existing safe `lastError` behavior.
Auth rejections can still fall back to a sibling's own cookie/proxy. Failed source
generations cannot rotate accounts or replay on the same account.

## Actual shared logging boundary inspected

`open-sse/handlers/chatCore.js` copies `result.url`, `headers`, and
`transformedBody` into request logging, and its error line passes that URL through
`maskSensitiveUrl` in `open-sse/utils/requestLogger.js`. That shared helper does
not mask `fp`. The provider therefore returns a fixed query-free diagnostic URL;
its credential-bearing wire URL never reaches that line. The shared request
logger strips URL queries and stores payload metadata, rather than raw payloads.
The suite also enables and exercises that actual logger in private scratch and
reads its generated files to verify no synthetic cookie/fingerprint appears.
Console/error logging is captured across the real gateway and account paths.
No separate shared logger/redactor file is needed or changed. This does not claim
that every other provider is safe or that arbitrary external transport logging
outside these application boundaries is redacted.

## Bounded reproductions: before and after

The base executor and repaired executor were loaded against the same mocked fetch
in a credential-free process. Relative imports in a private scratch copy of the
base source resolved to the same checkout dependencies. No base changes were kept.

```text
D1/D2 before: status=500, "Dola error: synthetic-bare-session-alpha rejected"
             loggedURLHasFingerprint=true
D1/D2 after:  status=500, "Dola upstream request failed"
             loggedURLHasFingerprint=false
throw before: status=502, error includes synthetic Cookie and ?fp= fingerprint
throw after:  status=502, "Dola request failed", no fingerprint in diagnostic URL
D3 before:    status=200, content="partial", finish_reason="stop"
D3 after:     status=502, "Dola generation failed", terminalNoReplay=true
D4 before:    status=200, content="", finish_reason="stop"
D4 after:     status=502, "Dola returned an empty or unusable response"
```

The initial gateway regression run against the unmodified base failed all 11
selected cases (echo, failed terminal and HTML cases). The repaired gateway suite
covers bare session and full Cookie echoes and transport throws in all four
OpenAI/Anthropic × buffered/streamed combinations, capturing console messages,
client responses and saved `lastError`. It uses actual `handleChat`, executor,
SQLite connection/error paths and proxy dispatch; only the network transport is
scripted. Both stored credentials and proxy settings are checked after failures.
The dispatched Undici ProxyAgent's selected URI is checked against that account,
as are wire Cookie, query fingerprint and body fingerprint.

## Validation

All setup and essential checks use `env -i` with explicit PATH, LANG and CI and
unique private HOME, DATA_DIR, TMPDIR, cache and pnpm store under `/var/tmp`.
Root and tests dependencies were installed with frozen lockfiles into this
checkout; no borrowed graph was repaired or relinked. Every command has a
300-second ceiling. Focused Vitest uses `--maxWorkers=2` and the repository config.

Run from `tests/`:

```sh
node node_modules/vitest/vitest.mjs run \
  unit/fix-doubao-errors-terminal-2034.test.js \
  unit/cookie-flow-doubao-web-2034.test.js \
  unit/doubao-web-provider.test.js \
  unit/web-session-redirects.test.js \
  unit/review-w-websession-proxy.test.js \
  unit/provider-registration-web-batch-a.test.js \
  unit/provider-registration-web-batch-a-routes.test.js --maxWorkers=2
```

Result on Node 24.22.3 and pnpm 12.18.0: 205/205 pass across seven files, including
the 35 new cases. Earlier five-file run of the same implementation: 134/134. The immutable cookie-flow suite passes 31/31. Additional direct executor cases prove submission
and body deadlines even when the transport or cancel operation never resolves,
safe status/quota evidence, safe request diagnostics, and HTML rejection.
Targeted ESLint passes on this head. In the earlier run, root `pnpm run lint`
passes (348 existing src warnings, zero errors; anti-slop zero diagnostics). The
35 new cases were rerun after the final source changes and with structured console
arguments serialized rather than collapsed to object labels. `git diff --check` passes.
Failure baselines are unchanged; every new case runs normally. The retry
migration of the existing architecture suite is detailed below.

## Limits and provenance

This preserves the existing complete `MESSAGE_DELTA`/`STREAM_CHUNK` EOF success
cases, with or without `[DONE]`. A transport cut exactly between complete source
events is indistinguishable from that existing EOF success contract; there is no
claim that the provider supplies a stronger mandatory terminal marker. Incomplete
frames, explicit errors and broken body reads are rejected. Collection remains
buffered before delivery. No live sign-in, real proxy connection, browser/e2e,
full inventory/build gate or independent review was run here.

The original provider protocol is attributed by the integrated report to
OmniRoute (MIT), `open-sse/executors/doubao-web.ts` at
`b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523`. This repair uses existing DurinDoor
helpers and locally authored validation; no additional upstream logic was ported.
CodeGraph was unavailable on PATH, so source lookup used bounded checkout search.

## Gate-3 retry: authorized architecture fixture migration

Carried the full `4506ad2b03c32386fc97236971a40bcff03fdd03` checkpoint
onto base `e3658bc6836` as `c08ae479256`; the executor and all 35 own cases
are unchanged. No source head was fetched. The referenced `.orq/.../gate-3.json`
is absent in this checkout; the two reported failures were confirmed in the
existing test source before editing.

- Error assertion before: expected sanitized `Dola error: upstream rejected token=…`.
  After: exact `Dola upstream request failed`, with separate assertions excluding
  raw upstream prose and the synthetic secret. The adjacent Notrack expectation
  and every other provider case are unchanged.
- Positive block/patch fixture before: `Hel`, `lo`, `data: not-json`, `[DONE]`.
  After: `Hel`, `lo`, a benign `: keepalive` SSE comment, `[DONE]`, still yielding
  `Hello`. The separate streamed `Hello` case still ends at complete-event EOF.
- Malformed input remains explicit negative coverage in both stream modes:
  partial text followed by `data: not-json` returns 502 with exact safe message,
  no choices/stop/usage, one dispatch, and `claudeRequestScoped: true` to prevent
  gateway replay. The unchanged own suite exercises the actual gateway boundary.

The actual source contract skips comment-only frames, parses nonempty data as
JSON, and fails invalid JSON before publishing any buffered source text. It
continues to accept EOF after complete source events; no parser tolerance was
added for the obsolete positive fixture.

Retry validation (Node 24.22.3, pnpm 12.18.0): root and tests frozen-lockfile
installs succeeded in this checkout with a new private store. The exact seven
files in the command above plus `unit/arch-c2311.test.js` passed: **234/234,
eight files**, including own 35 and cookie-flow 31. The command ran from `tests/`
with `--maxWorkers=2`, `env -i`, private `/var/tmp/doubao-2034-retry.lQopxZBg`
HOME/DATA_DIR/TMPDIR/cache/store and a 300-second ceiling. No credentials were
inherited. No full-suite worker was started.

Targeted ESLint passes for the executor and own regression file. Adding the
architecture file to ESLint fails on its **pre-existing duplicate `readStreamLines`
import** (base lines 16 and 190; now lines 16 and 208), outside the authorized
Doubao assertion/fixture migration. It was left unchanged. Vitest collects and
passes that file. `git diff --check` passes. No root lint/build/full gate is
claimed for this retry.
