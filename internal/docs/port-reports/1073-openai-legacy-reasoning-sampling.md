# 1073: OpenAI legacy reasoning sampling fields

Disposition: **port applied; qualifying gap on an existing provider.** The local tree declared no unsupported-parameter set for the legacy OpenAI reasoning family, so a client that sent `temperature` or `top_p` reached the upstream reasoning endpoint with parameters it rejects. The rule table now removes the upstream contract's field set for the affected models on the native `openai` provider, on both dispatch shapes.

Source inspected 2026-11-21: [OmniRoute #412](https://github.com/cheaper-inference/OmniRoute/pull/412), merged 2026-03-17T06:03:28Z, final head `d79b55be5ae282b11373e3d157d679c8fbf6d9ff` (authored 2026-03-16T19:30:14+01:00), merge commit `d261ae7883df861d9a7759bb83dcc78dc16e21b0` (first parent `6fa77a63d794122b5d38f741dd4c4a5aa88ab909`, second parent `d79b55be5ae282b11373e3d157d679c8fbf6d9ff`). The patch was read as the exact merged diff against its first parent (`git diff <merge>^1 <merge>`) in the retained upstream mirror `/var/tmp/durindoor-omniroute-source.4eUb6QtM/source.git`.

## Upstream contract

The patch adds a per-model `unsupportedParams` list to `RegistryModel`, a frozen `REASONING_UNSUPPORTED` constant (`temperature`, `top_p`, `frequency_penalty`, `presence_penalty`, `logprobs`, `top_logprobs`, `n`), marks the OpenAI registry rows `o1`, `o1-mini`, `o1-pro`, `o3` and `o3-mini` with it, and exposes `getUnsupportedParams(provider, modelId)` with three lookups: the provider's own registry row, a cross-provider precomputed map, and a prefix-stripped id (`openai/o3` → `o3`). `open-sse/handlers/chatCore.ts` then deletes every listed parameter from the translated body before the executor runs and logs the stripped names.

Changed upstream paths: `open-sse/config/providerRegistry.ts`, `open-sse/handlers/chatCore.ts`.

## DurinDoor comparison

The local tree already had the rule-table shape but not this rule:

- `open-sse/translator/concerns/paramSupport.js` — `STRIP_RULES` / `stripUnsupportedParams` / `applyParamRenames` are the local rule table. Before this port the only OpenAI-scoped entries were the `max_tokens` → `max_completion_tokens` rename (all OpenAI models) and the `^gpt-6-astra$` sampling drop. No rule removed a sampling field for the o-series, and the only reasoning-family strip in the tree was Kimi-scoped inside `open-sse/executors/default.js`.
- `open-sse/providers/registry/openai.js` — the o-series rows carry `targetFormat: "openai-responses"` and no `unsupportedParams`. The registry's `unsupportedParams` field is plugin-manifest metadata (`open-sse/config/providerPluginManifest.js`), published to the sidecar catalog; it is not consulted on the outbound path, so declaring the set there would not have changed any request.
- `open-sse/executors/default.js:466` — `stripUnsupportedParams(this.provider, model, transformed, …)` is the outbound filter, applied by `DefaultExecutor.transformRequest`, which `BaseExecutor.execute` calls for every dispatch (`open-sse/executors/base.js:425`). The native `openai` provider has no dedicated executor (`open-sse/executors/index.js` has no `openai` entry), so it resolves to `new DefaultExecutor("openai")` and `this.provider` is `"openai"`.

Both local dispatch shapes for these models end on that same filter:

- **Chat-to-Responses.** The o-series rows resolve to the Responses transport (`getModelTargetFormat` → `targetFormat: "openai-responses"`, `open-sse/config/providerModels.js:81`), so a Chat Completions request is translated by `openaiToOpenAIResponsesRequest` (`open-sse/translator/request/openai-responses.js`), which rebuilds the body field by field. Only `temperature` (`openai-responses.js:1005`) and `top_p` (`openai-responses.js:1007`) are copied; `frequency_penalty`, `presence_penalty`, `logprobs`, `top_logprobs` and `n` are dropped by the translation itself.
- **Native Responses.** `src/app/api/v1/responses/route.js` resolves the source format as `openai-responses`, and the target format equals the source format, so `translateRequest` skips translation (`open-sse/translator/index.js:182`) and the client's Responses body reaches the executor close to literally. All seven upstream field names therefore survive to the wire on this path.

This confirms the earlier audit in `internal/docs/port-reports/1073-march-existing-media-and-search.md` (§#412): the gap was real, the local rule table is the equivalent insertion point, and no local fixture asserted that an OpenAI reasoning model loses `temperature`/`top_p`.

## Scope decision

The upstream model list and the local catalog differ, so the set was intersected with what the local OpenAI provider actually supports:

| Upstream list | Local catalog | In scope |
| --- | --- | --- |
| `o1` | `o1` (exact row), `o1-2024-12-17` (documented snapshot alias) | yes |
| `o1-mini` | absent — OpenAI shutdown 2025-10-27, retired from the local registry (`internal/docs/port-reports/1072-retired-model-catalog-5781.md`) | no |
| `o1-pro` | `o1-pro` (exact row), `o1-pro-2025-03-19` (documented snapshot alias) | yes |
| `o3` | `o3` (exact row) | yes |
| `o3-mini` | absent — OpenAI shutdown 2026-10-23, retired from the local registry (same report) | no |
| — | `o3-pro` — a live local row the upstream list does not contain | no |

The ported model set is therefore `o1`, `o1-2024-12-17`, `o1-pro`, `o1-pro-2025-03-19` and `o3`. The dated snapshots are the documented aliases of `o1` and `o1-pro`, and the local outbound path would otherwise send sampling fields for them. `o1-mini` and `o3-mini` are excluded because the local catalog retired those rows, and `o3-pro` is excluded because extending the rule to it would generalize past the pinned upstream contract. Nothing in the o4, gpt-5.x or gpt-6.x families is in scope: those models accept sampling controls.

The rule is scoped to the native `openai` provider. Upstream's second lookup was a cross-provider map, which would also strip sampling fields on a third-party provider that merely serves a model named `o3`; the local rule does not, so other providers, proxy routes and `openai-compatible-*` nodes keep the fields.

## Actual behavior

`open-sse/translator/concerns/paramSupport.js` gains one rule and the model set it matches:

```js
{
  provider: "openai",
  match: (model) => LEGACY_OPENAI_REASONING_MODELS.has(bareModelId(model)),
  drop: ["temperature", "top_p", "frequency_penalty", "presence_penalty", "logprobs", "top_logprobs", "n"],
},
```

`LEGACY_OPENAI_REASONING_MODELS` is a frozen-by-convention `Set` of the five in-scope ids; `bareModelId` strips a provider prefix so `openai/o3` resolves to `o3`, mirroring upstream's third lookup. The rule sits after the existing OpenAI rules in `STRIP_RULES` and deletes only fields that are present, so it never invents one.

Effects on the native `openai` provider:

- Chat-to-Responses for `o1`, `o1-2024-12-17`, `o1-pro`, `o1-pro-2025-03-19`, `o3`: `temperature` and `top_p` are removed from the wire body. The other five names are already gone by translation.
- Native Responses for the same models: all seven names are removed from the wire body.
- `reasoning` / `reasoning_effort`, `tools`, `tool_choice` and the token-limit fields (`max_output_tokens`, `max_completion_tokens`) are untouched. The `max_tokens` → `max_completion_tokens` rename still applies to these models exactly as before.
- Every other OpenAI model, every other provider, and every proxy/custom route keeps its sampling fields.

Not ported, deliberately: the upstream patch deletes only the seven named fields, so a native Responses body that asks for logprobs through the Responses spelling (`include: ["message.output_text.logprobs"]`) still carries that entry — the same gap exists upstream at this pin. The `dropInclude` mechanism the local tree already uses for `gpt-6-astra` was not reused here, because doing so would extend the upstream field contract.

## Verification

`tests/unit/omni-openai-legacy-reasoning-sampling.test.js` is new, offline, and drives the real outbound path through a mocked transport (`open-sse/utils/proxyFetch.js` is mocked; no provider is contacted, no credential is read, and the fixture key is a placeholder string).

- Native Responses dispatch: for each of the five in-scope models, the captured wire body has none of the seven fields and keeps `reasoning.effort`, `tools`, `max_output_tokens` and `input`; the request goes to `https://api.openai.com/v1/responses`.
- Chat-to-Responses dispatch: the translation itself still copies `temperature` and `top_p` (asserted, so the strip stays on the outbound boundary rather than moving into translation), and the captured wire body then carries none of the seven fields while keeping the reasoning, tool and token-limit fields.
- Only the listed fields are removed and none is invented; a provider-prefixed `openai/o3` resolves to the same rule.
- Preserved everywhere else: `gpt-4o`, `gpt-4.1`, `gpt-5.6`, `gpt-5.6-sol`, `o3-pro`, `o1-mini`, `o3-mini`, `o4-mini` and `o1-preview` keep all seven fields on the native provider; `openrouter` serving `openai/o3`, `openai-compatible-custom` serving `o3`, `azure-openai` serving `o3` and `github` serving `o3` keep them too.

Results:

- `tests/unit/omni-openai-legacy-reasoning-sampling.test.js` — 26 tests pass.
- With the rule temporarily reverted, the same file fails 12 of 26 (the strip cases fail; the preserve cases pass), so the fixture does bind the new behavior.
- Neighbouring suites, run together with the new file: `unit/param-support.test.js`, `unit/astra-gpt-6.test.js`, `unit/openai-max-completion-tokens-1366.test.js`, `unit/openai-responses-strip-fields.test.js`, `unit/omni-claude-thinking-sampling-presence.test.js`, `unit/provider-plugin-manifest.test.js`, `unit/omniroute-provider-field-strips-exec.test.js`, `unit/github-responses-temperature.test.js`, `unit/openai-tool-call-id-normalization.test.js` — 10 files, 178 tests, all pass. Existing assertions, including the `o1`/`o3` max-token rename cases in `tests/unit/param-support.test.js` and the `gpt-4o` temperature-retention case, are unchanged and still pass.
- Wider OpenAI/Responses surface — every `unit/*openai*.test.js`, `unit/*responses*.test.js`, `translator/*openai*.test.js` and `translator/*responses*.test.js` file, with the new file included — 116 files, 1062 tests, all pass. This is a targeted slice, not the full suite.

## Rejected alternatives

- **Declaring `unsupportedParams` on the OpenAI registry rows.** The registry field feeds the plugin manifest only; nothing on the outbound path reads it, so this would have published a catalog claim without changing any request. The task also forbids provider-catalog changes.
- **A wildcard o-family rule** (`/^o[13]/`): it would strip sampling fields on `o3-pro`, `o1-preview` and on any model id that merely starts with those characters — a generalization past the pinned contract, and it would silently change models the upstream patch never named.
- **A cross-provider lookup** mirroring upstream's second lookup: it would strip sampling fields on unrelated providers that happen to serve a model named `o3`.
- **Stripping in the translator** instead of at the outbound boundary: the native Responses path skips translation entirely, so the strip would not run there.

## Limits

Offline request-shape and wire-body evidence only. No provider was contacted, no credential was read or written, no paid API was called, and no browser, Docker, e2e or full-suite run was performed. The mock proves what DurinDoor sends, not that any upstream accepts it. Dependencies were installed into the git-ignored `node_modules` trees with the existing lockfiles; no manifest, lockfile, baseline file, workflow, route, key or `AGENTS.md` was touched.
