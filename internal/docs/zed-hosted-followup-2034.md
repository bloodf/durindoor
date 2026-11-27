# Zed follow-up for #2034

Continuity: prepared base 68e78e2089 includes predecessor
5454c8b16c9485e2f758cee2a4c7c028b83eb1a1. Its protected three-test file is
byte-for-byte unchanged (git diff against predecessor is empty).

Read-only source caches inspected:
- OmniRoute b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523: shared/zedAuth.ts,
  executors/zed-hosted.ts and native OAuth adapter establish RSA native callback,
  cloud.zed.dev token/models/completions protocol and vendor translation.
- CLIProxyAPI dbe641f286a489ecb39e3c041c554371e6add864: bounded exact-word Zed
  search in internal finds a user-agent test, no Zed hosted executor contract.
- EasyCLIProxy 29567ead8164a00724dfdc2087f02a23895636ee: bounded source search
  finds no Zed hosted implementation. Neither absence changes the local supported paths.

The pinned OmniRoute helper retries expiry headers without distinguishing accepted
completions. DurinDoor now requires explicit 401 rejection for completion replay;
network uncertainty, successful responses and output are never replayed here.
This is a deliberate gateway safety restriction, not an upstream hosted authorization
claim. Credential endpoints are fixed, redirects refused in the dedicated executor,
and each transport receives a 30-second cancellation deadline.

Cache keys now include connection, system ID and supplied proxy options alongside
full token, user and organization. Rotations cannot reuse old credential entries.
Upstream bodies are untrusted: HTTP and stream failures expose stable diagnostics
instead of echoed secrets. The old stream-message assertion expecting "model
overloaded" described an obsolete raw-echo contract and now asserts withholding
that text while retaining the same error scenario and error code. No test removed.

Production handler mocks cover both buffered and streamed OpenAI/Anthropic calls.
New route tests invoke the real OAuth POST handler and RSA adapter, with persistence, the generic provider facade and transport mocked around
the real Zed adapter: wrong state, supplied verifier tampering,
callback replay and per-owner supersession are covered. Existing quota tests cover
selected-account Orb credit observations, missing/expired credentials, malformed
payloads and redirect refusal; no billable inference probe is used.

Shared edits are intentionally handed to auth06 in
src/lib/oauth/providerParity/zed-hosted/registration.json. Discovery must pass its
resolved proxy and connection ID to obtain the new isolation guarantee. The generic
exchange wrapper must forward cancellation to the dedicated adapter. These pending
slots mean this worker does not claim complete public parity.

Validation evidence: /var/tmp/zed-followup-2034.l2EmRaqv (mode 0700).
Root and test dependencies were essential for the closed-mock suite and installed
with env -i, private HOME/DATA_DIR/TMPDIR/XDG/npm cache/pnpm store and umask 077.
No CLI or website install was needed. Nine scoped files passed 93 tests in
zed-final.log; the added deadline boundary assertion passed with all 15 follow-up
tests in deadline-tests.log (94 distinct assertions across the final scoped set).
Every test command used timeout 300 and maxWorkers=2. No test baseline edits,
live calls, Docker, browser, deployment, push or PR-state changes were performed.
Root lint passed (349 existing warnings, zero errors); anti-slop passed with zero
diagnostics across 3663 files. Full CI/build and independent review remain pending.
