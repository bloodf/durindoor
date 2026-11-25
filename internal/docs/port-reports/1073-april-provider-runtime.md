# #1073 — April OmniRoute provider runtime dispositions

This report compares eight exact merged OmniRoute pull requests against current DurinDoor runtime
behavior. The changed-path lists are the complete ones recorded in
`/var/tmp/durindoor-omni-early-metadata.gnjcuh68/2026-04.json`; the source diffs were read from the
private mirror at `/var/tmp/durindoor-omniroute-source.4eUb6QtM/source.git` at the head and merge
pins quoted per row. Local evidence is file-and-line citations into this tree.

Method and limits, applied to every row:

- The upstream diff was taken as `git diff <merge>^1 <merge>` in the mirror. For each pull request
  that range reproduces the complete changed-path list in the metadata exactly, so the diff and the
  path list describe the same change. Where the supplied head commit is not the tip of the merged
  branch (`#915`), the merge-parent range is the authoritative one and the head pin is still
  recorded.
- The published `#1073` ledgers were consulted before reporting any gap. All eight rows are
  recorded there as unresolved runtime or as Provider Sign-in scope
  (`internal/docs/port-reports/1073-april-recovered-1-dispositions.md`), and again as unresolved
  with unavailable paths in
  `internal/docs/port-reports/1073-first-quarter-row-dispositions.md`. No published `#1073`
  disposition resolves any of these eight rows, so nothing here contradicts a settled decision.
- Local fixtures were consulted for each row that touches a path with existing coverage.
- No provider traffic, credential access, browser, Docker, paid API, exploit development or
  whole-suite run was used. The single dynamic check is a read-only `node` import of a local
  translator module, described in the `#923` row.
- This is a disposition record only. It proposes no product implementation and makes no selection
  slate.

Three rows carry a residual that survives the comparison — `#915`, `#923` and `#943` — and each is
written below as one focused port, with the exact observable behavior and the evidence needed to
prepare it. One further row, `#1002`, records a divergence that is deliberately not proposed here.
The remaining four rows are closed.

---

## Dispositions

### [#915](https://github.com/cheaper-inference/OmniRoute/pull/915) — CLIProxyAPI executor and upstream-proxy routing

- **Pins:** head `dd33dc1f9bb786f9996a27d0ae65517d4ec1b229`; merge `0f75387f419599707db3244d6776fcb3e2833d33`.
- **Source diff:** adds `open-sse/executors/cliproxyapi.ts`, a new executor that posts to a local
  CLIProxyAPI instance at `<host>:<port>/v1/chat/completions` with a bearer credential and an
  optional request timeout; registers it in `open-sse/executors/index.ts` under the id `cliproxyapi`
  and the alias `cpa`; exports `mergeAbortSignals` from `open-sse/executors/base.ts` so the executor
  can combine the caller signal with the fetch timeout; and adds
  `resolveExecutorWithProxy` to `open-sse/handlers/chatCore.ts`, which reads a per-provider
  `upstream_proxy_config` (mode `native`, `cliproxyapi` or `fallback`, cached for 10 s) and either
  returns the native executor, routes to the sidecar, or returns a wrapper that retries through the
  sidecar when the native call fails or answers with a retryable status.
  Complete paths: `open-sse/executors/base.ts`, `open-sse/executors/cliproxyapi.ts`,
  `open-sse/executors/index.ts`, `open-sse/handlers/chatCore.ts`,
  `tests/unit/cliproxyapi-executor.test.mjs`.
- **Local evidence:** the routing layer is present and stronger than the source change.
  `open-sse/handlers/chatCore/executorProxy.js:56-121` resolves the executor per request and
  supports all three source modes plus a per-connection override, a configurable retryable-status
  set (`open-sse/handlers/chatCore/executorProxy.js:8`, `:43-50`), model mapping and a body cancel
  before the sidecar retry (`:112-116`). The config is cached in
  `open-sse/handlers/chatCore/comboContextCache.js:20-35`. The dedicated executor exists at
  `open-sse/executors/cliproxyapi.js:56-104` and carries the provider-manifest header
  (`:70-79`), a settings-configurable base URL with an environment fallback
  (`open-sse/executors/cliproxyapi.js:16-34`) and `noAuth` (`:61-63`).
- **Disposition:** the source behavior is mostly present, but it is **not on the dispatch path**.
  `open-sse/executors/index.js` never imports `CliproxyapiExecutor`, and the `executors` map
  (`:73-167`) has no `cliproxyapi` or `cpa` key. `getExecutor` therefore misses the map, misses
  alias resolution (`resolveProviderAlias("cliproxyapi")` returns the id unchanged,
  `open-sse/services/model.js:16-22`, `:50-52`), and falls through to
  `new DefaultExecutor("cliproxyapi")` at `open-sse/executors/index.js:200`. A repo-wide search
  finds `CliproxyapiExecutor` referenced only at its own definition
  (`open-sse/executors/cliproxyapi.js:56`); the only runtime import of that module is the helper
  `isCliproxyapiDeepModeEnabled` (`open-sse/handlers/chatCore/executorProxy.js:3`). The upstream
  audit fixtures record the upstream registration explicitly
  (`tests/fixtures/omniroute-executor-audit/executors-191dce8d.txt:81-82`).
  Git history shows why: commit `05afc5fbac` ("feat: port omniroute oauth provider slice",
  2026-07-06) removed `import { CliproxyapiExecutor } from "./cliproxyapi.js";` and the
  `cliproxyapi:` map entry together with six other executor registrations. Six of the seven were
  re-registered by later commits; `cliproxyapi` was not.
- **Observable difference:** sidecar dispatch currently leaves through `DefaultExecutor`, which
  takes the registry base URL `http://127.0.0.1:8317/v1/chat/completions`
  (`open-sse/providers/registry/omniroute-api-cloud.js:144-163`) and a bearer credential. Three
  documented local contracts are therefore not met on this path:
  1. `docs/reference/provider-plugin-manifest.mdx:88-98` states that a dispatch through the
     `cliproxyapi` executor carries `X-OmniRoute-Provider-Manifest-Url`. That header is added in
     exactly one place, `open-sse/executors/cliproxyapi.js:70-79`, and a repo-wide search shows
     `getProviderPluginManifestHeader` is called nowhere else. It is never sent.
  2. The `cliproxyapi_url` setting and the `CLIPROXYAPI_HOST` / `CLIPROXYAPI_PORT` fallback
     (`open-sse/executors/cliproxyapi.js:16-34`, documented in
     `internal/docs/product/reference/environment.mdx:247-248`) are never consulted; only the
     hard-coded registry default is used.
  3. The executor's `noAuth` flag (`open-sse/executors/cliproxyapi.js:61-63`), which
     `executorProxy.js:65`, `:82`, `:95` propagates onto the routed wrapper, is absent, so
     `hasSpecializedExecutor("cliproxyapi")` is false and the wrapper inherits the native
     executor's flag instead.
  The local unit fixture `tests/unit/cliproxyapi-executor.test.js` exercises the class directly and
  therefore does not cover the registration, and `tests/unit/chatcore-executor-proxy.test.js:10-35`
  mocks the executor index, so its `getExecutor("cliproxyapi")` assertion at `:160-163` does not
  cover it either.
- **Residual — applicable, one focused port:** register the dedicated executor for the `cliproxyapi`
  id and the `cpa` alias in the local executor index, and cover the dispatch with an offline
  fixture. Expected behavior after the change: a `cliproxyapi` request — whether issued directly as
  that provider id or routed through `executorProxy` in `cliproxyapi` or `fallback` mode — is
  dispatched by `CliproxyapiExecutor`, so the outbound request carries
  `X-OmniRoute-Provider-Manifest-Url`, the base URL comes from the `cliproxyapi_url` setting when
  set and from `CLIPROXYAPI_HOST` / `CLIPROXYAPI_PORT` otherwise, and the executor is marked
  `noAuth`. This is a registration correction to an existing local runtime path, not a new provider
  and not an authentication-flow change: the sidecar provider, its registry entry, its catalog
  models and its credential shape already exist locally.

### [#923](https://github.com/cheaper-inference/OmniRoute/pull/923) — GitHub Copilot assistant reasoning fields on the chat route

- **Pins:** head `51c734e4388a4b6b3000348290d7ff81386dbfbc`; merge `2ab41a359eceec4dc0b0bd60bf59a058e0ba8d5c`.
- **Source diff:** in `open-sse/executors/github.ts` the GitHub Copilot executor deletes
  `reasoning_text` and `reasoning_content` from assistant messages before dispatch, because
  Copilot turns those fields into Anthropic thinking blocks that carry no `signature` and the
  upstream then rejects the request with a 400; the same file also mirrors the Copilot token into
  `providerSpecificData` on both refresh paths, and `src/sse/services/tokenRefresh.ts` copies the
  refreshed Copilot token to the top level of the credential object so `buildHeaders` picks it up.
  Complete paths: `open-sse/executors/github.ts`, `src/sse/services/tokenRefresh.ts`.
- **Local evidence:** the token-placement half of the source change is already present locally, in a
  different and more central place. `src/sse/services/tokenRefresh.js:303-331` reads the Copilot
  token from `providerSpecificData`, and after a refresh sets `creds.copilotToken` at the top level
  (`:329`). The credential object handed to the executor lifts the same field:
  `src/shared/services/providerCredentials.js:313-323` builds
  `copilotToken: providerSpecificData?.copilotToken`, and
  `src/sse/handlers/typeHelpers.js:91-97` preserves it. The executor's own refresh paths already
  return the token at the top level (`open-sse/executors/github.js:898`, `:905`), which is what
  `open-sse/executors/github.js:66` reads. The source `providerSpecificData` mirroring therefore has
  no local equivalent to add.
- **Disposition:** the token half is **already present**; the message-field half is **missing**.
  Local has exactly the mechanism the source change needs, applied to other providers but not to
  GitHub: `open-sse/translator/concerns/paramSupport.js:164-179` deletes named fields from
  assistant messages only, and `STRIP_RULES` already uses it for `groq`, `mistral` and `cerebras`
  (`:44-46`). The GitHub rules in the same table are top-level `drop` rules only
  (`:24`, `:29`) and touch nothing on a message. The GitHub chat route runs that strip:
  `open-sse/executors/github.js:139-152` calls `stripUnsupportedParams("github", model, transformed)`
  at `:150`, and `sanitizeMessagesForChatCompletions` (`:89-127`) only rewrites `content` parts, so
  a message-level `reasoning_content` or `reasoning_text` passes through untouched. The field is
  reachable on this route: `open-sse/translator/request/claude-to-openai.js:437` and `:455` attach
  `reasoning_content` to assistant messages, and the GitHub provider targets the `openai` format
  (`open-sse/executors/github.js:281-283`), so a Claude-format client routed to Copilot produces
  exactly the shape the source change removes. The sibling Anthropic-native route already handles
  its equivalent, stripping unsigned thinking via
  `normalizeClaudePassthrough(transformedBody, model, "claude", ...)`
  (`open-sse/executors/github.js:328-340`); the chat route has no counterpart.
- **Residual — applicable, one focused port:** extend `STRIP_RULES` in
  `open-sse/translator/concerns/paramSupport.js` with a `github` rule that drops
  `reasoning_text` and `reasoning_content` from assistant messages, and add the offline fixture.
  The existing `dropMessageFields` mechanism already restricts the deletion to assistant turns
  (`paramSupport.js:166`), matching the source change's own scope, so user-authored fields are
  unaffected. Dynamic check, read-only and offline: importing
  `open-sse/translator/concerns/paramSupport.js` in `node` and calling
  `stripUnsupportedParams("github", "gpt-5-mini", body)` on a body whose assistant message carries
  `reasoning_content`, `reasoning_text` and `reasoning` returns a message that still holds all
  three, while the same call for provider `mistral` returns a message with `reasoning_content` and
  `reasoning` removed. That confirms both the gap and that the local mechanism is the right
  carrier. Expected behavior after the change: an assistant history turn replayed to GitHub
  Copilot's `/chat/completions` no longer carries `reasoning_text` or `reasoning_content`, while
  every other provider rule and every non-assistant turn is unchanged. This is a correction to an
  existing runtime path, not a new provider and not an authentication-flow change.

### [#943](https://github.com/cheaper-inference/OmniRoute/pull/943) — GitHub Copilot token placement, non-streaming body, and combo error-body extraction

- **Pins:** head `629a6936fab709cbc8bd6eb6a2dda8647dcf6d3f`; merge `7dea0441ac5e6463d0df3817039a085cc8df1059`.
- **Source diff:** in `open-sse/executors/github.ts` the executor reads the Copilot token from either
  the top level or `providerSpecificData` (a new `getCopilotToken` / `getCopilotTokenExpiresAt`
  pair, used by `buildHeaders` and `needsRefresh`), and materializes a non-streaming upstream
  response into a fresh native `Response` so downstream code always finds a readable body; in
  `open-sse/services/combo.ts` the error-body extraction is changed in both the sequential and the
  round-robin path to read the cloned body as text, keep the first 500 characters as the error text
  and parse JSON from that same text, instead of parsing the clone as JSON and falling back to
  reading the original response body.
  Complete paths: `open-sse/executors/github.ts`, `open-sse/services/combo.ts`,
  `tests/unit/t27-github-copilot-response-format.test.mjs`.
- **Local evidence, per sub-change:**
  - *Token placement*: already present centrally, as recorded in the `#923` row —
    `src/shared/services/providerCredentials.js:313-323` lifts
    `providerSpecificData.copilotToken` to the top level for every executor, and
    `src/sse/handlers/typeHelpers.js:97` preserves it. Nothing to add.
  - *Non-streaming materialization*: the source change exists because upstream's HTTP client
    consumes the original response body when a clone is read as text. The local client is the
    platform `fetch` (`open-sse/utils/proxyFetch.js:18`, `:803`), so the premise does not hold here
    and the local non-streaming path is unaffected. Not applicable.
  - *Combo error-body extraction*: local never had the defect the source change repairs. The
    pre-change source read the original response body as a fallback, which consumed it; local only
    ever clones (`open-sse/services/combo.js:1765`), so no local path consumes a body it still
    needs. The local site does, however, lose information the source change preserves: it parses
    the clone as JSON and swallows a parse failure (`open-sse/services/combo.js:1764-1771`), so a
    non-JSON upstream error body leaves `errorText` at `result.statusText` — usually empty — when
    it reaches `checkFallbackError` (`open-sse/services/combo.js:1796-1803`). Local is otherwise
    ahead of the source here: it also reads `retryAfter` from two shapes
    (`open-sse/services/combo.js:1767`), which the source change does not.
- **Disposition:** two of the three sub-changes are **not applicable**; the third is a **narrow
  residual in the combo error path**.
- **Residual — applicable, one focused port:** change the combo error extraction to read the clone
  as text and parse JSON from that text, keeping the text when the parse fails. Expected behavior
  after the change: an upstream error whose body is not JSON still yields a non-empty error text
  (the first 500 characters) into `checkFallbackError`, so the combo classifier sees the provider's
  message instead of an empty string; a JSON error body yields the same `errorText` and `retryAfter`
  as today; and the original response body is never read, so the existing no-consumption property
  is preserved. Scope is the single extraction site at `open-sse/services/combo.js:1760-1775`;
  the local tree has one such site, and the separate `detectUpstreamError` helper
  (`open-sse/services/combo.js:1315-1329`) already requires a JSON content type and needs no
  change. This is a correction to an existing runtime path.

### [#1002](https://github.com/cheaper-inference/OmniRoute/pull/1002) — Codex system/tool normalization and Responses detection on the chat endpoint

- **Pins:** head `d5b3e02539146dc20fd960cc5d134e6f76b58796`; merge `9d3986e06ee938345f9dcb4f73b21171642ea783`.
- **Source diff:** in `open-sse/executors/codex.ts` the Codex executor hoists `role: "system"`
  messages out of `body.input` into `body.instructions` and removes them from the input, and
  filters `body.tools` down to `type: "function"` tools with non-empty names, dropping a
  `tool_choice` that names an unknown function; in `open-sse/handlers/chatCore.ts` a
  `clientResponseFormat` variable is introduced so that a client whose source format is
  `openai-responses` but which called the Chat Completions endpoint receives a Chat Completions
  shaped response, with Droid CLI and `codex-cli` user agents exempt; in
  `open-sse/services/provider.ts` `detectFormatFromEndpoint` starts returning `openai-responses`
  for a chat/completions path whose body carries `input`, `max_output_tokens`,
  `previous_response_id` or `reasoning`.
  Complete paths: `open-sse/executors/codex.ts`, `open-sse/handlers/chatCore.ts`,
  `open-sse/services/provider.ts`.
- **Local evidence, per sub-change:**
  - *Codex system messages*: already covered locally by a different remediation. Local
    `convertSystemToDeveloperRole` (`open-sse/executors/codex.js:334-342`) rewrites `role: "system"`
    to `role: "developer"` for input items, which removes the same rejected role while keeping the
    content in the cacheable input prefix; the source instead lifts the text into `instructions`.
    Both prevent the 400; the local form additionally preserves cache locality.
  - *Codex tools*: already covered locally. `normalizeCodexTools`
    (`open-sse/executors/codex.js:368-425`) flattens the Chat tool shape into the Responses flat
    form, filters unsupported tool types, and drops a `tool_choice` naming an unknown function
    (`open-sse/executors/codex.js:422-425`) — the same guarantees the source function adds. Local
    also normalizes assistant history `input_text` to `output_text`
    (`open-sse/executors/codex.js:350-365`), which the source change does not.
  - *`clientResponseFormat`*: the local tree has no such variable because it never labels a
    chat-endpoint Responses body as `openai-responses` (next bullet). The client-visible outcome is
    the same as the source change's: the response reaches a Chat Completions client in Chat
    Completions shape. The one difference is the Droid CLI exemption — local handles Droid at
    `open-sse/handlers/chatCore/streamingHandler.js:80` without changing the client response shape.
  - *Format detection*: this is where the two trees genuinely differ.
    `open-sse/translator/formats.js:29-42` labels a chat/completions body whose `input` is an
    **array** as `openai`, with the comment that Cursor CLI sends a Responses body through the chat
    endpoint; anything else falls through to `detectFormat(body)`
    (`open-sse/services/provider.js:32-37`), which yields `openai-responses` only for a **string**
    `input` with no `messages`, and never for `max_output_tokens`, `previous_response_id` or
    `reasoning`. The source labels the array case `openai-responses` and adds the three
    Responses-only fields.
- **Disposition:** the Codex executor sub-changes are **already present**; the
  `clientResponseFormat` sub-change is **structurally unnecessary locally** given the detection
  convention; the detection sub-change is a **real divergence, recorded and not proposed here**.
  The divergence has a concrete observable: there is no `openai` to `openai` request translator
  (the registrations in `open-sse/translator/request/*.js` cover `openai` only as a source for
  `claude`, `gemini`, `gemini-cli`, `antigravity`, `kiro`, `cursor`, `commandcode`, `ollama`,
  `vertex` and `openai-responses`),
  so a Responses-shaped body with an `input` array and no `messages` that is routed to a
  Chat Completions target is forwarded unchanged, while under the source change the
  `openai-responses` to `openai` hop (`openaiResponsesToOpenAIRequest`, present locally at
  `open-sse/translator/request/openai-responses.js:355` and registered at `:1036`) would convert
  the `input` items into `messages`. The local convention is deliberate and load-bearing: it is
  asserted by a local fixture (`tests/unit/port-3245-rtk-system-part-type.test.js`) and the
  Cursor target depends on the `input` array being preserved
  (`open-sse/translator/request/openai-to-cursor.js:97`). Changing the detection label would
  therefore move gateway format detection, not one provider runtime path, and would require the
  Cursor path to be re-verified; that is outside this comparison unit and outside the provider
  runtime scope. Recorded for the format-detection owner as a divergence with the evidence above;
  no port recommendation is made here.

### [#1076](https://github.com/cheaper-inference/OmniRoute/pull/1076) — MiniMax authentication header and Gemini OAuth client secret

- **Pins:** head `1a768e493e53e0ae9360648833c6d1edaf442182`; merge `64909afb042777d46a9f53e306689c3dfe30e02e`.
- **Source diff:** in `open-sse/config/providerRegistry.ts` the `minimax` and `minimax-cn` entries
  change the Anthropic transport's `authHeader` from `x-api-key` to `bearer`; in
  `open-sse/executors/default.ts` the `minimax` and `minimax-cn` cases are removed from the list
  that forces an `x-api-key` header, so the registry value decides; in
  `src/lib/oauth/constants/oauth.ts` the Gemini OAuth config gains a default `clientSecret`
  constant; `package.json` and `package-lock.json` carry a version bump.
  Complete paths: `open-sse/config/providerRegistry.ts`, `open-sse/executors/default.ts`,
  `package-lock.json`, `package.json`, `src/lib/oauth/constants/oauth.ts`.
- **Local evidence:** local MiniMax declares its authentication in the registry rather than in a
  switch statement, and the Anthropic transport still uses the raw `x-api-key` header in both the
  primary transport (`open-sse/providers/registry/minimax.js:39-43`) and the Claude transport list
  entry (`open-sse/providers/registry/minimax.js:65-70`), with the same shape for `minimax-cn`
  (`open-sse/providers/registry/minimax-cn.js:39-43`, `:65-69`). The OpenAI and
  `openai-responses` transports of both providers already use
  `Authorization` bearer (`open-sse/providers/registry/minimax.js:56`, `:74`;
  `open-sse/providers/registry/minimax-cn.js:56`, `:73`). The default executor holds no
  MiniMax-specific auth case: `resolveAuthDescriptor`
  (`open-sse/executors/default.js:656-665`) returns the bearer descriptor for a non-Claude
  format, and the registry auth wins through `AUTH_DESCRIPTORS` / `rt.auth`
  (`open-sse/executors/default.js:683`). Local Gemini OAuth configuration is assembled from
  `GOOGLE_OAUTH_CLIENT` and the registry (`src/lib/oauth/constants/oauth.js:29-31`) and holds no
  embedded default secret.
- **Disposition:** this is an **authentication-flow change to an existing provider**, not a
  correction to an existing runtime path, and it is excluded from this unit. The upstream switch
  from `x-api-key` to bearer on the MiniMax Anthropic transport is therefore **not present locally**
  and is recorded here as an open provider-auth difference for the Provider Sign-in owner, not as a
  port recommendation. The embedded Gemini OAuth client secret is credential material and is out of
  scope for this comparison unit; local deliberately keeps the value in server configuration. The
  version bump has no local counterpart and needs none.

### [#1190](https://github.com/cheaper-inference/OmniRoute/pull/1190) — Antigravity Google One AI credits fallback

- **Pins:** head `e18b192b718559e832d09615d64263f5c2e55f11`; merge `ed27ef4cee5be6e60945f5ef25ed7f0d5545674d`.
- **Source diff:** in `open-sse/executors/antigravity.ts` a quota-exhausted 429 is intercepted before
  the retry-delay parser, and the same request is retried once with
  `enabledCreditTypes: ["GOOGLE_ONE_AI"]` so the request can be served from the account's Google
  One AI credit balance; a per-account tracker suppresses the credit retry for five hours after
  the credits are reported exhausted; the executor parses `remainingCredits` from the final SSE
  chunk and exposes it as `_remainingCredits`; the dashboard provider-limits view and the usage
  fetcher consume that balance; `src/lib/oauth/constants/oauth.ts` adds a
  `fetchAvailableModelsEndpoint` constant.
  Complete paths: `open-sse/executors/antigravity.ts`,
  `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.tsx`,
  `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.tsx`,
  `src/lib/oauth/constants/oauth.ts`, `src/lib/usage/fetcher.ts`,
  `tests/unit/antigravity-credits.test.mjs`.
- **Local evidence:** local Antigravity has no credit path. A search of
  `open-sse/executors/antigravity.js` finds no `enabledCreditTypes`, no `remainingCredits` and no
  credits-exhausted tracker. Its quota handling is a different mechanism and is already more
  precise than the source change in one respect: `parseError`
  (`open-sse/executors/antigravity.js:811-856`) reads `quotaResetTimeStamp` and `quotaResetDelay`
  out of the structured `error.details[].metadata` and returns `resetsAtMs`, so the account is
  locked for the real duration instead of the source change's hard-coded 24-hour keyword match on
  the message text.
- **Disposition:** this is a **new provider-credit feature on an existing provider**, and it changes
  how a paid credit balance is consumed. It is not a correction to an existing runtime path, and it
  is excluded from this unit. No port recommendation is made; the credit-consumption semantics and
  the opt-in upstream later added (`ANTIGRAVITY_CREDITS`) belong with the provider owner.

### [#1198](https://github.com/cheaper-inference/OmniRoute/pull/1198) — CLIProxyAPI dual mode, health check and upstream-proxy route

- **Pins:** head `fc83286d6fd7903a2b707bf7f429dfffcd6148c2`; merge `3e3ea37aba06d527b9d9451b8aefd460372e873e`.
- **Source diff:** in `open-sse/executors/cliproxyapi.ts` the executor is reworked into a dual-mode
  component — `isCliproxyapiDeepModeEnabled` reads a per-connection `cliproxyapiMode` of
  `claude-native`, the wire format is pinned to the OpenAI-compatible chat endpoint, the request
  body is always copied before the model is rewritten, and a `healthCheck` method probes
  `<base>/health` with a 5 s timeout; a new REST route
  `src/app/api/upstream-proxy/[providerId]/route.ts` exposes GET, PUT and DELETE over a per-provider
  upstream-proxy configuration row; the provider detail page gains a `CPA ON/OFF` toggle that
  writes through that route.
  Complete paths: `open-sse/executors/cliproxyapi.ts`,
  `src/app/(dashboard)/dashboard/providers/[id]/page.tsx`,
  `src/app/api/upstream-proxy/[providerId]/route.ts`.
- **Local evidence:** the dual-mode behavior is already present — `isCliproxyapiDeepModeEnabled`
  (`open-sse/executors/cliproxyapi.js:45-47`) implements the same `claude-native` test, and
  `open-sse/handlers/chatCore/executorProxy.js:56-72` consumes it to route a single connection
  through the sidecar. The configuration surface differs by design: local stores the upstream-proxy
  configuration as a settings map (`upstreamProxyConfig`, with `cliproxyapi_fallback_codes`
  alongside it, at `src/lib/db/repos/settingsRepo.js:120-121`) rather than as a per-provider table
  behind a REST route, and there is no `src/app/api/upstream-proxy/` route and no CLIProxyAPI
  toggle anywhere under `src/app/`. The executor has no `healthCheck` method, and no local module
  consumes one.
- **Disposition:** the routing semantics are **already present**; the remaining source artifacts
  are upstream product surfaces this fork expresses differently — a settings map instead of a
  per-provider table plus REST route, and no dashboard toggle. The `healthCheck` method has no
  local consumer, so adding it would be an unused capability rather than a runtime correction.
  No port recommendation is made. One dependency is worth recording: the local dual-mode path only
  behaves as intended once the executor registration gap recorded under `#915` is closed, because
  until then `executorProxy` resolves the sidecar to `DefaultExecutor`.

### [#1203](https://github.com/cheaper-inference/OmniRoute/pull/1203) — Antigravity and Gemini CLI header fingerprinting, obfuscation and 429 engine

- **Pins:** head `b142145a4e70c211e81a9df55547150eb40ecbaf`; merge `0856854c819e9d205c1dc7da796f60838dc3e2a9`.
- **Source diff:** the Antigravity and Gemini CLI executors are refactored onto four new services —
  `antigravityHeaders.ts` (a dynamic Antigravity user agent, a Gemini CLI user agent carrying the
  model, and an `X-Goog-Api-Client` value), `antigravityHeaderScrub.ts` (removes proxy-tracing,
  Stainless SDK and Chromium `Sec-Ch-*` headers and pins `Accept-Encoding: gzip, deflate, br`),
  `antigravityObfuscation.ts` (rewrites client tool names in user content with zero-width joiners)
  and `antigravity429Engine.ts` (a four-category 429 classifier with a four-kind decision table and
  a per-credential credits-failure counter), plus `antigravityCredits.ts` (the credit injection
  helpers that supersede the inline implementation from `#1190`). The Antigravity executor's
  `User-Agent` and `X-OmniRoute-Source` header are replaced by the generated ones, the Gemini CLI
  executor drops its `x-goog-user-project` header and gains a model-aware user agent, and the
  Antigravity 429 handling is rewritten around the new engine.
  Complete paths: `open-sse/executors/antigravity.ts`, `open-sse/executors/gemini-cli.ts`,
  `open-sse/services/antigravity429Engine.ts`, `open-sse/services/antigravityCredits.ts`,
  `open-sse/services/antigravityHeaderScrub.ts`, `open-sse/services/antigravityHeaders.ts`,
  `open-sse/services/antigravityObfuscation.ts`.
- **Local evidence:** the header-generation half is **already present**. Local
  `geminiCLIUserAgent(model)` builds a model-aware Gemini CLI user agent
  (`open-sse/config/appConstants.js:30-32`) and `GEMINI_CLI_API_CLIENT` carries the
  `X-Goog-Api-Client` value (`open-sse/config/appConstants.js:17`); both are used by the Gemini CLI
  executor (`open-sse/executors/gemini-cli.js:17-25`), and the Antigravity executor takes its user
  agent from the registry constant `ANTIGRAVITY_IDE_USER_AGENT`
  (`open-sse/executors/antigravity.js:242`, `open-sse/config/appConstants.js:146-148`). Local has
  none of the other three services: there is no header-scrubbing step, no content obfuscation, and
  no 429 classification engine — the Antigravity 429 path is the metadata-based
  `parseError` described in the `#1190` row (`open-sse/executors/antigravity.js:811-856`). The
  credits services are the same subject as the `#1190` row.
- **Disposition:** this is a **new client-identity and provider-credit feature set**, not a
  correction to an existing runtime path, and it is excluded from this unit. The header-generation
  part is already present locally; the scrubbing, the zero-width-joiner obfuscation of user
  content and the 429 engine are new behavior whose product and policy decisions belong to the
  provider owner, and the obfuscation in particular mutates user content. No port recommendation is
  made.

---

## Residual summary

| Row | Residual | Shape |
| --- | --- | --- |
| #915 | The dedicated CLIProxyAPI executor is not registered in the local executor index, so sidecar dispatch runs through `DefaultExecutor` and loses the provider-manifest header, the settings-based base URL and the `noAuth` flag. | Correction to an existing runtime path. One focused port: register the executor for `cliproxyapi` and `cpa`, with an offline dispatch fixture. |
| #923 | GitHub Copilot assistant turns keep `reasoning_text` and `reasoning_content` on the `/chat/completions` route; the local strip mechanism exists but has no `github` rule. | Correction to an existing runtime path. One focused port: add a `github` `dropMessageFields` rule plus an offline fixture. |
| #943 | The combo error extraction drops the upstream message when the error body is not JSON. | Correction to an existing runtime path. One focused port: parse the clone text and keep it when the JSON parse fails. |
| #1002 | Chat-endpoint format detection differs from the source for an `input` array and for the Responses-only fields. | Divergence recorded, not proposed: it moves gateway format detection and would require the Cursor path to be re-verified. |

The `#943` residual is narrow and independent of the other two; the `#915` and `#923` residuals are
independent of each other as well. `#915` is the recommended first port, because the missing
registration is what makes the local dual-mode path recorded under `#1198` behave as documented, and
because the current behavior breaks a published local contract
(`docs/reference/provider-plugin-manifest.mdx:88-98`).

## Verification limits

- No provider was contacted and no credential was read; every claim about upstream behavior is
  quoted from the pinned source diff in the private mirror, and every claim about local behavior is
  a file-and-line citation into this tree.
- The upstream diffs were read at the merge commit's first parent. For `#915` the supplied head
  commit is not the tip of the merged branch, so the merge-parent range was used and both pins are
  recorded.
- The single dynamic check is the read-only `node` import of
  `open-sse/translator/concerns/paramSupport.js` described in the `#923` row; it makes no network
  call and touches no provider.
- Endpoint availability, whether a given upstream actually rejects a given body, and the live
  behavior of the CLIProxyAPI sidecar were not verified and are not asserted.
- No test suite, browser, Docker or e2e run was performed, so no regression claim is made about the
  current tree.

Refs #1073
