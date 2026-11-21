# #1073 May model-scoped outbound controls: existing behavior and residuals

Reviewed against the current local source and offline fixtures. No provider traffic, account access, or credentials were used. Each disposition below is based on the PR head commit itself; enclosing merge commits are recorded for provenance, not treated as the patch when they contain unrelated changes.

## Exact public pins

| PR | Exact patch head | Enclosing merge | Patch base (head parent) | Public patch |
| --- | --- | --- | --- | --- |
| [OmniRoute #2916](https://github.com/cheaper-inference/OmniRoute/pull/2916) | `170b549bc79ffad4ef6c274c1f2d5185535f4b58` | `2ae278fac5d0bf97dceeee68deff5cd871c96356` | `338636a3041e5bba32570c508d1e895ecd8e6f11` | [head commit](https://github.com/cheaper-inference/OmniRoute/commit/170b549bc79ffad4ef6c274c1f2d5185535f4b58) |
| [OmniRoute #2999](https://github.com/cheaper-inference/OmniRoute/pull/2999) | `d0a87970c69281012975b6f1b881317e26d77997` | `b2e1e6c1e950d54c89b138aff4b382c8cbd4300e` | `81bf13e866d8cdf9932faae505719abfd15ed68` | [head commit](https://github.com/cheaper-inference/OmniRoute/commit/d0a87970c69281012975b6f1b881317e26d77997) |
| [OmniRoute #3004](https://github.com/cheaper-inference/OmniRoute/pull/3004) | `d4045e74b5ee986f430396bd41bb1532d75abb27` | `b1e1f5e5f6b5572919e3c5f0c1777a332d9ee3b5` | `687c28474dc0eb171cd901e6fbfa09aeb502f99` | [head commit](https://github.com/cheaper-inference/OmniRoute/commit/d4045e74b5ee986f430396bd41bb1532d75abb27) |

The inspected #2916 head changes `open-sse/executors/base.ts` and its sanitizer fixture. The #2999 head changes Codex executor normalization and its free-plan fixture; its message identifies it as an image-generation fix spun off from #2980. The #3004 head changes custom-model storage, API validation/route, model metadata resolution, chat-core format selection, and its fixture. Its named commit was inspected directly so unrelated changes in the enclosing merge are out of scope.

## Current behavior and evidence

### #2916 — OpenAI-shape reasoning effort normalization

**Disposition: already covered by the local model-scoped normalization; do not port the provider-wide sanitizer.**

Current `resolveOpenAiEffort` in `open-sse/translator/concerns/thinkingUnified.js` resolves the requested tier against `getThinkingLevelsFromCapabilities` when model capabilities are present, otherwise against the provider/model effort declaration. It preserves a declared `max`; when `max` is absent and `xhigh` is declared it chooses `xhigh`; if neither is available it falls to `high` or the lowest declared tier. `applyThinking` runs on the resolved outbound format in chat core. This is model-aware and retains explicit model effort metadata, including the distinction between models that accept `max` and those that accept `xhigh`.

Fixture evidence: `tests/unit/thinking-effort-openai-max-clamp.test.js` covers unsupported `max` in all three accepted input shapes, preserves `max` for a model that declares it, maps unsupported `ultra` to the declared maximum, and preserves a supported ordinary tier. `tests/unit/custom-caps-default-effort.test.js` and `tests/unit/custom-model-capabilities.test.js` cover custom model effort/capability metadata and explicit operator values. These fixtures demonstrate the relevant existing boundary without relying on live provider claims.

The upstream executor sanitizer has a broader provider/model predicate and changes `reasoning_effort` plus nested `reasoning.effort` for OpenAI-shape providers. Copying that behavior over the current capability-aware path risks overwriting a declared `max` or capability/override ownership. No narrow gap is demonstrated by the patch fixture.

### #2999 — free-plan Codex hosted image-generation tool

**Disposition: narrow gap; accept a scoped port candidate for Codex chat tool normalization.**

Current Codex chat normalization allowlists `image_generation` with the other hosted Responses tools and does not consult account plan metadata. `tests/unit/codex-tool-normalization.test.js` explicitly verifies that the hosted image tool is preserved. This is distinct from Codex's image-generation endpoint: `open-sse/handlers/imageProviders/codex.js` already rejects known free plans before dispatch, checking `chatgptPlanType` and `workspacePlanType`; `tests/unit/codex-client-version-and-reasoning.test.js` covers free-plan rejection and non-free pass-through for that endpoint. The endpoint guard therefore does not cover the chat request where a CLI-injected hosted tool reaches the Responses executor.

A narrow implementation should filter only `image_generation` for an account whose stored plan is explicitly free, retain the existing tool order and all other hosted/function tools, and leave unknown plan values and paid accounts unchanged. Read the existing connection metadata (including its canonical `chatgptPlanType` field and compatible `workspacePlanType` form) without changing plan ownership, account selection, quota accounting, or retries. Offline acceptance should exercise both plan-field spellings and case/whitespace normalization, free versus paid versus unknown plans, and preservation of the other tools. The existing hosted-tool fixture is a useful regression case to update or complement.

### #3004 — persisted operator-custom target format (out of scope)

**Disposition: out of scope for the current owner request; do not propose this feature as a port.**

The local request path already supports model-scoped target formats from the registry: `getModelTargetFormat` in `open-sse/config/providerModels.js` reads a catalog row, and `resolveRequestTransport` in `open-sse/handlers/chatCore.js` gives that format precedence over source-format and provider-default selection. `tests/unit/copilot-endpoint-contract-1073.test.js` separately proves a discovered Copilot endpoint contract carries a model-specific `openai-responses` route while models without that metadata retain existing behavior. These existing registry and Copilot findings remain valid for their own contracts.

The exact #3004 change adds a generic persisted `targetFormat` to operator-created custom model records and uses it in chat routing. DurinDoor does not have that generic persisted operator control. Registry catalog metadata and the Copilot-discovered endpoint contract are distinct existing controls; neither implies that arbitrary operator-created custom models can store a target format. Adding that control would be a new product feature outside the assigned scope. Record the local capability boundary without recommending its implementation or characterizing it as a required port.

## Mixed or newer source behavior recorded separately

The local tree contains later, independently scoped behavior relevant to the comparison: the Codex image-generation endpoint's free-plan guard; registry/model-catalog target formats and the Copilot discovered endpoint contract; and model-capability effort declarations. These provide useful boundary and fixture evidence, but they are not evidence that #2999 chat hosted-tool filtering or #3004 arbitrary custom-model persistence is already implemented. The three dispositions above address only the pinned head commits and the corresponding local behavior.
