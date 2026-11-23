# #1073 late-June existing request-option tail

## Scope and pins

Reviewed only the named runtime changes for existing fetch output parameters, explicit JSON mode, and provider-owned cache blocks. The three PR heads and enclosing merges were verified in the supplied OmniRoute source history. Each PR change is described from its exact head commit; enclosing merge commits can contain unrelated PRs and are not treated as the patch.

| PR | Exact head | Enclosing merge | Patch base | Public patch |
| --- | --- | --- | --- | --- |
| [OmniRoute #4692](https://github.com/cheaper-inference/OmniRoute/pull/4692) | `0052e3b22c354a3c536fa6d485e34cbebf3c1383` | `520293ffc04183a808326084fb8f4697569769f0` | `32bc6a9736225b8c410538c5049c6200f87592cb` | [head diff](https://github.com/cheaper-inference/OmniRoute/commit/0052e3b22c354a3c536fa6d485e34cbebf3c1383) |
| [OmniRoute #5009](https://github.com/cheaper-inference/OmniRoute/pull/5009) | `d602a4fda96b252f19ee2903b05574f098af29ce` | `917b2244b6af3b303e2bf15b1d55248c9192834c` | `af32e0041c754ca482b808afd967bbf7635e5a4c` | [head diff](https://github.com/cheaper-inference/OmniRoute/commit/d602a4fda96b252f19ee2903b05574f098af29ce) |
| [OmniRoute #5013](https://github.com/cheaper-inference/OmniRoute/pull/5013) | `b1258aef07d6184718a153fb36cc00e8ea2d38ed` | `c5c8db77dad51e1c756a4c8baa78c84ed68fbec6` | `ac8bd72e917ce5a20ab1b997b3bb083c49b937ac` | [head diff](https://github.com/cheaper-inference/OmniRoute/commit/b1258aef07d6184718a153fb36cc00e8ea2d38ed) |

## Current behavior and evidence

### #4692 — Firecrawl metadata request parameter

The patch removes invalid `includeTags` selectors when `include_metadata=true`, because Firecrawl returns metadata automatically and the bad selector values can produce a provider 500. DurinDoor's existing `/v1/web/fetch` Firecrawl adapter does not expose an `include_metadata` input and does not send `includeTags`: [fetch dispatch and format selection](../../../open-sse/handlers/fetch/index.js), [Firecrawl body and returned metadata title](../../../open-sse/handlers/fetch/index.js). It sends the caller-selected output format as `formats: [fmt]` and reads `data.metadata.title` when present. The offline Firecrawl fixture exercises the current hosted endpoint/auth path: [firecrawl-selfhosted.test.js](../../../tests/unit/firecrawl-selfhosted.test.js). This is a different, narrower API shape than OmniRoute's `web_fetch` option; no corresponding unsupported request parameter exists in the current path.

**Disposition: no port.** Keep the current provider-owned fetch API and its output-format selection. No fetch behavior gap is demonstrated, so no new test is warranted.

### #5009 — Pollinations explicit JSON mode

The patch stops forcing `jsonMode` on every Pollinations request and enables it only for `response_format.type` equal to `json_object` or `json_schema`. DurinDoor already implements this exact opt-in: [PollinationsExecutor.transformRequest](../../../open-sse/executors/pollinations.js). Non-JSON requests have stale `jsonMode` removed; explicit JSON requests set it true. Provider behavior is covered alongside the specialized executor in [omniroute-specialized-executors.test.js](../../../tests/unit/omniroute-specialized-executors.test.js) and the offline Pollinations acceptance fixtures in [fleet-provider-g4f-pollinations-acceptance.test.js](../../../tests/unit/fleet-provider-g4f-pollinations-acceptance.test.js).

**Disposition: already covered; no port.** Preserve the existing response-format opt-in and current executor ownership. No additional fixture is needed for the demonstrated patch.

### #5013 — preserve provider-owned cache blocks

The patch carries client `cache_control` through Claude-to-OpenAI translation only for providers that explicitly support OpenAI-format cache markers, while stripping it for generic OpenAI endpoints. DurinDoor uses per-provider `quirks.preserveCacheControl` to opt in during translation: [translation context](../../../open-sse/translator/index.js) and [OpenAI normalization](../../../open-sse/translator/index.js). The OpenAI normalizer strips cache markers by default and retains them only under that option: [filterToOpenAIFormat](../../../open-sse/translator/formats/openai.js). Alibaba/DashScope records own the capability opt-in: [alicode registry entry](../../../open-sse/providers/registry/alicode.js). Xiaomi MiMo is already an existing provider with OpenAI-format transports, but its [registry entry](../../../open-sse/providers/registry/xiaomi-mimo.js) does not opt into `preserveCacheControl`; only four other provider registry entries currently do. Existing offline fixtures assert default stripping, explicit retention, signature stripping, and no marker invention: [alicode-cache-control-2069.test.js](../../../tests/unit/alicode-cache-control-2069.test.js). This preserves provider/endpoint ownership and avoids broad forwarding to providers that rely on automatic caching.

**Disposition: narrow port recommended.** Add the existing `preserveCacheControl` provider quirk to Xiaomi MiMo only, consistent with #5013's explicit provider list; do not broaden forwarding to all OpenAI-compatible routes. Ordinary offline acceptance should exercise `translateRequest` from Claude to Xiaomi's OpenAI target with a system and message text cache block, assert those blocks retain the marker, and assert an unopted generic OpenAI provider still strips it. The current filter-level fixture alone cannot prove the provider-owned option reaches the translator.

## Acceptance

The narrow Xiaomi cache opt-in above is the only demonstrated gap. Its acceptance is an ordinary offline translator test with synthetic bodies and no provider credentials or external calls. Firecrawl and Pollinations require no changes.
