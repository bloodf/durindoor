# DeepSeek Web source repair (#2034)

The `82d15a5a7c0` default-off completion claim is withdrawn. The source requires
proof on every completion. The follow-up [mandatory proof report](complete-deepseek-source-default-2034.md)
records the authorized fixture migrations, restored terminal checks and current evidence.
All verification is mocked/offline, not live provider parity.

Base: `fbf30334f2dc4899e900a215252e3e020b4cbe2f`; the repair series
(`32727dcb0bb`, `1105fed4228`) is merged onto integration head `0e4553ee1b5`.
It carries the cookie-flow report from `6500f95f7c6` unchanged. The cookie-flow
test has one authorized fixture migration, described under
[Integration reconciliation](#integration-reconciliation).
Scope: the executor, new executor-local protocol/solver helpers, one new suite,
and this report. No live provider requests or live parity claims.

## Source and license

Port source: cheaper-inference/OmniRoute (MIT),
`4265bb2ad5477450a07d3a43ea33a62c6c874878` (2026-11-21T17:10:26Z).
Read exact objects from the read-only `/tmp/omni-2034` repository; its newer HEAD
was not used. The reported cache revision `b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523`
was absent there. Fetched only that exact revision into a private bounded bare
scratch repository, without changing the borrowed checkout or consulting later heads.
Its commit time is 2026-11-27T14:40:38Z, before the owner freeze
2026-11-27T23:49:25.752045Z. Matching Git blobs at both pins:

| Source file | Git blob |
| --- | --- |
| `open-sse/executors/deepseek-web.ts` | `0f68366ffdb9c85538b824ec6c18610e0b98472a` |
| `open-sse/executors/deepseek-web/pow.ts` | `096f0be08a0d72d60048e4cdcf10039c6f4f5ec9` |
| `open-sse/lib/deepseek-pow.ts` | `3d373dcb138ca3012d737d58e21604754fecc849` |
| `open-sse/lib/deepseek-pow-hash.js` | `10941df9b4a016adf4fbe58c60471079a7429f34` |
| `open-sse/lib/deepseek-pow-worker.mjs` | `6a375678576bbf796857c33bb14029e70a310740` |

The hash and worker retain source algorithms, with attribution comments and
repository-shared type predicates replacing direct typeof checks for lint compliance.
`pow.js` adapts source validation, worker scheduling and proof serialization;
`protocol.js` holds the envelope mapping and bounded body reader. The fragment
decoder (`decodeEvents`) lives in `deepseek-web.js`, the provider-private parser
location that `review-x-sse-final.test.js` allows. Copyright/license are
retained in `open-sse/executors/deepseek-web/LICENSE.omniroute`.
The fixed hash vectors in the new suite come from the same pin's
`tests/unit/deepseek-pow-js-only.test.ts`. No extracted binary or remotely loaded
solver is used. The implementation is the source's JavaScript 23-round Keccak
solver, with a separate 24-round FIPS control tested against Node crypto.

## Reproduction before edits

Ran the carried report's bounded fake-fetch pattern against the actual unedited
executor in a credential-free private environment. Both a JSON HTTP200
`{code:40003}` rejection and a native fragment stream ending in `FINISHED`
returned HTTP200 with empty assistant content, `finish_reason:"stop"` and zero
usage. Each made only current-user, session-create and completion calls, with no
challenge or proof header. This confirms the report's local execution gaps;
it does not establish whether the live service requires proof today.

## Resulting behavior

- Nonzero top-level JSON envelope codes map to fixed errors: 40003 → 401,
  40002 → 429, everything else → 502. Provider prose and exception text never
  become client messages. Empty/unrecognized completion bodies fail.
- Native `v.response.fragments`, `response/fragments` arrays/objects, bare `v`
  deltas and nested response fragment batches preserve answer/reasoning routing.
  Native streams require `response/status: FINISHED`; OpenAI `[DONE]` alone does
  not qualify. Malformed JSON/UTF-8, missing terminal, read exceptions and aborts
  cannot produce successful stop or usage. Legacy envelopes and OpenAI deltas require
  an explicit valid finish or `[DONE]`; EOF alone fails. Mixed dialects fail.
- Streaming clients retain the executor's existing buffered-then-SSE behavior.
  This permits full validation before any successful client completion is sent;
  it does not add incremental delivery or claim full upstream feature parity.
- Proof is mandatory: every completion first fetches an unbilled challenge from
  the fixed first-party endpoint with `{target_path:"/api/v0/chat/completion"}`.
  No environment value disables it. The real bounded source solver serializes
  `algorithm`, `challenge`, `salt`, `answer`, `signature`, `target_path` as base64
  JSON in `X-Ds-Pow-Response` on the single completion POST.
- All stages use the selected account and proxy, manual redirects, and no account
  cache or ambient credential fallback. Completion transport replay is disabled.
  The real proxy-router tests (in the new suite and in the
  migrated cookie-flow fixture) verify four socket sends for each of two synthetic
  credentials/strict proxies, including account-specific proof/session binding.
- Only DeepSeekHashV1 is supported. Challenge inputs and setup bodies are bounded;
  difficulty is at most 250,000; at most two workers run, each with a 10-second
  solve deadline and 32 MiB old/8 MiB young generation plus 2 MiB stack limits.
  Worker environments are empty, contain challenge data only, and inherit no
  credentials or runtime flags. Abort/timeout always terminates the worker before
  releasing its slot. Unsupported/no-solution challenges fail before submission.
- A 60-second request deadline covers setup, solving and completion reads. Setup
  JSON is capped at 64 KiB per response, completion at 4 MiB. UTF-8 decoding is
  incremental and fatal for invalid sequences, preserving split multibyte text.
- Accepted or uncertain completion failures, including transport exceptions and
  ambiguous 5xx replies, carry the existing request-scoped terminal contract
  (`claudeRequestScoped`, honored for both client dialects). This prevents refresh,
  account rotation and outer transient replay. Explicit auth/quota rejection
  remains classifiable; no executor retry is added. Auth refresh is declined.
- Setup/challenge are unbilled. The original completion quota ticket is transferred
  onto mapped errors and successes; tests settle the real ticket for successful,
  envelope-rejected and truncated completion cases. Existing zero/estimated token
  reporting is preserved; no usage is invented on errors.

## Offline verification and packaging

All installs and test/lint commands ran under `env -i` with explicit PATH, LANG,
CI and unique private HOME, DATA_DIR, TMPDIR, XDG cache and pnpm store beneath
`/var/tmp/deepseek2034.*`. Each command had `timeout 300`; focused Vitest used two
workers. Root, CLI and tests dependencies were installed with frozen lockfiles
into this checkout and the private store. No shared graph was repaired or relinked.
CodeGraph was unavailable; bounded exact-path reads/searches were used instead.

New suite: `tests/unit/deepseek-web-source-parity-2034.test.js`.
The public-route tests run actual OpenAI and Anthropic route handlers, translator,
chatCore and executor with mocked network responses. Authentication/account
selection is isolated at the handleChat seam; live dashboard auth and the entire
account-selection loop are not exercised. Terminal results additionally pass
through the real single-model postprocessor and do not request another account.

Worker packaging is exercised offline using the existing
`cli/scripts/build-cli.js` `copyRecursive` helper: copy the executor helper
payload and its manifest-listed shared type-predicate dependency to a disposable
runtime root, then solve with the copied worker/hash.
The existing `scripts/packaging-manifest.json` already includes the entire
`open-sse` tree, and `scripts/build-app.mjs` copies that tree into standalone.
No additional packaging path is needed. This is helper-level artifact validation,
not a full Next production build or installed CLI smoke run.

Commands (from repository root, within that private environment):

```sh
node tests/node_modules/vitest/vitest.mjs run --config tests/vitest.config.js \
  tests/unit/deepseek-web-source-parity-2034.test.js --maxWorkers=2
node tests/node_modules/vitest/vitest.mjs run --config tests/vitest.config.js \
  tests/unit/deepseek-web-source-parity-2034.test.js \
  tests/unit/deepseek-web-provider.test.js tests/unit/deepseek-web-capture.test.js \
  tests/unit/cookie-flow-deepseek-web-2034.test.js --maxWorkers=2
pnpm run lint
```

Superseded test counts and the earlier fixture-failure table from the first two
commits are replaced by [Integration reconciliation](#integration-reconciliation).

## Deferred documentation row

For the final docs batch, `src/lib/providers/cookieImport/README.md` still calls
DeepSeek Web “Manual token” and says “there is no cookie to capture”. The existing
extension/dashboard flow imports the approved localStorage `userToken`; the row
should describe that flow. It was not edited because `src/**` is out of scope.

## Gate correction: caller working directory

The first commit's root-only validation missed the documented `tests/` invocation.
Reproducing that invocation on the first commit yields 49 failures and six passes:
worker lookup incorrectly assumed `process.cwd()` was the application root, and
the packaging test likewise copied source paths relative to its caller's directory.

The solver now prefers the existing packaged runtime path, then resolves the
worker beside its source module if that runtime asset is absent. It does not
search ancestor directories. The fallback uses `fileURLToPath(import.meta.url)`
with ordinary path operations rather than the static `new URL(worker, import.meta.url)`
worker-detection pattern discussed in the pinned source. Production bundles retain
the runtime-root priority that avoids frozen build-machine module paths.
The packaging fixture resolves input files relative to the test module and checks
that the copied worker exists before invoking it. A new regression solves from an
unrelated temporary directory, also exercising slot recovery and cwd restoration.

Verification uses a fresh private `/var/tmp/deepseek2034-cwd.*` environment with
`env -i`, explicit PATH/LANG/CI, private HOME/DATA_DIR/TMPDIR/cache, 300-second
command ceilings and two Vitest workers. The focused suite now has 56 passing
tests when run from `tests/` and from the repository root. The combined run from
`tests/` has 115 passes and the same five immutable fixture failures documented
above. The anti-slop check passes with zero diagnostics. No frozen suite or
out-of-scope file was changed, and no live provider request was made.

```sh
cd tests
node node_modules/vitest/vitest.mjs run \
  unit/deepseek-web-source-parity-2034.test.js --maxWorkers=2
```

The paragraph above records the second commit's state. Its fixture-failure claim is
superseded by the next section.

## Integration reconciliation (superseded)

`82d15a5a7c0` added an opt-in flag to accommodate three-request fixtures and
changed the legacy incomplete-delta case from HTTP502 to HTTP200. Those changes
did not complete source parity and are withdrawn. The follow-up restores mandatory
proof and the original `1105fed4228` strict EOF assertion, retains the additional
malformed/empty/mixed negative cases, and migrates only authorized DeepSeek fixtures.
The decoder remains in the allowed executor module; the architecture guard is unchanged.

The historical 602-test/root-lint result validated that earlier integration only.
It is not evidence for mandatory default proof or terminal parity. Current scoped
counts and exact per-file changes are recorded in the follow-up report. Full CI
belongs to the orchestrator/review lane and was not run for this follow-up.
