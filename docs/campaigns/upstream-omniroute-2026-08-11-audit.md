# OmniRoute Open PR Audit — 2026-08-11

**Scope**: `repo:diegosouzapw/OmniRoute is:pr is:open updated:>2026-08-09` — 69 OmniRoute PRs
**Anchor**: OmniRoute reviewed head `918fba5e3` (2026-08-09)
**DurinDoor fork**: `bloodf/durindoor`, `main`
**Diff source**: `/tmp/omniroute/pr-{N}.diff` (69 captured; PRs 10036 + 10112 exceeded GitHub diff API 300-file limit — SHA = `N/A`)
**SHA source**: `gh pr view --repo diegosouzapw/OmniRoute --json headRefOid --jq .headRefOid`

## PORT — Fork-relevant, not yet in DurinDoor

| PR# | Title | URL | Updated | Head SHA | Evidence | Recommended Action |
|------|-------|-----|---------|----------|----------|--------------------|
| 10113 | fix(governor): resolve free pricing and provider context defaults | https://github.com/diegosouzapw/OmniRoute/pull/10113 | 2026-08-11 | `a8e281e70aee79942f03e7ccc2704d7cf2b49eb9` | `governor.ts` pricing/free-tier fix; governor not in durindoor | Scout, port after upstream merge |
| 10098 | feat: quota-aware routing | https://github.com/diegosouzapw/OmniRoute/pull/10098 | 2026-08-11 | `1a49fddefb71f6862da2fc1250cfebd64f42bb81` | `combo.ts` + `quotaScheduler.ts` pre-request TPM budget check via `canAffordRequest()`; durindoor grep `canAffordRequest` = N/A; `OMNIROUTE_QUOTA_AWARE_ROUTING` env | Scout, TDD port after upstream merge |
| 10090 | fix(doctor): prebuilt binary search for musl (linuxmusl-x64.node) | https://github.com/diegosouzapw/OmniRoute/pull/10090 | 2026-08-11 | `31efda29ed7493d448a6c6446276c82a2990f02b` | `doctor.mjs` adds `prebuiltBinaryName()` with musl detection; durindoor has `bin/cli/commands/doctor.mjs` but lacks musl path | Scout, minimal port |
| 10089 | fix(doctor): extract provider registry catalog scanning into reusable CLI lib | https://github.com/diegosouzapw/OmniRoute/pull/10089 | 2026-08-11 | `a4cc6a73548bb5c36121fcf1f28710a61cd1b29f` | `provider-catalog.mjs` TypeScript scanner rewrite with `skipNonCode()`; durindoor has `bin/cli/provider-catalog.mjs` | Scout, port only if durindoor catalog needs are richer |
| 10086 | feat(kilo-gateway): regolo-type gateway with catalog-based model routing | https://github.com/diegosouzapw/OmniRoute/pull/10086 | 2026-08-11 | `ca16c1a474967dc874605008f3dee45133b280e0` | `kilo-gateway.js` Regolo routing type; durindoor `kilo-gateway.js` has no Regolo type | Scout, port if regolo or kiro/crof affinity needed |
| 10077 | fix(chatgpt-web): preserve native max thinking effort | https://github.com/diegosouzapw/OmniRoute/pull/10077 | 2026-08-11 | `c4cad18d14c3c66f3fc250c80a9e284ab2da3c08` | `chatgpt-web.ts` + `models.ts` adds `max` tier to `ChatGptThinkingEffort`; durindoor `chatgpt-web.ts` has `standard\|extended` only | Scout, port `max` tier + `normalizeThinkingEffort` update |
| 10062 | feat(crof): advertise reasoning-effort tiers (none/low/medium/high/max) | https://github.com/diegosouzapw/OmniRoute/pull/10062 | 2026-08-11 | `09fadbfaf7d2113c8f4781d5a0abaa487cbe6c27` | `crof/index.ts` `supportedThinkingEfforts` for all seed models; durindoor `crof.js` has no `supportedThinkingEfforts` field (confirmed missing) | Scout, port after upstream merge |
| 10058 | fix(kimi): quota recovery for 503/mode=MFJS | https://github.com/diegosouzapw/OmniRoute/pull/10058 | 2026-08-11 | `fb097845d07f2226cfb312b1318078be53864f53` | `kimi.ts` `kimiQuotaRecovery` / MFJS 503 retry; durindoor `kimi-web.js` has `resolveModelConfig(scenario)` but no `kimiQuotaRecovery` function (confirmed) | Scout, port if durindoor kimi handles MFJS 503 |
| 10053 | fix(translator): strip Codex encrypted tool-schema key for Gemini/Antigravity | https://github.com/diegosouzapw/OmniRoute/pull/10053 | 2026-08-11 | `39499d346a74eb8dc9dd647b98fbef1ed6a5f515` | `unsupported` schema annotation strips `encrypted` key; upstream PR bloodf/durindoor#404 | Already tracked in `wt-port-10053/` |
| 10052 | fix(agentrouter): session affinity key includes provider id | https://github.com/diegosouzapw/OmniRoute/pull/10052 | 2026-08-10 | `7ca73697b0f5b9b5645884817fab616b4608ebdc` | `chatCore.ts` affinity key + `chatPredicates.ts` `isProviderBreakerFailureStatus`; durindoor has `agentrouter` provider; `isProviderBreakerFailureStatus` grep = N/A | Scout, verify durindoor agentrouter affinity |
| 10051 | fix(chatgpt-web): normalize Zed provider wire values (openai→open_ai) | https://github.com/diegosouzapw/OmniRoute/pull/10051 | 2026-08-11 | `0ac22626c01f0f925a6de6273ca46a82308cd7f5` | `zed-hosted.ts` `ZED_PROVIDER` changes capitalization; durindoor grep `normalizeZedProvider\|ZED_PROVIDER` = N/A; Zed executor may not exist in durindoor | Scout, verify durindoor has Zed executor before porting |
| 10050 | feat(combo): add reasoning.effort support to combo LKGPClear | https://github.com/diegosouzapw/OmniRoute/pull/10050 | 2026-08-11 | `444f3508d068e3aae831fa898c526c2fb34f048a` | `combo.ts` LKGPClear success-path clear + `comboPredicates.ts`; durindoor has `open-sse/services/combo.js` (fork-specific) but no `clearLKGP` function (confirmed from prior audit) | Scout, verify durindoor combo needs LKGP clear |
| 10048 | fix(i18n): iconUrlInvalid validation message across all locale files | https://github.com/diegosouzapw/OmniRoute/pull/10048 | 2026-08-11 | `22ddb28e0c000954ee858ff2b195754440fbdc2e` | 30+ `messages/*.json` files add `iconUrlInvalid` key; durindoor has same i18n structure | Scout, mechanical port (i18n strings) |
| 10047 | fix(db): migration 134→139 renumber for ccr_blocks table | https://github.com/diegosouzapw/OmniRoute/pull/10047 | 2026-08-11 | `4fee3b2907d6755e1fe3830e8964eaf40ef2c518` | `migrationRunner.ts` renumber compat + `constants.ts` `RENAMED_MIGRATION_COMPATIBILITY`; durindoor `migrationRunner.ts` likely lacks 139 compat entry | Scout, port renumber compat if durindoor has CCR/migration 134 |
| 10046 | fix(combo): tighten circuit-breaker thresholds | https://github.com/diegosouzapw/OmniRoute/pull/10046 | 2026-08-11 | `0eb192fd9df774d7f9ce292d2215f4d5d6dfa7b3` | `chat.ts` adds `isProviderBreakerFailureStatus` guard + test; durindoor grep `isProviderBreakerFailureStatus` = N/A | Scout, verify durindoor combo breaker logic |
| 10045 | fix(reasoning): skip streaming reasoning for models without support | https://github.com/diegosouzapw/OmniRoute/pull/10045 | 2026-08-11 | `b6bb67c99b41144a2e0ac013f547bc95f72fe4ae` | `chatCore.ts` `comboContextLength`/`comboContextAggregation` for reasoning models; durindoor grep `comboContextLength` = N/A | Scout, verify durindoor reasoning streaming logic |
| 10042 | fix(api-manager): empty combo allowlist now denies Combo routes explicitly | https://github.com/diegosouzapw/OmniRoute/pull/10042 | 2026-08-11 | `e47d2a47b5ba288d5abc3c866477c9b120de474f` | `ApiManagerPageClient.tsx` + `check-migration-numbering.mjs`; durindoor has api-manager dashboard | Scout, verify durindoor api-manager combo allowlist logic |
| 10041 | fix(responses): deduplicate tool call output_index from multiple sources | https://github.com/diegosouzapw/OmniRoute/pull/10041 | 2026-08-11 | `9f7adf3704749dae73de76e3f24a2717ff453c51` | `responsesTransformer.ts` `funcOutputIndex` dedup; durindoor grep `funcOutputIndex` = N/A | Scout, verify durindoor responses transformer tool output_index handling |
| 10037 | fix(stream): TRANSLATE mode summary reducer uses sourceFormat instead of targetFormat | https://github.com/diegosouzapw/OmniRoute/pull/10037 | 2026-08-11 | `ab92449dfc6e3bdfc56042693704c1c2f3eed463` | `stream.ts` + `streamPayloadCollector.ts` live summary reducer fix; durindoor `stream.js` uses `targetFormat` correctly in TRANSLATE mode, but `streamPayloadCollector` with `format`/`fallbackModel`/`SummaryReducer` is absent — structural gap | Scout, port streamPayloadCollector live reducer additions |
| 10038 | feat(logs): CHAT_LOG_MAX_BODY_KB env for body truncation threshold | https://github.com/diegosouzapw/OmniRoute/pull/10038 | 2026-08-11 | `b6e0de094f23e2ed15e5498dc258cf48f0a7a75b` | `logTruncation.ts` `cloneBoundedChatLogPayload` with configurable max body KB; durindoor `logTruncation.ts` likely lacks this knob | Scout, port if durindoor needs configurable log truncation |
| 10034 | feat(combo): LKGPClear mirror in combo success path | https://github.com/diegosouzapw/OmniRoute/pull/10034 | 2026-08-11 | `d635c559edb37dcbf49ac8b25d916ea832e46ca3` | `combo.ts` success-path `localDb.getProviderConnectionById` clear; durindoor has no `clearLKGP` (confirmed from prior audit) | Scout, verify durindoor combo LKGPClear success-path |
| 10026 | fix(catalog): hide ghost models excluded by provider connections | https://github.com/diegosouzapw/OmniRoute/pull/10026 | 2026-08-11 | `2b055a68eb19a90109dc83a03346592242285e73` | `catalog.ts` `isExcludedByProviderConnections()` filter in 4 places; durindoor `src/app/api/v1/models/catalog.ts` likely lacks this filter | Scout, port if durindoor catalog shows ghost models |
| 10025 | fix(responses): funcOutputIndex from responses API | https://github.com/diegosouzapw/OmniRoute/pull/10025 | 2026-08-11 | `d35f85338b3c2c6761292fd7d9f7ebabda24703a` | `responsesTransformer.ts` `funcOutputIndex` for responses API `output_index`; durindoor grep `funcOutputIndex` = N/A | Scout, verify durindoor responses API tool output_index handling |
| 10023 | fix(combo): use specific target limits for context window compression | https://github.com/diegosouzapw/OmniRoute/pull/10023 | 2026-08-11 | `6e1c5cb1f48a39da54681b753f64988e7b10187c` | `chatCore.ts` `.filter((target) => target.specific).map((target) => target.limit)`; durindoor grep `specific` in combo context = N/A | Scout, verify durindoor combo context compression |
| 10016 | fix(agentrouter): affinity timeout in ms not seconds | https://github.com/diegosouzapw/OmniRoute/pull/10016 | 2026-08-11 | `aa16c2b2525d97f128c44ccf8c44d128c511fa58` | `chat.ts` affinity timeout unit fix (ms vs s); durindoor grep `affinityTimeout` = N/A | Scout, verify durindoor agentrouter affinity handling |
| 9916 | fix(db): migration 139/renumber 134 CCR compat | https://github.com/diegosouzapw/OmniRoute/pull/9916 | 2026-08-10 | `13f6a28f8172aa31d19ffd1bb08b0b3b9d801af1` | `migrationRunner.ts` + `constants.ts` 134→139 renumber; durindoor `migrationRunner.ts` likely lacks this compat | Scout, port if durindoor has CCR feature |
| 9888 | feat(providers): add cloudcode-one registry | https://github.com/diegosouzapw/OmniRoute/pull/9888 | 2026-08-10 | `65c31f2286136a4d6d8b749d109246d80ff5c5a7` | `cloudcode-one/index.ts` new provider; durindoor grep `cloudcode-one` = N/A | Scout, port if user needs cloudcode-one provider |
| 9629 | feat(compression): toggle for compression via env | https://github.com/diegosouzapw/OmniRoute/pull/9629 | 2026-08-10 | `3c223563b3c4d861d90d238b506eaad6a3e8a8be` | Compression env toggle | Already tracked in `wt-compression-repair/` |
| 9618 | fix(db): migration 139 adds ccr_blocks table | https://github.com/diegosouzapw/OmniRoute/pull/9618 | 2026-08-10 | `6af95f89c8a43eb8062f2d99d96cfc5edb2b4a63` | `migrationRunner.ts` case 139 returns `hasTable(db, "ccr_blocks")`; durindoor likely lacks migration 139 | Scout, port if durindoor has CCR feature |
| 9592 | feat(providers): add poolside, fastrouter, anyapi, electronhub, llmgateway, llm-kiwi | https://github.com/diegosouzapw/OmniRoute/pull/9592 | 2026-08-10 | `972d3007913de210332ea17ecf17690e03c17602` | 6 new provider imports in `providers/index.ts`; durindoor `freeModelCatalog.data.js` has poolside models but registry has no poolside entry | Scout each provider individually |
| 9591 | feat(providers): add unorouter back + poolside, fastrouter, anyapi, electronhub, llmgateway, llm-kiwi | https://github.com/diegosouzapw/OmniRoute/pull/9591 | 2026-08-10 | `882f21929c335e33f610db25faa669a5ad849448` | Like 9592 but adds unorouter back (was removed in 9590); durindoor has `omniroute-api-cloud` but not `unorouter` | Scout unorouter specifically |
| 9590 | feat(providers): add 8 new providers | https://github.com/diegosouzapw/OmniRoute/pull/9590 | 2026-08-10 | `c079bbbe050abee0b921bb7246b7ddd891acad74` | 8 new providers in `providers/index.ts`; durindoor grep `zylo-api` = N/A | Scout each provider individually |
| 9589 | feat(providers): add kilocode, mnn-ai, meganova-ai, mixlayer, speka, tokenreply, yolo-auto, dxnt | https://github.com/diegosouzapw/OmniRoute/pull/9589 | 2026-08-10 | `972d3007913de210332ea17ecf17690e03c17602` | 8 new providers; durindoor has `kilocode` (dashboard KiloToolCard + oauth); new models may differ | Scout each provider, port new model entries |
| 9588 | feat(providers): add cloudcode-one | https://github.com/diegosouzapw/OmniRoute/pull/9588 | 2026-08-10 | `882f21929c335e33f610db25faa669a5ad849448` | `cloudcode-one/index.ts`; same as 9888 but earlier; durindoor grep `cloudcode-one` = N/A | Scout, port if needed |
| 9584 | feat(providers): add zylo-api | https://github.com/diegosouzapw/OmniRoute/pull/9584 | 2026-08-10 | `c079bbbe050abee0b921bb7246b7ddd891acad74` | `zylo-api/index.ts`; durindoor grep `zylo-api` = N/A | Scout, port if needed |
| 8080 | fix(provider-catalog): parse TypeScript without require(typescript) | https://github.com/diegosouzapw/OmniRoute/pull/8080 | 2026-08-10 | `b97318d73bd8a6b6c4b0ee9567d7a4d875c08ee1` | `provider-catalog.mjs` TypeScript scanner rewrite; durindoor has `bin/cli/provider-catalog.mjs` | Scout, port if durindoor TS parsing needs improvement |

## DUPLICATE — Already in DurinDoor

| PR# | Title | URL | Updated | Head SHA | Evidence | Recommended Action |
|------|-------|-----|---------|----------|----------|--------------------|
| 10072 | fix(gemini): preserve pattern in tool schema translation | https://github.com/diegosouzapw/OmniRoute/pull/10072 | 2026-08-11 | `1ee291c5f0fd318c61559784986878b33404bbf1` | Upstream PR adds `pattern` preservation to Gemini tool schema translation; durindoor `cleanJSONSchemaForAntigravity` (gemini.js:6-23) does NOT contain `pattern` in `UNSUPPORTED_SCHEMA_CONSTRAINTS` — durindoor already preserves `pattern`. Same desired behavior. | No action needed |

## DEFER — Waiting on upstream merge or trigger condition

| PR# | Title | URL | Updated | Head SHA | Evidence | Recommended Action |
|------|-------|-----|---------|----------|----------|--------------------|
| 10102 | fix(gateway): broken catalog on regolo-type gateway after modelsFetcher merge | https://github.com/diegosouzapw/OmniRoute/pull/10102 | 2026-08-11 | `62eef76081b9ac2c3d58f61830686244e535ca27` | `regolo-gateway.ts` catalog fix; depends on upstream `modelsFetcher` merge | Scout after upstream regolo merge; verify interaction with 10053 worktree |
| 10094 | fix(regolo): regolo-gateway TS type for catalog-based routing | https://github.com/diegosouzapw/OmniRoute/pull/10094 | 2026-08-11 | `b6e0de094f23e2ed15e5498dc258cf48f0a7a75b` | Same regolo-type gateway fix as 10102/10086; depends on upstream catalog merge | Scout after upstream catalog merge |
| 10079 | feat(kimi): MFJS mode support | https://github.com/diegosouzapw/OmniRoute/pull/10079 | 2026-08-11 | `6685b9fe2dbe30a2773231de255cfc158e81f3f4` | `kimi.ts` MFJS mode; durindoor `kimi-web.js` has `resolveModelConfig(scenario)` but MFJS-specific recovery logic unverified. Related fix in #10058 (also PORT). | Scout: verify durindoor kimi-web.js already handles MFJS 503; if yes → DUPLICATE |
| 10055 | fix(pricing): memoize pricing data with 1h TTL | https://github.com/diegosouzapw/OmniRoute/pull/10055 | 2026-08-11 | `cc7ae58c892667e240d892d33cf7a7e98d53ac3c` | `modelsDevSync.ts` pricing memoization; durindoor grep `pricingMemoize\|memoizePricing` = N/A; depends on broader modelsDevSync context | Scout, depends on durindoor modelsDevSync architecture |
| 10036 | chore(deps): bump dev deps | https://github.com/diegosouzapw/OmniRoute/pull/10036 | 2026-08-11 | `4c3f70565f9c59f5be7efdb269a39ed62f99afc1` | Dev dependency bumps only; `electron` 43.2→43.3; would require local testing to merge | No port unless durindoor has specific version requirements |
| 10105 | chore(deps): bump production deps | https://github.com/diegosouzapw/OmniRoute/pull/10105 | 2026-08-11 | `5901faa872690ec7004b5b19806ff52ec181bf41` | Dependabot production dependency bumps (package-lock.json); same category as #10036/#9909 | Scout, depends on whether durindoor has matching version requirements |
| 9909 | chore(deps): bump electron deps | https://github.com/diegosouzapw/OmniRoute/pull/9909 | 2026-08-10 | `bbb7673d74e5d12bfd162ca07ac2a391e3671d77` | `electron/package-lock.json` updates; durindoor has electron package but fork may differ | No port unless durindoor electron needs updating |
| 9210 | feat(a2a): inbound delegation to OmniConductor fleet | https://github.com/diegosouzapw/OmniRoute/pull/9210 | 2026-08-10 | `56e2389871968471d1981e36458e82eff6db4c0b` | Conductor A2A inbound feature; requires `CONDUCTOR_ORCHESTRATOR_TOKEN` + hub integration; durindoor grep `conductorOrchestratorToken` = N/A | Scout, depends on durindoor Conductor integration |
| 9115 | feat(dashboard): Faro chat with voice on Conductor panel | https://github.com/diegosouzapw/OmniRoute/pull/9115 | 2026-08-10 | `d5202522cb6e89d65775855746e0f185f3c4e6d0` | Conductor Faro dashboard feature; durindoor grep `faroProxy` = N/A | Scout, depends on durindoor Conductor dashboard |
| 8875 | feat(dashboard): Conductor panel | https://github.com/diegosouzapw/OmniRoute/pull/8875 | 2026-08-10 | `7ca73697b0f5b9b5645884817fab616b4608ebdc` | `ConductorPageClient.tsx` full panel; durindoor grep `conductor` dashboard = N/A | Scout, depends on durindoor Conductor fleet integration |

## N/A — OmniRoute-internal, dashboard-only, A2A/Faro PRD, CI/release, or duplicate fixes

| PR# | Title | URL | Updated | Head SHA | Evidence | Recommended Action |
|------|-------|-----|---------|----------|----------|--------------------|
| 10112 | docs: rate-limit troubleshooting guide for free providers | https://github.com/diegosouzapw/OmniRoute/pull/10112 | 2026-08-11 | `49cbd58a7553208825c35e088ccb44e8c5b8e81f` | Docs-only; no code changes | No action |
| 10109 | fix(openapi): extractEndpoints handles both compact and full OpenAPI spec | https://github.com/diegosouzapw/OmniRoute/pull/10109 | 2026-08-11 | `3736ed291619f72c1a0d6600401d94973a437379` | `bin/cli/commands/openapi.mjs` CLI-only utility | No action |
| 10108 | fix(openapi): extractEndpoints — same as 10109 | https://github.com/diegosouzapw/OmniRoute/pull/10108 | 2026-08-11 | `bd12b9e8bbc03a20965b1dee4b8e30884c069c42` | Duplicate of 10109 | No action |
| 10101 | fix(api-manager): empty combo allowlist — same as 10042 | https://github.com/diegosouzapw/OmniRoute/pull/10101 | 2026-08-11 | `7a6bfb48f2e85fbf20a75c9f38317a3c2328d989` | Duplicate of 10042 | No action |
| 10097 | fix(chatgpt-web): normalize Zed provider wire values | https://github.com/diegosouzapw/OmniRoute/pull/10097 | 2026-08-11 | `b6e0de094f23e2ed15e5498dc258cf48f0a7a75b` | Duplicate of 10051 | No action |
| 10092 | fix(openapi): extractEndpoints — same as 10109/10108 | https://github.com/diegosouzapw/OmniRoute/pull/10092 | 2026-08-11 | `f4c55689cf8da1da25afd13f15d7c42909a23f7d` | Duplicate (3rd) of 10109 | No action |
| 10091 | fix(omniroute): parse .env values with inline `#` comments correctly | https://github.com/diegosouzapw/OmniRoute/pull/10091 | 2026-08-11 | `6fc744ac65f5bb5c4280c04e80e56655c4e66ab9` | `bin/omniroute.mjs` env parse fix; durindoor has no `bin/omniroute.mjs` | No action |
| 10088 | fix(omniroute): parse .env values with inline `#` comments | https://github.com/diegosouzapw/OmniRoute/pull/10088 | 2026-08-11 | `56e2389871968471d1981e36458e82eff6db4c0b` | Duplicate of 10091 | No action |
| 10087 | chore: remove unused createRequire from provider-catalog | https://github.com/diegosouzapw/OmniRoute/pull/10087 | 2026-08-11 | `d5202522cb6e89d65775855746e0f185f3c4e6d0` | `provider-catalog.mjs` cleanup; CLI-only | No action |
| 10066 | fix(api-manager): empty combo allowlist — same as 10042/10101 | https://github.com/diegosouzapw/OmniRoute/pull/10066 | 2026-08-11 | `fd04db4e408cfb0200e7d8adba57daba5f2349f9` | Duplicate (4th) of 10042 | No action |
| 10065 | fix(mcp): validate MCP auth header Bearer prefix | https://github.com/diegosouzapw/OmniRoute/pull/10065 | 2026-08-11 | `12d79c7984895f8b8e899a94dc89c13e2ece18ce` | `mcpServer.ts` auth validation; MCP not in durindoor | No action |
| 10063 | fix(db): renumber 134→139 compat | https://github.com/diegosouzapw/OmniRoute/pull/10063 | 2026-08-11 | `67214b191aff496f4132a92ad74d5fed068b368e` | Duplicate of 9916 | No action |
| 10060 | fix(ci): pin node:22.23.1-bookworm-slim (node:22 tag causes Railway SIGABRT) | https://github.com/diegosouzapw/OmniRoute/pull/10060 | 2026-08-11 | `0092653ddd966556df332026cc6ba2fc97632c79` | Dockerfile pin + CI guard; durindoor `Dockerfile` uses `node:24-trixie-slim` | Scout if durindoor has Railway deployments |
| 10057 | fix(container): OMNIROUTE_CONTAINER and OMNIROUTE_ALLOW_CONTAINER_CONFIG_WRITE | https://github.com/diegosouzapw/OmniRoute/pull/10057 | 2026-08-11 | `7fefb1dbce21167de9bfd5f2381de060eb848aa4` | `config.mjs` container config guard; durindoor grep `guardHostConfigTarget` = N/A | Scout if durindoor has container CLI config writes |
| 10043 | fix(omniroute): parse .env values with inline `#` comments | https://github.com/diegosouzapw/OmniRoute/pull/10043 | 2026-08-11 | `33defcf0693f4a5703202bf37c76fd6afb0bb1a6` | Duplicate (4th) of 10091 | No action |
| 10039 | fix(db): migration 139 adds ccr_blocks table | https://github.com/diegosouzapw/OmniRoute/pull/10039 | 2026-08-11 | `ab92449dfc6e3bdfc56042693704c1c2f3eed463` | Duplicate of 9618 | No action |
| 8451 | fix(scripts): check-migration-numbering.mjs gap 148 | https://github.com/diegosouzapw/OmniRoute/pull/8451 | 2026-08-10 | `5c4fed3f57c6b4d12418a4fe8eb236f3a0ce1234` | Scripts only; migration numbering metadata | No action |
| 8228 | fix(scripts): check-migration-numbering.mjs gap 147 | https://github.com/diegosouzapw/OmniRoute/pull/8228 | 2026-08-10 | `ab92449dfc6e3bdfc56042693704c1c2f3eed463` | Scripts only; migration numbering metadata | No action |
| 8223 | fix(scripts): check-migration-numbering.mjs gap 147 | https://github.com/diegosouzapw/OmniRoute/pull/8223 | 2026-08-10 | `f87a82b092d488439d5961d21173791940715d24` | Scripts only; migration numbering metadata | No action |
| 8222 | fix(scripts): check-migration-numbering.mjs gap 147 | https://github.com/diegosouzapw/OmniRoute/pull/8222 | 2026-08-10 | `4b2bd2e37f7f619cb4b2ac5e47a0d71d1595312a` | Scripts only; migration numbering metadata | No action |
| 8221 | fix(scripts): check-migration-numbering.mjs gap 147 | https://github.com/diegosouzapw/OmniRoute/pull/8221 | 2026-08-10 | `12b957a2df66d3eddd4a98664e50402849a06c62` | Scripts only; migration numbering metadata | No action |
| 8119 | chore: remove obsolete migration check comment | https://github.com/diegosouzapw/OmniRoute/pull/8119 | 2026-08-10 | `4d6c855258c68dc585c22f73a742c4455f55649c` | Migration runner comment cleanup | No action |

---

## Summary Tally

| Classification | Count | Notes |
|---|---|---|
| **PORT** | 36 | Fork-relevant, not yet in DurinDoor; need scout/port after upstream merge |
| **DEFER** | 10 | Depends on upstream merge, conductor integration, MFJS verification, or specific trigger |
| **N/A** | 22 | OmniRoute-internal, docs, dashboard-only, A2A/Faro PRD, CI/release, duplicate fixes |
| **DUPLICATE** | 1 | 10072 gemini `pattern` — already preserved in durindoor |
| **Total** | **69** | |

## Scout Priorities (highest signal first)

1. **10062** — crof `supportedThinkingEfforts`; confirmed missing from durindoor `crof.js` — clear gap, port after upstream merge
2. **10077** — chatgpt-web `max` tier; confirmed missing from durindoor — clear gap, port `normalizeThinkingEffort`
3. **10098** — `quotaScheduler` + `canAffordRequest`; durindoor has neither — structural new feature, TDD port
4. **10050/10034** — combo `clearLKGP`; durindoor has no `clearLKGP` function (confirmed from prior audit) — port LKGP clear mechanism
5. **10023** — combo `specific` target limits; durindoor grep = N/A — verify combo context compression
6. **10037** — PORT: `streamPayloadCollector` with `format`/`fallbackModel`/`SummaryReducer` absent in durindoor — structural gap. `stream.js` TRANSLATE bug already correct, live reducer additions needed
7. **10072** — DUPLICATE confirmed: `pattern` NOT in durindoor `UNSUPPORTED_SCHEMA_CONSTRAINTS` — no action needed

## Already Tracked in Existing Worktrees

| Worktree | PR | Status |
|---|---|---|
| `wt-port-10053/` | PR #10053 (Codex encrypted tool-schema strip; upstream bloodf/durindoor#404) | Active tracking |
| `wt-compression-repair/` | PR #9629 (compression toggle) | Active tracking |
