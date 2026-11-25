# #1073 March OmniRoute existing-provider transport comparison

Comparison scope: the four recovered March merge records in `/var/tmp/durindoor-omni-early-metadata.gnjcuh68/2026-03.json`. The upstream head and merge OIDs below are pinned independently; the listed patch paths are from those merged PRs. Local evidence names current DurinDoor paths and offline fixtures. No provider or paid request was made.

## Dispositions

### [#311](https://github.com/cheaper-inference/OmniRoute/pull/311) — Claude extended context `[1m]`

- **Pins:** head `623c63baf6665d84f7595e4e4c0dd4d0e2f6d810`; merge `d87c7c3b8ce58c5b56acfda8e76f68915e27026a`.
- **Exact upstream patch paths:** `open-sse/executors/base.ts`, `open-sse/handlers/chatCore.ts`, `open-sse/services/model.ts`, `src/sse/handlers/chat.ts`, `src/sse/services/model.ts`. Patch parses a trailing `[1m]`, carries an `extendedContext` request flag, and conditionally adds Anthropic's context beta for the listed Claude models.
- **Current equivalent paths:** `open-sse/services/model.js` (`parseModel`/`getModelInfoCore`); `open-sse/handlers/chatCore.js` transport selection and request shaping; `open-sse/executors/base.js` header overlay; `src/sse/services/model.js` routability; Claude Code model projection/decoding in `src/shared`.
- **Offline fixtures:** `tests/unit/claude-code-compat.test.js` checks `[1m]` model projection/decoding; `tests/unit/claude-model-routability.test.js` checks routability of the documented GLM `[1m]` form; `tests/unit/chat-policy-sequence.test.js` checks the context beta header after Claude Code model decoding.
- **Disposition — existing-runtime behavior is substantially covered, exact contract has a gap.** Current compatibility tests cover Claude Code `[1m]` routing and a beta-header path, but do not establish the upstream contract: a Claude model suffix survives model resolution as an explicit context request, is constrained to the upstream-supported Claude model set, and adds the beta to an existing Anthropic header without duplication. This is a feature on an existing provider, not a new provider or sign-in flow. **Focused implementation unit:** add suffix-aware model metadata and executor header propagation for the supported Claude model IDs; add offline cases for parsing/canonicalization, supported versus unsupported model IDs, existing beta-header merge, and a request without the suffix.

### [#368](https://github.com/cheaper-inference/OmniRoute/pull/368) — advertise Codex GPT-5.4

- **Pins:** head `8f2c0acc7e2fa973ae10d9e69db2c424348e8a41`; merge `ca7854210da89ba57b460651a6b7f4741e3c8b3d`.
- **Exact upstream patch paths:** `open-sse/config/providerRegistry.ts`, `tests/unit/plan3-p0.test.mjs`. The patch adds `gpt-5.4` to the Codex registry and asserts bare model resolution to Codex.
- **Current equivalent paths:** `open-sse/providers/registry/codex.js` includes `gpt-5.4`; shared model resolution is in `open-sse/services/model.js`, with registry-derived catalog/model routes.
- **Offline fixtures:** `tests/unit/model-routing.test.js` covers model routing; `tests/unit/models-export-surface.test.js` and `tests/unit/model-exposure-list.test.js` cover catalog/export surfaces. The concrete Codex registry entry is local evidence for the added model.
- **Disposition — already present; no qualifying gap.** The exact Codex registry model from the patch is present in the current registry and the existing offline model-routing/catalog fixtures cover the relevant resolution and exposure surfaces. This is catalog parity for an existing provider, not a new provider or authentication flow; no implementation unit is indicated.

### [#387](https://github.com/cheaper-inference/OmniRoute/pull/387) — preserve native Responses requests to Codex

- **Pins:** head `271f5f9c644478cfb1bd818e7227c4c6d3ef9ca3`; merge `d81a7bcedfb69166d7222affa5a5484698a1f57d`.
- **Exact upstream patch paths:** `open-sse/executors/codex.ts`, `open-sse/handlers/chatCore.ts`, `tests/unit/plan3-p0.test.mjs`. The patch selects native Responses passthrough for Codex Responses requests, bypasses compatibility translation/mutations, and lets the executor keep only its required stream/tier handling while skipping other compatibility rewrites.
- **Current equivalent paths:** `open-sse/handlers/chatCore.js` detects native passthrough (`isNativePassthrough`) and takes a cloned, lossless request path; Codex-only additional-tools normalization and negotiated stream handling are explicit. `open-sse/executors/codex.js` handles Codex wire requirements. `open-sse/utils/clientDetector.js` defines the native-client classification.
- **Offline fixtures:** `tests/unit/force-stream-config.test.js` checks stream synchronization on native Codex passthrough; `tests/unit/codex-toolcall-arguments-json.test.js` covers preservation of native Responses tool arguments; `tests/unit/codex-effort-model-echo-6820.test.js` covers Codex client recognition/response identity; `tests/unit/codex-alpha-search.test.js` exercises Responses routing through the handler.
- **Disposition — existing-runtime fix covered by the current transport architecture.** The upstream marker-based branch is implemented locally as provider/client native passthrough selection with a cloned body and narrowly scoped documented rewrites. Offline fixtures cover stream handling, tool-call payloads, and native Codex routing. The mechanism differs, but the target behavior is represented; no new provider or sign-in flow is involved and no focused implementation unit is indicated.

### [#478](https://github.com/cheaper-inference/OmniRoute/pull/478) — remove synthetic top-level model from Kiro payload

- **Pins:** head `1d8f8a6f38d6b487f1e41790c3790dcdc50682a4`; merge `801b4eef4c388b97560088aec36dde004990c9bc`.
- **Exact upstream patch path:** `open-sse/executors/kiro.ts`. It removes the injected top-level `model` before sending the translated native Kiro body.
- **Current equivalent paths:** `open-sse/handlers/chatCore.js` deliberately skips adding `translatedBody.model` when `targetFormat === FORMATS.KIRO`; `open-sse/translator/request/openai-to-kiro.js` places the wire model in Kiro's nested user-input structure. `open-sse/executors/kiro.js` applies gateway-specific request shaping and session affinity.
- **Offline fixtures:** `tests/unit/openai-to-kiro.test.js` covers translated Kiro request shape and rejects stray top-level reasoning fields; `tests/unit/kiro-outbound-validation.test.js` validates outbound Kiro structure; `tests/unit/kiro-session-affinity.test.js` exercises executor transformation. The executor fixture's literal `{ model: "m" }` pass-through is intentional in this architecture: `chatCore` prevents synthetic top-level model injection before the executor.
- **Disposition — existing-runtime fix covered at the earlier injection boundary.** Current chat-core avoids the defect rather than deleting the field in the executor, and the native translator and outbound validation fixtures cover the nested Kiro model shape. No new provider or authentication flow is involved; no focused implementation unit is indicated. The executor fixture alone would not prove absence of injection, so the disposition relies on the explicit `targetFormat !== FORMATS.KIRO` guard in `chatCore.js`.

## Classification

These rows concern behavior or model exposure on existing Claude, Codex, and Kiro providers. None adds a provider or changes a sign-in/authentication flow. #311 is a feature gap in an existing provider's extended-context option; the other three are already represented in current runtime paths and offline evidence. No Provider Sign-in work is identified.
