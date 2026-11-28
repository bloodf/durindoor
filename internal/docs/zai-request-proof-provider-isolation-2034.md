# Z.ai client request proof provider boundary (#2034)

The selected canonical provider now scopes client proof fields at the start of
`chatCore`, before validation, prompt transforms, translation and execution.
Only `zai-web` retains `captcha_verify_param`, `captchaVerifyParam` and
`zaiCaptchaVerifyParam`. Other selected providers receive copies with those keys
omitted at the top level and along the `providerSpecificData` path. Unrelated
fields remain. No replacement placeholder is sent upstream.

The original body and nested provider data remain available to later combo
members. This helper does not modify credentials, stored proof extraction,
audit redaction, logger APIs, raw header snapshots or combo retry policy.
Post-completion uncertainty remains terminal; setup failure remains eligible
for ordinary fallback. Messages translation behavior is unchanged.

## Evidence scope

Work started at `e63ef40e006b7bae2f15915527ca86530f357923`. The parent reported
its reproduction at `9493964d31eb0b058e9ef36d304831569c33513e`; this report does
not claim an independent run on that exact revision or any live exposure.
The parent's private reproduction was neither opened nor changed.

The new file `tests/unit/zai-request-proof-provider-isolation-2034.test.js`
reuses `cookiePublicFlow2034`, with real SQLite, API-key admission, public route
parsing, combo resolution, accounts, strict proxy selection and executors.
The shared fixture substitutes management authority; the tests create synthetic
accounts directly through the real database API. Vendor replies and transport
are synthetic and closed to unexpected destinations. No gateway is mocked.
All proofs, tokens and keys are synthetic. No live provider is contacted.

Coverage includes three aliases at both locations, direct OpenAI, nonbillable
Z.ai setup 503 followed by OpenAI 200 with zero Z.ai completion POSTs, reversed
member order, buffered and streaming clients, frozen caller-body preservation,
simultaneous admitted Z.ai requests, no proof persistence, Messages setup failure,
and terminal uncertain completion with no successful usage. Existing protected
suites cover stored proofs, source tokens and audit metadata boundaries.

Disabling only the new chatCore boundary caused all 12 original alias/location/
stream omission cases to fail on leaked fields. The dedicated parent-shaped
case separately verifies fallback 200 and zero completion POSTs before checking
proof omission. This is a local synthetic regression, not evidence of live use.

## Validation

Dependencies were installed frozen for root, CLI and tests with an explicit
unique private store. Commands used `env -i`, private HOME, DATA_DIR, TMPDIR and
cache under `/var/tmp/zai-request-proof-2034.qCK0i8`, a 300-second ceiling, and
two Vitest workers. Raw evidence is retained there. No full inventory, browser,
e2e, Docker, live provider, push or PR action was run.

The three protected test files were confirmed tracked before execution and
remain byte-for-byte unchanged. The new test path was confirmed untracked before
adding it. No baseline changes were made.

Scoped command (from repository root, with the private environment above):

```sh
node tests/node_modules/vitest/vitest.mjs run --config tests/vitest.config.js \
  tests/unit/zai-request-proof-provider-isolation-2034.test.js \
  tests/unit/zai-web-proof-combo-fallback-2034.test.js \
  tests/unit/fix-zai-source-token-proof-2034.test.js \
  tests/unit/zai-proof-metadata-secret-boundary-2034.test.js --maxWorkers=2
```

The four-file run passed 61 assertions before the final dedicated parent case
and strengthened usage-status assertion were added. Root lint initially rejected
two new raw type checks; the helper now uses the same `isRecord` predicate as the
existing Z.ai session helper. The final new-file and lint results are recorded
below after their completion. Existing-suite output included a process listener
warning; it did not fail the scoped command.

Final outcomes: all 24 tests in the new file passed. Root `pnpm run lint`
passed (existing ESLint warnings, zero errors; anti-slop zero diagnostics).
`git diff --check` and the explicit protected-file unchanged check passed.
The new `isRecord` helper change received a final focused caller-immutability
and parent-reproduction recheck. The parent-shaped disabled-boundary run failed
specifically at proof omission after confirming fallback 200 and zero completion
POSTs. Baseline impact: none; stored-proof handling remains covered by the
unchanged protected suites. No independent review or merge gate is claimed.
