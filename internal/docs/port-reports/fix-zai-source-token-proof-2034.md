# Z.ai Web source token and proof contract, #2034

## Verdict: NOT FULL PARITY

This report covers the executor repair that follows the cookie-flow report
`internal/docs/port-reports/cookie-flows/zai-web-2034.md` (written at
`acaef33ca45`). That report is left as it was: it records the original
reproduction, not how the repaired executor behaves.

The repair changes only `open-sse/executors/zai-web.js`, the helpers
`open-sse/executors/zai-web/session.js` and `open-sse/executors/zai-web/readBody.js`,
the new regression file `tests/unit/fix-zai-source-token-proof-2034.test.js`,
this report and the private handoff
`internal/docs/port-reports/fix-zai-source-token-proof-2034-handoff.json`.
Public capture, registry, import activation, shared auth and existing suites are
unchanged. No live origin, token location, proof validity or completion is claimed.

### Source reproduction and attribution

Re-read `acaef33ca45:internal/docs/port-reports/cookie-flows/zai-web-2034.md` and
the current executor. The old executor ignores both request and stored proofs
and accepts a non-SSE 200 as an empty completion; this is reproducible directly
from its `readCompletion` and payload construction. The protected reproduction
at `tests/unit/cookie-flow-zai-web-2034.test.js:669` now fails exactly where it
asserts that proof is dropped (see the conflicts section), which confirms the
old behavior was what that test pinned.

Only existing pins before the freeze (2026-11-27T23:49:25.752045Z) were read.
These source reads were made by the first repair attempt (commit `2b7540b78b0`
on the attempt branch). Its scratch clones no longer exist, and this revision
did not read the pins again. Read-only Git commands used `GIT_NO_LAZY_FETCH=1 GIT_OPTIONAL_LOCKS=0` in
`/tmp/omni-2034` for `4265bb2ad5477450a07d3a43ea33a62c6c874878` and
`/tmp/omniroute-2034-d3f06` for
`b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523`. The four source blobs in the original
table were rechecked and are identical at those pins. Protocol and executor
contents were read at the port pin, including `buildZaiBrowserChatOptions`,
`useSignedApi` and proof extraction. No source fetch or later pin was used.

Proof extraction in `open-sse/executors/zai-web/session.js` is adapted from
OmniRoute `open-sse/executors/zai-web/protocol.ts`, blob
`511e5d3aa9937ef537712b8163ad6b997878a9f7`, MIT, Copyright (c) 2026 Cheaper
Inference, created by Diego Souza. Source terminal envelope shapes were checked
against `open-sse/executors/zai-web/stream.ts` at the same port pin.

### Current private contract

- Canonical explicit Local Storage credential: `credentials.providerSpecificData.token`.
  This matches the shared import handler's existing named-item storage rule;
  it is consumed by exported `resolveZaiWebSession(credentials, extractZaiWebToken)`.
  Legacy `apiKey` / `accessToken` accept manual `token=<value>` and bare/Bearer
  values; source JSON credential wrappers are accepted too. An explicitly
  malformed storage value or differing credential values refuses dispatch.
  No global credential, page, proof or account cache is introduced.
- Source proof precedence is body, credential `providerSpecificData`, `apiKey`,
  then `accessToken`. The three source aliases and credential JSON/cookie
  envelope forms are preserved. The opaque string goes unchanged after source
  whitespace trimming into completion JSON `captcha_verify_param`, never into
  an invented query/header or a solver. Audit body copies redact its aliases.
- A missing/blank proof or image request produces local HTTP 400
  `zai_proof_required` before **either** POST. Normal text/proof dispatch sends
  setup and one completion to fixed `https://chat.z.ai`, with the selected
  account's token and the exact selected proxy options on both requests.
  Redirects are manual and rejected; a Location is never followed.
- Non-SSE, HTML, malformed JSON data frames, explicit errors, nonzero codes,
  incomplete streams and contentless terminals produce a local failure rather
  than an empty success. Valid source `done` / `finish` / completion-finish,
  OpenAI finish reasons and `[DONE]` terminals are recognized. The executor
  still buffers before constructing its OpenAI response/stream, so an upstream
  failure cannot emit a success stop or usage frame first.
- Failures after setup carry the existing internal `claudeRequestScoped` flag.
  Despite its historical name, `chatCore`, single-model `postProcess`, combo
  and transient-retry code use it as a request terminal. This avoids account,
  model, credential-refresh or uncertain-work replay without shared changes.
  No new retry loop is added. Caller cancellation settles dispatch and throws.
- Body reads have local 120-second and 16-MiB bounds, cancel their reader on
  failure, and honor caller cancellation. These are local safety bounds,
  **not** a provider proof TTL. Error messages never include provider response
  text or thrown transport messages, which can contain token URLs or proofs.

### Precise limits and shared-owner handoff

The source proof is opaque. It defines no expiry timestamp, challenge identifier,
account-binding verifier or refresh API. Therefore this unit cannot locally
prove that any supplied string is valid, unexpired or issued for this challenge
and account. It passes the selected request's proof once and treats provider
expiry/challenge rejection as terminal. Synthetic proofs prove forwarding and
isolation only. No local TTL, guessed verifier or proof bypass is implemented.

The pinned no-proof branch drives a normal headed browser using `browserBackedChat`,
a token-keyed pool, Local Storage on the fixed origin, page controls and
`reuseContext: true`. DurinDoor has no corresponding browser-backed chat service
or Z.ai browser pool that can preserve selected account session **and** selected
proxy binding. The upstream options read here do not establish proxy binding.
Porting only DOM automation would not establish that property. Browser parity is
therefore unsupported and guarded by the actionable local refusal. No browser,
page script, origin permission, third-party solver or paid service was added or run.

`fix-zai-source-token-proof-2034-handoff.json` is the pure JSON private handoff with exact proposed
registry/import profile, payload and stored field names, helper exports and
remaining activation work. The shared cookie batch owner must implement and
verify capture/create/update activation; changing the profile alone still does
not fix create validation. Existing manual cookie credentials remain consumable
with a caller-supplied proof. Public capture still cannot read Local Storage.
No live sign-in, site token location, actual proof validity or completion was
verified. This unit does not advertise a usable browser branch or full parity.


### Existing assertions that conflict with the required proof gate

No existing test was edited. `tests/unit/cookie-flow-zai-web-2034.test.js` is
protected. The other two files below are left unchanged, so the conflict can be
resolved in one place by the test owners. Every case fails for one of two
reasons. All but one assert a successful or provider-shaped result from a
request that carries **no** CAPTCHA proof, and the executor now refuses that
request locally with HTTP 400 `zai_proof_required` before any POST. The
remaining case asserts that a supplied proof is dropped.

The proofless cases are below. The line given is the first assertion that fails.

| File:line | Test | Asserted today | Stricter replacement |
| --- | --- | --- | --- |
| `cookie-flow-zai-web-2034.test.js:317` | carries exactly the tab's chat.z.ai token cookie … | 200 success without proof | supply a synthetic proof, assert it reaches the completion body only |
| `cookie-flow-zai-web-2034.test.js:428` (×4, `it.each` at 404) | stores only the token pair from a Cookie header / cURL / cURL -b / HAR paste … | 200 success without proof | same |
| `cookie-flow-zai-web-2034.test.js:490` | accepts a bare Local Storage value through Add Connection … | 200 success without proof | same |
| `cookie-flow-zai-web-2034.test.js:569` | keeps each account on its own token and proxy … | 200 for both accounts without proof | per-account synthetic proofs, assert each stays with its own account and proxy |
| `cookie-flow-zai-web-2034.test.js:584` | returns a pinned account's rejection without rotating … | provider 401 | supply proof, then assert the provider 401 with no rotation |
| `cookie-flow-zai-web-2034.test.js:604` | falls back on its own proxy, then recovers … | 200 after re-capture | supply proof on both turns |
| `cookie-flow-zai-web-2034.test.js:636` | keeps the query-string token out of the response … | 502 transport failure | supply proof, then assert the redacted 502 |
| `cookie-flow-zai-web-2034.test.js:657`, `:661` (`it.each` at 648) | reports a failure for a 200 reply that is not an event stream | 502 / streamed failure | supply proof; the stricter executor still fails a non-SSE 200 |
| `zai-web-provider.test.js:63`, `:73`, `:81` | JSON/SSE chat, Anthropic Messages route, two-session isolation | 200 success without proof | supply proof per request, or assert `zai_proof_required` |
| `fleet-provider-zai-web-acceptance.test.js:107` | zai-web credentials are never sent to another vendor's endpoint | at least one outbound call | supply a proof so dispatch occurs, keep the origin assertion |

The proof-dropping case:

- `cookie-flow-zai-web-2034.test.js:681`: the NOT PARITY reproduction at line 669
  expects the provider's refusal text in the response, and at lines 683–684 that
  the completion body has no `captcha_verify_param`. The repair forwards the
  selected request's proof in the body. It also returns a fixed redacted failure
  message instead of provider-controlled text. The stricter replacement should
  assert that the proof is present in the completion body, absent from the URL
  and audit output, and that the provider rejection stays a terminal failure.

The re-import wording at `cookie-flow-zai-web-2034.test.js:502` still passes:
the 401 message keeps "Re-import the chat.z.ai token cookie" and adds the stored
Local Storage token. The Local Storage capture refusal at lines 386–399 also
still passes. It remains correct until the shared owner activates capture.

None of these conflicts is hidden in `tests/__baseline__/known-fails.txt`, a
skipped test or an expected-failure marker. Weakening the proof gate so these
proofless successes pass would reintroduce the unsafe dispatch this issue
removes. Until the owners migrate them, these 17 cases fail in full CI, and
this branch is not ready for PR qualification.

### Validation status

Node v24.22.3, pnpm 12.18.0. Every command ran under `env -i` with an explicit
PATH, LANG and CI, a private unique `/var/tmp/zai2034-*` HOME, DATA_DIR, TMPDIR,
cache and pnpm store, no inherited credentials, and a ceiling under 300 seconds.
Dependencies were installed into this worktree with
`pnpm install --frozen-lockfile --ignore-scripts --store-dir <private>`. No
shared dependency directory was read through or modified. No live provider,
browser, Docker or `~/.9router` was used.

- PASS: root `pnpm run lint` (0 ESLint errors; anti-slop gate OK with 0
  diagnostics). This revision replaces the helper's runtime `typeof` checks with
  the shared `isRecord` / `isString` guards from `src/shared/utils/typeChecks.js`.
- PASS: `node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/fix-zai-source-token-proof-2034.test.js`
  from `tests/`, 19 of 19 tests.
- FAIL (expected, listed above): the same command over
  `unit/cookie-flow-zai-web-2034.test.js`, `unit/zai-web-provider.test.js` and
  `unit/fleet-provider-zai-web-acceptance.test.js`: 17 failed, 22 passed.
- NOT RUN: `test:ci`, full inventory, build, `scripts/checks.sh final`. These
  are outside this unit's scope and belong to later PR qualification.

The new regressions cover opaque proof precedence, separate account, proxy and
route bindings, credential conflicts, the unsupported browser refusal before any
POST, malformed, HTML, non-stream and nonzero-code failures, synthetic expiry and
challenge rejection, a valid stream, redirect refusal, redaction, cancellation
and the local read deadline, and one completion send per turn. A matrix through
the real handler covers buffered and streamed OpenAI and Anthropic failures: each
ends in a failure, records no success usage and refreshes no credential.
