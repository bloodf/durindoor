# OmniRoute current sign-in/provider delta (#2034)

## Scope and evidence

This documentation-only refresh compares OmniRoute `release/v3.8.55` from `9671192011beb2d7f83979f40be488c5da8772b9` through `d3f06ea668109f8ac1feadfcae25f6ff9b873b5f` (six commits; the first pin is an ancestor of the second). The exact source range is [the pinned compare](https://github.com/cheaper-inference/OmniRoute/compare/9671192011beb2d7f83979f40be488c5da8772b9...d3f06ea668109f8ac1feadfcae25f6ff9b873b5f). The previous OmniRoute release inventory is [`provider-parity-omni-release-delta.md`](./provider-parity-omni-release-delta.md); this report checks the new range only and does not repeat the parent-verified CLIProxyAPI or EasyCLIProxyAPI comparisons.

The checkout-bounded clone verified ancestry, commit count, and the complete file diff. The eight changed paths are two changelog entries, a quality merge-gates template, Codex prompt-cache key code and tests, combo auto-routing code and tests, and an opaque-token fingerprint test. No changed path is a provider registry, OAuth/device/import/session/refresh implementation, credential schema, executor, quota adapter, model catalog/discovery implementation, or Firefly consumer integration.

For the current integration, the provider catalog is composed by [`open-sse/providers/registry/index.js`](../../open-sse/providers/registry/index.js); OAuth and token-refresh provider dispatch are in [`src/lib/oauth/`](../../src/lib/oauth) and [`open-sse/services/tokenRefresh/providers.js`](../../open-sse/services/tokenRefresh/providers.js). These are the local comparison points, not files changed by this OmniRoute range. The previously recorded auth inventory remains in [`provider-parity-omni-sessions-verified.md`](./provider-parity-omni-sessions-verified.md), while [`provider-parity-current-dispositions.md`](./provider-parity-current-dispositions.md) is the current provider-identity ledger. Neither earlier status nor a composed identity implies a live account was accepted.

## Provider and sign-in inventory

| Contract surface in the requested range | Source result and current DurinDoor comparison | Classification and acceptance |
|---|---|---|
| OAuth, device authorization, account import, session capture, token refresh, request headers and auth envelopes | No matching source paths or changed hunks occur in the pinned range. The changed Codex cache helper and combo selector do not alter provider credentials or request authentication. | **No delta; no gap to port from this range.** No new sign-in acceptance test is indicated. This is source-diff evidence, not a claim that all older OmniRoute auth contracts are equivalent. |
| Account quotas, provider quota adapters, and quota headers/envelopes | No provider quota or account-quota files occur in the range. `resolveAutoStrategy.ts` adds automatic routing budget filtering (`budgetCap`) and fallback target filtering; this is shared combo selection, not a provider account-quota API. | **Other lane:** shared combo/budget routing owner. It does not create a provider quota gap. No provider quota acceptance test is indicated. |
| Provider discovery and catalog behavior | No provider discovery, catalog, registry composition, model-resolution, or provider-specific fallback catalog files change. No dynamic catalog becomes static or vice versa in this range. | **No delta.** Existing provider catalog behavior remains governed by the current DurinDoor registry and its dynamic discovery/fallback rules. A registry entry or static fallback alone does not prove account-specific model acceptance. |
| Provider identities and model IDs | No provider registry identity is added or removed, and no provider model ID is introduced or retired in this range. The Codex prompt-cache anchor fingerprint change uses existing Codex request context; it does not rename a provider or model. | **No delta; no new/removed identity gap.** No provider identity acceptance test is indicated. |
| Codex prompt-cache anchor fingerprint | `open-sse/executors/codex/promptCacheKey.ts` replaces a local SHA-256 digest with the existing opaque-token fingerprint helper; `tests/unit/codex-prompt-cache-key-21077.test.ts` and `tests/unit/opaque-token-fingerprint.test.ts` are adjusted. This concerns internal cache identity, not sign-in, provider selection, model discovery, or provider quota. | **Other lane:** Codex request/cache behavior. It is not a provider-auth delta for this order. |
| Adobe Firefly consumer | No Firefly source or tests change between these pins. DurinDoor's current internal [`Firefly consumer browser contract`](./firefly-consumer-browser-contract.md) documents Adobe's ordinary consumer UI workflow from Adobe help: sign in, enter a prompt, choose model/settings, generate, and retrieve output via Generation History. It separately distinguishes Firefly Services developer credentials and endpoints. | **No reason from this range to amend the queued browser-UI unit.** The source diff adds no consumer workflow, selector, accessibility-name, job lifecycle, or challenge handling contract. The consumer flow is not made contingent on Firefly Services entitlement; absence of upstream browser code is not an authorization barrier. Do not infer live account acceptance or service availability from documentation or local fixtures. |

## Other-lane ownership

The remaining upstream changes are outside this provider work order:

- `open-sse/services/combo/resolveAutoStrategy.ts` and its tests implement strict per-request budget filtering for auto routing (**shared combo/budget routing lane**).
- `open-sse/executors/codex/promptCacheKey.ts` and its tests change prompt-cache anchor fingerprinting (**Codex executor/cache lane**).
- `config/quality/skill-templates/_shared/merge-gates.md` updates the upstream merge-gate template (**upstream quality/process lane**).
- Changelog files describe those changes; they do not add provider contracts.

No other provider-auth, provider-discovery, or provider-identity delta was found in the exact range. This conclusion is limited to those two OmniRoute revisions and the source files they compare. It makes no claim of live provider acceptance, live quota, entitlement, or model availability.

## Focused acceptance

There is no concrete remaining provider/sign-in gap in this range, so there is no provider-specific focused test command to run or propose. Existing upstream Codex/combo tests cover their respective other-lane changes. No provider tests were run for this documentation-only review.
