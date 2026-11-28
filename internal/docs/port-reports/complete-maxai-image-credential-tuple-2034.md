# Complete MaxAI image credential tuple isolation (#2034)

## Change

The private image adapter now delegates account selection to the existing
`open-sse/executors/maxaiCredentials.js` resolver carried by
`9b2eae8af9b53f1b317156870c908123532bf338`. The previous image-only field-by-field
selection could combine a saved PSD token with an imported cookie's device and
user. A complete cookie `access_token=t; device_id=d; user_id=u` now resolves
exactly `{ token: "t", deviceId: "d", userId: "u" }`, even with a stale saved token.
A cookie token with a missing member cannot borrow that member from PSD.
JWT user fallback comes only from the selected token; conflicting subjects and
duplicate conflicting cookie tokens are refused by the shared resolver.

Complete legacy PSD-only tuples remain supported. The image wrapper preserves
its existing LocalStorage device-ID quote stripping on a copy of PSD, without
mutating stored credentials. It maps the shared resolver's refusal to the
adapter's existing `null` contract. Signing cryptography, chat executors, registry,
account fallback, foundation markers and retry policy are unchanged. MaxAI image
support remains private and unregistered.

The explicitly authorized migration in `tests/unit/native-maxai-image.test.js`
changes only the unsafe expected token from `psd` to `t`. The surrounding JWT,
quoted device, incomplete tuple and unsafe-header assertions remain intact.

## Own regression suite

`tests/unit/complete-maxai-image-credential-tuple-2034.test.js` uses the existing
real cookie-import/pairing routes, isolated SQLite storage and gateway chat
construction. It extends that harness to actual private image construction.
Operator authorization, proxy reachability and outbound transport are mocked;
all identities and signing constants are synthetic. Unexpected network calls
fail closed.

Coverage includes two imported accounts retaining stale PSD, actual decrypted
chat/image signatures and proofs, Bearer identity, request body, selected proxy,
public registration absence, missing members before discovery/send, malformed
input, complete legacy PSD, quote compatibility without mutation, token-local JWT
fallback/conflict, and response/log secret absence. Image disconnect, 5xx and
unreadable success cases assert one send and the existing accepted-job accounting.
The two-account gateway chat disconnect case requires exactly one send and
`upstream_outcome_unknown`, exercising the integrated Tencent/MaxAI terminal
foundation in `src/sse/handlers/chat/singleModel/postProcess.js`. It does not retain
the older suite's permissive cross-account fallback expectation. The private
image path is called directly; these tests do not claim public image endpoint
activation or end-to-end image gateway fallback coverage.

## Sources and attribution

Sources are frozen at **2026-11-27T23:49:25.752045Z**. No source refresh, network
comparison or new upstream pin was used. The existing MIT-licensed OmniRoute
project attribution is retained: [cheaper-inference/OmniRoute](https://github.com/cheaper-inference/OmniRoute),
commit `c71f0065a7efe9230ec23b96a12253b050c4d7ad`, files
`open-sse/executors/maxai/credentials.ts`, `signing.ts`, `protocol.ts`, and
`open-sse/handlers/imageGeneration/providers/maxaiImage.ts`, as recorded in the
private image registration and existing port report. The earlier tuple report
also records `credentials.ts` at `4265bb2ad5477450a07d3a43ea33a62c6c874878`
and `b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523`. No upstream code was copied here;
this change reuses the repository's existing resolver.

Remaining limits: actual browser cookie/storage placement, signing bundle
freshness, vendor acceptance, refresh-token capture and renewal remain unproved.
Saved stale PSD remains stored but cannot supply members to a selected cookie
tuple. Source refresh and disposable live verification are separate work; no
real provider, token or account was used.

## Validation

Starting checkout HEAD: `0dea3a84fb9aeca923d956d2c512d126f72f6f41`.
Evidence directory: `/var/tmp/maxai-2034-e4m_fond` (private mode 0700).
Commands used `env -i` with explicit PATH, LANG and CI, private HOME/DATA_DIR/TMPDIR
and caches/store, and `timeout 300`. Node reported 24.22.3.

| Check | Result |
| --- | --- |
| From `tests/`: `node node_modules/vitest/vitest.mjs run unit/complete-maxai-image-credential-tuple-2034.test.js unit/native-maxai-image.test.js --maxWorkers=2` | Exit 1: Vitest missing; no tests collected or executed |
| `node node_modules/eslint/bin/eslint.js src` | Exit 1: ESLint missing |
| `node scripts/build-anti-slop-plugin.mjs` | Exit 1: esbuild missing; bundle not written |
| `node scripts/check-anti-slop.mjs` | Exit 1: oxlint missing |
| Node syntax checks for new suite and image signer | Passed |
| Dependency-free Node assertions importing actual image credential wrapper | Passed: cookie precedence, missing members, conflict, legacy PSD, quoted device/JWT and malformed input |
| `git diff --check` | Passed |

Root and test dependencies are absent. No install, borrowed dependency mutation,
full inventory, test:ci or local-ci run was performed. The focused suite and root
lint are **not validated**; the native gate must supply isolated dependency setup
and run the named commands. Syntax and smoke checks do not replace that gate.
The failure baseline and existing test inventory configuration are unchanged.

## Gate correction

The first native evidence run executed the focused suite and rejected two own-suite
assertions: chat selected Charlie where the fixture expected Alpha (the first
chat/image case and the two-account unknown-outcome case). The test setup relied
on per-row priority updates during account creation rather than persisting a full
final account order. The corrected harness explicitly sets MaxAI's fill-first
strategy in its disposable database, atomically orders all created IDs after setup,
and asserts both the distinct IDs and persisted priorities before dispatch.
Bearer, decrypted signature, selected proxy and exactly-one-send assertions remain
strict. Production selection and terminal-outcome policy are unchanged.

The native test-file delta is the user-authorized assertion migration, not removal
of a scenario: the expected token changes from stale `psd` to cookie `t`, with the
same exact device/user assertions. An additional own regression now repeats that
literal tuple and refuses missing members even with complete saved identities.
The report now describes the unchanged failure baseline directly.

The corrected suite still requires execution with isolated dependencies: this
worker checkout has no root or test node_modules. The prior gate failures are
recorded above rather than represented as a pass.

Correction verification evidence is retained in
`/var/tmp/maxai-2034-correction-tzijhohx` (0700), using a new private environment
and 300-second limits. The named focused command and all three direct root-lint
commands again exited 1 because their dependencies are absent. The corrected
suite passes Node syntax checking and `git diff --check` passes. No execution pass
is claimed for this correction.
