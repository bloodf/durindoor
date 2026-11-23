# #1073 March: existing provider usage contracts

This report compares the pinned OmniRoute patches with current DurinDoor provider usage parsers and offline fixtures. No credentials, provider requests, live accounts, or persisted usage values were used or changed.

## Pins and comparison method

- [OmniRoute #203](https://github.com/cheaper-inference/OmniRoute/pull/203): PR head [`5cb56ea53221670fc7cf882b07771a232bf1de59`](https://github.com/cheaper-inference/OmniRoute/commit/5cb56ea53221670fc7cf882b07771a232bf1de59); enclosing merge [`f4e2dc270ee16a23c48e90ce8edc7228fc47e5ce`](https://github.com/cheaper-inference/OmniRoute/commit/f4e2dc270ee16a23c48e90ce8edc7228fc47e5ce). Compared the PR-head patch because the merge includes unrelated changes.
- [OmniRoute #279](https://github.com/cheaper-inference/OmniRoute/pull/279): PR head and enclosing merge [`6e1bf4652d7293efc2aa0a51be7c108f9bf22135`](https://github.com/cheaper-inference/OmniRoute/commit/6e1bf4652d7293efc2aa0a51be7c108f9bf22135).
- [OmniRoute #591](https://github.com/cheaper-inference/OmniRoute/pull/591): PR head [`f5b0d3102e4ac4b7d9236ea4d35a21aee11da97b`](https://github.com/cheaper-inference/OmniRoute/commit/f5b0d3102e4ac4b7d9236ea4d35a21aee11da97b); enclosing merge [`e9ae50be0c2ea5cbaaa62a33a4bb2e24d2946e25`](https://github.com/cheaper-inference/OmniRoute/commit/e9ae50be0c2ea5cbaaa62a33a4bb2e24d2946e25). Compared the PR-head patch, not the enclosing merge.

The behavior under review is quota/plan display metadata for existing provider integrations. It does not change request usage accounting, billing units, usage history, or provider calls.

## Current local contract and fixture evidence

### Claude OAuth quota values

The current OAuth parser treats Anthropic `utilization` as percentage used, computes `remaining = 100 - used`, and publishes that value as `remainingPercentage`; it requires a numeric utilization value and ignores malformed/non-object windows. It also uses `extra_usage ?? null`. See [`open-sse/services/usage/claude.js`](../../../open-sse/services/usage/claude.js) and the dashboard normalizer `ProviderLimits/utils.js`.

Offline fixtures assert used/remaining values for OAuth windows and model windows in [`provider-quota-normalizers.test.js`](../../../tests/unit/provider-quota-normalizers.test.js), preserve provider-supplied percentages in [`quota-remaining-percentage.test.js`](../../../tests/unit/quota-remaining-percentage.test.js), and verify extra-usage credit display and absolute balance handling in [`claude-extra-usage-quota.test.js`](../../../tests/unit/claude-extra-usage-quota.test.js). Persisted request usage remains separate from these quota snapshots.

### Installed integrations and credential boundaries

Kimi Coding is an installed integration with offline request-mock fixtures. Its normalized quota fetcher emits `X-Msh-Platform: omniroute` and `X-Msh-Version: 2.1.2`, and uses a stable non-secret device identifier; [`provider-quota-fetchers.test.js`](../../../tests/unit/provider-quota-fetchers.test.js) asserts these fields and device-ID behavior. [`kimi-usage.test.js`](../../../tests/unit/kimi-usage.test.js) separately proves that Kimi Platform API-key usage is not probed or advertised as Kimi Coding subscription quota, API-key auth wins when both credential forms are supplied, and credential absence results in no request. Kimi Coding entitlement is therefore not inferred for the distinct Kimi Platform integration.

Claude OAuth usage and Claude administrator/API-key usage are separate contracts. The OAuth parser reads OAuth quota windows; administrator API-key usage uses the legacy organization settings/usage endpoints and preserves unknown limits as unknown. [`provider-quota-fetchers.test.js`](../../../tests/unit/provider-quota-fetchers.test.js) includes a mocked administrator-key fixture asserting `x-api-key`, no bearer authorization, and no fabricated limit. The HTTP route also refuses OAuth credential refresh for a non-admin API-key caller in [`provider-usage-route.test.js`](../../../tests/unit/provider-usage-route.test.js). Do not apply OAuth response fields or auth behavior to that administrator path.

### Plan metadata

Claude OAuth plan display currently derives from connection-time profile fields (`claudeRateLimitTier`, organization type, and account flags) via [`claudePlanName`](../../../open-sse/services/usage/claude.js). Offline tests cover these fields and the historical fallback in [`claude-oauth-profile.test.js`](../../../tests/unit/claude-oauth-profile.test.js). The OAuth usage response's `tier`, `plan`, or `subscription_type` fields are not currently consulted. Provider display names are not persisted usage units or accounting inputs.

## Per-PR disposition

### #203 — Already covered; no port

The exact patch corrects Claude's utilization direction, adds numeric/object guards and optional chaining, preserves explicit `extra_usage: false` through nullish fallback, and forwards `remainingPercentage` through `parseQuotaData`. Current DurinDoor already has the same semantics, with stricter numeric validation and explicit local fixtures for used/remaining percentages and extra usage. Its administrator-key parser remains distinct. No demonstrated gap remains; no code or test change is warranted.

### #279 — Already covered in the installed Kimi Coding quota path; no port

The exact patch changes the Kimi Coding platform/version headers to `omniroute` / `2.1.2` in OAuth usage, refresh, and sign-in code. The current normalized quota-fetch path uses those same values, covered by an offline header fixture. The older generic `buildKimiHeaders` helper still labels its separate legacy Kimi request path `9router`; this audit found no evidence that changing that shared helper is required for the installed normalized Kimi Coding usage contract. Keep Kimi Platform API-key usage absent from the subscription quota integration and do not probe it as Kimi Coding.

### #591 — Narrow plan-display gap; theme changes do not apply

The exact patch includes theme-aware Provider Limits styling, which does not establish a provider usage parser delta. It also extracts a Claude display plan from the OAuth usage response (`tier`, then `plan`, then `subscription_type`) before falling back to `Claude Code`, and excludes provider names from plan-tier badges. Current local OAuth parsing uses connection-time profile metadata instead, so the response-field fallback is a narrow display metadata gap. It must not affect quota values, usage accounting, OAuth/admin credential routing, or stored units.

**Disposition:** ordinary offline acceptance is justified for the response plan fallback only. A focused mocked-fetch test should cover each accepted response field, precedence (`tier` → `plan` → `subscription_type`), empty/non-string values falling back to the profile-derived plan, and absence falling back to `Claude Code`. Existing profile precedence should remain explicit; if the provider response should override a known connection profile, that precedence needs a fixture documenting the choice. Tests must use synthetic response bodies and stubbed fetches. No administrator API-key path or live provider access is part of acceptance. No implementation is included in this report-only task.
