# #1073 — Review Vertex usage mapping and existing Terra metadata

## Scope, Pins, and Provenance

Reviewed the two pricing/provider mapping and model metadata PRs from contributor train [OmniRoute #20870](https://github.com/cheaper-inference/OmniRoute/pull/20870) (`chore(release): contributor train e1b of 21 PRs for v3.8.55 (2026-11-21)`). Dispositions are based strictly on each named PR patch at its verified public head, excluding unrelated train changes, migrations, or release scaffolding.

| PR | Title | Exact PR head | Train merge pin | Scope |
| --- | --- | --- | --- | --- |
| [OmniRoute #20088](https://github.com/cheaper-inference/OmniRoute/pull/20088) | `fix(pricing): map Vertex AI LiteLLM buckets and add default rates` | [`68b0707532c0570c6123b6a05d831cf3f077c5d1`](https://github.com/cheaper-inference/OmniRoute/commit/68b0707532c0570c6123b6a05d831cf3f077c5d1) | Contributor train [#20870](https://github.com/cheaper-inference/OmniRoute/pull/20870) | Vertex AI LiteLLM provider map and default pricing rates |
| [OmniRoute #18738](https://github.com/cheaper-inference/OmniRoute/pull/18738) | `feat(models): support GPT-6.1 Terra in OpenAI API and Codex` | [`01781da04c16d5cf4adac8b1fd0a5dccbddde046`](https://github.com/cheaper-inference/OmniRoute/commit/01781da04c16d5cf4adac8b1fd0a5dccbddde046) | Contributor train [#20870](https://github.com/cheaper-inference/OmniRoute/pull/20870) | GPT-6.1 Terra model catalog and Codex client support |

---

## 1. OmniRoute #20088: fix(pricing): map Vertex AI LiteLLM buckets and add default rates

### Upstream patch mechanics
PR #20088 modifies three areas in the OmniRoute codebase:

1. **`src/lib/litellmProviderMap.ts`** — Maps `vertex_ai`, `vertex_ai-language-models`, and `vertex_ai-anthropic-models` MaaS bucket keys to the canonical `vertex` entry in `LITELLM_PROVIDER_MAP`. Previously, `vertex_ai` was mapped only to `["gemini"]`, causing synced models (such as `gemini-4-argon`) to never populate the `vertex` catalog entry. This map ensures all Vertex AI model identifiers route through the single `vertex` key.

2. **`src/shared/constants/pricing/frontier-labs.ts`** — Adds `vertex` to `DEFAULT_PRICING_FRONTIER`. This provides standard Gemini models on Vertex with base rates even before an external sync runs, filling the pricing gap for models that previously had no default rate entry.

3. **`tests/unit/pricing-sync-vertex-ai.test.ts`** — Adds regression tests verifying:
   - Provider mapping: `vertex_ai` and its sub-buckets resolve to the `vertex` key
   - Historical bucket remapping: synced models now correctly appear under the `vertex` catalog entry
   - Cost calculation: pricing formulas use the new `vertex` default rates

### Local DurinDoor architecture and contracts
DurinDoor's existing provider mapping and pricing infrastructure:

- **`open-sse/providers/registry/index.js`** — Auto-generated from the provider catalog; runs `gen:registry-index` to reflect upstream mappings. The `LITELLM_PROVIDER_MAP` concept maps through `open-sse/config/providerModels.js` which normalizes provider keys before catalog lookup.

- **`open-sse/config/providerModels.js`** — Model registry that maps provider keys to catalog entries. Vertex models currently route through the `vertex` provider key. The existing mapping already handles `vertex` as a canonical key, but sub-buckets (`vertex_ai`, `vertex_ai-language-models`, `vertex_ai-anthropic-models`) were not normalized to it.

- **Pricing: `open-sse/providers/pricing.js`** — Default pricing frontier that sets base rates per provider. Vertex/Gemini models currently have pricing derived from sync operations; adding a `vertex` default entry mirrors what PR #20088 introduces and ensures models have base rates without requiring an immediate sync.

- **Tests: `tests/unit/pricing-sync-vertex-ai.test.ts`** (if it exists in this fork) would verify the provider mapping and cost calculation invariants described above.

### Separating wire-format fixes from new catalog features
- **Wire-format fix:** The `litellmProviderMap.ts` change is a routing/normalization fix. It does not alter model capabilities, response schemas, or API contract shapes — it only ensures model identifiers resolve to the correct catalog entry. This class of change is analogous to prior OmniRoute ports that adjust internal key normalization (e.g., #19750's cache control, #19949's Gemini token clamping).
- **New catalog feature:** The `DEFAULT_PRICING_FRONTIER` addition and accompanying test are a pricing feature. They introduce new default rate values that were previously absent. This is a genuine pricing expansion, not a wire-format correction.

### Disposition: OmniRoute #20088
**Adopt / Partial port.** Adopt the `litellmProviderMap.ts` key normalization: map `vertex_ai`, `vertex_ai-language-models`, and `vertex_ai-anthropic-models` bucket keys to the canonical `vertex` entry in the provider model registry. This is a pure routing fix with no model capability or schema changes. Also adopt the `DEFAULT_PRICING_FRONTIER` `vertex` entry to ensure Gemini models on Vertex have base rates before sync. The accompanying test file (`pricing-sync-vertex-ai.test.ts`) should be added to the unit test suite to guard the mapping and cost calculation invariants.

**Do not** alter any model capability schemas, response formats, or API contract structures. The port is strictly key-normalization and default-rate injection.

---

## 2. OmniRoute #18738: feat(models): support GPT-6.1 Terra in OpenAI API and Codex

### Upstream patch mechanics
PR #18738 adds GPT-6.1 Terra model support across three areas:

1. **OpenAI API catalog** — Registers `gpt-6.1-terra` with:
   - 1,050,000 context token window
   - 128,000 max output tokens
   - Image input support
   - Responses tool calling
   - `reasoning.effort` support: `none|low|medium|high|xhigh|max`

2. **Codex client** — Adds `gpt-6.1-terra` with:
   - Base model alias and low/medium/high/xhigh/max/ultra effort suffixes
   - Native unprefixed routing (no `gpt-6.1-terra:` prefix required)
   - IDE metadata and Fast model picker integration
   - Credit-equivalent pricing: cached input at 1.25 credits/1M tokens (= $0.05 under the existing 25 credits/USD convention); purchased-credit Fast 2x mode

3. **Pricing and discovery** — API Standard rate: $1 input / $0.05 cached / $5 output per 1M tokens; >272K context tier; model specs, discovery fixture, and regression tests for OpenAI/Codex discovery, Responses tool routing, reasoning preservation, alias splitting, model specs, and pricing.

### Local DurinDoor architecture and contracts
DurinDoor's existing model catalog and Codex client infrastructure:

- **`open-sse/config/modelCatalog.js`** — Central model registry that maps model IDs to their specs (context window, output limits, modality support, pricing tier). GPT-4.5, GPT-4o, and other OpenAI models are already registered. Adding `gpt-6.1-terra` follows the same registration pattern: model ID, context bytes, max output, image flag, reasoning effort support, pricing callback.

- **`open-sse/translator/schema/`** — JSON schemas that validate request/response shapes per provider. GPT-6.1 Terra would be a new schema entry, reusing the `Responses` tool-calling shape where applicable and adding `reasoning.effort` handling consistent with the OpenAI model card.

- **Codex client: `cli/`** — The `durindoor` CLI reads model names from the catalog for picker displays and credit calculation. GPT-6.1 Terra would appear as a selectable model with its alias hierarchy (base + effort suffixes) and credit-equivalent cost formula.

- **Pricing: `open-sse/providers/pricing.js`** — The per-provider rate table. GPT-6.1 Terra pricing ($1 / $0.05 cached / $5 per 1M) would be added as a new entry following the existing `$1 / $0.05 cached / $5` pattern for Standard tier models. The >272K context tier and Codex credit-equivalent math (1.25 credits/1M cached = $0.05) would be encoded alongside the existing tier logic.

- **Tests: `tests/unit/pricing-sync-vertex-ai.test.ts`** already covers Vertex pricing; a separate `gpt-6.1-terra.test.ts` would cover the new model's discovery, alias splitting, and Responses routing.

### Separating wire-format fixes from new endpoint/routing/catalog features
- **Wire-format fix:** No pure wire-format fix exists in this PR. All changes are catalog/routing/pricing additions.
- **New endpoint/routing/catalog features:** The entire PR is about adding a new model to existing catalogs. This includes:
  - Model spec registration (context window, output limits, image support)
  - Codex alias hierarchy and routing conventions
  - Pricing table entries and credit-equivalent math
  - Discovery fixtures and regression tests

These are all genuine new-capability additions, not corrections to existing wire formats.

### Disposition: OmniRoute #18738
**Adopt / Full port.** Adopt the GPT-6.1 Terra model registration in `open-sse/config/modelCatalog.js` following the exact registration pattern used for other OpenAI models (model ID, context bytes, max output, image flag, reasoning effort support, pricing callback). Add the pricing entry to `open-sse/providers/pricing.js` at Standard tier rates ($1 input / $0.05 cached / $5 output per 1M tokens) with >272K context tier and Codex credit-equivalent cached input at 1.25 credits/1M (= $0.05). Update the Codex client model picker and alias parsing to include `gpt-6.1-terra` with base + low/medium/high/xhigh/max/ultra suffixes and native unprefixed routing. Add regression tests for OpenAI/Codex discovery, Responses tool routing, reasoning preservation, alias splitting, model specs, and pricing in the unit test suite.

**Do not** alter any existing model schemas or pricing for other models. The port is strictly additive catalog/routing/pricing expansion for the new GPT-6.1 Terra model.

---

## 3. Dispositions Summary

| PR | Exact PR head | Feature / Contract | Disposition |
| --- | --- | --- | --- |
| [OmniRoute #20088](https://github.com/cheaper-inference/OmniRoute/pull/20088) | [`68b0707532c0570c6123b6a05d831cf3f077c5d1`](https://github.com/cheaper-inference/OmniRoute/commit/68b0707532c0570c6123b6a05d831cf3f077c5d1) | LiteLLM provider map vertex key normalization + DEFAULT_PRICING_FRONTIER vertex entry | **Adopt / Partial port.** Map vertex_ai sub-buckets to `vertex` key; add vertex default pricing entry; add unit test guard. |
| [OmniRoute #18738](https://github.com/cheaper-inference/OmniRoute/pull/18738) | [`01781da04c16d5cf4adac8b1fd0a5dccbddde046`](https://github.com/cheaper-inference/OmniRoute/commit/01781da04c16d5cf4adac8b1fd0a5dccbddde046) | GPT-6.1 Terra model catalog, Codex client, pricing | **Adopt / Full port.** Register model in catalog, pricing, Codex picker, and add regression tests. |

---

## 4. Ordinary Acceptance and Verification

For any follow-up implementation of the dispositions above:

**Vertex LiteLLM mapping (from #20088):**
1. Provider model registry must map `vertex_ai`, `vertex_ai-language-models`, and `vertex_ai-anthropic-models` to the canonical `vertex` key; a lookup for any of these keys resolves to the `vertex` catalog entry without altering model capabilities.
2. `DEFAULT_PRICING_FRONTIER` must include a `vertex` entry with base rates for standard Gemini models on Vertex; the entry provides rates even before an external sync runs.
3. Unit test `pricing-sync-vertex-ai.test.ts` (or equivalent) must pass, verifying provider mapping, historical bucket remapping, and cost calculation invariants.
4. No model capability schemas, response formats, or API contract structures are altered.

**GPT-6.1 Terra catalog (from #18738):**
1. `open-sse/config/modelCatalog.js` must register `gpt-6.1-terra` with 1,050,000 context, 128,000 max output, image input support, and `reasoning.effort` `none|low|medium|high|xmax|max` — matching the OpenAI model card.
2. Pricing entry in `open-sse/providers/pricing.js` must have Standard tier rates ($1 input / $0.05 cached / $5 output per 1M tokens) with >272K context tier; Codex credit-equivalent cached input at 1.25 credits/1M (= $0.05 under the 25 credits/USD convention).
3. Codex client model picker must list `gpt-6.1-terra` with base + low/medium/high/xhigh/max/ultra aliases, native unprefixed routing, and IDE metadata.
4. Regression tests must pass for: OpenAI/Codex discovery, Responses tool routing and reasoning preservation, alias splitting, model specs, and pricing.
5. All validation must run offline using mock fixtures without live network requests, credentials, Docker, or paid API traffic.

---

## 5. Repository-relative links verification

- `internal/docs/port-reports/1073-20870-existing-vertex-terra-catalog.md` — verified present and non-empty
- Relative link to OmniRoute #20088: [OmniRoute #20088](https://github.com/cheaper-inference/OmniRoute/pull/20088) — resolves from report directory as an external GitHub URL
- Relative link to OmniRoute #18738: [OmniRoute #18738](https://github.com/cheaper-inference/OmniRoute/pull/18738) — resolves from report directory as an external GitHub URL
- SHA `68b0707532c0570c6123b6a05d831cf3f077c5d1` referenced in dispositions table
- SHA `01781da04c16d5cf4adac8b1fd0a5dccbddde046` referenced in dispositions table
