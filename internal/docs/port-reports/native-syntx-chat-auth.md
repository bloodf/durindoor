# Native SYNTX chat and Bearer JWT auth (staged)

Issue #1234, related to #2034. The executor is staged and unregistered. Nothing in production imports `open-sse/services/providerParity/native-syntx-chat-auth/`. `registration.json` in that directory describes the serial registration step.

## Why #1234 was reopened

`docs/providers/syntx.mdx` records one unauthenticated `GET https://api.syntx.ai/api/v1/chat/completions` that returned 404 on 2026-11-21. The pinned source executor never calls that route. The registry `baseUrl` (`https://api.syntx.ai/api/v1`) is nominal: the executor uses `SYNTX_API_BASE = "https://api.syntx.ai"` (`services/syntxAuth.ts`) and the flow below. The earlier 404 says nothing about this flow. Nothing here was checked against the live service either.

## Source

OmniRoute `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT), read from `/tmp/omni-2034` without changes:

- `open-sse/executors/syntx.ts`: `SyntxExecutor` shell and the flow comment.
- `open-sse/executors/syntxExecute.ts`: create chat, account prompt sync, uploads, generate, SSE read, OpenAI JSON/SSE assembly.
- `open-sse/executors/syntxChat.ts`: prompt flatten, tool catalog, `<tool_call>` parse, SSE decode, generate body, multipart, stream-URL check.
- `open-sse/services/syntxAuth.ts`: Bearer JWT resolution and the browser header set.
- `open-sse/services/syntxSessions.ts`: chat_uuid continuity, `/new` reset, rollover counters.
- `open-sse/services/syntxModels.ts`: 34 seed models, `ai_name` inference, live catalog discovery.
- `open-sse/config/providers/registry/syntx/index.ts`: id `syntx`, alias `stx`, `apikey` + `bearer`, 600 s timeout, passthrough models.

Not ported: `services/syntxMedia.ts` and `services/syntxMediaCatalog.ts` (media generation, outside this unit).

## Local behavior before this change

- No `syntx` or `stx` entry exists in `open-sse/providers/registry`. No executor is mapped in `open-sse/executors/index.js`.
- `docs/providers/syntx.mdx` is `status: unreleased`.
- `tests/unit/provider-registration-apikey-batch-b.test.js` asserts `syntx` is not registered. It is unchanged and still passes.
- The prior candidate base had no SYNTX executor, service or registry code. This retry base also contains separately staged SYNTX media/upscale work; it does not provide this native chat/auth path.

So this module is the whole delta.

## Wire contract (source)

| Step | Request | Response used |
| --- | --- | --- |
| Create chat | `POST /api/v1/chats` `{title, scope:"text"}` | `uuid` |
| Account prompt (opt-in fields only) | `PUT /api/v1/user/settings` | ignored, best-effort |
| Upload | `POST /api/v1/chats/upload-files` multipart: `files`, `destination=uploaded`, `check_duplicates=true`, `model_type` | `files[0].url`, `object_type` |
| Generate | `POST /api/v1/llm/generate?ai_name=<ai>` `{chat_uuid, text, model, thinking, plan:false, deep_research, tools:["search","code","shell"], files?}` | `stream_url` |
| Stream | `GET https://sse.syntx.ai/stream/...`, no Authorization | `data: {type:"content"}`, `usage_final` (`tokens_input`, `tokens_output`), `error`, `[DONE]` |
| Models | `GET /api/v1/llm/models?enabled_only=true&lang=en` | `models[]` with `id`, `label`, `ai_name`, `capabilities.images/thinking`, `context_window`, `default_max_tokens` |

Every `api.syntx.ai` call carries the source browser headers (`Authorization: Bearer`, `Origin: https://syntx.ai`, `Referer`, the source user agent).

## Auth

The source resolves the token from `accessToken`, then `apiKey`, then `providerSpecificData`. It reads a raw token, `Bearer <jwt>`, or a JSON wrapper (`accessToken`, `access_token`, `token`, `jwt`, `idToken`, `id_token`, `apiKey`, `authorization`). The first JWT-shaped candidate wins. A non-JWT credential is refused with 401 before any network call.

The source has no refresh or exchange call. The credential is a long-lived site JWT. A 401/403 means the user must paste a new one. This module does not invent a refresh.

## Framing

These source behaviors are ported unchanged:

- OpenAI `messages`, Anthropic `system`, and Responses `input` / `instructions` normalize into one list.
- A first turn flattens to `<system>`, `<user>`, `<assistant>` and `<tool_result>` blocks.
- A reused chat sends only the trailing tool results, or the last user text.
- The tool catalog is injected once per chat_uuid and catalog fingerprint. When the catalog is injected, the client system prompt is dropped.
- `<tool_call>{json}</tool_call>` answers become OpenAI `tool_calls` with `call_<12 hex>` ids and finish `tool_calls`. Tool turns are buffered.
- Thinking comes from `thinking`, `reasoning_effort`, `reasoning.effort`, a budget, or a model id that contains `thinking`.
- An empty `tools: []` turns SYNTX native tools off.
- Generate text is capped at 200 000 characters with the source head/tail strip.
- Session handling follows the source: `/new` and `/clear` envelopes reset the session, a rollover handoff happens after 700 generates, and pending first-turn coalescing is kept. The `syntx_isolated`, `syntx_force_new_chat`, `syntx_deep_research`, `syntx_continue_chat`, `syntx_history_file`, `syntx_session_password_block` and `syntx_account_system_prompt` extensions also work as in the source.
- Images come from `image_url` / `input_image` parts and inline base64 data URLs, and are uploaded before generate. Image failures are skipped, as in the source. A history-file upload failure is 422.

## Fork deviations

- **Bounds.** The turn deadline is the source 600 s. Each auxiliary call has its own 60 s deadline, and the stream headers share that deadline. Other limits:
  - SSE idle timeout: 300 s.
  - Size caps: 1 MiB for JSON bodies, 16 MiB for a stream, 1 MiB for one SSE frame.
  - Images: at most 8 per turn, 20 MiB per download, 50 MiB per upload (the source cap).
- **Redirects.** No SYNTX call follows a redirect.
- **SSE parsing.** Frames are parsed by the shared `open-sse/utils/sseFrames.js` reader. Each `data:` line is still decoded as its own JSON payload, as in the source.
- **Truncation.** A body that ends without `[DONE]` or `usage_final` is a truncation (502 `syntx_truncated`). The source reported it as success.
- **Client image URLs.** These are downloaded with no Authorization, cookie or other credential. Only plain `https` is accepted. The literal host and every DNS answer must classify as public under `src/shared/utils/ssrfGuard.js#classifyHost`. A failed lookup is refused. Redirects are followed manually: at most 3, each re-checked. Only `image/*` content types are accepted. The source fetched any https URL with default redirect following. Known limit: the DNS check runs before the fetch, so a rebinding resolver could still answer differently at connect time.
- **Returned URLs.** A `stream_url` must be `https://sse.syntx.ai/stream/...` with no credentials, port or fragment. Otherwise it is never fetched: 502 `syntx_invalid_stream_url`. An upload result URL must be https on `syntx.ai` or a subdomain before it goes into generate `files`. The account token is sent only to `api.syntx.ai`.
- **No replay.** Generate is sent once, through the executor sender as the one quota-bearing dispatch.
  - Transport error or deadline: 502/504 `syntx_generate_uncertain` with `acceptedTurn: {state:"uncertain"}`.
  - Generate 5xx: also `uncertain`.
  - After a valid `stream_url`, every failure carries `acceptedTurn: {state:"accepted"}`.
  - A stream commits to 200 only after the first delta or the end of the turn. After output has started, a failure ends the stream with a `finish_reason: "error"` chunk and `[DONE]`.
  - Nothing here retries.
- **Auth status.** A create-chat or generate 401/403 becomes 401 `syntx_auth_error`, so the gateway can flag the credential. The source wrapped a create-chat failure as 502 and passed the generate status through.
- **Quota.** Only a generate 429 is a quota signal: 429 `syntx_rate_limited`, with a numeric `Retry-After` passed through. The source parses no other quota condition, so none is invented. A non-200 from the stream host becomes 502 `syntx_stream_failed`, because that host never sees the account token.
- **Sanitized errors.** Error messages pass through `sanitizeErrorMessageWithSecrets` with every credential form. The returned `headers` are `{authorization: "Bearer <redacted>"}`. Log lines carry only the step, status or outcome, never a body, a URL with a job id, or a token.
- **Account scoping.** Session state is held per executor and is not module-global. The key is a SHA-256 of the connection id plus the token. The source used the connection id alone, or a token head/tail slice. A token pasted again on the same connection therefore never inherits another account's chat. The model-discovery cache is likewise per instance and keyed by a token hash; the source used the token's last 16 characters.
- **Session persistence.** The session is persisted only after a complete turn. The source also persisted after a failed stream read.
- **Tool emulation switch.** The source env switch `OMNIROUTE_PROMPT_EMULATE_TOOLS` is the executor option `emulateTools` (default on).

## Evidence

`tests/unit/native-syntx-chat-auth.test.js` (44 tests) uses only synthetic, source-shaped fixtures: a closed transport that fails on any unexpected request, a synthetic DNS lookup, and synthetic JWTs, chat uuids and stream URLs. No live call, account or capture was used. A pass says nothing about the live service. The suite covers:

- the staging guard and the manifest;
- token resolution order;
- the exact create-chat, generate and SSE wire;
- JSON and SSE output;
- multi-turn reuse, account scoping, `/new`, rollover and isolation;
- tool catalog injection, `<tool_call>` parsing and the tool-result follow-up;
- data-URL and guarded remote image uploads, including blocked private, loopback-resolving, non-https and redirect-to-private URLs;
- off-host upload URLs and the history file;
- every failure class (auth, 429 with Retry-After, uncertain 5xx and transport errors, invalid `stream_url`, SSE error, truncation, stream 404, error after output, idle, size cap, caller abort), all without replay and without secret leaks;
- model discovery and its fallback;
- Claude Messages and OpenAI Responses requests and streamed answers translated through the public translators, including a Claude `tool_use` → `tool_result` round trip.

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-syntx-chat-auth.test.js --maxWorkers=2
```

The existing guard suites were run alongside it. These pass unchanged: registration batch b, provider docs status, staging manifest, staging ownership, executor send, redirect default, provider secrets and logger redaction.

`unit/review-x-sse-final.test.js` fails on this branch before and after this change. The cause is two pre-existing hand-written SSE splitters in `native-codex-search-search/adapter.js` and `native-zai-search-search/adapter.js`. This module adds no entry to that list.

## Registration (later, serial)

See `registration.json` `integrationPoints`. The steps are:

1. Add `open-sse/providers/registry/syntx.js` from `SYNTX_PROVIDER_DEFINITION` and `SYNTX_REGISTRY_MODELS`.
2. Map `syntx` and `stx` to one process-wide `createSyntxChatExecutor()`.
3. Drop `syntx` from the not-registered list in `provider-registration-apikey-batch-b.test.js`.
4. Rewrite `docs/providers/syntx.mdx`.

The staged suite's "not registered" assertion is the isolated guard, and it moves with that step.

## Retry preservation and lint correction

Carried forward candidate `8f52f93d3d66a76a4f3e594853453d9d739e6c7d`
(the prior `orq/tp47m5/native-syntx-chat-auth-a1` head) with all 43 existing
regression cases intact. No gate metadata path was supplied in this retry;
the candidate was resolved from the retained Git branch and its commit record.
The restored suite and scoped ESLint passed before edits. Repository anti-slop
lint failed on four numeric `typeof` checks in `chat.js` and `models.js`.
Those checks now use the shared `isNumber` predicate, preserving the pinned
source's primitive-number semantics and its defaults for nonnumeric fields.
Optional `acceptedTurn` metadata is assigned imperatively. One additional test
checks numeric zero and nonnumeric usage/catalog fields; no prior tests were
removed or skipped, and no source contract changed.

Retry validation: the explicit SYNTX file passes 44/44; the eight existing
registration/docs/staging/sender/redirect/secrets/logger guard files listed above
pass 119/119. Scoped ESLint and repository `pnpm run lint:anti-slop` both exit 0.
No full test inventory or live provider call was run for this unit.
