# #1073 Preserve tool fragments across chat heartbeats (OmniRoute #18468)

Compared 2026-11-20 against local base `e0b6e45d0` (branch `orq/tornf6/port-omni-chat-heartbeat-tool-fragments-a1`) and OmniRoute [#18468](https://github.com/cheaper-inference/OmniRoute/pull/18468) ("fix(sse): preserve LangChain tool calls across chat heartbeats"), state MERGED 2026-11-01, pinned final head `3b3c7dd0ab3761a5c86b866ac16bb1a320669268`. This supersedes the "unresolved" row in `1073-november-01-19-row-dispositions.md`.

Evidence is source-diff reading (`gh pr diff 18468`: 7 files, 144 additions, 18 deletions), local code reading and offline tests. No provider, browser, credential, paid API, Docker, e2e or full-suite run was used.

## Disposition

**Already satisfied; no runtime change.** DurinDoor has no Chat Completions heartbeat that carries an application choice, so there is nothing to adapt. The pinned fix removes `choices:[{index:0,delta:{},finish_reason:null}]` from two OmniRoute frames; both frames are absent here.

## Source change

Upstream (#18410): an empty-delta chunk emitted before the first `role: "assistant"` delta makes LangChain create an untyped message and drop later tool calls. The fix changes only these upstream-owned frames to `choices: []`, with the same `id`/`model`/JSON shape:

| Upstream file | Frame |
| --- | --- |
| `open-sse/utils/earlyStreamKeepalive.ts` | `OPENAI_KEEPALIVE_FRAME` (and `OPENAI_STARTUP_FRAME`, which defaults to it) |
| `open-sse/utils/sseHeartbeat.ts` | `buildHeartbeatPayload`, `openai-chunk` shape |

The rest is test updates and a changelog fragment.

## Local comparison

| Path | Local behavior | Evidence |
| --- | --- | --- |
| Early (startup) keepalive on Chat | None. `/v1/chat/completions`, `/v1/completions` and `/v1/api/chat` do not use `withEarlyStreamKeepalive`; the route returns the `handleChat` response untouched. | `src/app/api/v1/chat/completions/route.js`, `completions/route.js`, `api/chat/route.js` |
| Ongoing keepalive on Chat | None. `streamingHandler.js:219` selects a frame only for emitted Claude format (`ANTHROPIC_PING_FRAME`); every other emitted format, including OpenAI, passes `null`, and `createDisconnectAwareStream` arms no timer without a frame. The timer also stops at the first client byte (`clientBytesStarted`), so it never runs between tool fragments. | `open-sse/handlers/chatCore/streamingHandler.js:219,240`; `open-sse/utils/streamHandler.js:165-178` |
| `OPENAI_KEEPALIVE_FRAME` / `OPENAI_STARTUP_FRAME` / `sseHeartbeat` | Do not exist locally. `earlyStreamKeepalive.js` exports only `ANTHROPIC_PING_FRAME` and the failure-frame builder. | `open-sse/utils/earlyStreamKeepalive.js` |
| Early `: keepalive` SSE comment | Used only by `/v1/responses` (default frame) for Responses clients such as Codex CLI; `/v1/messages` passes `ANTHROPIC_PING_FRAME`. Neither is a Chat Completions stream. | `src/app/api/v1/responses/route.js:39-44`, `src/app/api/v1/messages/route.js:47-52` |

### The actual client contract

The existing transport comments in `earlyStreamKeepalive.js` say strict clients (Codex `reqwest`, Anthropic SDK) drop idle connections and that Anthropic clients reset watchdogs on real events but ignore SSE comments. That contract is about idle-connection timers on the Responses and Messages wires. It does not claim that Chat clients accept comments, and no Chat route uses them. The OmniRoute concern, a strict JSON-per-line Chat parser that rejects comments, or an empty-delta choice that starts an untyped message, does not occur because Chat streams carry only provider-derived `data:` JSON frames and `[DONE]`. Nothing on the Chat path was inferred or fabricated: the first choice, tool-call id, accumulated `arguments` and terminal `[DONE]` plus EOF all originate from the translated upstream stream.

The residual difference is that an idle Chat stream sends no bytes before the first upstream frame; that is existing behavior and is not a LangChain-corruption issue. Adding a no-choice heartbeat to Chat would be a new feature (a readiness/idle default change), not a missing JSON-compatible frame, and is out of scope here.

## Preserved and untouched

Not changed: native Anthropic ping, Responses `: keepalive` and its `error` event, the `buildKeepaliveErrorFrame` failure frames and their status/retry hints (see `keepalive-error-frame-status.test.js`), `SSE_KEEPALIVE_MS` and its default, billing/admission selection, empty-stream guard, and all existing tests. No file under `AGENTS.md`, `.github/workflows/**` or `tests/__baseline__/**` was touched.

## Tests

`tests/unit/omni-chat-heartbeat-tool-fragments.test.js` (5 cases, offline, fake timers):

1. Startup: a slow `/v1/chat/completions` handler yields no early frame for 30 s; once it settles, the strict-JSON body is byte-identical to the upstream fragments plus `[DONE]`.
2. Ongoing: an OpenAI-emitted stream through `handleStreamingResponse` emits nothing in silence before or between tool fragments; a strict-client parse of the output finds only single-choice `data:` JSON, one stable id, tool call `call-real` / `get_self` with arguments `{"reason":"ready"}` aggregated across fragments, no `chatcmpl-keepalive`, and terminal `[DONE]` followed by EOF.
3. Transport layer: `createDisconnectAwareStream` with no frame stays silent and forwards fragments byte-identically to EOF.
4. The `: keepalive` comment appears only on `/v1/responses`, and no Chat-family route imports the early wrapper.
5. Only the Claude emitted format selects an ongoing frame, and no Chat-shaped keepalive constant exists.

Mutation check: forcing `ANTHROPIC_PING_FRAME` for every emitted format fails cases 2 and 5 (reverted afterwards).

Command: `test -s internal/docs/port-reports/1073-chat-heartbeat-tool-fragments.md && (cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-chat-heartbeat-tool-fragments.test.js)` passed, 5/5. Dependencies came from `pnpm install --frozen-lockfile --offline` (root and `tests/`); nothing was added to a manifest or lockfile.

## Limits

Real LangChain was not run (no network or paid APIs); the strict parser in the test models the contract described in #18410. Production behavior against real providers is not asserted.
