# Tencent AI Studio Web cookie flow (#2034)

**Public-route positive flow proved offline; acceptance remains blocked by replay after uncertain accepted work.** All responses below are synthetic network fixtures. This is not evidence of live sign-in or the vendor protocol.

The original three cases are preserved inside a describe block. They cover extension capture, the parser contract, and import refusal/update behavior, but their direct `runSession` call is not gateway evidence. The added vertical slice unloads their legacy DB/localDb mocks and uses `tests/unit/helpers/cookiePublicFlow2034.js`: real file-backed SQLite initialization/migrations, repositories, management pairing/import handlers, registry-selected executor, account selection and public route handlers. The helper contains no vendor response fixtures or Tencent protocol mapping. Only operator permission checks and the final external fetch boundary are replaced. Operator checks require a synthetic operator header; imports use the issued single-use pairing capability without an operator session. No global configuration or gate changed.

## Positive evidence

- Two accounts are created through pairing/import, persisted, and bound to distinct strict proxy pools. All eight combinations of account A/B, OpenAI/Anthropic public route, and buffered/streamed mode reach the actual executor and return the fixture answer.
- The network boundary asserts exact URL, cookie, origin, request body/model mapping, stream flag, redirect refusal and dispatcher identity. No request-builder or direct executor call is counted toward these public-route claims. The transport upgrades redirects to `error`, preventing credential forwarding.
- Cookie header, cURL and HAR each go through the actual dashboard parser, candidate builder, pairing, import endpoint, persistence and public dispatch. Only the supported `sessionid` survives. This is separate from HAR expiry/chunk fixes and the public cookie batch.
- An update changes only its paired account, preserves the strict proxy, and sends the replacement credential next. Cross-target update, foreign operator, foreign origin, expired cookie metadata, unsupported chunks and unsupported localStorage are refused without changing either stored row.
- Public response, connection listing and captured logs do not expose either synthetic account credential. Import responses do not echo the pairing token.
- Explicit 401 refusal permits unpinned fallback to the other imported account/proxy. Pinned 401 and 429 do not rotate. Caller abort and a broken stream after a text frame do not replay or produce the asserted success terminators.
- A pinned HTTP 200 HTML sign-in page is a vendor refusal (no chat work accepted). It returns the HTML error page error; the documented single-model transient retry may repeat it up to three times, and every attempt carries only account A's cookie over proxy A.
- A vendor SSE error envelope is not turned into success on either route. OpenAI emits no `[DONE]`. Anthropic emits `event: error` carrying the vendor message, with no `message_delta`, `end_turn` or `message_stop`; the gateway's `data: [DONE]` line may follow the error event. The Anthropic client stops on that error event, so the trailing line is not a success terminal.

The descriptor supports Cookie header/cURL/HAR inputs with `sessionid`, not `sessionid.0`, optional cookies or localStorage. Unsupported fields receive actionable refusal rather than being accepted. Its origin is `https://aistudio.tencent.ai`. The registry's provenance note says the pinned source forwards the Cookie header without naming the cookie or validation path: neither `sessionid` sufficiency nor `/api/user/info` validity is established here. No upstream source was acquired or read after the freeze.

## Bounded failing reproductions and repair handoff

These remain ordinary failing assertions, without skips, expected failures, baseline entries, or product edits. Each starts from two imported accounts with separate strict proxies and invokes the public OpenAI route in buffered mode. Network-call diagnostics include only synthetic credentials. All four are one defect class: the gateway replays a billable Tencent POST when nothing proves the vendor did not accept it.

| Test | Fixture at external fetch boundary | Observed public runtime behavior | Required behavior |
| --- | --- | --- | --- |
| `returns upstream 502 without success terminal or pinned-account rotation` | Pinned account A, HTTP 502 | Three identical POSTs on A/proxy A (no rotation); error response | One POST: a vendor/intermediary 502 does not prove refusal before acceptance |
| `refuses a 200 malformed JSON body without a success terminal` | Pinned A, HTTP 200, body `{broken` | Three POSTs on A/proxy A; 502 to caller | Accepted work with an unreadable body is terminal: one POST |
| `does not replay uncertain accepted work after the network rejects` | Unpinned, fetch rejects with a synthetic connection reset | Two POSTs, B over proxy B then A over proxy A | Outcome unknown is terminal; no sibling dispatch |
| `bounds a stalled buffered vendor body and never replays accepted work` | Unpinned, HTTP 200 headers then a stalled JSON body; body limit 100 ms | 504 "Provider response body timed out" (bounded), but two POSTs across B/proxy B and A/proxy A | Timeout after accepted headers is terminal; no sibling dispatch |

Probe of the same fixtures with and without pinning (removed afterwards; no file kept): pinned requests repeat three times on the pinned account because `runWithTransientBackendRetry` retries 502/503/504; unpinned requests try each account once through account fallback and then answer `Provider unavailable`. No attempt crossed a cookie with another account's proxy.

Minimal repair path, based on the exercised code (all outside this unit's allowed files):

1. `TencentAIStudioWebExecutor.runSession` (`open-sse/executors/tencent-aistudio-web.js`) turns a post-send network exception into a generic `network_error` 502, and passes matching JSON/SSE responses through. Mark post-dispatch transport failures and vendor 502/504 as outcome-unknown, as `minimax-code` already does. For a 2xx whose body is malformed or times out, `nonStreamingHandler` (`open-sse/handlers/chatCore/nonStreamingHandler.js`, body-timeout and parse-failure branches) needs to carry that provenance on its error result.
2. `processAttemptResult` in `src/sse/handlers/chat/singleModel/postProcess.js` already stops on `upstreamPartialOutput` and has provider rules for `minimax-code` and `windsurf`. Apply the same terminal rule to Tencent's outcome-unknown results before cooldown/fallback, and set `response.upstreamPartialOutput` so the outer retry also stops.
3. `runWithTransientBackendRetry` (`open-sse/services/transientBackendRetry.js`, called from `dispatchChat` in `src/sse/handlers/chat/combo.js`) already returns early on that flag; no change is needed there once step 2 sets it. Keep the passing explicit-401 fallback, HTML-refusal and pinned 401/429 cases green.

Re-run this exact suite after those product repairs. This suite does not claim to cover every stream/error shape. Live capture, real quotas and the vendor's acceptance semantics remain unverified.

## Changes since the previous gate rejection

The prior run had six failures. Two of them were test classification errors, now corrected with stronger, protocol-correct assertions rather than removed:

- **Anthropic SSE error framing.** The assertion forbade `[DONE]` on the Anthropic route. `[DONE]` is an OpenAI sentinel, not an Anthropic success terminal, and the gateway writes it after the Claude `event: error` it builds for this vendor frame. The repository's own stream-error helpers (`open-sse/utils/streamHelpers.js`) likewise treat a trailing `[DONE]` after an error payload as non-success. The case now requires the vendor error message and the error event, requires any `[DONE]` to come after the error, and forbids `message_delta`, `end_turn` and `message_stop`. The OpenAI variant still forbids `[DONE]`.
- **200 HTML sign-in page.** This was grouped with malformed JSON. A sign-in page shows the session was refused, so no chat work was accepted and the bounded same-account retry is not a replay of accepted work. It is now its own case: an error status naming the HTML error page, no success text or `[DONE]`, at most three attempts, and every attempt on account A's cookie over proxy A. Malformed JSON stays strict.

No other assertion changed. Against the base test file the diff removes zero lines.

## Validation

Dependencies were not installed in this checkout. The run borrowed the root and `tests/` `node_modules` of the earlier attempt's worktree read-only through two untracked symlinks (`node_modules`, `tests/node_modules`); both lockfiles are byte-identical to this checkout's. Nothing was written through the symlinks, and both were removed after the run so the native gate installs its own dependencies. The native gate supplies its own isolated dependencies. CodeGraph was not used; bounded checkout reads only. No browser, live provider, real token, protected data directory, upstream checkout, push or merge was used.

Focused command (from `tests/`):

```sh
runroot=/var/tmp/tencent-2034-1988967
timeout 300 env -i PATH=/home/stormtrooper/.local/bin:/usr/bin:/bin LANG=C.UTF-8 CI=1 \
  HOME="$runroot/home" DATA_DIR="$runroot/data" TMPDIR="$runroot/tmp" XDG_CACHE_HOME="$runroot/cache" \
  node node_modules/vitest/vitest.mjs run unit/cookie-flow-tencent-aistudio-web-2034.test.js --maxWorkers=2 \
  > "$runroot/final-test.log" 2>&1
```

Result: **32 collected, 28 passed, 4 failed**, exit 1. The four failures are the rows above. All original cases pass. `git diff --check` passes. Full CI was not run. The evidence gate stays red until the product repair above lands; this must not be reported as a passing gate or as merge eligibility.
