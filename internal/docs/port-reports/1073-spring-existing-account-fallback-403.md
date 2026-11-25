# #1073 — Existing-account fallback and model-restriction responses

## Scope and pins

This comparison is limited to the exact OmniRoute PR heads and their enclosing merge commits:

- [OmniRoute #2534](https://github.com/cheaper-inference/OmniRoute/pull/2534), head [`08c61f0d304237efda5760ee01c48be7f3ab95d6`](https://github.com/cheaper-inference/OmniRoute/commit/08c61f0d304237efda5760ee01c48be7f3ab95d6), enclosing merge [`99c3cc6f160bc799ac09b4655769bff32b89e423`](https://github.com/cheaper-inference/OmniRoute/commit/99c3cc6f160bc799ac09b4655769bff32b89e423). The PR patch includes the follow-up narrowing of Anthropic `permission_error` in the same head.
- [OmniRoute #2972](https://github.com/cheaper-inference/OmniRoute/pull/2972), head [`eb7348aeb9104f2e90aa988a543375951ab0d074`](https://github.com/cheaper-inference/OmniRoute/commit/eb7348aeb9104f2e90aa988a543375951ab0d074), enclosing merge [`20a91c08edb92b21dc10f3dc66fa5f7b98e0cafd`](https://github.com/cheaper-inference/OmniRoute/commit/20a91c08edb92b21dc10f3dc66fa5f7b98e0cafd). Assessment uses the named PR patch, not other changes grouped by the merge.

## Existing local behavior

`open-sse/services/accountFallback.js` classifies an unmatched ordinary 4xx as `{ shouldFallback: false, requestScoped: true }`; account-scoped statuses including 401, 402, 403, 404 and 429 have already taken their configured status-rule path. `open-sse/services/combo.js` uses `requestScoped` to try the next combo member without cooldown or smart-scoring penalty. A 403 that remains account-fallback-worthy can still rotate according to existing policy.

`src/sse/services/auth.js` passes status, body, provider and headers to that classifier. It returns immediately when `shouldFallback` is false, so no connection cooldown is written. Provider rules can set model or connection scope and explicit cooldowns. Ordinary authentication remains distinct: durable credential rejection can mark a connection `reauth_required`/inactive, guarded by proof that the rejected credential is still the stored one. `tests/unit/orcarouter-quarantine.test.js` covers model-permission 403 responses staying active/in rotation and distinguishes revoked-key 403s that require reauthentication. `tests/unit/14234-bare-403-neutral.test.js` verifies a generic 403 is surfaced as neutral `permission_denied`, not quota exhaustion. These fixtures establish that a model denial must not be mistaken for a bad key or quota exhaustion.

The current provider-rule examples also show intentional model-scoped fallback: `open-sse/config/providerErrorRules.js` classifies AgentRouter's structured “no permission to access model” 403 with a model scope and a six-hour cooldown, while its quota rule has a separate connection scope. `tests/unit/upstream-status-restatement.test.js` verifies that a model-denial envelope is not rewritten as quota/rate-limit evidence. These distinctions preserve provider policy and caps instead of globally neutralizing model denials.

## PR dispositions

### #2534 — Do not port

The PR adds structured-code and text-pattern model-access recognition to the error classifier's 400 path, returning a zero-cooldown fallback result; its follow-up correctly requires model context for ambiguous Anthropic `permission_error` types. In the local implementation, generic unmatched 400s already take the request-scoped combo path and advance to the next member without account cooldown. Adding those patterns would duplicate the established behavior, while broadening 403/auth handling from ambiguous structured types risks confusing model restriction with key/org authentication. Keep existing credential-rejection quarantine and provider-specific model scopes intact. The PR supplies no demonstrated missing behavior in ordinary combo fallback that warrants a port.

### #2972 — Port narrow runtime classification only

The PR recognizes the exact provider-declared route-restriction marker “not authorized for this route” on 403 as no fallback and no cooldown, while preserving ordinary/genuine auth 403 behavior. Local classification currently treats generic 403 as account-fallback-worthy, and no matching route-restriction exception or fixture exists in `open-sse/services/accountFallback.js` or the local unit fixtures. This is a narrow gap for a provider response explicitly saying the key is valid but that particular endpoint/route is unavailable. It must not swallow model access denials, generic 403s, quota evidence, or credential rejection. The PR's separate `/models` validation change is not adopted here: the inspected local tree has no `src/lib/providers/validation.ts` equivalent.

Offline acceptance for a later runtime-only change: add a focused unit fixture invoking `checkFallbackError(403, marker, ..., provider)` and assert `{ shouldFallback: false, cooldownMs: 0 }`; pair it with neighboring fixture assertions that (1) generic invalid-key 403 keeps its current fallback/cooldown behavior, (2) ordinary model-access 403 keeps provider/model-specific policy, (3) explicit quota evidence keeps quota fallback/caps, and (4) durable 401 or proven revoked-key 403 retains `reauth_required` behavior. Keep the marker narrowly tied to the provider's declared route-restriction wording; do not infer benignity from 403 alone. No tests or product code were changed in this report task.
