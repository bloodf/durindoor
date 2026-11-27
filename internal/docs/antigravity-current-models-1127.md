# Antigravity current models and response contracts — 2026-11-27

Refs #2034. This follows up the model-alias and response-shape items in [parity-agy-1127.md](parity-agy-1127.md). It compares source code only. No provider account, live request or paid call was used. "Mock-covered" below means a closed-fixture test in [`tests/unit/antigravity-current-source-parity.test.js`](../../tests/unit/antigravity-current-source-parity.test.js). It does not mean the model is available on any live account.

## Pinned sources

| Source | Revision | Files |
| --- | --- | --- |
| OmniRoute | [`9671192011beb2d7f83979f40be488c5da8772b9`](https://github.com/cheaper-inference/OmniRoute/commit/9671192011beb2d7f83979f40be488c5da8772b9) | [`open-sse/config/antigravityModelAliases.ts`](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/config/antigravityModelAliases.ts), [`open-sse/config/antigravitySharedModels.ts`](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/config/antigravitySharedModels.ts) |
| CLIProxyAPI | [`47f18e4d82bd72f7d2b5ecf5ede93e4837a4625e`](https://github.com/router-for-me/CLIProxyAPI/commit/47f18e4d82bd72f7d2b5ecf5ede93e4837a4625e) | [`internal/registry/models/models.json`](https://github.com/router-for-me/CLIProxyAPI/blob/47f18e4d82bd72f7d2b5ecf5ede93e4837a4625e/internal/registry/models/models.json) (`antigravity`), [`antigravity_executor_execute.go`](https://github.com/router-for-me/CLIProxyAPI/blob/47f18e4d82bd72f7d2b5ecf5ede93e4837a4625e/internal/runtime/executor/antigravity_executor_execute.go), [`antigravity_executor_stream.go`](https://github.com/router-for-me/CLIProxyAPI/blob/47f18e4d82bd72f7d2b5ecf5ede93e4837a4625e/internal/runtime/executor/antigravity_executor_stream.go), [`antigravity_executor_credits.go`](https://github.com/router-for-me/CLIProxyAPI/blob/47f18e4d82bd72f7d2b5ecf5ede93e4837a4625e/internal/runtime/executor/antigravity_executor_credits.go) (`antigravityInBandErrorStatusCode`), [`antigravity_executor_finish_reason_test.go`](https://github.com/router-for-me/CLIProxyAPI/blob/47f18e4d82bd72f7d2b5ecf5ede93e4837a4625e/internal/runtime/executor/antigravity_executor_finish_reason_test.go) |

Local mapping: [`open-sse/providers/registry/antigravity.js`](../../open-sse/providers/registry/antigravity.js) is shared by `agy` ([`agy.js`](../../open-sse/providers/registry/agy.js)). Lookup goes through `getModelUpstreamId` in [`open-sse/config/providerModels.js`](../../open-sse/config/providerModels.js). A model ID with no catalog row is sent to the provider unchanged. Row `aliases` are matched only on lookup and are not added to `/v1/models`.

## Request alias table (OmniRoute `ANTIGRAVITY_MODEL_ALIASES`)

| Requested ID | OmniRoute upstream | CLIProxyAPI | DurinDoor before | DurinDoor now | Class |
| --- | --- | --- | --- | --- | --- |
| `gemini-3.7-flash-high` / `-medium` / `-low` | `gemini-3.7-flash-tiered` | — | `gemini-3.7-flash-tiered` + tier preset | unchanged | present |
| `gemini-3.7-flash` | `gemini-3.7-flash-tiered` (bare ID retired from discovery) | — | sent as-is | unchanged | missing, not implemented: needs a presetless `gemini-3.7-flash-tiered` row, which is a catalog addition for registration |
| `gemini-3.8-flash` | `gemini-3.8-flash-high` | — | `gemini-3.8-flash-medium` | unchanged | present, different default (kept) |
| `gemini-3.8-flash-tiered` | `gemini-3.8-flash-high` | listed and sent verbatim | sent as-is | unchanged | contested between sources; verbatim kept |
| `gemini-4-argon` | `gemini-4-argon-medium` | — | `gemini-4-argon-high` | unchanged | present, different default (kept) |
| `gemini-4-carbon` | `gemini-4-carbon-medium` | — | `gemini-4-carbon-high` | unchanged | present, different default (kept) |
| `gemini-4-hydrogen` | `gemini-4-hydrogen-high` | — | `gemini-4-hydrogen-high` | unchanged | present |
| `gpt-oss-120b` | `gpt-oss-120b-medium` | only `-medium` listed | sent as-is | `gpt-oss-120b-medium` | **added** (mock-covered) |
| `gemini-3.1-pro-high` | `gemini-pro-agent` | — | `gemini-pro-agent` | unchanged | present |
| `gemini-3-pro-image-preview` | `gemini-3-pro-image` (non-chat) | — | sent as-is | unchanged | non-chat image path, out of scope |
| `gemini-claude-sonnet-4-5` | `claude-sonnet-4-6` | — | sent as-is | `claude-sonnet-4-6` | **added** (mock-covered) |
| `gemini-claude-sonnet-4-5-thinking` | `claude-sonnet-4-6` | — | sent as-is | `claude-sonnet-4-6` | **added** (mock-covered) |
| `gemini-claude-opus-4-5-thinking` | `claude-opus-4-6-thinking` | — | sent as-is | `claude-opus-4-6-thinking` | **added** (mock-covered) |

A different bare-ID default tier is a behavior change for existing users, so those rows were not touched. Changing them needs its own decision.

## Catalog ID comparison

| ID | OmniRoute public | CLIProxyAPI `models.json` | DurinDoor registry | Class |
| --- | --- | --- | --- | --- |
| `gemini-3.8-flash-high` / `-medium` / `-low` | yes | `-high` | yes | present |
| `gemini-3.7-flash-tiered` | yes | — | no row; sent as-is | missing row (request passes through); registration |
| `gemini-pro-agent`, `gemini-3.1-pro-low` | yes | — | yes | present |
| `gemini-3.1-flash-lite` | yes | yes | no row; sent as-is | missing row (request passes through); registration |
| `gemini-3.5-flash-lite` | — | yes | no row | only CLIProxyAPI lists it; not promoted |
| `claude-opus-4-6-thinking`, `claude-sonnet-4-6` | yes | yes | yes | present |
| `claude-opus-5-5-*`, `claude-sonnet-5-5-*` (high/medium/low) | yes | `-high` | yes (plus `-max`, bare) | present |
| `gpt-oss-120b-medium` | yes | yes | yes | present |
| `gemini-4-argon-*`, `gemini-4-carbon-*` (high/medium/low) | yes | `-high` | yes | present |
| `gemini-4-hydrogen-*` (xhigh/high/medium/low) | yes | `-xhigh` | yes | present |
| `gemini-4-neon-xhigh` | — | yes | yes | present |
| `gemini-3-flash` | — (served live per OmniRoute comment) | yes | yes | present |
| `gemini-3.1-flash-image` | non-chat | yes | yes (image) | present |
| `gemini-3.7-flash-high/medium/low` | retired from discovery, aliased | — | yes | retired upstream as a discovery ID; request mapping is still valid, so kept |
| `gemini-3.6-flash-high/medium/low`, `gemini-3-flash-agent`, `gemini-3.5-flash-low`, `gemini-3.5-flash-extra-low`, `gemini-3.1-pro` | retired | — | yes | retired upstream; kept (removing them is a catalog decision) |
| `gemini-3.1-pro-preview` | — (`gemini-3.1-flash-lite-preview` and `gemini-3-pro-preview` retired) | — | yes → `gemini-pro-agent` | present local alias row |

## Response and error contracts

| Shape (pinned source) | CLIProxyAPI behavior | DurinDoor behavior (mock-covered, OpenAI and Anthropic, JSON and SSE) | Class |
| --- | --- | --- | --- |
| HTTP 200 JSON body with non-null `error` (`antigravity_executor_execute.go`) | status = `error.code` if 400–599, else 502 | 403→403, 400→400, 0→502 on both routes; no `choices`/`content`; served by the selected `agy` account and its project | matches |
| `data: {"error":…}` frame after output (`antigravity_executor_stream.go`) | stream error with upstream status | in-band error frame with the upstream message and code; no `finish_reason: stop`, `message_delta` or `message_stop` | matches (as in-band frame after headers) |
| Trailing bare multi-line JSON error after output (`TestAntigravityStreamSurfacesTrailingBackendError`) | 503 with the backend message | never a successful terminal; client gets the generic `incomplete_upstream_stream` error and loses the backend message | **gap, shared-lane**: see below |
| Complete `functionCall`, usage, no `finishReason` (`antigravityNoFinishReasonSSE`) | synthesizes `tool_calls` / `STOP` terminal with usage | tool-call name and arguments are delivered intact, then `incomplete_upstream_stream`; non-stream returns 502 | deliberate difference: DurinDoor fails closed |
| `functionCall.partialArgs` / `willContinue` | appears only in a CLIProxyAPI test fixture; neither project requests streamed arguments | not requested, not parsed | not actionable |

## Registration needs and limits

- No generated file needs to change. `open-sse/providers/registry/index.js` imports the module statically, and the added `aliases` are read at runtime.
- Catalog decisions left to the registration lane: whether to add `gemini-3.7-flash-tiered` (and alias the bare `gemini-3.7-flash` to it) and `gemini-3.1-flash-lite` rows, and whether to retire the IDs OmniRoute has retired.
- Shared-lane gap: the shared SSE parser (`open-sse/handlers/chatCore/emptyStreamGuard.js` / stream utilities) ignores non-field lines, so a bare JSON `error` block loses its message and status. Executor-side body rewriting is not safe, because dispatcher eviction and settlement are keyed by the original `Response.body` identity (`evictResponseDispatcher`). Acceptance: the CLIProxyAPI trailing fixture should reach OpenAI and Anthropic clients with `backend capacity exhausted` and code 503, still with no successful terminal.
- Live verification (model visibility per account, quota, current upstream error bodies) has not been done.
