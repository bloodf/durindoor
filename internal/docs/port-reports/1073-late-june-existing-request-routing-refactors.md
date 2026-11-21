# #1073 — Late-June request-routing extraction refactors

## Scope and exact pins

This review evaluates four late-June OmniRoute pull requests from the `#3501` `chatCore` god-file decomposition series against current DurinDoor request-routing architecture, transport resolution, and offline test coverage.

| Source PR | Exact PR head | PR base / parent | Enclosing merge | Landed patch scope |
| --- | --- | --- | --- | --- |
| [OmniRoute #4477](https://github.com/cheaper-inference/OmniRoute/pull/4477) | [`16d784f2f50f42ffca7db845b624a8889ba85452`](https://github.com/cheaper-inference/OmniRoute/commit/16d784f2f50f42ffca7db845b624a8889ba85452) | `1e726435953d5cfff88466b7fa58cb95befe5243` (head parent); `3b69960b3b4bd6263015b9c6d1bafc04c241be97` (merge parent) | [`e95fab8bbefbfd5eb82558fca4c6c994ca1a74cb`](https://github.com/cheaper-inference/OmniRoute/commit/e95fab8bbefbfd5eb82558fca4c6c994ca1a74cb) | `open-sse/handlers/chatCore.ts`, `open-sse/handlers/chatCore/serviceTier.ts`, `tests/unit/chatcore-service-tier.test.ts` (`+150 / -37`) |
| [OmniRoute #4526](https://github.com/cheaper-inference/OmniRoute/pull/4526) | [`17738682d27428a8f4a2cd2dac4fef98af2c8bfe`](https://github.com/cheaper-inference/OmniRoute/commit/17738682d27428a8f4a2cd2dac4fef98af2c8bfe) | `b28f6e93464f8a626c29ead13203984e7f073be2` (head and merge parent) | [`2601a557b85e07b91bf171adeed66fdd4e09235b`](https://github.com/cheaper-inference/OmniRoute/commit/2601a557b85e07b91bf171adeed66fdd4e09235b) | `open-sse/handlers/chatCore.ts`, `open-sse/handlers/chatCore/backgroundRedirect.ts`, `tests/unit/chatcore-background-redirect.test.ts` (`+139 / -33`) |
| [OmniRoute #4538](https://github.com/cheaper-inference/OmniRoute/pull/4538) | [`b0da0c8c61020e31b2121cb8171dfc6664348be8`](https://github.com/cheaper-inference/OmniRoute/commit/b0da0c8c61020e31b2121cb8171dfc6664348be8) | `686371849450dd3797aa65faada8c0d3853f744c` (branch parent); `3ffd6ffff1d3887ee3ac22c6cdf692e8f8c61527` (PR base / merge parent) | [`05c0c4e4007a88c128ec172e6f6af70b866cf566`](https://github.com/cheaper-inference/OmniRoute/commit/05c0c4e4007a88c128ec172e6f6af70b866cf566) | `open-sse/handlers/chatCore.ts`, `open-sse/handlers/chatCore/keyHealth.ts`, `open-sse/handlers/chatCore/targetFormat.ts`, `tests/unit/chatcore-key-health.test.ts`, `tests/unit/chatcore-target-format.test.ts` (`+292 / -70` clean PR delta) |
| [OmniRoute #4571](https://github.com/cheaper-inference/OmniRoute/pull/4571) | [`14ff6711b13dfaaacf70ba68afe70823448c1dfe`](https://github.com/cheaper-inference/OmniRoute/commit/14ff6711b13dfaaacf70ba68afe70823448c1dfe) | `be78e05925ba1e1190ebd2d307e05f5abde44a10` (head and merge parent) | [`619c2eaaeb358cf447a97838eaedc774976046f1`](https://github.com/cheaper-inference/OmniRoute/commit/619c2eaaeb358cf447a97838eaedc774976046f1) | `open-sse/handlers/chatCore.ts`, 6 pure leaves (`cacheUsageMeta.ts`, `executorClientHeaders.ts`, `nonStreamingResponseBody.ts`, `skillsFormat.ts`, `streamErrorResult.ts`, `streamFinalize.ts`), 6 characterization test files (`+582 / -243`) |

### Patch provenance notes

- For [#4477](https://github.com/cheaper-inference/OmniRoute/pull/4477), head [`16d784f2f50f42ffca7db845b624a8889ba85452`](https://github.com/cheaper-inference/OmniRoute/commit/16d784f2f50f42ffca7db845b624a8889ba85452) extracted inline Codex service-tier resolvers into `open-sse/handlers/chatCore/serviceTier.ts`. The enclosing merge [`e95fab8bbefbfd5eb82558fca4c6c994ca1a74cb`](https://github.com/cheaper-inference/OmniRoute/commit/e95fab8bbefbfd5eb82558fca4c6c994ca1a74cb) lands the exact same three code/test files with identical patch contents.
- For [#4526](https://github.com/cheaper-inference/OmniRoute/pull/4526), head [`17738682d27428a8f4a2cd2dac4fef98af2c8bfe`](https://github.com/cheaper-inference/OmniRoute/commit/17738682d27428a8f4a2cd2dac4fef98af2c8bfe) extracted the Background Task Redirection (T41) decision into `open-sse/handlers/chatCore/backgroundRedirect.ts`. The enclosing merge [`2601a557b85e07b91bf171adeed66fdd4e09235b`](https://github.com/cheaper-inference/OmniRoute/commit/2601a557b85e07b91bf171adeed66fdd4e09235b) lands the exact three files.
- For [#4538](https://github.com/cheaper-inference/OmniRoute/pull/4538), PR head [`b0da0c8c61020e31b2121cb8171dfc6664348be8`](https://github.com/cheaper-inference/OmniRoute/commit/b0da0c8c61020e31b2121cb8171dfc6664348be8) merged `origin/release/v3.8.33` into `pr4538` (`686371849450dd3797aa65faada8c0d3853f744c`), bringing in 43 unrelated release-branch commits. However, the enclosing squash merge [`05c0c4e4007a88c128ec172e6f6af70b866cf566`](https://github.com/cheaper-inference/OmniRoute/commit/05c0c4e4007a88c128ec172e6f6af70b866cf566) onto base `3ffd6ffff1d3887ee3ac22c6cdf692e8f8c61527` cleanly isolates the actual PR delta: recovering `keyHealth.ts` and `targetFormat.ts` (with `requestFormat.ts` and `claudeEffortVariant.ts` having already been landed via `#4547`). The clean diff `3ffd6ffff1d3887ee3ac22c6cdf692e8f8c61527..05c0c4e4007a88c128ec172e6f6af70b866cf566` contains only the two new leaves, their tests, and thin binding call sites in `chatCore.ts`.
- For [#4571](https://github.com/cheaper-inference/OmniRoute/pull/4571), head [`14ff6711b13dfaaacf70ba68afe70823448c1dfe`](https://github.com/cheaper-inference/OmniRoute/commit/14ff6711b13dfaaacf70ba68afe70823448c1dfe) moved 11 module-level helper functions into 6 leaves. The enclosing squash merge [`619c2eaaeb358cf447a97838eaedc774976046f1`](https://github.com/cheaper-inference/OmniRoute/commit/619c2eaaeb358cf447a97838eaedc774976046f1) onto `be78e05925ba1e1190ebd2d307e05f5abde44a10` lands the exact 13 files without modification.

---

## Summary of dispositions

| Source PR | Subject | Disposition |
| --- | --- | --- |
| [OmniRoute #4477](https://github.com/cheaper-inference/OmniRoute/pull/4477) | `refactor(chatCore): extrai resolvers de service-tier do Codex para leaf puro (#3501)` | **Behavior-unchanged upstream refactor of Codex service-tier closures; no port.** DurinDoor's service-tier handling is owned by `open-sse/config/serviceTier.js`, `open-sse/translator/concerns/thinkingSuffix.js`, and `open-sse/handlers/chatCore.js`. |
| [OmniRoute #4526](https://github.com/cheaper-inference/OmniRoute/pull/4526) | `refactor(chatCore): extrai decisão de Background Task Redirect (T41) (#3501)` | **Excluded — outside current policy; background task redirection absent locally.** Background task heuristics and silent model degradation are outside local policy; DurinDoor preserves explicit model routing without opportunistic degradation. |
| [OmniRoute #4538](https://github.com/cheaper-inference/OmniRoute/pull/4538) | `refactor(chatCore): recupera os 4 leaves perdidos no churn de merge (key-health, request-format, claude-effort, target-format) (#3501)` | **Behavior-unchanged upstream recovery of key-health and target-format leaves; no port.** Key-health multi-key rotation is absent locally; target-format and runtime transport resolution are unified in `resolveRequestTransport` and `open-sse/services/provider.js`. |
| [OmniRoute #4571](https://github.com/cheaper-inference/OmniRoute/pull/4571) | `refactor(chatCore): extrai 11 helpers de nível superior para 6 leaves puros (#3501)` | **Behavior-unchanged upstream extraction of 11 module helpers into 6 pure leaves; no port.** The extracted helpers either belong to subsystems absent locally (skills injection, semaphore capacity errors, `_omniroute` telemetry metadata) or are already modularized across local handlers (`nonStreamingHandler.js`, `sseToJsonHandler.js`, `streamingHandler.js`, `error.js`). |

---

## 1. OmniRoute #4477 — Codex service-tier resolvers extraction

### Exact pins

- PR: [OmniRoute #4477](https://github.com/cheaper-inference/OmniRoute/pull/4477)
- Exact head: [`16d784f2f50f42ffca7db845b624a8889ba85452`](https://github.com/cheaper-inference/OmniRoute/commit/16d784f2f50f42ffca7db845b624a8889ba85452)
- Head parent: `1e726435953d5cfff88466b7fa58cb95befe5243`
- Merge parent: `3b69960b3b4bd6263015b9c6d1bafc04c241be97`
- Enclosing merge: [`e95fab8bbefbfd5eb82558fca4c6c994ca1a74cb`](https://github.com/cheaper-inference/OmniRoute/commit/e95fab8bbefbfd5eb82558fca4c6c994ca1a74cb)

### Source patch contract

OmniRoute had two inline closures at the top of `handleChatCore`:
- `resolveEffectiveServiceTier(provider, providerSpecificData, body)`: Returns `"standard"` if `provider !== "codex"`. If `provider === "codex"`, reads `body.service_tier`, normalizes it via `normalizeCodexServiceTier`, and falls back to `getCodexRequestDefaults(providerSpecificData)?.serviceTier || "standard"`.
- `resolveReportedServiceTier(provider, payload, maxDepth = 3)`: Returns `null` if `provider !== "codex"` or payload is non-object. Otherwise reads `payload.service_tier` or recursively descends into `payload.response` up to `maxDepth` levels.

PR `#4477` moved these closures into `open-sse/handlers/chatCore/serviceTier.ts` as pure exported functions, leaving thin delegating closures in `chatCore.ts`. This was a pure structural extraction without behavioral modification.

### Current local ownership and fixture evidence

DurinDoor does not define inline Codex closures or recursive payload resolvers in `chatCore.js`. Instead, service-tier handling in DurinDoor is model-modifier-driven and provider-scoped:

- **Provider qualification**: [`open-sse/config/serviceTier.js`](../../../open-sse/config/serviceTier.js#L27-L34) exports `supportsServiceTier(providerOrAlias)`, restricting `service_tier` to `SERVICE_TIER_PROVIDER_IDS = new Set(["openai", "codex"])`. For all other providers, parenthesized tier suffixes remain part of the opaque model ID.
- **Model modifier parsing**: [`open-sse/translator/concerns/thinkingSuffix.js`](../../../open-sse/translator/concerns/thinkingSuffix.js#L63-L77) implements `parseModelModifiers`, parsing `(fast)` to `serviceTier: "priority"` and `(standard)` to `serviceTier: "default"` only when `tierApplies(provider)` is true.
- **Outbound body assignment**: In [`open-sse/handlers/chatCore.js`](../../../open-sse/handlers/chatCore.js#L864-L867), explicit service tiers are assigned to `translatedBody.service_tier` only on supported transports:
  ```javascript
  if (supportsServiceTier(provider) && parsedModel.serviceTier &&
      (finalFormat === FORMATS.OPENAI || finalFormat === FORMATS.OPENAI_RESPONSES)) {
    translatedBody.service_tier = parsedModel.serviceTier;
  }
  ```
- **Checked-in fixture evidence**: [`tests/unit/provider-service-tier-suffix-scope.test.js`](../../../tests/unit/provider-service-tier-suffix-scope.test.js#L53-L177) verifies `supportsServiceTier` and `parseModelModifiers`, ensuring `model(fast)` maps `serviceTier: "priority"` for `codex` and `openai` while leaving suffixes on other providers untouched.

### Disposition

**Behavior-unchanged upstream refactor of Codex service-tier closures; no port.** PR `#4477` is an internal extraction of Codex-specific closures in OmniRoute. DurinDoor's service-tier architecture is owned by `open-sse/config/serviceTier.js`, `open-sse/translator/concerns/thinkingSuffix.js`, and `open-sse/handlers/chatCore.js`. No port or behavior gap.

---

## 2. OmniRoute #4526 — Background Task Redirection extraction

### Exact pins

- PR: [OmniRoute #4526](https://github.com/cheaper-inference/OmniRoute/pull/4526)
- Exact head: [`17738682d27428a8f4a2cd2dac4fef98af2c8bfe`](https://github.com/cheaper-inference/OmniRoute/commit/17738682d27428a8f4a2cd2dac4fef98af2c8bfe)
- Head and merge parent: `b28f6e93464f8a626c29ead13203984e7f073be2`
- Enclosing merge: [`2601a557b85e07b91bf171adeed66fdd4e09235b`](https://github.com/cheaper-inference/OmniRoute/commit/2601a557b85e07b91bf171adeed66fdd4e09235b)

### Source patch contract

PR `#4526` extracts OmniRoute's Background Task Redirection (T41) logic from the top of `handleChatCore` into `open-sse/handlers/chatCore/backgroundRedirect.ts`:
- `resolveBackgroundTaskRedirect({ body, headers, model })`: Checks `getBackgroundDegradationConfig().enabled`. If enabled and `getBackgroundTaskReason(body, headers)` detects a background task (e.g., `x-task-type: background` header or `max_tokens <= 10`), it checks `getDegradedModel(model)`. If the degraded model differs from the requested model, it returns `{ backgroundReason, redirect: { degradedModel, reason } }`.
- `chatCore.ts`: Updates `model` and `body.model` to `degradedModel`, logs `BACKGROUND`, and records an audit event (`routing.background_task_redirect`).

### Current local ownership and fixture evidence

- **Outside current policy**: Background task redirection and opportunistic model degradation based on request heuristics are intentionally absent in DurinDoor.
- **Model routing ownership**: In DurinDoor, incoming requests route strictly to the requested model (or operator-configured model alias pattern/targets if defined in `open-sse/config/providerModels.js`). DurinDoor does not inspect request characteristics (such as low token limits or background headers) to opportunistically downgrade model execution.
- **Audit and configuration**: DurinDoor maintains no `backgroundTaskDetector` service, degradation configuration, or background redirection audit actions.

### Disposition

**Excluded — outside current policy; background task redirection absent locally.** PR `#4526` extracts a feature that silently downgrades model selection based on background heuristics. In accordance with local routing policy, background redirection is marked outside current policy. DurinDoor preserves explicit model routing without opportunistic degradation.

---

## 3. OmniRoute #4538 — Restoration of key-health and target-format leaves

### Exact pins

- PR: [OmniRoute #4538](https://github.com/cheaper-inference/OmniRoute/pull/4538)
- Exact head: [`b0da0c8c61020e31b2121cb8171dfc6664348be8`](https://github.com/cheaper-inference/OmniRoute/commit/b0da0c8c61020e31b2121cb8171dfc6664348be8)
- PR base / merge parent: `3ffd6ffff1d3887ee3ac22c6cdf692e8f8c61527`
- Enclosing merge: [`05c0c4e4007a88c128ec172e6f6af70b866cf566`](https://github.com/cheaper-inference/OmniRoute/commit/05c0c4e4007a88c128ec172e6f6af70b866cf566)

### Source patch contract

Due to merge churn in OmniRoute's `release/v3.8.33` branch, four leaves had been orphaned. Because `requestFormat.ts` and `claudeEffortVariant.ts` were already restored via PR `#4547`, PR `#4538`'s clean delta on top of base `3ffd6ffff1d3887ee3ac22c6cdf692e8f8c61527` recovered the remaining two leaves:
1. `open-sse/handlers/chatCore/keyHealth.ts`:
   - Extracts `recordKeyHealthStatus(status, creds, log)`: tracks extra API keys via `apiKeyRotator`. On 401, calls `recordKeyFailure(connId, currentKeyId)` and persists health to DB; on 2xx, calls `recordKeySuccess(connId, currentKeyId)` when previous status was `"warning"` or `"invalid"`.
2. `open-sse/handlers/chatCore/targetFormat.ts`:
   - Extracts `resolveChatCoreTargetFormat({ provider, resolvedModel, apiFormat, customModelTargetFormat, providerSpecificData })`: returns `{ alias, targetFormat }`, forcing `OPENAI_RESPONSES` if `apiFormat === "responses"`, else resolving model-specific format, custom format, or provider default format.

### Current local ownership and fixture evidence

- **Key health / rotation**: DurinDoor does not contain `apiKeyRotator`, multi-key connection arrays, or in-memory key health state machines inside `chatCore.js`. Connection lifecycle and failure recovery in DurinDoor are managed at the connection/account boundary via `open-sse/services/accountFallback.js` and provider executors.
- **Target format and transport resolution**: In DurinDoor, format resolution is not a detached 3-tier fallback; it is tightly coupled with runtime transport resolution. [`open-sse/handlers/chatCore.js`](../../../open-sse/handlers/chatCore.js#L171-L207) defines `resolveRequestTransport`:
  - Determines `forceOpenCodeMuseResponses` via `isOpenCodeMuse`.
  - Checks `getModelSupportedFormats(alias, model)` and client tool constraints (e.g. `needsNativeServerTools`, `responsesClientsOnly`, `nativeMiniMax`).
  - Calls `resolveTransport(provider, preferredFormat)` using provider and credential metadata from [`open-sse/services/provider.js`](../../../open-sse/services/provider.js#L135-L157).
  - Synthesizes runtime transports for custom OpenAI-compatible endpoints when needed.
- **Checked-in fixture evidence**:
  - [`tests/unit/ollama-claude-regression.test.js`](../../../tests/unit/ollama-claude-regression.test.js#L165-L180) and [`tests/unit/omniroute-missing-api-cloud-providers.test.js`](../../../tests/unit/omniroute-missing-api-cloud-providers.test.js#L170-L175) verify `getTargetFormat` and credential override behavior.
  - [`tests/unit/public-route-tool-conformance-1089.test.js`](../../../tests/unit/public-route-tool-conformance-1089.test.js#L90-L130) verifies endpoint format detection and tool conformance.

### Disposition

**Behavior-unchanged upstream recovery of key-health and target-format leaves; no port.** PR `#4538` recovers the extraction of `keyHealth` and `targetFormat` leaves. `keyHealth` relies on an API key rotator infrastructure absent in DurinDoor. `targetFormat` in DurinDoor is integrated with runtime transport resolution (`resolveRequestTransport`) in `open-sse/handlers/chatCore.js`. No behavior change or port needed.

---

## 4. OmniRoute #4571 — Extraction of 11 module helpers into 6 pure leaves

### Exact pins

- PR: [OmniRoute #4571](https://github.com/cheaper-inference/OmniRoute/pull/4571)
- Exact head: [`14ff6711b13dfaaacf70ba68afe70823448c1dfe`](https://github.com/cheaper-inference/OmniRoute/commit/14ff6711b13dfaaacf70ba68afe70823448c1dfe)
- Head and merge parent: `be78e05925ba1e1190ebd2d307e05f5abde44a10`
- Enclosing merge: [`619c2eaaeb358cf447a97838eaedc774976046f1`](https://github.com/cheaper-inference/OmniRoute/commit/619c2eaaeb358cf447a97838eaedc774976046f1)

### Source patch contract

PR `#4571` extracted 11 module-scoped functions from OmniRoute's `chatCore.ts` into 6 pure leaf modules without behavioral modifications:
1. `chatCore/skillsFormat.ts`: `getSkillsProviderForFormat`, `getSkillsModelIdForFormat` (maps wire format to skills provider/model id).
2. `chatCore/nonStreamingResponseBody.ts`: `readNonStreamingResponseBody` (reads response stream with timeout and early cancellation on terminal SSE event).
3. `chatCore/streamErrorResult.ts`: `isSemaphoreCapacityError`, `createStreamingErrorResult`, `getUpstreamErrorIdentifier` (formats SSE error payloads).
4. `chatCore/streamFinalize.ts`: `wrapReadableStreamWithFinalize` (wraps ReadableStream to invoke callback on completion or cancel).
5. `chatCore/cacheUsageMeta.ts`: `toPositiveNumber`, `buildCacheUsageLogMeta`, `attachLogMeta` (extracts token cache details and attaches `_omniroute` metadata).
6. `chatCore/executorClientHeaders.ts`: `buildExecutorClientHeaders` (normalizes Headers and backfills User-Agent).

### Current local ownership and fixture evidence

DurinDoor already decomposes these responsibilities across focused, cohesive handler modules:
- **Skills format**: DurinDoor contains no skills injection or skill-provider mapping subsystem.
- **Non-streaming and SSE response reading**: Owned by [`open-sse/handlers/chatCore/nonStreamingHandler.js`](../../../open-sse/handlers/chatCore/nonStreamingHandler.js#L559) (`handleNonStreamingResponse`) and [`open-sse/handlers/chatCore/sseToJsonHandler.js`](../../../open-sse/handlers/chatCore/sseToJsonHandler.js#L424) (`handleForcedSSEToJson`), covered by [`tests/unit/nonstream-json-contracts-10258.test.js`](../../../tests/unit/nonstream-json-contracts-10258.test.js), [`tests/unit/forced-sse-responses-json.test.js`](../../../tests/unit/forced-sse-responses-json.test.js), and [`tests/unit/sse-to-json-claude-compat.test.js`](../../../tests/unit/sse-to-json-claude-compat.test.js).
- **Streaming error results**: DurinDoor has no semaphore capacity errors in `chatCore.js`. Error normalization and sanitized error results are owned by [`open-sse/utils/error.js`](../../../open-sse/utils/error.js#L23-L65) (`buildErrorBody`, `createErrorResult`) and streaming handlers, covered by [`tests/unit/error-sanitize.test.js`](../../../tests/unit/error-sanitize.test.js) and [`tests/unit/stream-abort-inband-error.test.js`](../../../tests/unit/stream-abort-inband-error.test.js).
- **Stream finalization**: Stream controller lifecycle and cancellation cleanup are owned by [`open-sse/utils/streamHandler.js`](../../../open-sse/utils/streamHandler.js) (`createStreamController`) and [`open-sse/handlers/chatCore/streamingHandler.js`](../../../open-sse/handlers/chatCore/streamingHandler.js#L112), covered by [`tests/unit/chat-stream-success-lifecycle.test.js`](../../../tests/unit/chat-stream-success-lifecycle.test.js).
- **Cache usage metadata**: DurinDoor handles token usage logging directly through unified accounting pipelines without wrapping payloads in `_omniroute` metadata.
- **Executor client headers**: Headers passed to executors are normalized via [`open-sse/utils/clientDetector.js`](../../../open-sse/utils/clientDetector.js) and executor implementations in [`open-sse/executors/base.js`](../../../open-sse/executors/base.js) at the executor boundary.

### Disposition

**Behavior-unchanged upstream extraction of 11 module helpers into 6 pure leaves; no port.** PR `#4571` is a pure structural extraction of 11 module helpers in OmniRoute. The underlying subsystems either do not exist in DurinDoor (skills injection, semaphore error classifications, `_omniroute` telemetry metadata) or are already cleanly partitioned across DurinDoor's modular handlers. No behavior change or port needed.

---

## Ordinary offline acceptance

None of the four reviewed pull requests (`#4477`, `#4526`, `#4538`, `#4571`) introduces a behavior change or reveals a narrow gap in DurinDoor:
1. `#4477` is a pure extraction of Codex service-tier closures; DurinDoor's model-modifier service-tier architecture is verified offline by [`tests/unit/provider-service-tier-suffix-scope.test.js`](../../../tests/unit/provider-service-tier-suffix-scope.test.js).
2. `#4526` extracts Background Task Redirection, a heuristic degradation mode that is outside current local policy. DurinDoor routes requests directly to requested models.
3. `#4538` recovers key-health rotation and target-format extraction; DurinDoor's format and transport selection is verified offline by [`tests/unit/ollama-claude-regression.test.js`](../../../tests/unit/ollama-claude-regression.test.js) and [`tests/unit/public-route-tool-conformance-1089.test.js`](../../../tests/unit/public-route-tool-conformance-1089.test.js).
4. `#4571` extracts 11 module-level helper functions; DurinDoor's modular handlers and stream error protections are verified offline by [`tests/unit/nonstream-json-contracts-10258.test.js`](../../../tests/unit/nonstream-json-contracts-10258.test.js), [`tests/unit/forced-sse-responses-json.test.js`](../../../tests/unit/forced-sse-responses-json.test.js), and [`tests/unit/stream-abort-inband-error.test.js`](../../../tests/unit/stream-abort-inband-error.test.js).

All current provider endpoints, transport mappings, and explicit routing semantics remain preserved, and no product code or test modification is warranted.
