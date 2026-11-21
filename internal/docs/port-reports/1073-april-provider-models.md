# #1073 — April provider model source dispositions

This report compares the six exact merged source diffs supplied for the April provider-model review with current local runtime and offline fixture evidence. Complete paths are from `/var/tmp/durindoor-omni-early-metadata.gnjcuh68/2026-04.json`. No owner selection is made.

## Dispositions

### #899 — empty model sync guard

- **Pins:** head `c214c6c120180fd0ec40c10a4659d9a37293d922`; merge `d10e70a77becf8a0206fc65574c650bc3dbf1820`.
- **Source diff:** moves `replaceCustomModels`'s early return for an empty incoming list (unless `allowEmpty` is explicitly true) ahead of database setup and merge processing. It returns the current custom-model list, preventing an empty discovery result from clearing it. Complete paths: `src/app/api/provider-models/route.ts`, `src/lib/db/models.ts`.
- **Local evidence and disposition:** local model auto-sync already treats an empty discovery response as a failed sync and leaves the previous catalog and sync timestamp untouched. `tests/unit/model-auto-sync-runner.test.js` covers empty list, HTTP error, malformed/non-routable list, network error, and timeout. Local custom models are stored through a separate model API; this source guard specifically covers OmniRoute's `provider-models` persistence shape, which has no direct local counterpart. **No small isolated port is indicated for the applicable sync-preservation behavior; the local behavior is already stronger at the sync boundary.**

### #924 — GitHub Gemini 3.1 model and legacy alias

- **Pins:** head `a7fa34c2fcecfe71bdde16e935f4731d4fa803b1`; merge `24721cf2fafae0ad735dcfa2863dcb9a44edd0f2`.
- **Source diff:** adds `gemini-3.1-pro-preview` to the GitHub model catalog, maps both `gemini-3-pro` and `gemini-3-pro-preview` to it, and adds fixture coverage for canonical and legacy model resolution. README and user guide examples are updated. Complete paths: `README.md`, `docs/USER_GUIDE.md`, `open-sse/config/providerRegistry.ts`, `open-sse/services/model.ts`, `tests/unit/t28-model-catalog-updates.test.mjs`.
- **Local evidence and disposition:** `open-sse/providers/registry/github.js` already lists `gemini-3.1-pro-preview`; `tests/unit/github-responses-routing.test.js` exercises runtime handling of that model. The local alias resolver in `open-sse/services/model.js` has no GitHub mapping for either legacy name (the exact source behavior is an alias normalization, not a model feature). **A small isolated port is still applicable:** map both legacy names to `github/gemini-3.1-pro-preview` in the existing alias-resolution path and add the equivalent offline alias fixture. Expected behavior: requests using either old name resolve to the current catalog model, while the canonical ID continues to resolve unchanged.

### #1238 — Xiaomi MiMo regional base URL normalization

- **Pins:** head `9dde2b6e3ca01e611c68a71e45a30ad5487db5da`; merge `b6e8597ef8e545dff199440b68dc5c06797d8b8a`.
- **Source diff:** adds Xiaomi URL normalization that removes a trailing `/chat/completions` before appending it, and documents that behavior for regional token-plan base URLs. Its fixture covers both a regional `/v1` base and a base already ending in the completion path. Complete paths: `open-sse/config/providerRegistry.ts`, `open-sse/executors/default.ts`, `src/app/(dashboard)/dashboard/providers/[id]/page.tsx`, `tests/unit/xiaomi-mimo-provider.test.mjs`.
- **Local evidence and disposition:** local Xiaomi OAuth traffic uses its dedicated `XiaomiMimoExecutor`, which selects runtime transport URLs and has fixture coverage in `tests/unit/xiaomi-mimo-executor.test.js`; the separate API-key token-plan catalog is `open-sse/providers/registry/xiaomi-mimo-token-plan.js`. The generic executor's custom-base handling appends `/chat/completions` and avoids duplicating it for local-provider base URLs. The source change normalizes one existing provider's user-supplied regional base path; it is not a new provider or authentication change. **A narrowly scoped port remains applicable for the token-plan custom-base case** if that base URL is accepted at runtime: normalize a trailing completion path before appending, with the two source fixture cases. Expected behavior: both regional base forms produce exactly one `/chat/completions` suffix. No provider request was made, so endpoint availability is not asserted.

### #1246 — OAuth client ID fallback cleanup

- **Pins:** head `067d1bc11e1a6e17b0c956cd9dce593baa0cb195`; merge `00a4b456de51df13953923c325cee2da6a31a8b7`.
- **Source diff:** factors the OpenAI OAuth client ID through the Codex config and adds rationale for public PKCE client identifiers. Complete paths: `open-sse/config/providerRegistry.ts`, `src/lib/oauth/constants/oauth.ts`.
- **Disposition:** Provider Sign-in/authentication scope; excluded from this provider-model comparison. No port recommendation is made here.

### #1263 — CLI-tools API key and model mapping fixes

- **Pins:** head `8c36d6e9aa2c8478d74919801012df5c44ae6958`; merge `d89e38ef6e85f8a2163d8fd98081700f92a4aa95`.
- **Source diff:** extracts `keyId` before schema validation across six CLI settings routes, masks the configured key when matching the dashboard's masked key list, and adjusts provider-model mapping on fallback. Complete paths: `src/app/(dashboard)/dashboard/cli-tools/components/ClaudeToolCard.tsx`, `src/app/api/cli-tools/claude-settings/route.ts`, `src/app/api/cli-tools/cline-settings/route.ts`, `src/app/api/cli-tools/codex-settings/route.ts`, `src/app/api/cli-tools/droid-settings/route.ts`, `src/app/api/cli-tools/kilo-settings/route.ts`, `src/app/api/cli-tools/openclaw-settings/route.ts`, `src/app/api/providers/[id]/models/route.ts`.
- **Disposition:** dashboard CLI-tools integration and credential selection behavior, outside the requested provider-model runtime scope. Excluded; no port recommendation is made here.

### #1289 — Perplexity Web provider

- **Pins:** head `d4657879142a9010d6b3c461aa134cfaebeb0de9`; merge `66ace45e67835ded0ea1354e3c11b0d5b06a57dd`.
- **Source diff:** the supplied exact head adds only `.worktrees` to `.gitignore`; the merged PR also introduces the Perplexity Web session provider across the other listed files. Complete paths: `.gitignore`, `open-sse/config/providerRegistry.ts`, `open-sse/executors/index.ts`, `open-sse/executors/perplexity-web.ts`, `src/shared/constants/providers.ts`, `tests/unit/perplexity-web.test.mjs`.
- **Disposition:** new provider and integration, explicitly reserved for Provider Sign-in/new-provider work and excluded here. No port recommendation is made.

## Summary

Of the in-scope runtime differences, #899's empty-sync preservation already exists locally, while #924's legacy GitHub model aliases and #1238's Xiaomi token-plan custom regional URL normalization remain candidates for small isolated ports. The latter should be limited to path normalization and an offline fixture; no new provider or authentication work is proposed. #1246, #1263, and #1289 are excluded as described above.
