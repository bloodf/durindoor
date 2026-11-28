# Bedrock discovery body timeout classification (#2034)

Private discovery correction; no public registration or wiring. Base checkout:
`21e7ffb65000ed499fae0ed0d58b61f9c976adb4`. Source freeze:
2026-11-27T23:49:25.752045Z. No upstream refresh performed.

Attribution retained: OmniRoute (MIT), Copyright (c) 2026 Cheaper Inference -
Created by Diego Souza, source commit `3a17f7e908308a217887a7617c2c793b95ea83c0`.

## Defect

Two timers serve one deadline: the discovery-wide timer and the timer inside
`readBoundedResponseText`, armed for the time left to the same `end`. When the
reader's timer fired first, `state.timedOut` was still false and its
`TimeoutError` matched no branch in `toDiscoveryError`:

- on the foundation model list, or any call answering an error status with a
  stalled body, discovery failed as `unavailable`/502 `TransportUnavailable`;
- on an inference profile page, `unavailable` is not fatal, so discovery
  **succeeded** with a partial list and the warning
  `Bedrock inference profiles unavailable (TransportUnavailable)`.

The first symptom made the discovery suite's "times out a body that never ends"
case fail intermittently. An independent review reported it as pre-existing.

## Correction

The request handler turns a `TimeoutError` from its bounded body read into the
`timeout`/504 `TimeoutError` failure. `timeout` is already fatal for profile
pages. Both timers stay, the shared reader is unchanged, and no test timeout was
raised. Precedence is otherwise unchanged:

- a caller abort is still `aborted`/499, even if it lands while the reader
  deadline is cancelling the body;
- a `TimeoutError` thrown by the transport before any response, and any other
  body stream error, are still `unavailable`/502;
- an error status with a complete body is still classified as before. An error
  status whose body stalls is a `timeout` in either timer order.

## Regression suite

`tests/unit/fix-bedrock-discovery-body-timeout-2034.test.js` has 23 cases. It
fakes `setTimeout`, `clearTimeout` and `Date`, and moves the clock by 10 ms
before the reader computes its delay, which forces either timer to fire first
(or both at one instant). Each foundation and profile case asserts the order
through the abort state seen at body cancellation. Cases also assert one body
read, one cancellation, a released stream lock, no pending timer and no extra
request. Identities and transport are synthetic; the real Bedrock SDK runs.

Against the unchanged `index.js`, 7 cases failed and 16 passed. The failures were
the six reader-first cases and the explicit stream `TimeoutError` case: six
received `unavailable`/502 and the profile case received a successful partial
result. With the correction all 23 pass.

## Validation

Commands ran in a private `git archive` snapshot of the base with the changed
files copied in, under `env -i` with explicit PATH, LANG and CI, private HOME,
DATA_DIR, TMPDIR, caches and pnpm store under `/var/tmp`, a 300-second ceiling
and two test workers. Root and `tests/` dependencies were installed there with
`pnpm install --frozen-lockfile --ignore-scripts --store-dir <private store>`.
Node was 24.22.3.

- This suite plus the discovery (35), profile boundary (19), AWS credentials
  (26) and credential boundary (20) suites: 5 files, 123 passed, none pending or
  todo. The four existing suite blobs match the base.
- `node node_modules/eslint/bin/eslint.js src`: 0 errors, 348 warnings.
- `node scripts/build-anti-slop-plugin.mjs`, then
  `node scripts/check-anti-slop.mjs`: 0 diagnostics across 3714 files.
- Direct ESLint on the module and this suite with `--max-warnings=0`: no findings.

The intermittent failure rate in the review was not re-measured. The forced
timer orders above reproduce its mechanism and received value.

## Validation limits

Only this suite, the four existing Bedrock suites (unchanged) and root lint were
run. No live AWS call, real profile, build, full inventory or browser check was
used. Exact-head independent review and the merge gate remain outstanding.
