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
With explicit authorization, it also migrates the existing Zai fixtures listed
under "Migrated existing assertions": first three named suites, then, after a gate
rejection, three more suites that dispatch zai-web without a proof. Public capture, registry, import activation
and shared auth are unchanged. No live origin, token location, proof validity or
completion is claimed.

### Source reproduction and attribution

Re-read `acaef33ca45:internal/docs/port-reports/cookie-flows/zai-web-2034.md` and
the current executor. The old executor ignores both request and stored proofs
and accepts a non-SSE 200 as an empty completion; this is reproducible directly
from its `readCompletion` and payload construction. The protected reproduction
at `tests/unit/cookie-flow-zai-web-2034.test.js:669` failed against the repair
exactly where it asserted that proof is dropped, which confirms the old behavior
was what that test pinned. It is now migrated (see below).

Only existing pins before the freeze (2026-11-27T23:49:25.752045Z) were read.
This revision read the primary source again. All commands were read-only Git
commands with `GIT_NO_LAZY_FETCH=1 GIT_OPTIONAL_LOCKS=0`, run in the existing
scratch clones `/tmp/omni-2034` (pin `4265bb2ad5477450a07d3a43ea33a62c6c874878`)
and `/tmp/omniroute-2034-d3f06` (pin `b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523`).
Nothing was fetched, and no later pin was used. Blobs that were read:

| Path at `4265bb2` | Blob | What was read |
| --- | --- | --- |
| `open-sse/executors/zai-web.ts` | `236943166d94eb43c6e14c863272659ccc4d69a6` | `buildZaiBrowserChatOptions`: token-hash `poolKey`, `localStorage: { token }` on `https://chat.z.ai`, `headless: false`, `reuseContext: true`, no proxy option. `execute`: `useSignedApi = Boolean(captchaVerifyParam) && imageUrls.length === 0`, otherwise `fetchThroughBrowser`. Audit body `captcha_verify_param: "[REDACTED]"` |
| `open-sse/executors/zai-web/protocol.ts` | `511e5d3aa9937ef537712b8163ad6b997878a9f7` | `extractZaiToken` (JSON `token`/`accessToken`/`access_token`, Bearer, `token=` cookie), `extractZaiCaptchaVerifyParam` (three aliases, nested `providerSpecificData`, JSON, `captcha_verify_param=` cookie), `resolveZaiCaptchaVerifyParam` precedence body, PSD, `apiKey`, `accessToken`, payload field `captcha_verify_param` |
| `open-sse/executors/zai-web/stream.ts` | `1c87321bf1b9643089f9fb5d1201baf08929a3a5` | terminal signals `data.done`, phase `done`/`finish`, `chat:completion:finish`, OpenAI `finish_reason` |
| `open-sse/services/tokenExtractionConfig.ts` | `d91c9cdb413b8fbc16c06d5bf506173c303235e7` | Z.ai Web entry `[{ type: "localStorage", key: "token" }]` on `https://chat.z.ai`, with the note that the browser transport handles CAPTCHA |

At `b15b2ee`, `zai-web.ts`, `protocol.ts` and `stream.ts` have the same blob IDs,
so the contract is unchanged between the two pins.

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
- A failure from the moment the billable completion send starts carries the
  existing internal `claudeRequestScoped` flag. This includes a throw from that
  send. Despite its historical name, `chatCore`, single-model `postProcess`,
  combo and transient-retry code use it as a request terminal. It stops account,
  model and credential-refresh replay, and the cooldown after uncertain work,
  with no shared changes. A setup failure (`chats/new` rejected, thrown, or with
  no id) comes before any completion is sent. It does **not** carry the flag, so
  normal account fallback and health marking still apply. The proof is sent
  only once in that case, to the completion of the account that is finally
  selected. No new retry loop is added. Caller cancellation settles dispatch
  and throws.
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


### Migrated existing assertions

The retry adjudication authorized migrating
`tests/unit/cookie-flow-zai-web-2034.test.js`, `tests/unit/zai-web-provider.test.js`
and `tests/unit/fleet-provider-zai-web-acceptance.test.js`. The checks gate then
reported 8 further failures, every one a proofless zai-web dispatch. They were in
`provider-registration-web-batch-a-routes.test.js` (4),
`review-x-executor-send-2.test.js` (2) and `web-session-redirects.test.js` (2).
Those fixtures are migrated the same way (table at the end). Every original case
is kept. A successful request now supplies a distinct synthetic opaque proof.
The test asserts that proof appears in the completion JSON body only: not in the
URL, not in the setup body, and (through `expectNoSecretLeak`) not in logs or
the database. Failure cases still assert the same failure after a proof
permits dispatch. Nothing is in `known-fails.txt`, skipped or marked as an
expected failure.

To keep each original line and assertion verbatim, the cookie-flow and provider
suites send the proof through their `chat()` / `openai()` helpers (a
`requestProof` variable that is reset before each test). The original call lines
are not rewritten. The only original assertions removed are those that pinned the
behavior this issue removes:
- cookie-flow transport error: "Provider unavailable", plus socket text in
  `lastError`, logs and the database. That text quotes the token URL.
- cookie-flow non-SSE 200: a streamed 200 with an error frame, plus an account
  cooldown after uncertain completion work.
- the former proof-dropped reproduction: no proof in the body, provider text
  echoed back.

| File: case | Before | After |
| --- | --- | --- |
| cookie-flow: capture through to the executor | 200 without proof | proof `capture` forwarded in body only, same token/proxy/redirect assertions |
| cookie-flow: Cookie header / cURL / cURL -b / HAR paste (×4) | 200 without proof | per-paste proof forwarded in body only |
| cookie-flow: bare Local Storage value via Add Connection | 200 without proof | proof `manual` forwarded in body only |
| cookie-flow: two accounts, own token and proxy, either order | 200 without proof | a distinct proof per turn (b, a, b) stays with that turn's account and proxy |
| cookie-flow: pinned rejection without rotation | provider 401, no rotation | same, with proof |
| cookie-flow: fallback on own proxy, then re-capture | 200 after fallback and re-capture | same, with proof on both turns. Needed the setup-scope fix above: a setup 401 rotates, so the proof reaches only the fallback account's completion |
| cookie-flow: transport error quotes token URL | 502 "Provider unavailable", socket text in `lastError` and logs | stricter: 502 with fixed "completion was not replayed" message. The socket text (which quotes the token URL) reaches no response, log or row. No cooldown, one completion call |
| cookie-flow: non-SSE 200 (stream false / true) | 502 / streamed 200 error frame, account unavailable | stricter: 502 in both modes before any client byte, no `finish_reason: "stop"`, no provider text, no cooldown after uncertain work, one completion call |
| cookie-flow: former "NOT PARITY: sends no CAPTCHA proof" | proof dropped, provider text echoed | renamed "forwards the request's CAPTCHA proof…": request proof wins over the stored proof, body only, terminal failure with fixed redacted text, one completion call |
| cookie-flow: **new** no-proof refusal | — | 400 `zai_proof_required`, no transport call at all, no change to account health |
| zai-web-provider: JSON and SSE chat | 200 without proof | per-request proofs, each forwarded in body only |
| zai-web-provider: Anthropic Messages route | 200 without proof | proof stored on the connection (`providerSpecificData.captchaVerifyParam`, a source location), because Messages translation keeps only Messages fields. Forwarded in body only |
| zai-web-provider: expiry, quota, two-session isolation | 200 / 401 / 429 without proof | same statuses with per-account proofs. Each account's completion carries its own proof |
| fleet acceptance: never sent to another vendor | ≥1 outbound call | synthetic proof so dispatch occurs, same origin assertion |
| batch-a routes: zai-web OpenAI/Messages, JSON/stream (×4) | 200 without proof | stored `providerSpecificData.captchaVerifyParam` added to the fixture through its existing hook. The scripted upstream refuses a completion whose body lacks the proof, and any URL or setup body that contains it. All four assertions are unchanged |
| review-x shared sender: zai-web charge-once and quota-denial cases (×2) | 200 from a reply with no SSE content type and no terminal | stored synthetic proof, and the reply is now a complete source-shaped event stream (`text/event-stream`, `[DONE]`). An unterminated, untyped reply is exactly the incomplete stream this fix refuses. Quota and attempt assertions are unchanged |
| web-session redirects: zai-web chat request 1/2 redirect (×2) | 401 session error without proof | stored synthetic proof so dispatch reaches the redirect. Same session-error and request-sequence assertions |

### Validation status

Node v24.22.3, pnpm 12.18.0. Every command ran under `env -i` with an explicit
PATH, LANG and CI, a private unique `/var/tmp/zai2034-*` HOME, DATA_DIR, TMPDIR,
cache and pnpm store, no inherited credentials, and a ceiling under 300 seconds.
Dependencies were installed into this worktree with
`pnpm install --frozen-lockfile --ignore-scripts --store-dir <private>`. No
shared dependency directory was read through or modified. No live provider,
browser, Docker or `~/.9router` was used.

- PASS: root `pnpm run lint`, exit 0 (0 ESLint errors, 348 existing warnings,
  none in touched files; anti-slop gate OK with 0 diagnostics). This revision replaces the helper's runtime `typeof` checks with
  the shared `isRecord` / `isString` guards from `src/shared/utils/typeChecks.js`.
- PASS: from `tests/`, `node node_modules/vitest/vitest.mjs run --maxWorkers=2
  unit/fix-zai-source-token-proof-2034.test.js unit/cookie-flow-zai-web-2034.test.js
  unit/zai-web-provider.test.js unit/fleet-provider-zai-web-acceptance.test.js`:
  4 files, 60 of 60 tests. That is the 19 original own cases plus one new
  setup-versus-completion scope case, 31 cookie-flow cases (30 original plus the
  no-proof refusal), 3 provider cases and 6 fleet cases.
- PASS: the same command over those 4 files plus every other unit suite that
  names zai-web: `provider-registration-web-batch-a-routes`,
  `provider-cookie-import-contracts`, `provider-registration-web-batch-a`,
  `review-x-executor-send-2`, `review-x-sse-final` and `web-session-redirects`.
  10 files, 505 of 505 tests.
- NOT RUN: `test:ci`, full inventory, build, `scripts/checks.sh final`. These
  are outside this unit's scope and belong to later PR qualification.

The new regressions cover opaque proof precedence, separate account, proxy and
route bindings, credential conflicts, the unsupported browser refusal before any
POST, malformed, HTML, non-stream and nonzero-code failures, synthetic expiry and
challenge rejection, a valid stream, redirect refusal, redaction, cancellation
and the local read deadline, and one completion send per turn. A matrix through
the real handler covers buffered and streamed OpenAI and Anthropic failures: each
ends in a failure, records no success usage and refreshes no credential.
