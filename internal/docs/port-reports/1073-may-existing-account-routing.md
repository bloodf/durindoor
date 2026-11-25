# #1073: May existing-account routing comparison

Static comparison of the six requested merged source patches against the current DurinDoor checkout. Source commits and complete changed paths were read from the local read-only OmniRoute mirror and May metadata. No product files were changed. No provider traffic or credentials were used, and no tests were run. Existing offline test files are cited as coverage evidence only.

## Existing-account routing and admission

### #1854 — [source PR](https://github.com/cheaper-inference/OmniRoute/pull/1854)

Pins: head `abe5fe845b9660ee9e99c4739e4e1d5cfcddde8b`; merge `20358bc8bf51d80e894a4f104f3f87596b444406`.

Complete changed paths: `open-sse/config/constants.ts`, `open-sse/services/accountFallback.ts`, `open-sse/services/accountSemaphore.ts`, `open-sse/services/combo.ts`, `open-sse/services/quotaPreflight.ts`.

The patch raises session and API-key provider breaker thresholds for scale, excludes 429 from provider-wide failure counting, deduplicates repeated failures by connection for five seconds, caps the account wait queue at 20, treats queue-full like timeout for combo round-robin fallback, and moves quota exhaustion from 95% to 98%.

**Disposition: partial existing behavior; account-level admission remains a distinct code unit.** DurinDoor has a process-local `concurrencyGate.js` with queued waits, timeout, abort handling, and slot handoff, plus `acquireMany` with rollback. It is keyed by provider/tier and has no queue-size rejection; it does not implement the source account semaphore or its combo-specific queue-full fallback. This is demonstrated existing admission behavior, but it does not establish parity for the account queue. The patch's provider breaker thresholds, per-connection failure deduplication, and quota-preflight threshold have no matching current implementation identified in the inspected local service paths. Existing offline coverage includes `tests/unit/concurrency-gate.test.js`, `tests/unit/account-fallback-request-errors.test.js` and `tests/unit/account-fallback-request-scoped-4xx.test.js`, and `tests/unit/provider-quota-preflight.test.js`; none is evidence of the absent account queue cap. An isolated account-level admission unit and caller-level fallback adaptation would be needed to port that behavior.

### #1891 — [source PR](https://github.com/cheaper-inference/OmniRoute/pull/1891)

Pins: head `8dcb7c8aed11c460578347328970054993750c1c`; merge `6b7f33183c0c68e5422e4bdbb1dfcca371466c42`.

Complete changed paths: `open-sse/services/accountFallback.ts`, `open-sse/services/combo.ts`, `tests/integration/chat-pipeline.test.ts`, `tests/unit/account-fallback-service.test.ts`.

The source change passes the runtime combo provider profile into breaker configuration when recording a failure, so the shared provider breaker uses that profile's threshold and reset duration.

**Disposition: no demonstrated local equivalent; isolated breaker-profile unit required.** The current local `concurrencyGate.js` is admission control, not a provider circuit breaker. The source's runtime profile merge and preservation of that configuration across status reads are not represented by the inspected local code. Existing offline account-fallback tests cover local account cooldown behavior, not this provider-breaker configuration contract. This is distinct from queue admission in #1854.

## New feature

### #1865 — [source PR](https://github.com/cheaper-inference/OmniRoute/pull/1865)

Pins: head `a990bd78fc982ad728d9069311de715660e0f89a`; merge `00182afb2fb5d2f5e3c5913b9eb4451d1ab5ea03`.

Complete changed paths: `open-sse/services/usage.ts`, `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.tsx`, `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.tsx`, `src/lib/usage/providerLimits.ts`, `src/shared/constants/providers.ts`, `tests/unit/usage-service-hardening.test.ts`.

The patch adds NanoGPT subscription quota retrieval and dashboard normalization for PRO daily/weekly tokens and daily images, FREE-plan display, and missing-key/API-error messages.

**Disposition: new usage feature, absent locally.** The current NanoGPT registry supports API-key chat and has no usage feature flag; `USAGE_SUPPORTED_PROVIDERS` is derived from registry usage flags. Local offline `tests/unit/provider-quota-normalizers.test.js` explicitly classifies NanoGPT as `provider-not-present`; existing provider usage tests do not cover the subscription endpoint. The matching behavior would require a new usage code unit, registry/dashboard wiring, and deterministic mocked-fetch tests. This is not an existing-account routing change.

## Provider and model catalog additions or removals

### #1949 — [source PR](https://github.com/cheaper-inference/OmniRoute/pull/1949)

Pins: head `aef63ae29631450c8705257ddf14935d7fd3bfb3`; merge `a15b6964b746485de95d32af3f15c7d81093de86`.

Complete changed paths: `.env.example`, `open-sse/config/imageRegistry.ts`, `open-sse/config/providerRegistry.ts`, `open-sse/services/model.ts`, `tests/unit/plan3-p0.test.ts`, `tests/unit/t20-t22-provider-headers.test.ts`.

The patch updates Kimi Coding model IDs, removes retired Codex and other OpenAI IDs, removes older Codex image IDs, adds Grok Imagine Image Pro, and drops `codex-auto-review` from the preferred bare-model inference set.

**Disposition: provider/model catalog maintenance with substantial local divergence; no wholesale port indicated.** Current local registry has NanoGPT and updated model catalogs, Codex lists `codex-auto-review` as an explicit provider model, and its image registry is maintained separately. Current `getModelInfoCore` maps that exact bare virtual ID to Codex, rather than using the source's model-to-provider inference set. Local offline coverage includes `tests/unit/codex-image-models.test.js` and provider-specific routing/catalog tests. Those establish current local contracts; they do not validate the source's Kimi or Grok catalog edits. No sign-in or credential flow is changed in this patch.

### #2012 — [source PR](https://github.com/cheaper-inference/OmniRoute/pull/2012)

Pins: head `05f514f0377e26366b650ed921562815493f6437`; merge `d96f0c2fda8b9ed25ee2a464acd956a61241aede`.

Complete changed paths: `open-sse/services/model.ts`, `src/app/api/v1/models/catalog.ts`, `src/sse/handlers/chat.ts`, `src/sse/handlers/chatHelpers.ts`, `tests/unit/chat-helpers.test.ts`, `tests/unit/models-catalog-route.test.ts`, `tests/unit/plan3-p0.test.ts`.

The patch introduces bare `codex-auto-review` inference/catalog exposure and routes Codex-native gpt-5.5 Responses/compact requests to Codex based on endpoint and client metadata, while preserving ordinary OpenAI Responses routing.

**Disposition: existing Codex account capability, source-specific client routing absent from current resolver.** DurinDoor already has Codex native Responses execution, catalog entries, `codex-auto-review`, and OpenAI Responses transport, but the inspected `getModelInfoCore` infers bare `gpt-*` as OpenAI and no chat resolver branch recognizes Codex client metadata for gpt-5.5. Offline coverage includes `tests/unit/codex-image-models.test.js`, `tests/unit/port-14673-responses-empty-input-continuity.test.js`, and `tests/unit/chat-policy-sequence.test.js`; these exercise related native/protocol contracts, not the source's client-sensitive route or bare Codex catalog aliases. An isolated resolver/catalog code unit and caller propagation of endpoint plus request headers would be needed for this behavior. This is model routing using existing accounts, not sign-in/auth.

### #2054 — [source PR](https://github.com/cheaper-inference/OmniRoute/pull/2054)

Pins: head `dabbbc21e6340dd5079320a572d4be7b4a598b80`; merge `fc84e5a34aca241f800d92c64e7c37b08babb943`.

Complete changed paths: `open-sse/config/providerRegistry.ts`, `open-sse/services/model.ts`, `tests/unit/chat-helpers.test.ts`.

The patch adds bare gpt-5.5 to Codex's model catalog, aliases it to `gpt-5.5-medium` when Codex is the only active account, and preserves OpenAI selection when OpenAI alone is active. It also consults active accounts when inferring among eligible providers.

**Disposition: existing-account selection behavior partially represented, with bare gpt-5.5 account-aware inference missing.** Local model inference currently maps bare `gpt-5.5` to OpenAI; its resolver has no active-provider set selection. DurinDoor does already list Codex tiered gpt-5.5 IDs and has OpenAI gpt-5.5, so the model/provider capability is present while the source's account-sensitive default and medium alias are not. The same offline resolver and Codex tests cited for #2012 do not cover active-account selection. A focused resolver test should distinguish Codex-only, OpenAI-only, and both/neither active states before adapting the behavior. No sign-in, token refresh, or auth changes are present.

## Sign-in/auth boundary

None of these six exact source patches changes OAuth, sign-in, token refresh, or credential acquisition. The Codex rows above select among existing configured accounts and do not port authentication behavior.

Refs #1073
