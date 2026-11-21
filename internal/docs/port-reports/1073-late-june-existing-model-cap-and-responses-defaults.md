# #1073 - Late-June existing model output caps and Responses `text.format` defaults

Reviewed 2026-11-21. This report compares two exact public OmniRoute pull requests against the
current local DurinDoor source and fixtures, limited to **existing OpenAI-compatible Responses
behavior**. No product code, test, workflow, or baseline file was changed. No provider request,
credential access, paid API, browser, Docker, or e2e run was performed; every check below is
offline.

## 1. Scope and pins

| Item | Value |
|---|---|
| Issue | [#1073](https://github.com/bloodf/durindoor/issues/1073) |
| Source repository | [`cheaper-inference/OmniRoute`](https://github.com/cheaper-inference/OmniRoute) (public, merged pull requests) |
| Local branch | `orq/tornf6/audit-omni-late-june-existing-model-cap-and-responses-defaults-a1` |
| Comparison surface | existing OpenAI-compatible Responses request path only |
| Provider traffic | none |

### 1.1 Exact pins

| PR | PR head | Enclosing merge | Enclosing-merge parent (base) |
|---|---|---|---|
| [OmniRoute #4584](https://github.com/cheaper-inference/OmniRoute/pull/4584) - `fix(models): treat unknown output caps as unset` | [`e9be19a8ec8b04ebf996327694d316c0ff26a20d`](https://github.com/cheaper-inference/OmniRoute/commit/e9be19a8ec8b04ebf996327694d316c0ff26a20d) | [`67c8a0436e9c8589b44d524acec8f8fcec89a377`](https://github.com/cheaper-inference/OmniRoute/commit/67c8a0436e9c8589b44d524acec8f8fcec89a377) | [`5887bc3d6ab592ea79d36064c9bf2c7973e35edf`](https://github.com/cheaper-inference/OmniRoute/commit/5887bc3d6ab592ea79d36064c9bf2c7973e35edf) |
| [OmniRoute #5101](https://github.com/cheaper-inference/OmniRoute/pull/5101) - `fix(responses): default text.format for openai-compatible responses providers` | [`7b76dda4e9be9ca8c3e29011d128fa68e1634c11`](https://github.com/cheaper-inference/OmniRoute/commit/7b76dda4e9be9ca8c3e29011d128fa68e1634c11) | [`cfaba4410fcdf33a1ed0be6d1694d437fb7246cc`](https://github.com/cheaper-inference/OmniRoute/commit/cfaba4410fcdf33a1ed0be6d1694d437fb7246cc) | [`135b5daaa5a9fa07ad8a36355a1baca1e7d767d7`](https://github.com/cheaper-inference/OmniRoute/commit/135b5daaa5a9fa07ad8a36355a1baca1e7d767d7) |

### 1.2 Boundary verification

Both enclosing merges are **single-parent squash commits**, so the merge does not drag in unrelated
pull-request changes, and the PR-head diff and the enclosing-merge diff were compared for
agreement:

| PR | Diff A | Diff B | Changed files | Insertions / deletions |
|---|---|---|---|---|
| #4584 | `5887bc3d6ab592ea79d36064c9bf2c7973e35edf` -> `e9be19a8ec8b04ebf996327694d316c0ff26a20d` | `5887bc3d6ab592ea79d36064c9bf2c7973e35edf` -> `67c8a0436e9c8589b44d524acec8f8fcec89a377` | identical (21) | identical (206 / 106) |
| #5101 | `135b5daaa5a9fa07ad8a36355a1baca1e7d767d7` -> `7b76dda4e9be9ca8c3e29011d128fa68e1634c11` | `135b5daaa5a9fa07ad8a36355a1baca1e7d767d7` -> `cfaba4410fcdf33a1ed0be6d1694d437fb7246cc` | identical (4) | identical (76 / 1) |

The two patch views are byte-identical per PR, so the patches quoted below are the exact public
patches, with no enclosing-merge contamination to discount.

## 2. PR #4584 - treat unknown output caps as unset

### 2.1 Exact upstream patch

The upstream defect was a **generic output ceiling**: `MODEL_SPECS.__default__.maxOutputTokens` was
`8192`, so any model without a declared limit was silently clamped to 8192 output tokens. The pull
request removes that default and makes "unknown" a first-class state.

| Upstream site (at `e9be19a8ec8b04ebf996327694d316c0ff26a20d`) | Before | After |
|---|---|---|
| `src/shared/constants/modelSpecs.ts` - `ModelSpec.maxOutputTokens` | `number` (required) | `number \| undefined` (optional) |
| `src/shared/constants/modelSpecs.ts` - `MODEL_SPECS.__default__` | `{ maxOutputTokens: 8192 }` | `{}` |
| `src/shared/constants/modelSpecs.ts` - `capMaxOutputTokens` | cap = spec ?? 8192; `requested ? Math.min(requested, cap) : cap` | cap = `spec?.maxOutputTokens`; unknown cap returns the requested value, else `undefined` |
| `src/lib/modelCapabilities.ts` - `ResolvedModelCapabilities.maxOutputTokens` | `number` | `number \| null` |
| `src/lib/modelCapabilities.ts` - resolution chain tail | `... ?? MODEL_SPECS.__default__.maxOutputTokens` | `... ?? null` |
| `src/lib/modelCapabilities.ts` - `capMaxOutputTokens` | `Math.min(requested, cap)` against the 8192 default | unknown cap returns `requested` unchanged, else `null` |
| `open-sse/services/reasoningTokenBuffer.ts` | `if (maxOutputTokens === null \|\| maxOutputTokens === DEFAULT_MAX_OUTPUT_TOKENS) return null;` | `if (maxOutputTokens === null) return null;` (the 8192 proxy is dropped) |
| `open-sse/translator/request/claude-to-gemini.ts` | always assigns `generationConfig.maxOutputTokens` | assigns only when the cap is known |
| `open-sse/translator/request/openai-to-gemini.ts` | always assigns `generationConfig.maxOutputTokens` | assigns only when the cap is known |
| `open-sse/translator/request/openai-to-claude.ts` | `FALLBACK_OUTPUT_CAP = 128000` substituted when the cap is unknown | unknown cap means no clamp: `Math.max(callerMaxTokens, 1)` |
| `open-sse/services/combo/comboStructure.ts` | inline `Number.isFinite(cap) && cap < requested` | `exceedsKnownOutputLimit()` - a `null` cap is never a compatibility failure |

Upstream fixture added by the pull request:
`tests/unit/model-capabilities-registry.test.ts` - *"unknown models keep maxOutputTokens null
instead of using a generic default"*, asserting `maxOutputTokens === null` for an unknown model,
`capMaxOutputTokens(model, 32000) === 32000`, and `capMaxOutputTokens(model) === null`.

**Upstream live normalizer.** The function actually consulted at runtime is
`src/lib/modelCapabilities.ts:capMaxOutputTokens`; `src/shared/constants/modelSpecs.ts` supplies the
spec table through `getModelSpec`, and the pull request removes the last reader of
`MODEL_SPECS.__default__` (`open-sse/services/reasoningTokenBuffer.ts`). The translators
`open-sse/translator/request/claude-to-gemini.ts`,
`open-sse/translator/request/openai-to-claude.ts` and
`open-sse/translator/request/openai-to-gemini.ts` are the three runtime consumers.

A file-by-file scan of every upstream `src/` file at the PR head confirms this is the only live
normalizer: `src/shared/constants/modelSpecs.ts` also exports a `capMaxOutputTokens`, but nothing
in `src/` or `open-sse/` imports that copy. The spec module is imported for `getModelSpec`,
`MODEL_SPECS`, `isAdaptiveThinkingOnly` and `normalizeThinkingForModel` only. The two definitions
carry the same post-pull-request semantics (unknown cap returns the requested value, else
`null`/`undefined`), so the distinction does not affect the comparison.

### 2.2 Local normalizer and current behavior

DurinDoor has **no `MODEL_SPECS` table and no generic output ceiling**. The local equivalent of
the upstream cap resolver is a three-stage chain:

1. [`open-sse/providers/capabilities.js`](../../../open-sse/providers/capabilities.js) owns limit
   resolution. `DEFAULT_CAPABILITIES.maxOutput` is `null`
   ([`capabilities.js:63`](../../../open-sse/providers/capabilities.js)), and
   `resolveModelLimits()` returns `{ contextWindow: undefined, maxOutput: undefined, known: false,
   source: "default" }` for a model with no authoritative row
   ([`capabilities.js:1444`](../../../open-sse/providers/capabilities.js),
   [`capabilities.js:1538`](../../../open-sse/providers/capabilities.js)). A curated
   `maxOutput: null` or an unpublished-output policy also leaves the ceiling unknown
   ([`capabilities.js:1352`](../../../open-sse/providers/capabilities.js)).
2. [`open-sse/handlers/chatCore.js`](../../../open-sse/handlers/chatCore.js) freezes the resolved
   ceiling into the request context: `resolveModelLimits(...)` at
   [`chatCore.js:1150`](../../../open-sse/handlers/chatCore.js) ->
   `preflightCaps.maxOutput` at [`chatCore.js:1158`](../../../open-sse/handlers/chatCore.js) ->
   `requestContext.modelCapabilities` at
   [`chatCore.js:1165`](../../../open-sse/handlers/chatCore.js).
3. [`open-sse/executors/base.js`](../../../open-sse/executors/base.js) is the actual clamp. Its
   docstring states the contract explicitly: *"No-op without a known ceiling; never invents absent
   fields."* (`clampCustomMaxOutput`, [`base.js:126`](../../../open-sse/executors/base.js)), invoked
   on every dispatch at [`base.js:439`](../../../open-sse/executors/base.js)). The reservation side
   (`resolveEffectiveOutputReservation`, [`base.js:152`](../../../open-sse/executors/base.js))
   mirrors it: an explicit client value is preserved when no ceiling is known.

[`src/lib/modelCapabilities.js`](../../../src/lib/modelCapabilities.js) is the local counterpart of
upstream's `src/lib/modelCapabilities.ts`. It resolves to `maxOutputTokens: null` for an unknown
model ([`modelCapabilities.js:18`](../../../src/lib/modelCapabilities.js)) and exposes no
`capMaxOutputTokens` export; the clamp lives in the executor instead.

The remaining upstream consumer adaptations all have local counterparts with the same
"unknown means unset" semantics:

| Upstream adaptation | Local counterpart | Local evidence |
|---|---|---|
| `reasoningTokenBuffer.ts` drops the 8192 proxy | [`open-sse/services/reasoningTokenBuffer.js`](../../../open-sse/services/reasoningTokenBuffer.js) | `getExplicitModelOutputCap()` returns `null` when no explicit cap exists ([`reasoningTokenBuffer.js:43`](../../../open-sse/services/reasoningTokenBuffer.js)); `resolveReasoningBufferedMaxTokens` returns `null` on `maxOutput === null` ([`reasoningTokenBuffer.js:119`](../../../open-sse/services/reasoningTokenBuffer.js)). The 8192 proxy never existed locally, so nothing had to be removed. |
| `claude-to-gemini.ts` / `openai-to-gemini.ts` set the field only when the cap is known | [`open-sse/translator/request/claude-to-gemini.js`](../../../open-sse/translator/request/claude-to-gemini.js), [`open-sse/translator/request/openai-to-gemini.js`](../../../open-sse/translator/request/openai-to-gemini.js) | Both carry the caller's explicit value verbatim and leave the field unset when the caller sent none ([`claude-to-gemini.js:43`](../../../open-sse/translator/request/claude-to-gemini.js), [`openai-to-gemini.js:145`](../../../open-sse/translator/request/openai-to-gemini.js)). A *known* cap is applied centrally by `clampCustomMaxOutput`, including both Gemini-envelope shapes ([`base.js:143`](../../../open-sse/executors/base.js)). |
| `comboStructure.ts` never fails a target on an unknown cap | [`open-sse/providers/capabilities.js`](../../../open-sse/providers/capabilities.js) | `minKnownLimit()` skips unknown members and yields `undefined` when every member is unknown ([`capabilities.js:1077`](../../../open-sse/providers/capabilities.js)); `aggregateComboCapabilities` uses it for `maxOutput` ([`capabilities.js:1153`](../../../open-sse/providers/capabilities.js)). Local has no `open-sse/services/combo/comboStructure.js` counterpart - `open-sse/services/combo/` holds only `contextRequirements.js` - so there is no upstream file to port. |

### 2.3 Fixture evidence

Local fixtures that pin this behavior:

| Fixture | What it pins |
|---|---|
| [`tests/unit/context-limit-enforcement.test.js`](../../../tests/unit/context-limit-enforcement.test.js) | `resolveModelLimits` source and honesty; feature-flag-only rows stay `known: false`; Grok's unpublished output ceiling stays unset; and the *"effective output reservation"* block that matches what `clampCustomMaxOutput` actually lets through, including *"reserves nothing without an output request, operator limit, or default"*. |
| [`tests/unit/custom-max-output-ceiling.test.js`](../../../tests/unit/custom-max-output-ceiling.test.js) | A configured ceiling still clamps; a routed provider ceiling above the bare fallback is preserved; an explicit client value under the cap is kept. |
| [`tests/unit/custom-caps-executor-matrix.test.js`](../../../tests/unit/custom-caps-executor-matrix.test.js) | The executor clamp matrix for `max_tokens` and for the Gemini `generationConfig.maxOutputTokens` envelope. |
| [`internal/docs/product/reference/model-limits.mdx`](../product/reference/model-limits.mdx) | The documented contract: *"Numeric limits must not come from transport defaults or compaction thresholds"* and *"Preserve explicit false and null, unknown output ceilings"*. |

Offline probe against the working tree (`node --input-type=module`, no network, no provider call),
with `modelCapabilities.maxOutput` driven directly and `max_output_tokens: 32000` in the body:

```
resolveModelLimits("openai-compatible-local", "custom-large-output-model")
  -> { known: false, source: "default" }            # maxOutput absent, not 8192
getCapabilitiesForModel("openai-compatible-local", "custom-large-output-model").maxOutput
  -> null
getResolvedModelCapabilities("openai-compatible-local/custom-large-output-model")
  -> { provider, model, maxOutputTokens: null }
clampCustomMaxOutput(body, { modelCapabilities: { maxOutput: undefined } })
  -> { model, max_output_tokens: 32000 }            # explicit value preserved, no clamp
clampCustomMaxOutput(body, { modelCapabilities: { maxOutput: 4096 } })
  -> { model, max_output_tokens: 4096 }             # configured limit still respected
clampCustomMaxOutput(body, { modelCapabilities: { maxOutput: 64000 } })
  -> { model, max_output_tokens: 32000 }            # explicit value under the cap is kept
resolveEffectiveOutputReservation({ max_output_tokens: 32000 }, { maxOutput: undefined })
  -> 32000
resolveEffectiveOutputReservation({ max_output_tokens: 32000 }, { maxOutput: 4096 })
  -> 4096
```

### 2.4 Disposition

**Already covered - behavioral parity on the scoped OpenAI-compatible Responses surface. No code
change.**

The upstream defect (a generic 8192 output ceiling silently clamping unknown models) does not
exist in DurinDoor. The local normalizer resolves an unknown ceiling to "unset", the clamp is a
documented no-op without a known ceiling, and an explicit client value survives while an
operator-configured ceiling still applies. Every upstream consumer adaptation in the pull request
has a local counterpart with the same semantics, and the one upstream file with no local
counterpart (`comboStructure.ts`) is already satisfied by `minKnownLimit`.

### 2.5 Out-of-scope observation (recorded, not dispositioned)

Upstream's `open-sse/translator/request/openai-to-claude.ts` also removed a hardcoded
`FALLBACK_OUTPUT_CAP = 128000` so that an unknown-cap model on the **Claude** translation path is
left unclamped. The local counterpart,
[`open-sse/translator/request/openai-to-claude.js`](../../../open-sse/translator/request/openai-to-claude.js),
has no such constant; it resolves `modelCeiling` from the catalog
([`openai-to-claude.js:44`](../../../open-sse/translator/request/openai-to-claude.js)) and, for an
unknown model, falls through to `adjustMaxTokens`'s transport default
([`open-sse/translator/formats/maxTokens.js:13`](../../../open-sse/translator/formats/maxTokens.js),
[`open-sse/config/runtimeConfig.js:171`](../../../open-sse/config/runtimeConfig.js) ->
`DEFAULT_MAX_TOKENS = 64000`), which acts as a ceiling at
[`maxTokens.js:31`](../../../open-sse/translator/formats/maxTokens.js).

This is **outside the compared surface**: the OpenAI-compatible Responses path is dispatched by
`DefaultExecutor` plus `BaseExecutor.clampCustomMaxOutput`, never by the Claude translator, and
`DEFAULT_MAX_TOKENS` is a transport request default that the local reference document classifies
as request configuration rather than a model capacity
([`model-limits.mdx`](../product/reference/model-limits.mdx)). It is recorded here so a later
reader can see the one place where upstream's post-patch Claude-path semantics differ. It is not
claimed as a port gap and no acceptance is asserted for it.

## 3. PR #5101 - default `text.format` for openai-compatible Responses providers

### 3.1 Exact upstream patch

Upstream added a 17-line method to `open-sse/executors/default.ts` and calls it from
`transformRequest`, immediately after `applyJsonSchemaFallback`:

```ts
defaultResponsesTextFormat<T>(body: T): T {
  if (!this.provider?.startsWith?.("openai-compatible-")) return body;
  if (!this.provider.includes("responses")) return body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const record = body as Record<string, unknown>;
  const text = record.text;
  if (!text || typeof text !== "object" || Array.isArray(text)) return body;
  const textRecord = text as Record<string, unknown>;
  if (textRecord.format !== undefined) return body;
  return { ...record, text: { ...textRecord, format: { type: "text" } } } as T;
}
```

The guard set is: provider id starts with `openai-compatible-`; provider id contains `responses`;
`text` is a plain object; and an existing `text.format` is never overwritten. The remaining
changes in the pull request are a `CHANGELOG.md` entry and a file-size rebaseline
(`config/quality/file-size-baseline.json`, `open-sse/executors/default.ts` 859 -> 876) for the
upstream file-size gate.

Upstream fixture added by the pull request:
`tests/unit/responses-default-text-format.test.ts` - six cases: defaults the format when `text` is
an object without one; defaults it when `text` is an empty object; does not overwrite an existing
format; no-op when there is no `text` field; does not default for a non-responses openai-compatible
provider; does not default for a non-openai-compatible provider ("Codex" guard).

### 3.2 Local normalizer and current behavior

[`open-sse/executors/default.js`](../../../open-sse/executors/default.js) already carries the same
method with the same guard set:

| Guard | Upstream | Local |
|---|---|---|
| provider prefix | `this.provider?.startsWith?.("openai-compatible-")` | identical ([`default.js:552`](../../../open-sse/executors/default.js)) |
| responses surface | `this.provider.includes("responses")` | identical ([`default.js:553`](../../../open-sse/executors/default.js)) |
| `text` is a plain object | `typeof text !== "object" \|\| Array.isArray(text)` | `!isObject(text) \|\| Array.isArray(text)` ([`default.js:555`](../../../open-sse/executors/default.js)) |
| never overwrite | `if (textRecord.format !== undefined) return body;` | identical ([`default.js:556`](../../../open-sse/executors/default.js)) |
| fill value | `format: { type: "text" }` | identical ([`default.js:557`](../../../open-sse/executors/default.js)) |
| call site | `transformRequest`, after `applyJsonSchemaFallback` | `transformRequest`, after `applyJsonSchemaFallback` ([`default.js:379`](../../../open-sse/executors/default.js) -> [`default.js:414`](../../../open-sse/executors/default.js)) |

Two implementation differences, neither observable on the wire:

1. Upstream returns a new body object; the local method mutates `body.text` in place and returns
   `undefined`, and the local call site does not assign a result
   ([`default.js:414`](../../../open-sse/executors/default.js)). The forwarded body is the same
   object in both cases.
2. Upstream's method begins with an explicit `!body || typeof body !== "object" || Array.isArray(body)`
   guard. The local method does not, so a direct call with a null body would throw. The only local
   caller is the `transformRequest` call site, which is inside `if (transformed && isObject(transformed))`
   ([`default.js:392`](../../../open-sse/executors/default.js)), so a non-object body is not
   reachable through the request path, and no local caller invokes the method directly.

The upstream file-size rebaseline has no local counterpart: the fork has no `config/` directory and
no file-size baseline gate, so that part of the patch is not applicable.

### 3.3 Fixture evidence

Local fixture: [`tests/unit/openai-compat-responses-text-format.test.js`](../../../tests/unit/openai-compat-responses-text-format.test.js)
(five cases, filed under the fork's own issue `#2093`). It covers: the default fill; an existing
format preserved by identity; no `text` field; a non-responses openai-compatible provider left
untouched; and a non-object `text` value ignored.

The two upstream cases the local file does not name were checked offline against the local
implementation, which satisfies both:

```
run("openai-compatible-responses-lmstudio", { input: "Say OK", text: {} })
  -> { "format": { "type": "text" } }                # upstream case: empty text object
run("openai", { messages: [...], text: { verbosity: "medium" } })
  -> { "verbosity": "medium" }                        # upstream case: Codex guard
run("openai-compatible-responses-lmstudio", { input: "Say OK" })
  -> undefined                                       # upstream case: no text field
run("openai-compatible-responses-lmstudio", { input: "x", text: { format: { type: "json_schema", name: "x" } } })
  -> { "format": { "type": "json_schema", "name": "x" } }   # existing format preserved
run("openai-compatible-chat-1234", { messages: [], text: { verbosity: "medium" } })
  -> { "verbosity": "medium" }                        # non-responses provider untouched
```

### 3.4 Disposition

**Already covered - behavioral parity, with a narrower local fixture file. No code change.**

All six upstream fixture behaviors are satisfied by the local implementation. The local fixture
file names five of the six cases explicitly and adds one case the upstream file does not have
(a non-object `text` value); the two remaining upstream cases are satisfied by the implementation
and are evidenced by the offline probe above. The upstream `CHANGELOG.md` entry and file-size
rebaseline are upstream-release bookkeeping and have no local counterpart to update.

## 4. Ordinary offline acceptance

Both dispositions are re-established with the following offline checks. None of them needs a
credential, a provider request, a browser, Docker, or an e2e run.

```bash
# from the repository root
npm install --no-audit --no-fund
cd tests && npm install && cd ..

# focused fixture run for both dispositions
cd tests
npx vitest run --reporter=verbose \
  unit/openai-compat-responses-text-format.test.js \
  unit/context-limit-enforcement.test.js \
  unit/custom-max-output-ceiling.test.js \
  unit/custom-caps-executor-matrix.test.js
```

Observed result on the reviewed tree: **4 files passed, 27 tests passed, 0 failed.**

The read-only probes quoted in sections 2.3 and 3.3 are reproduced with
`node --input-type=module` against the working tree, importing
`open-sse/providers/capabilities.js`, `open-sse/executors/base.js`,
`open-sse/executors/default.js` and `src/lib/modelCapabilities.js` directly. They read the
working tree and change no file.

## 5. Boundaries observed

| Constraint | How it was honored |
|---|---|
| Exact PR head/base | Both heads and both enclosing merges are pinned in section 1.1; the head diff and the squash diff were compared and are identical per PR (section 1.2). |
| Compare only existing OpenAI-compatible Responses | Section 2 compares the unknown-cap resolution and the `text.format` default on that surface. The Claude translation path is recorded separately in section 2.5 as out of scope. |
| Respect configured limits and explicit values | Both are asserted by probe and fixture: a configured ceiling still clamps (32000 -> 4096), and an explicit client value survives when no ceiling is known. |
| Confirm the actual normalizer | The live chain is named for each PR in sections 2.2 and 3.2, with the call sites and the clamp point. |
| Confirm fixture scope | Local fixture files are listed with what each pins in sections 2.3 and 3.3, including the two upstream cases the local file does not name. |
| Exclude broad inference or feature additions | No provider, model, model-list, or inference capability was added or proposed. The only upstream files not ported are upstream release bookkeeping (`CHANGELOG.md`, the file-size baseline) and one upstream-only file with no local counterpart. |
| No provider requests | No upstream endpoint was called. The upstream repository was read as a local bare mirror only. |
| Files written | This report only. No product code, test, workflow, `AGENTS.md`, or baseline file was changed. |
