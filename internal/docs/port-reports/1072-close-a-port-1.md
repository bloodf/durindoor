# Provider and connection close pass 1

Compared the first six `remaining` or `partial` entries in
[close ledger A](1072-close-ledger-a.md), in table order, against checkout
`904bf0860b5`. These are eligible rows 1–6, at ledger lines 7–12. Older reports
are unchanged. Scope is fixes and hardening of existing provider/connection
behavior, not new product features.

Fetched each PR's metadata and complete diff using `gh api
repos/decolua/9router/pulls/<N>` and the same endpoint with
`Accept: application/vnd.github.v3.diff`. Reviewed upstream heads are recorded
below so this report does not depend on a moving PR head.

| Row | PR and reviewed head | Final status | Evidence |
| --- | --- | --- | --- |
| 1 | [#1](https://github.com/decolua/9router/pull/1), `9221ef691a48550e68739c9c434314d253b39f29` | Already present for provider selection; out of scope for dashboard, authentication, pricing and usage product work | [Credential selection](../../../src/sse/services/auth.js) serializes selection per provider, persists sticky round-robin counts, and releases its mutex in `finally`. [Session affinity tests](../../../tests/unit/provider-session-sticky.test.js) cover same-session reuse, different-session allocation, exclusion and request-count rotation. [Zero-limit tests](../../../tests/unit/port-3259-sticky-limit-zero.test.js) cover the later explicit-zero contract. [Chat core](../../../open-sse/handlers/chatCore.js) already tracks connection-scoped pending requests and logs. The [usage dashboard](../../../src/shared/components/UsageStats.js), [request log](../../../src/shared/components/RequestLogger.js) and [pricing modal](../../../src/shared/components/PricingModal.js) also exist locally. Their UI, pricing and dashboard-authentication changes are outside this provider/connection fix pass; no absent local subsystem is claimed for that remainder. |
| 2 | [#111](https://github.com/decolua/9router/pull/111), `81429aafb872780e1e840ec87a5727e8433daafa` | Already present for OAuth identity; out of scope for new manual sync feature | [OAuth provider mapping](../../../src/lib/oauth/providers.js) exposes GitHub login, display name and email; [connection storage](../../../src/lib/db/repos/connectionsRepo.js) derives GitHub connection names from identity. [Identity tests](../../../tests/unit/oauth-github-identity.test.js) exercise populated and missing optional fields. The new upstream action `src/app/api/providers/[id]/sync-username/route.js` is absent. Its button and manual backfill endpoint are a new feature, not a fix to the existing sign-in path. No stored secrets were rewritten. |
| 3 | [#112](https://github.com/decolua/9router/pull/112), `e3a68651603ed064689e9e7c2bca9040edb140ca` | Already present for overwrite prevention; out of scope for new fingerprint and replacement workflow | [Provider creation](../../../src/lib/providerRouteHandlers.js) requests create-only insertion; [connection storage](../../../src/lib/db/repos/connectionsRepo.js) checks conflicts inside its write transaction. [Connection-name tests](../../../tests/unit/api-key-connection-name.test.js) verify 409 conflict plumbing and preservation of the existing key. Upstream's `src/app/api/providers/check-duplicate/route.js`, `src/shared/utils/duplicateDetection.js` and `src/shared/components/DuplicateWarningModal.js` are absent. Fingerprinting, the warning dialog and delete-before-replace API are new workflows; the existing transactional conflict handling remains authoritative. |
| 4 | [#130](https://github.com/decolua/9router/pull/130), `9dcd41701cd3fd1eea374bbb05af53d79a62bb67` | Out of scope: new force-fallback policy | The diff adds an environment variable, persistent setting and dashboard toggle to deliberately select unavailable accounts. [Current selection](../../../src/sse/services/auth.js) instead enforces exclusions, model locks, quota admission and RPM gates before returning `allRateLimited`. `forceFallback` and `FORCE_FALLBACK_ON_ALL_UNAVAILABLE` are absent locally; there is no missing new file for this inline feature. No setting or cooldown bypass was added. Upstream's retry guard also returns before executing the last candidate, so transplanting it would discard a valid single-account attempt. |
| 5 | [#137](https://github.com/decolua/9router/pull/137), `c3de453289deb8c4a86d3c0078929dbda762d3a7` | Out of scope: new global TLS transport | The diff replaces global fetch with a new Chrome-124 wreq session and adds `open-sse/utils/tlsClient.js`, which is absent locally. [Current transport](../../../open-sse/utils/proxyFetch.js) has per-route proxy and egress handling; [package metadata](../../../package.json) already reserves optional wreq for the OpenCode free-tier adapter. That provider-specific dependency is not evidence that the global replacement landed. The upstream fallback to native fetch after any transport error changes proxy/failure semantics, rather than fixing a demonstrated existing connection bug. No transport or dependency change was made. |
| 6 | [#141](https://github.com/decolua/9router/pull/141), `d80fc29ab693e3522606574815167af22da223f7` | Ported native client mode and quota metadata; existing session/signature hardening retained | [Dashboard OAuth](../../../src/lib/oauth/providers.js) and [CLI OAuth](../../../src/lib/oauth/services/antigravity.js) now send `mode: 1` for project lookup and onboarding. [Quota requests](../../../open-sse/services/usage/google.js) now include numeric client metadata and `mode: 1` on `fetchAvailableModels`; subscription lookup already included both. [Focused PR #141 tests](../../../tests/unit/port9r-141-antigravity-onboarding-mode.test.js) prove the outgoing envelopes, identity result and proxy context. Numeric OAuth metadata was already present in [OAuth constants](../../../src/lib/oauth/constants/oauth.js). [Session management](../../../open-sse/utils/sessionManager.js), the [executor](../../../open-sse/executors/antigravity.js), and [signature tests](../../../tests/unit/antigravity-thought-signature-family.test.js) implement newer account/session and model-family behavior. Upstream's per-account UUID session, arbitrary random signature fallback, signature debug logging, old IDE headers and double system-prompt injection are not applicable to that newer contract. They were not copied over the current numeric session and scoped signature implementations. |

## Verification

The new OAuth tests failed before the port because both outgoing requests lacked
`mode`. The quota test separately failed because the per-model request lacked
both `metadata` and `mode`. All network responses in these tests are synthetic;
global fetch and proxy-aware fetch are stubbed. No live provider calls or
credentials were used. No existing expectations or failure baselines changed.

Focused checks run from `tests/` with a disposable `DATA_DIR`, a 290-second
command ceiling and `--maxWorkers=2`:

```sh
node node_modules/vitest/vitest.mjs run \
  unit/port9r-141-antigravity-onboarding-mode.test.js \
  unit/antigravity-flow.test.js unit/antigravity-oauth-cancellation.test.js \
  unit/antigravity-thought-signature-family.test.js \
  unit/provider-session-sticky.test.js unit/port-3259-sticky-limit-zero.test.js \
  unit/oauth-github-identity.test.js unit/api-key-connection-name.test.js \
  unit/antigravity-usage-headers.test.js unit/antigravity-weekly-quota.test.js
```

Required report and inventory checks run after staging this report:

```sh
node node_modules/vitest/vitest.mjs run \
  unit/review-l-docs.test.js unit/1300-v5-storybook-inventory.test.js \
  unit/model-catalog-consistency.test.js unit/review-r-settings-complete.test.js
```

Results: 10 focused files passed, 72 tests; all four required check files passed,
12 tests. No UI sources, settings, registry entries,
pricing identifiers or storybook sources changed. Full local CI and independent
review remain integration/merge gates; this work order does not claim either.
