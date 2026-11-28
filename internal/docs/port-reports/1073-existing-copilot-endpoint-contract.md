# 1073: Existing Copilot endpoint contract

Ports the merged OmniRoute PRs that teach the gateway to honor the endpoint
contract Copilot's live catalog advertises, and the enterprise GPT-6
exception. Read on 2026-11-20 against the current tree.

- [OmniRoute #15337](https://github.com/cheaper-inference/OmniRoute/pull/15337), merged 2026-10-06, merge commit `cee37af666f5904063ad15d54dc5b075abdf2751`, "fix(sse): preserve Copilot discovered endpoint routing": **ported, adapted**. Upstream changed `open-sse/services/githubCopilotModels.ts` only (+45/−1) plus two test files.
- [OmniRoute #15499](https://github.com/cheaper-inference/OmniRoute/pull/15499), merged 2026-10-06, merge commit `ac8113d50423f3b8783e1beec5e1ee0c6e076d3b`, "fix(executors): route GHE Copilot GPT-6 models to Responses": **ported, adapted**, with one upstream mechanism rejected. Upstream changed `open-sse/config/providerModels.ts` (+12) and `open-sse/executors/ghe-copilot.ts` (+40/−13) plus one test file.

Neither upstream PR touched sign-in, OAuth, a public endpoint, a provider, or
an integration, and neither does this port.

## What the upstream contract says

Copilot's live `/models` catalog can advertise the endpoints that serve a
model, as `supported_endpoints` at the top level or the same list nested under
`capabilities`. Upstream normalizes those paths into endpoint kinds and uses
the result to pick the route:

- the top-level list wins over the nested one;
- a path is lowercased, stripped of leading slashes, of a `v1/` prefix and of
  a trailing slash, so `/v1/responses/` and `/responses` are the same kind;
- `chat/completions`, `chat-completions` and `messages` all mean the chat
  route;
- a model that declares `responses` and no chat endpoint is served by
  `/responses`, unless its id names Claude or Gemini — Copilot's Responses
  endpoint does not serve those.

No model-version heuristic is involved: the catalog's own statement is the
authority, and a model that states nothing keeps the previous behavior.

## Where this fork applies it, and why

Upstream stores the contract on the synced-model row as a per-model
`targetFormat` and lets chatCore's target format drive the request body. This
fork's Copilot seam is different in three ways, so the contract is applied at
the executor instead:

1. **The registry declares no per-model target format for Copilot.**
   `open-sse/providers/registry/github.js:54` records why: a static per-entry
   `targetFormat` would silently miss the live `claude-*` models the catalog
   exposes ahead of the static list, and would double-translate the models
   that are listed.
2. **The Copilot executor owns the route and the body conversion.**
   `open-sse/executors/github.js` converts a chat-shaped body into the
   Responses shape itself (`executeWithResponsesEndpoint`, via
   `openaiToOpenAIResponsesRequest`), and always answers in OpenAI chat
   frames. chatCore reads the provider's answer as `targetFormat`
   (`open-sse/handlers/chatCore.js:1319`), so a chatCore-level
   `openai-responses` target format would make the request body Responses
   shaped *and* make chatCore translate an OpenAI-shaped provider answer as
   if it were Responses shaped.
3. **The synced catalog keeps only id/name/kind/capabilities.**
   `src/lib/modelAutoSync/catalog.js:120` (`normalizeSyncedModels`) drops
   every other field, so the contract cannot ride on the synced-model row
   here.

The port therefore keeps the contract where it is durable and per account: on
the connection, in `providerSpecificData.copilotEndpointContract`, next to the
Copilot token and the enterprise host. The executor reads it from the
credentials of the account that serves the request, so the account choice
stays the account that discovered the route, and the contract survives a
restart.

### Normalization and discovery

- `open-sse/services/copilotEndpointContract.js` (new) owns the
  normalization and the route decision. It is pure: no I/O, no provider
  state.
- `open-sse/services/catalogs/copilotModels.js:74` (`expandCatalog`) now attaches the
  contract to each discovered row (`supportedEndpoints`, plus a
  `targetFormat` marker for a Responses-only model). A row that declares no
  endpoint carries none.
- `src/app/api/providers/[id]/models/modelsConfig.js:295`
  (`withCopilotEndpointContract`) applies the same normalization to the
  enterprise catalog, and `:328` (`persistCopilotEndpointContract`) stores
  the contract on the connection. Both the dashboard's model list and the
  model auto-sync service reach the store through this resolver.

The stored model list is an array on purpose: a refreshed catalog then
replaces the stored contract instead of deep-merging into it, so a model
Copilot stopped serving does not keep a stale route. The write is skipped
when the stored contract already matches.

### Route selection

- `open-sse/executors/github.js:171` (`copilotEndpointRoute`) resolves the
  route as `"responses"`, `"chat"`, or null when nothing is known.
  `:183` (`usesResponsesRoute`) applies it, and `:220` uses it in `execute()`.
- A model with no discovered metadata keeps the current fallback: the chat
  route first, escalated to `/responses` only on Copilot's own
  "not accessible via the /chat/completions endpoint" error
  (`open-sse/executors/github.js:238`). The escalation cache
  (`knownCodexModels`) is unchanged.
- `open-sse/executors/ghe-copilot.js:58` adds the enterprise GPT-6 rule: the
  GPT-6 family uses the existing enterprise `/responses` route
  (`ENDPOINT_PATHS.responsesUrl`, `/responses` on the connection's enterprise
  host). The rule applies only when the account's discovered contract says
  nothing about the model; a contract that states the chat route keeps the
  model on chat.

## Local compatibility: what is preserved

| Contract | Where it is preserved |
| --- | --- |
| Explicit registry overrides | `copilotEndpointRoute` consults `getModelTargetFormat` first: a catalog row that pins a model to a format wins over the discovered route. |
| Unsupported model exclusions | `supportsResponsesEndpoint` (`open-sse/executors/github.js:151`) still excludes Gemini and Claude from the Responses route. |
| Claude Messages | Claude models are routed to Copilot's Anthropic-native `/v1/messages` shim before any contract decision (`open-sse/executors/github.js:211`). |
| Provider account choice | The contract is stored per connection and read from the selected account's credentials. Account selection is untouched. |
| Known endpoint defaults | The registry's `baseUrl`/`responsesUrl`/`messagesUrl` and the enterprise host derivation (`resolveGheCopilotApiBase`) are unchanged; no endpoint was added. |
| github.com Copilot routing | github.com Copilot keeps its established behavior: only a discovered contract or Copilot's own error escalates a model. Upstream was explicit that the enterprise GPT-6 rule must not leak to github.com. |

## Rejected upstream mechanisms

- **The catalog-level `targetFormat` for GHE GPT-6** (`getModelTargetFormat`
  returning `openai-responses`): it would make chatCore translate the request
  body into the Responses shape, which the Copilot executor then converts a
  second time, and would make chatCore read the executor's OpenAI-shaped
  answer as Responses shaped. The local equivalent of upstream's rule is the
  executor route decision, which reuses the existing body conversion
  unchanged.
- **The `/^gpt-6/i` URL regex in the GHE executor's `buildUrl`**: in this
  fork `buildUrl` is the chat URL for every Copilot provider (the enterprise
  executor test pins that), and the route decision happens in `execute()`.
- **Upstream's synced-model persistence and VS Code catalog checks**: this
  fork has no VS Code model catalog route, and its synced catalog keeps only
  id/name/kind/capabilities.

## Files changed

- `open-sse/services/copilotEndpointContract.js` (new) — normalization and
  route decision.
- `open-sse/services/catalogs/copilotModels.js` — discovery carries the contract.
- `open-sse/executors/github.js` — route selection from the contract.
- `open-sse/executors/ghe-copilot.js` — enterprise GPT-6 route.
- `src/app/api/providers/[id]/models/modelsConfig.js` — normalize and store
  the contract per connection.
- `tests/unit/copilot-endpoint-contract-1073.test.js` (new).

No registry entry, schema, generated index, dependency, workflow, baseline or
public documentation changed.

## Verification and limits

Offline only. The fixtures are a synthetic catalog payload and synthetic
request bodies: no network, no credentials, no paid API, no Docker, no
browser, no live account. `tests/unit/copilot-endpoint-contract-1073.test.js`
covers the normalization, the discovery carry-over, the route selection, the
request shape sent to `/responses`, the Claude and Gemini exclusions, the
enterprise GPT-6 rule, the github.com Copilot counterpart, the retained
provider-error fallback, and the contract store.

Not verified here: that a live Copilot or GHES account advertises
`supported_endpoints` at all, and that an enterprise host accepts `/responses`
for a GPT-6 model. Upstream records the same limit for its own change. The
contract only acts on what the account's catalog states; a catalog without
endpoint metadata leaves every model on its current route, which is why the
provider-error fallback is retained.
