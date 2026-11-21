# #1073: client-selected model echo through combos

Source: [OmniRoute #18495](https://github.com/cheaper-inference/OmniRoute/pull/18495), merged 2026-11-04, pinned head `b7ebca0ff38500c15068080f8809029e758e8789`.

## Disposition

**Already covered. No production change.** The contract the source restores is already implemented in DurinDoor for every path that promises it. The residual work was offline proof, not code.

## What the source changed

In OmniRoute, combo and alias dispatch rewrite the dispatched `body.model` to the resolved leaf (`provider/model`) before `handleChatCore` runs. The echo id was taken from that rewritten value (`requestedModel`), so an echo-enabled client saw the leaf instead of the combo or alias it asked for. The source adds `resolveClientEchoModel(clientRawRequest.body, requestedModel)`: prefer the client snapshot's `model`, fall back to the routed value.

The echo triggers there are the opt-in `echoRequestedModelName` setting, the Codex Responses echo, and Claude Code clients.

## Comparison with DurinDoor

| Concern | Source after #18495 | DurinDoor today |
| --- | --- | --- |
| Echo id origin | `clientRawRequest.body.model`, fallback to routed `requestedModel` | Responses: `clientRawRequest.body.model` only (`resolveResponsesEchoModel`). Claude: `clientRawRequest.originalModel` only (`resolveClaudeEchoModel`). |
| Snapshot capture | request body before combo dispatch | `handleChat` captures `body.model` as `originalClientModel` and builds `clientRawRequest` (`body: { ...body }`, `originalModel`) before auth, Claude-id decode and combo expansion (`src/sse/handlers/chat.js`). The same `clientRawRequest` object is passed to every combo, nested-combo and fusion attempt. |
| Fallback to routed id | yes (`requestedModel`) | **No.** A missing snapshot model echoes nothing. This is stricter than the source and is the documented intent in `responseModelEcho.js`. |
| Opt-in setting `echoRequestedModelName` | present | not present in this fork; there is no setting-driven echo to fix. |
| Chat Completions echo | via the opt-in setting | not promised; response `model` keeps its existing visibility. |
| Claude unary JSON | via the setting | not promised; only `message_start` of SSE is rewritten. |

Call path (echo): `handleChat` → `handleComboChat`/`handleSingleModelChat` (same `clientRawRequest`) → `handleChatCore` → `finalizeResponse` → `applyResponseModelEcho` (Responses, Codex-originated, non-compact) and `applyClaudeResponseModelEcho` (Claude source) → response masking. Dispatch, `logRawRequest`, `appendRequestLog` and combo failover use `modelInfo` and the leaf `body.model`, never the echo id.

The only way the source bug could recur here is a caller that passes its own `clientRawRequest` whose `body.model` is already a leaf. No in-repo caller does; the HTTP routes call `handleChat(request)` and let it build the snapshot.

## Why the existing tests were not enough

`codex-compact-chatcore.test.js` proves the echo at the `handleChatCore` boundary, but its Responses case sets `body` and `clientRawRequest.body` to the same model, so it cannot tell a client-snapshot read from a routed-body read. `chat-policy-sequence.test.js` proves the snapshot reaches `handleChatCore`, with `handleChatCore` mocked, and does not cover the response. Nothing exercised a combo with failover, where the served leaf differs from the first leaf and from the client id.

## Acceptance coverage added

`tests/unit/omni-client-model-echo-combos.test.js` runs offline. The executor, stream shapers, usage store and credentials are stubbed. `DATA_DIR` points at a throwaway temp directory. No network, no real accounts.

- Real `handleChat` → combo → fallback → `handleChatCore` with the first leaf returning 503:
  - Responses SSE: lifecycle events echo the combo id; delta and `[DONE]` frames are untouched; dispatch order is `gpt-first`, then `gpt-second`; `logRawRequest` and `appendRequestLog` carry the served leaf and never the combo id.
  - Responses unary JSON: top-level `model` is the combo id; `content-length` is dropped.
  - Claude SSE: `message_start.message.model` is the combo id; other events untouched.
  - Responses without a Codex-originated header: no echo, upstream model stays visible (policy unchanged).
  - Chat Completions: no echo, served model stays visible (policy unchanged).
  - Direct Codex alias (`codex/gpt-6.1-sol-xhigh`): echoes the client id while dispatching the resolved model.
- `handleChatCore` with a routed `body.model` that differs from the client snapshot, for Responses and Claude, including "snapshot model absent → nothing echoed, never the routed id".
- Resolver and passthrough unit checks (`resolveResponsesEchoModel`, `resolveClaudeEchoModel`, failed/no-echo results returned by reference).

Mutation check (performed once, then reverted): making the two resolvers return a routed/leaf value failed 8 of the 11 tests, so the suite is sensitive to the regression the source fixed.

## Not changed

- `open-sse/services/responseModelEcho.js`, `open-sse/handlers/chatCore.js`, `src/sse/handlers/chat.js`: untouched.
- Visibility policy for upstream details: untouched. The tests pin it for Chat Completions and for non-Codex Responses clients.
- No `echoRequestedModelName` setting was introduced.

## Verification limits

Offline stubs only. No live provider, Codex CLI or Claude Code client was used, so real upstream frame shapes beyond those in the fixtures are not proven here. The suite was run alone through the private `tests/` install (frozen lockfile, scripts disabled); the whole suite, browser, e2e and Docker were not run.

## Evidence command

```bash
test -s internal/docs/port-reports/1073-client-model-echo-combos.md && (cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-client-model-echo-combos.test.js)
```
