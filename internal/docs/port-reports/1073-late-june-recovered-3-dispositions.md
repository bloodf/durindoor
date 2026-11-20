# #1073 - June 21-30 recovered source metadata: part 3 dispositions

Reviewed 2026-11-20. This is a **recorded-disposition ledger** for the third slice of the
recovered June 21-30, 2026 OmniRoute merged-source metadata. It records what each assigned
source row is and what the local DurinDoor tree shows. **It is not a selection slate, it does
not propose work for an owner, and no code was changed.**

## 1. Scope

| Item | Value |
|---|---|
| Source repository | `cheaper-inference/OmniRoute` (public, merged pull requests) |
| Source window | inclusive UTC merge dates 2026-06-21 through 2026-06-30 |
| Assigned slice | zero-based `[380, 571)` of the 762 recovered records, ordered by pull-request number |
| Rows in this slice | **191** |
| Source PR range | **#5008 through #5330** |
| Metadata file | `/var/tmp/durindoor-omni-late-june-metadata._jf7odhu/2026-06-21-30.json` (read as data; no bulk requests were repeated) |
| Row ledger reconciled | [`1073-june3-row-dispositions.md`](1073-june3-row-dispositions.md) |

This ledger covers the `[380, 571)` slice only. The remaining 571 records of the same
recovered June 21-30 metadata are not described or re-dispositioned here, and the slice is
disjoint by merge date from the June 1-10 and June 11-20 windows recorded in
[`1073-june1-row-dispositions.md`](1073-june1-row-dispositions.md),
[`1073-june2-row-dispositions.md`](1073-june2-row-dispositions.md) and
[`1073-june-merged-source-scope.md`](1073-june-merged-source-scope.md).

## 2. Recovered metadata basis and verification

Every check below was recomputed from the metadata file itself in this audit. The orchestrator
had already verified the merge dates, both SHAs and the changed-path pagination; those checks
were repeated here on the assigned slice only, and no additional bulk request was made.

| Check | Result |
|---|---|
| Records in the metadata file | 762 |
| Records in the assigned slice `[380:571]` | **191** |
| Pull-request numbers in the slice | distinct, no duplicates; min 5008, max 5330 |
| Slice disjointness | the 191 numbers do not occur in the other 571 records of the file |
| `state` | `MERGED` on all 191 rows |
| `mergedAt` | ISO-8601 UTC on all 191 rows; every value inside 2026-06-21..2026-06-30 |
| Merge-date range in the slice | 2026-06-25T10:22:28Z .. 2026-06-29T19:51:03Z |
| Per-day merge counts | 2026-06-25: 13, 2026-06-26: 30, 2026-06-27: 58, 2026-06-28: 49, 2026-06-29: 41 |
| `headRefOid` | 40-character lowercase hex present on all 191 rows |
| `mergeCommit.oid` | 40-character lowercase hex present on all 191 rows |
| Head vs. merge SHA | identical on 0 rows, distinct on 191 rows; both are recorded on every row |
| `files.totalCount` vs. `len(files.nodes)` | equal on all 191 rows - no truncated path list |
| `files.pageInfo.hasNextPage` | `false` on all 191 rows |
| Changed-path volume | 4260 path entries; per-row `totalCount` ranges 1-1007 |

The `totalCount == len(nodes)` equality is the load-bearing check: it means the path list of
every row below is complete, so a path that does not appear is a real absence in the source
diff and not a pagination cut-off.

## 3. Reconciliation with the #1073 row ledger

[`1073-june3-row-dispositions.md`](1073-june3-row-dispositions.md) holds the 762-row inventory
for this window. It was recorded from the public search result only, so every row there carries
`UNRESOLVED: search result contains no source SHA` and
`UNRESOLVED: complete changed-file list not obtained`. This ledger closes that gap for the 191
assigned rows only.

| Check | Result |
|---|---|
| Ledger rows parsed | 762 |
| Assigned rows present in the ledger | 191 of 191 - no row is missing |
| Merge date agreement | 191 of 191 - the ledger's merge date equals `mergedAt.slice(0,10)` on every row |
| Pull-request id agreement | the ledger's `pull/N` id equals the metadata `number` on every row |
| Rows newly resolvable | all 191 - exact head and merge SHAs and the complete changed-path set are now available |

The ledger titles are reused below as navigation aids only. A title, a label or a path name is
never treated as evidence of runtime behaviour.

## 4. Method, evidence rules and disposition vocabulary

Rules applied to every row:

- **The metadata file is input data only.** It was read from disk; no GitHub metadata query was
  repeated. A bounded, targeted read of the final diff was made for a small comparison sample
  only (section 5) so that parity claims can rest on the actual source change rather than on a
  file name.
- **A path match does not prove parity.** A local counterpart file only makes a row comparable.
  A row is called covered only when the local implementation was read and matched against the
  upstream change, and the local behaviour is cited by file and line.
- **A path absence is not proof of absence of behaviour.** Where a fork file is organised
  differently from upstream (the fork keeps JS where upstream keeps TypeScript, and several
  upstream modules were re-homed), the local counterpart was searched for under the fork's
  layout before a row was called unresolved.
- **Provider Sign-in is reserved for confirmed new-provider identity and sign-in / credential
  surfaces.** A release rollup that merely happens to touch a provider registry file is not
  assigned to that lane; mixed records stay unresolved with the mixed remainder named.
- **Docs, tests, CI and build-only rows are decided by their complete path set.** A row whose
  complete path list contains no runtime module has no runtime behaviour to port.
- **No live provider, credential, paid API, browser, Docker, e2e path or full test suite was
  used.** The review is static: source diffs, the local tree, and local history.
- **No product file was changed.** This report is the only file added.

| Disposition | Meaning |
|---|---|
| `already covered (ported)` | The upstream change was read and the local implementation was read and matched. The local behaviour is cited by file and line; any bounded difference is named. |
| `new feature lane` | The complete behavioural path set introduces a capability with no local counterpart in this tree. Additive surface, not a missing fix to an existing compatible path. |
| `Provider Sign-in - assigned to the existing Provider Sign-in lane` | The complete path set identifies a new provider identity or an OAuth / sign-in / credential-import surface. Implementation disposition stays in that lane. |
| `docs/tests/CI-only scope` | Every changed path is a test, document, changelog fragment, translated locale file, or CI/quality-tooling definition. No runtime module is touched. |
| `build/dependency-only scope` | Every changed path is a dependency, lockfile, packaging, container or dev-tooling definition. No runtime module is touched. |
| `Unresolved - needs behaviour comparison` | The row changes runtime behaviour and the available path and local evidence does not settle applicability or parity. Not claimed absent and not claimed covered. |

## 5. Bounded behaviour comparison sample

Twelve rows were compared source-against-local, because their complete path set points at an
existing provider or protocol surface with a local counterpart. The final upstream diff was
fetched for these rows only; every other row was classified from the recovered path list and
the local tree. Results are summarised here; the per-row evidence is repeated in section 6.

| Source PR | Upstream change | Local counterpart and behaviour | Result |
|---|---|---|---|
| [#5009](https://github.com/cheaper-inference/OmniRoute/pull/5009) | `open-sse/executors/pollinations.ts` sets `jsonMode` only for `response_format.type` of `json_object`/`json_schema`. | `open-sse/executors/pollinations.js:36-46` sets `jsonMode` under exactly those two conditions and deletes it otherwise. | **Parity confirmed**; the local delete is strictly stricter than upstream. |
| [#5013](https://github.com/cheaper-inference/OmniRoute/pull/5013) | `open-sse/translator/helpers/openaiHelper.ts` keeps `cache_control` when the routed provider honours OpenAI-format cache breakpoints, decided by `open-sse/utils/cacheControlPolicy.ts`. | `open-sse/translator/formats/openai.js:12-19` implements the same `opts.preserveCacheControl` contract; `open-sse/translator/index.js:166,272-273` supplies it from `PROVIDERS[provider].quirks.preserveCacheControl`. Fixture `tests/unit/alicode-cache-control-2069.test.js` covers it. | **Parity confirmed**; the policy lives in the provider registry instead of a dedicated module. |
| [#5019](https://github.com/cheaper-inference/OmniRoute/pull/5019) | `open-sse/executors/codebuddy-cn.ts` makes reasoning params opt-in: `reasoning_summary:"auto"` only when the client set `reasoning_effort`, `reasoning_effort` dropped for `none`/`off`. | `open-sse/executors/codebuddy-cn.js:57-67` has the identical branches. | **Parity confirmed.** |
| [#5101](https://github.com/cheaper-inference/OmniRoute/pull/5101) | `open-sse/executors/default.ts` adds `defaultResponsesTextFormat`, defaulting `text.format` to `{type:"text"}` for `openai-compatible-*` responses providers. | `open-sse/executors/default.js:545-552` has the same method and the same three guards, called at line 416. | **Parity confirmed.** |
| [#5129](https://github.com/cheaper-inference/OmniRoute/pull/5129) / [#5130](https://github.com/cheaper-inference/OmniRoute/pull/5130) | `open-sse/utils/anthropicHost.ts` replaces the `baseUrl.includes("api.anthropic.com")` substring test with exact hostname equality. | `open-sse/utils/anthropicHost.js:22-28` does the exact-hostname check; `open-sse/executors/default.js:766` applies it. The local file header records the port from OmniRoute `b3207ab010`. | **Parity confirmed**, with one bounded difference: upstream re-parses a scheme-less baseUrl with an assumed `https://` prefix, the local helper returns `false` for any unparseable value, so a scheme-less official host is treated as third-party. #5130 is the same change re-landed, with an identical path set. |
| [#5175](https://github.com/cheaper-inference/OmniRoute/pull/5175) | `open-sse/translator/response/claude-to-openai.ts` defers the literal `</think>` close marker so it cannot precede `tool_calls`. | `open-sse/translator/response/claude-to-openai.js:77-83,135-141` never emits a literal `</think>` chunk; end-of-thinking is state-only and thinking text flows through `reasoning_content`. | **Parity confirmed and stronger locally**: the upstream leak cannot occur. |
| [#5224](https://github.com/cheaper-inference/OmniRoute/pull/5224) | `open-sse/handlers/responseSanitizer.ts` adds `shouldParseTextualReasoningTags(provider, model)` so textual `<think>` parsing is scoped per route. | The fork has no `open-sse/handlers/responseSanitizer.js`; textual reasoning handling is `open-sse/utils/thinkStripper.js` and `open-sse/utils/stream.js:637`, with no provider/model gate located. | **Unresolved**: the scoping mechanism was not located in this tree. |
| [#5273](https://github.com/cheaper-inference/OmniRoute/pull/5273) | `open-sse/executors/grok-cli.ts` deletes `presencePenalty`, `frequencyPenalty`, `logprobs`, `topLogprobs` before sending to Grok Build. | `open-sse/executors/grok-cli.js:528-532` deletes those four plus `top_logprobs`. | **Parity confirmed** as a superset. |
| [#5309](https://github.com/cheaper-inference/OmniRoute/pull/5309) | `open-sse/utils/aiSdkCompat.ts` and `src/sse/handlers/chat.ts` stop coercing to SSE when the `Accept` header lists `application/json`. | `open-sse/handlers/chatCore/streamFlag.js:29` starts from `bodyStream === true`, so a body without `stream` stays non-streaming whatever the `Accept` header says. | **Parity confirmed** for the JSON opt-in; one bounded difference: upstream additionally forces SSE for an SSE-only `Accept` with no body `stream`, the local resolver keeps that non-streaming. |
| [#5008](https://github.com/cheaper-inference/OmniRoute/pull/5008) | `open-sse/executors/antigravity.ts` defaults `safetySettings` to all-OFF and preserves a caller-supplied array through the request whitelist. | `open-sse/executors/antigravity.js:487` still sets `safetySettings: undefined`, while the native Gemini paths default all-OFF at `open-sse/translator/formats/gemini.js:121`. | **Unresolved**: a parity gap candidate, scope named in section 6. |
| [#5010](https://github.com/cheaper-inference/OmniRoute/pull/5010) | `open-sse/executors/chatgpt-web.ts` extends `MODEL_MAP` with `gpt-5.5-pro`, `gpt-5.5`, `gpt-5.4-pro`, `gpt-5.2-pro`. | `open-sse/executors/chatgpt-web.js` is a transport dispatcher and holds no advertised-slug map. | **Unresolved**: no local counterpart for the advertised-slug mapping was located. |
| [#5100](https://github.com/cheaper-inference/OmniRoute/pull/5100) | `open-sse/translator/request/claude-to-openai.ts` lifts a base64 image out of a `tool_result` as a `data:` `image_url` part. | `open-sse/translator/request/claude-to-openai.js:360-394` keeps the same structure but replaces the base64 payload with a bounded placeholder and only lifts URL-sourced images. | **Unresolved**: deliberate local divergence, scope named in section 6. |

## 6. Row dispositions

The 191 rows of the assigned slice. `head SHA` and `merge SHA` are both recorded verbatim from
the recovered metadata; the `Files` column records the complete changed-path set as returned by
the finished pagination. The complete path list of every row is reproduced in section 7.

| Source PR | Merged UTC | head SHA / merge SHA | Files | Disposition | Evidence and remaining comparison scope |
|---|---|---|---|---|---|
| [#5008](https://github.com/cheaper-inference/OmniRoute/pull/5008) | 2026-06-25T10:24:17Z | `619dd2f0b87a46bc8f270e47a99032e3613f39f1` / `515bc3465f72342006905c60301c9e51ebfa0389` | 4/4 complete; hasNextPage=false | Unresolved - parity gap candidate | Upstream `open-sse/executors/antigravity.ts` adds `DEFAULT_SAFETY_SETTINGS` as the Antigravity safety default and preserves a caller-supplied `safetySettings` array through the request whitelist. Local `open-sse/executors/antigravity.js:487` still sets `safetySettings: undefined`, while the native Gemini paths do default all-OFF (`open-sse/translator/formats/gemini.js:121` `DEFAULT_SAFETY_SETTINGS`, used at `open-sse/translator/request/openai-to-gemini.js:133` and `open-sse/translator/request/claude-to-gemini.js:37`). Local file `open-sse/translator/helpers/geminiHelper.ts` has no counterpart - the helper moved to `open-sse/translator/formats/gemini.js`. Comparison scope: decide whether the Antigravity executor should default `safetySettings` to `DEFAULT_SAFETY_SETTINGS` and keep a caller-supplied array; no local Anthropic/Gemini parity claim is made here. |
| [#5009](https://github.com/cheaper-inference/OmniRoute/pull/5009) | 2026-06-25T10:22:28Z | `d602a4fda96b252f19ee2903b05574f098af29ce` / `917b2244b6af3b303e2bf15b1d55248c9192834c` | 3/3 complete; hasNextPage=false | already covered (ported) | Upstream `open-sse/executors/pollinations.ts` stops setting `jsonMode` unconditionally and enables it only for `response_format.type` of `json_object`/`json_schema`. Local `open-sse/executors/pollinations.js:36-46` does exactly that and additionally deletes `jsonMode` in every other case, so a caller-supplied `jsonMode:true` cannot survive the local path (upstream mutates the incoming body and would keep it). Parity confirmed for the upstream defect; the local delete is strictly stricter. |
| [#5010](https://github.com/cheaper-inference/OmniRoute/pull/5010) | 2026-06-25T10:25:08Z | `461e56d93a64382a269cc292dbdb831bf1b88feb` / `09d0d11ed580acfae07cdda855b93ac341b85271` | 4/4 complete; hasNextPage=false | Unresolved - no local counterpart | Upstream `open-sse/executors/chatgpt-web.ts` extends `MODEL_MAP` with `gpt-5.5-pro`, `gpt-5.5`, `gpt-5.4-pro` and `gpt-5.2-pro` so advertised slugs are not silently substituted. Local `open-sse/executors/chatgpt-web.js` is a transport dispatcher (browser/http) and carries no advertised-slug map; the local model list is not in that file. Comparison scope: locate the local ChatGPT Web advertised-model list and confirm whether `gpt-5.5-pro`/`gpt-5.5`/`gpt-5.4-pro`/`gpt-5.2-pro` are mapped or substituted before the request leaves the executor. |
| [#5011](https://github.com/cheaper-inference/OmniRoute/pull/5011) | 2026-06-25T10:25:59Z | `0395782dda2ba3e585e856d6bc72fad37c15eb63` / `325188eb9bd157fc62df36e73e75a5a1d5df81da` | 6/6 complete; hasNextPage=false | new feature lane | Adds an editable per-combo description persisted through `/api/combos`; behavioural paths are `src/app/(dashboard)/dashboard/combos/page.tsx` (local counterpart `src/app/(dashboard)/dashboard/combos/page.js`) and the new field in `src/shared/validation/schemas/combo.ts` (no local counterpart - the local combo schema file is absent). Additive dashboard/schema surface, not a change to an existing gateway behaviour. |
| [#5013](https://github.com/cheaper-inference/OmniRoute/pull/5013) | 2026-06-26T14:00:40Z | `b1258aef07d6184718a153fb36cc00e8ea2d38ed` / `c5c8db77dad51e1c756a4c8baa78c84ed68fbec6` | 6/6 complete; hasNextPage=false | already covered (ported) | Upstream `open-sse/translator/helpers/openaiHelper.ts` keeps `cache_control` on OpenAI-format content blocks when the routed provider honours it, driven by `open-sse/utils/cacheControlPolicy.ts`. Local `open-sse/translator/formats/openai.js:12-19` implements the same `opts.preserveCacheControl` contract (`signature` always stripped) and `open-sse/translator/index.js:166,272-273` supplies it from `PROVIDERS[provider].quirks.preserveCacheControl`. Local policy lives in the provider registry rather than a dedicated `cacheControlPolicy` module; `open-sse/translator/helpers/openaiHelper.ts` and `open-sse/utils/cacheControlPolicy.ts` have no local counterpart. Fixture `tests/unit/alicode-cache-control-2069.test.js` covers the same contract. |
| [#5015](https://github.com/cheaper-inference/OmniRoute/pull/5015) | 2026-06-27T01:51:26Z | `4a2383db42bcfd767544b73a6108d79ad6cdb6cc` / `c0830c95ab77ac91df4fe49b51c071d3b6660c64` | 11/11 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: Hydrate quota cache and scope auto combo candidates. 3 of 8 behavioural path(s) have a local counterpart; 5 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/executors/azure-openai.ts` -> local `open-sse/executors/azure-openai.js`; `open-sse/services/combo.ts` -> local `open-sse/services/combo.js`; `src/app/(dashboard)/dashboard/combos/page.tsx` -> local `src/app/(dashboard)/dashboard/combos/page.js`; `open-sse/config/imageRegistry.ts` (no local counterpart at this path); `src/app/(dashboard)/dashboard/combos/BuilderIntelligentStep.tsx` (no local counterpart at this path); `src/app/(dashboard)/dashboard/combos/IntelligentComboPanel.tsx` (no local counterpart at this path); `src/domain/quotaCache.ts` (no local counterpart at this path); `src/lib/db/quotaSnapshots.ts` (no local counterpart at this path). |
| [#5016](https://github.com/cheaper-inference/OmniRoute/pull/5016) | 2026-06-27T01:04:39Z | `d3bd82af764368fbd3837011076d3e1985bfada4` / `25b65ac34ae33d762ae6720d20cdb0bd54bfdee6` | 4/4 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: Track final connection IDs in failover logs. 1 of 3 behavioural path(s) have a local counterpart; 2 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/handlers/chatCore.ts` -> local `open-sse/handlers/chatCore.js`; `open-sse/handlers/chatCore/attemptLogging.ts` (no local counterpart at this path); `src/shared/components/RequestLoggerDetail.tsx` (no local counterpart at this path). |
| [#5019](https://github.com/cheaper-inference/OmniRoute/pull/5019) | 2026-06-26T13:51:28Z | `2fffe490a61fc9927892649f4b7c17bc01041891` / `36c62c7a38816e1656e388052bfc1f5836969949` | 3/3 complete; hasNextPage=false | already covered (ported) | Upstream `open-sse/executors/codebuddy-cn.ts` makes the reasoning params opt-in: `reasoning_summary:"auto"` only when the client set `reasoning_effort`, `reasoning_effort` dropped for `none`/`off`, and nothing forced on plain requests. Local `open-sse/executors/codebuddy-cn.js:57-67` implements the identical branches (`eff === "none" || eff === "off"` -> delete; `else if (eff)` -> `reasoning_summary = "auto"`; otherwise both unset). Parity confirmed. |
| [#5020](https://github.com/cheaper-inference/OmniRoute/pull/5020) | 2026-06-27T01:31:40Z | `8e6a50b6e0f2229fa7d9ee5bd053ecabfa005910` / `2eefe2f76d262d9d77710536a677f1cab46c57f2` | 19/19 complete; hasNextPage=false | Provider Sign-in - assigned to the existing Provider Sign-in lane | New provider identity (Grok Build / xAI) plus an OAuth import-token flow; paths include `open-sse/config/providers/registry/grok-cli/index.ts`, `src/lib/oauth/providers/grok-cli.ts`, `src/app/api/oauth/[provider]/[action]/route.ts` and `src/shared/constants/providers.ts`. Local counterparts already exist for the provider identity (`open-sse/providers/registry/grok-cli.js`, `open-sse/executors/grok-cli.js`, `src/app/(dashboard)/dashboard/providers/[id]/BulkImportGrokCliModal.js`); the import-token flow itself is not compared here. |
| [#5021](https://github.com/cheaper-inference/OmniRoute/pull/5021) | 2026-06-26T13:52:12Z | `a19d20dada5ed212ed3f600392932182cd6c496e` / `eb712d296601e70a43a04595a69cf7074ab90f42` | 5/5 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(sse): keep streaming for forceStream providers when client requests JSON. 1 of 3 behavioural path(s) have a local counterpart; 2 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/handlers/chatCore.ts` -> local `open-sse/handlers/chatCore.js`; `open-sse/config/providers/shared.ts` (no local counterpart at this path); `open-sse/utils/aiSdkCompat.ts` (no local counterpart at this path). |
| [#5022](https://github.com/cheaper-inference/OmniRoute/pull/5022) | 2026-06-25T14:30:34Z | `3c42147a4d9dacd4f7215ebc3a89fc99e85878fa` / `50df2ca42e4d7a8ccfffb461062fc87b08ef9935` | 48/48 complete; hasNextPage=false | new feature lane | Adds per-endpoint custom system-prompt injection; behavioural paths `open-sse/services/systemPrompt.ts` (no local counterpart), `open-sse/handlers/chatCore.js` equivalent `open-sse/handlers/chatCore.ts`, `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.tsx` (local `.../EndpointPageClient.js`) and `src/lib/db/settings.ts` (no local counterpart). Additive configuration surface. |
| [#5023](https://github.com/cheaper-inference/OmniRoute/pull/5023) | 2026-06-25T14:30:42Z | `b74256f2103e5d3664d469bc2900fe04155e51fc` / `2d39c95285d56d2a05ad13c86e912af40fbb1cc7` | 3/3 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(headroom): translate openai-responses input through OpenAI for compression. A local counterpart exists for every behavioural path in the row. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/services/compression/bodyAdapter.ts` -> local `open-sse/services/compression/bodyAdapter.js`. |
| [#5024](https://github.com/cheaper-inference/OmniRoute/pull/5024) | 2026-06-25T14:30:14Z | `1b26a4b7e1e11b539f37506832457ef6e385e20f` / `d40200a26b578f65fa7e7c5cc7820f696ac9b5f0` | 2/2 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(copilot): replace execSync with execFile to prevent command injection. 0 of 1 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/lib/copilot/tools.ts` (no local counterpart at this path). |
| [#5026](https://github.com/cheaper-inference/OmniRoute/pull/5026) | 2026-06-25T19:39:56Z | `689d31864aec003aa23ad822ce7b3bf96bdb9c67` / `cba636b9f03a90197c4dccb5c7760029cdd47821` | 4/4 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(db): replace Math.random with crypto.randomUUID for ID generation. 0 of 3 behavioural path(s) have a local counterpart; 3 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/lib/db/migrationRunner.ts` (no local counterpart at this path; closest local area `src/lib/db/migrate.js`); `src/lib/db/quotaGroups.ts` (no local counterpart at this path); `src/lib/db/quotaPools.ts` (no local counterpart at this path). |
| [#5027](https://github.com/cheaper-inference/OmniRoute/pull/5027) | 2026-06-25T14:30:17Z | `cb9af5b44df0710140175fd7abe01b340f3247b6` / `8c1895574bf85adc050d0462d620f7c8047fcd00` | 8/8 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(plugin): auth.json dual-key fallback for auto-prefix migration. 0 of 1 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `@omniroute/opencode-plugin/src/index.ts` (no local counterpart at this path). |
| [#5028](https://github.com/cheaper-inference/OmniRoute/pull/5028) | 2026-06-25T14:46:22Z | `2fc9876cf6106d5de96647907504937aaabf1df9` / `06882d6a89fe3b52876593f328723eb24140ad21` | 5/5 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(api): stop /api/system/env/repair 500 on packaged install (#5006). 0 of 1 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/app/api/system/env/repair/route.ts` (no local counterpart at this path). |
| [#5029](https://github.com/cheaper-inference/OmniRoute/pull/5029) | 2026-06-25T19:38:45Z | `e040d9ee5712b042365ff31a5172193952e452f5` / `c8639669665f09ab46be9a1082427749ac82c53a` | 4/4 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: fix(release): green v3.8.36 release CI (pack-artifact + resilience keys). Complete changed-path set is non-runtime only (0 doc, 1 test, 2 CI, 1 build path(s)); no runtime module is touched. |
| [#5031](https://github.com/cheaper-inference/OmniRoute/pull/5031) | 2026-06-25T20:22:42Z | `5749466bba5205e88a669107e3688ee85183ccc5` / `b5c789a3b4a258ac327877e0ea2bf1db697fb4d7` | 3/3 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: fix(build): exclude .claude worktrees from tsconfig scope (stops local next build OOM). Complete changed-path set is non-runtime only (1 doc, 0 test, 1 CI, 1 build path(s)); no runtime module is touched. |
| [#5032](https://github.com/cheaper-inference/OmniRoute/pull/5032) | 2026-06-26T14:20:18Z | `f042f24e0f5d8a9ac8c846a9bb1d8b0d7f0d0686` / `7b6a9ed33dc0272f5f61cdf6102717570a48358e` | 12/12 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: Harden selected API error responses. 2 of 7 behavioural path(s) have a local counterpart; 5 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/app/api/logs/export/route.ts` -> local `src/app/api/logs/export/route.js`; `src/app/api/providers/test-batch/route.ts` -> local `src/app/api/providers/test-batch/route.js`; `src/app/api/cli-tools/backups/route.ts` (no local counterpart at this path); `src/app/api/cli-tools/guide-settings/[toolId]/route.ts` (no local counterpart at this path); `src/app/api/models/catalog/route.ts` (no local counterpart at this path); `src/app/api/settings/import-json/route.ts` (no local counterpart at this path); `src/app/api/usage/proxy-logs/route.ts` (no local counterpart at this path). |
| [#5051](https://github.com/cheaper-inference/OmniRoute/pull/5051) | 2026-06-26T14:10:33Z | `f7a33f0f468278aa0f7b059b5de3a08225da4cb3` / `14eab57ed3c104f7500def6d82b8ccea3da69130` | 4/4 complete; hasNextPage=false | Provider Sign-in - assigned to the existing Provider Sign-in lane | New provider identity for media (Alibaba DashScope `wan2.7-t2v`); paths include `open-sse/config/videoRegistry.ts` and `open-sse/handlers/videoGeneration.ts`. Local video providers are under `open-sse/handlers/videoProviders/` (only `minimax.js` present) and no local `open-sse/config/videoRegistry.js` exists, so this provider surface is new here. |
| [#5053](https://github.com/cheaper-inference/OmniRoute/pull/5053) | 2026-06-26T05:51:07Z | `cb49f095b275ca3ee41422ba0963ac5260c8c8e9` / `555b21d296d950865a59d9371c8f850bc68ca300` | 233/233 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: Release v3.8.37. 51 of 94 behavioural path(s) have a local counterpart; 43 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/config/providers/index.ts` -> local `open-sse/providers/index.js`; `open-sse/config/providers/registry/dgrid/index.ts` -> local `open-sse/providers/registry/dgrid.js`; `open-sse/config/providers/registry/github/index.ts` -> local `open-sse/providers/registry/github.js`; `open-sse/config/providers/registry/pioneer/index.ts` -> local `open-sse/providers/registry/pioneer.js`; `open-sse/config/providers/registry/siliconflow/index.ts` -> local `open-sse/providers/registry/siliconflow.js`; `open-sse/executors/antigravity.ts` -> local `open-sse/executors/antigravity.js`; `open-sse/executors/base.ts` -> local `open-sse/executors/base.js`; `open-sse/executors/codex.ts` -> local `open-sse/executors/codex.js`; plus 86 further behavioural path(s) spread over 52 upstream areas (`src/app/api` (8), `src/lib/providers` (7), `open-sse/translator/request` (6), `open-sse/config/providers` (5), `src/app/(dashboard)` (4), `src/shared/constants` (4), `src/lib/db` (3), `src/shared/components` (3), `src/shared/validation` (3), `src/sse/services` (3), `bin/cli/runtime` (2), `open-sse/translator/helpers` (2), `open-sse/translator/response` (2), `src/lib/headroom` (2), `src/shared/utils` (2), `src/sse/handlers` (2), `bin/cli/tray` (1), `open-sse/config/toolCloaking.ts` (1), `open-sse/executors/antigravity.ts` (1), `open-sse/executors/base.ts` (1), `open-sse/executors/codex.ts` (1), `open-sse/executors/cursor.ts` (1), `open-sse/executors/default.ts` (1), `open-sse/executors/gemini-cli.ts` (1), `open-sse/executors/kiro.ts` (1), `open-sse/executors/qoder.ts` (1), `open-sse/handlers/chatCore.ts` (1), `open-sse/handlers/chatCore` (1), `open-sse/handlers/responseSanitizer.ts` (1), `open-sse/package.json` (1), `open-sse/services/model.ts` (1), `open-sse/services/provider.ts` (1), `open-sse/services/tokenRefresh.ts` (1), `open-sse/transformer/responsesTransformer.ts` (1), `open-sse/translator/index.ts` (1), `open-sse/utils/diagnostics.ts` (1), `open-sse/utils/error.ts` (1), `open-sse/utils/flattenToolHistory.ts` (1), `open-sse/utils/kiroSanitizer.ts` (1), `open-sse/utils/streamHandler.ts` (1), `open-sse/utils/toolSources.ts` (1), `open-sse/utils/usageTracking.ts` (1), `src/app/globals.css` (1), `src/lib/combos` (1), `src/lib/dataPaths.ts` (1), `src/lib/embeddings` (1), `src/lib/ipUtils.ts` (1), `src/lib/localDb.ts` (1), `src/lib/oauth` (1), `src/lib/usage` (1), `src/server/authz` (1), `src/shared/services` (1)). The complete path list of the row is in section 7.. |
| [#5054](https://github.com/cheaper-inference/OmniRoute/pull/5054) | 2026-06-25T22:38:25Z | `abf0ee6dd7a329938982d05c7e17594b10ccacf5` / `138f84b93e1d5b321d9225cbf1c91c15fe7361da` | 6/6 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: chore(ci): harden release flow (ratchet decoupling + fast-path drift gates + build-scope guard). Complete changed-path set is non-runtime only (0 doc, 0 test, 3 CI, 3 build path(s)); no runtime module is touched. |
| [#5055](https://github.com/cheaper-inference/OmniRoute/pull/5055) | 2026-06-26T14:18:22Z | `e80136495ac015e934315ad8d2666856f46809f1` / `f7e5d2c26846f91f97a639c38a35cf32eb5cbd62` | 61/61 complete; hasNextPage=false | new feature lane | Adds a summarized thinking-display toggle for Claude Code-compatible connections; behavioural paths are the `ccCompatibleRequestDefaults` / `providerSpecificData` schema family plus `open-sse/services/claudeCodeCompatible.ts`. The fork has no `open-sse/services/claudeCodeCompatible.js` (it keeps `open-sse/services/claudeCodeToolRemapper.js` and `open-sse/services/claudeCodeExtraRemap.js` instead) and no `src/shared/validation/` tree, so no local counterpart was located. Additive provider request-default surface. |
| [#5062](https://github.com/cheaper-inference/OmniRoute/pull/5062) | 2026-06-26T02:07:52Z | `85e511884681f92cb12f6a6bdf7baf7969deb89e` / `ba6f2e034c995b6c718d5e31d24467a4d82f2b23` | 4/4 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(dashboard): align Engine Combos editor engines with API schema (#4955). 0 of 2 behavioural path(s) have a local counterpart; 2 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/app/(dashboard)/dashboard/context/combos/CompressionCombosPageClient.tsx` (no local counterpart at this path); `src/shared/validation/compressionConfigSchemas.ts` (no local counterpart at this path). |
| [#5063](https://github.com/cheaper-inference/OmniRoute/pull/5063) | 2026-06-26T14:09:12Z | `000b2cceaa9ebdef8f6a5e0e90a6114dc82c0f3e` / `98c5fac3ad4fbb0db5bf42c1fc18fe9eeab83175` | 6/6 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(sse): robust Anthropic /v1/messages streaming — real ping keepalive + client-disconnect guard. A local counterpart exists for every behavioural path in the row. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/utils/earlyStreamKeepalive.ts` -> local `open-sse/utils/earlyStreamKeepalive.js`; `open-sse/utils/streamHandler.ts` -> local `open-sse/utils/streamHandler.js`; `src/app/api/v1/messages/route.ts` -> local `src/app/api/v1/messages/route.js`. |
| [#5064](https://github.com/cheaper-inference/OmniRoute/pull/5064) | 2026-06-26T14:06:46Z | `15320ecd27be5310a6c03694aa0949c61d860d3d` / `1b041d8accfb29277f6351834fcbc41d05ee209b` | 5/5 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(sse): don't cool down the connection on a self-inflicted upstream timeout (504). 2 of 3 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/handlers/chatCore.ts` -> local `open-sse/handlers/chatCore.js`; `src/sse/handlers/chat.ts` -> local `src/sse/handlers/chat.js`; `open-sse/handlers/chatCore/cooldownClassification.ts` (no local counterpart at this path). |
| [#5065](https://github.com/cheaper-inference/OmniRoute/pull/5065) | 2026-06-27T01:36:03Z | `504b8e3d7090098bba3eb005a03aacce25096407` / `004c0c4fd1c3e92cb973f9066d81d282a3f7c9cc` | 6/6 complete; hasNextPage=false | Provider Sign-in - assigned to the existing Provider Sign-in lane | New provider identity (factory.ai subscription gateway); paths include `open-sse/config/providers/index.ts`, `open-sse/config/providers/registry/factory/index.ts` and `src/shared/constants/providers/apikey/gateways.ts`. Local `open-sse/providers/registry/factory.js` exists but is explicitly `hidden: true` pending a correct Factory LLM gateway route, so the upstream provider surface is not enabled here. |
| [#5067](https://github.com/cheaper-inference/OmniRoute/pull/5067) | 2026-06-26T04:20:00Z | `2b96783e9a0260679e3149193db08e41ce9dbd3f` / `2e5a0e03a50fda6b0be58f21f68ae383e67c80a2` | 11/11 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: docs(routing): sync combo strategy docs for Fusion (17 strategies). Complete changed-path set is non-runtime only (11 doc, 0 test, 0 CI, 0 build path(s)); no runtime module is touched. |
| [#5070](https://github.com/cheaper-inference/OmniRoute/pull/5070) | 2026-06-26T04:33:42Z | `5a15164c1a97f97687bf366a4058a5952da7b15d` / `749009736e4cee77686b88a42e88a643f22517ae` | 2/2 complete; hasNextPage=false | Provider Sign-in - assigned to the existing Provider Sign-in lane | OAuth/sign-in route surface: the only behavioural path is `src/server/authz/routeGuard.ts`, classifying `/api/oauth/cursor/auto-import` as local-only. Local counterpart `src/server/authz/routeGuard.js` was not compared in this audit. |
| [#5074](https://github.com/cheaper-inference/OmniRoute/pull/5074) | 2026-06-26T20:15:38Z | `6673e3a1428f844917a9a2b288a9c71f1022c5c5` / `68aeb893271696898700753b1ed27bb85e42b336` | 6/6 complete; hasNextPage=false | new feature lane | Exposes the Fusion `judgeModel` and `fusionTuning` combo fields in the dashboard editor; behavioural paths `src/app/(dashboard)/dashboard/combos/page.tsx` (local counterpart exists) and `src/shared/validation/schemas/combo.ts` (no local counterpart). Additive editor surface. |
| [#5078](https://github.com/cheaper-inference/OmniRoute/pull/5078) | 2026-06-27T12:07:12Z | `ae6e2342d1bbc459cae9ef227806ecadca41834e` / `7b139fdb5e42658a49f9d99ddf0eeeba9a994fd8` | 407/407 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: Release v3.8.38. 62 of 174 behavioural path(s) have a local counterpart; 112 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/config/freeModelCatalog.data.ts` -> local `open-sse/config/freeModelCatalog.data.js`; `open-sse/config/providers/index.ts` -> local `open-sse/providers/index.js`; `open-sse/config/providers/registry/blackbox/index.ts` -> local `open-sse/providers/registry/blackbox.js`; `open-sse/config/providers/registry/cline/index.ts` -> local `open-sse/providers/registry/cline.js`; `open-sse/config/providers/registry/factory/index.ts` -> local `open-sse/providers/registry/factory.js`; `open-sse/config/providers/registry/gemini/index.ts` -> local `open-sse/providers/registry/gemini.js`; `open-sse/config/providers/registry/grok-cli/index.ts` -> local `open-sse/providers/registry/grok-cli.js`; `open-sse/config/providers/registry/kiro/index.ts` -> local `open-sse/providers/registry/kiro.js`; plus 166 further behavioural path(s) spread over 71 upstream areas (`src/app/(dashboard)` (30), `src/app/api` (21), `open-sse/services/compression` (14), `open-sse/config/providers` (11), `src/lib/db` (9), `src/shared/constants` (7), `src/shared/validation` (5), `src/shared/components` (4), `open-sse/handlers/chatCore` (3), `src/lib/oauth` (3), `src/lib/usage` (3), `open-sse/translator/helpers` (2), `src/lib/providers` (2), `src/shared/network` (2), `src/sse/handlers` (2), `open-sse/config/anthropicHeaders.ts` (1), `open-sse/config/audioRegistry.ts` (1), `open-sse/config/freeModelCatalog.data.ts` (1), `open-sse/config/imageRegistry.ts` (1), `open-sse/config/videoRegistry.ts` (1), `open-sse/executors/azure-openai.ts` (1), `open-sse/executors/base.ts` (1), `open-sse/executors/codebuddy-cn.ts` (1), `open-sse/executors/cursor.ts` (1), `open-sse/executors/default.ts` (1), `open-sse/executors/grok-cli.ts` (1), `open-sse/executors/index.ts` (1), `open-sse/executors/kiro.ts` (1), `open-sse/executors/kiroThinking.ts` (1), `open-sse/executors/zenmux-free.ts` (1), `open-sse/handlers/audioSpeech.ts` (1), `open-sse/handlers/chatCore.ts` (1), `open-sse/handlers/responseSanitizer.ts` (1), `open-sse/handlers/videoGeneration.ts` (1), `open-sse/mcp-server/tools` (1), `open-sse/package.json` (1), `open-sse/services/accountFallback.ts` (1), `open-sse/services/browserPool.ts` (1), `open-sse/services/claudeCodeCompatible.ts` (1), `open-sse/services/claudeCodeCompatibleThinkingDisplay.ts` (1), `open-sse/services/combo.ts` (1), `open-sse/services/combo` (1), `open-sse/translator/index.ts` (1), `open-sse/translator/request` (1), `open-sse/utils/aiSdkCompat.ts` (1), `open-sse/utils/cacheControlPolicy.ts` (1), `open-sse/utils/composerToolCalls.ts` (1), `open-sse/utils/diagnostics.ts` (1), `open-sse/utils/earlyStreamKeepalive.ts` (1), `open-sse/utils/jsonToSse.ts` (1), `open-sse/utils/passthroughTailProcessor.ts` (1), `open-sse/utils/publicCreds.ts` (1), `open-sse/utils/reasoningFields.ts` (1), `open-sse/utils/socksConnectorWithFamily.ts` (1), `open-sse/utils/stream.ts` (1), `open-sse/utils/streamFailureFinalization.ts` (1), `open-sse/utils/streamHandler.ts` (1), `open-sse/utils/streamHelpers.ts` (1), `src/domain/quotaCache.ts` (1), `src/hooks/usePreviewCompression.ts` (1), `src/lib/api` (1), `src/lib/compression` (1), `src/lib/localDb.ts` (1), `src/lib/quota` (1), `src/lib/services` (1), `src/mitm/handlers` (1), `src/shared/providers` (1), `src/sse/services` (1), `src/store/index.ts` (1), `src/store/providerStore.ts` (1), `src/store/userStore.ts` (1)). The complete path list of the row is in section 7.. |
| [#5080](https://github.com/cheaper-inference/OmniRoute/pull/5080) | 2026-06-26T16:10:06Z | `62aea503d7855dd998bbac6a400f578b48e8dca2` / `721598fe0254282f76203fdecb9a5b6ebf2b9030` | 29/29 complete; hasNextPage=false | new feature lane | Adds the compression playground (Play and Compare tabs) to the compression studio; all behavioural paths are new studio, preview and compare routes under `src/app/(dashboard)/dashboard/compression/` and `src/app/api/compression/` plus `open-sse/services/compression/eval/fidelityCheck.ts`; no local counterpart file exists for any of them. Additive product surface. |
| [#5086](https://github.com/cheaper-inference/OmniRoute/pull/5086) | 2026-06-26T14:13:25Z | `b590b92dc21da6af7a001a225251242c517b8b72` / `7256d34a236b57794d43c503100f965263f5a4ef` | 3/3 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix: preserve model hidden flags (isHidden) across model sync. 0 of 1 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/lib/db/models.ts` (no local counterpart at this path; closest local area `src/lib/db/schema.js`). |
| [#5087](https://github.com/cheaper-inference/OmniRoute/pull/5087) | 2026-06-26T14:14:54Z | `39904dc7db896e17c3609b411e688dee04d7f12f` / `57d10ea9f772ec88272f19a54a31a8aec48fdf01` | 6/6 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(models): derive model discovery config from registry modelsUrl. 3 of 4 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/config/providers/registry/minimax/cn/index.ts` -> local `open-sse/providers/registry/minimax.js`; `open-sse/config/providers/registry/minimax/index.ts` -> local `open-sse/providers/registry/minimax.js`; `src/app/api/providers/[id]/models/route.ts` -> local `src/app/api/providers/[id]/models/route.js`; `src/app/api/providers/[id]/models/discoveryConfig.ts` (no local counterpart at this path). |
| [#5089](https://github.com/cheaper-inference/OmniRoute/pull/5089) | 2026-06-26T14:16:28Z | `28f3d244d6f8ba502a3854480207e3a929a20ee9` / `ef99a3c5baab9b9f7255e58c4af71be861fdf9c0` | 6/6 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(compression): replace fileURLToPath(import.meta.url) with runtime anchors for standalone bundle. 2 of 3 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/services/compression/engines/rtk/filterLoader.ts` -> local `open-sse/services/compression/engines/rtkAdapter.js`; `open-sse/services/compression/ruleLoader.ts` -> local `open-sse/services/compression/ruleLoader.js`; `open-sse/services/compression/engines/llmlingua/worker.ts` (no local counterpart at this path). |
| [#5091](https://github.com/cheaper-inference/OmniRoute/pull/5091) | 2026-06-27T01:24:16Z | `bb3fdb6ac3e6978ff968524e763617423c04b413` / `5f9bf378e76f08fd100944fea1533e4480b4edb0` | 2/2 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(dashboard): key model visibility toggle on canonical providerId. 0 of 1 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/app/(dashboard)/dashboard/providers/[id]/components/ProviderModelsSection.tsx` (no local counterpart at this path; closest local area `src/app/(dashboard)/dashboard/providers/[id]/ components tree`). |
| [#5093](https://github.com/cheaper-inference/OmniRoute/pull/5093) | 2026-06-27T01:46:20Z | `188288453a7a35251039b4cbcbcfaf0b3ee2d3af` / `09ac61589482877be25be2ce5e184fa0cde9f8da` | 6/6 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(resilience): harden quota and model lockout edge cases. 2 of 3 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/services/accountFallback.ts` -> local `open-sse/services/accountFallback.js`; `src/sse/services/auth.ts` -> local `src/sse/services/auth.js`; `open-sse/translator/helpers/geminiHelper.ts` (no local counterpart at this path). |
| [#5100](https://github.com/cheaper-inference/OmniRoute/pull/5100) | 2026-06-26T20:11:15Z | `69be8871847eb439ba13bed8d4c66e81eadaf2d2` / `135b5daaa5a9fa07ad8a36355a1baca1e7d767d7` | 3/3 complete; hasNextPage=false | Unresolved - deliberate local divergence | Upstream `open-sse/translator/request/claude-to-openai.ts` keeps the text of a `tool_result` in the tool message and lifts a base64 image out as an `image_url` part carrying a `data:` URI in the following user turn. Local `open-sse/translator/request/claude-to-openai.js:360-394` keeps the same structure but replaces the base64 payload with a bounded placeholder (`describeOmittedMedia`, `[tool result omitted media]`) and only lifts URL-sourced images (`open-sse/translator/request/claude-to-openai.js:388-392`). Comparison scope: confirm whether the local placeholder is an accepted substitute for upstream `data:` forwarding, given the local rationale recorded at lines 361-369 (token cost and oversized-payload validation). |
| [#5101](https://github.com/cheaper-inference/OmniRoute/pull/5101) | 2026-06-26T20:13:20Z | `7b76dda4e9be9ca8c3e29011d128fa68e1634c11` / `cfaba4410fcdf33a1ed0be6d1694d437fb7246cc` | 4/4 complete; hasNextPage=false | already covered (ported) | Upstream `open-sse/executors/default.ts` adds `defaultResponsesTextFormat`, defaulting `text.format` to `{type:"text"}` for `openai-compatible-*` providers whose id contains `responses`, and calls it from `transformRequest`. Local `open-sse/executors/default.js:545-552` has the same method with the same three guards (provider prefix, `responses` in provider id, `text` is a plain object without `format`), invoked at `open-sse/executors/default.js:416`. Parity confirmed. |
| [#5102](https://github.com/cheaper-inference/OmniRoute/pull/5102) | 2026-06-26T20:20:26Z | `481a4e264545f55011c7d5cc22987e16c9ef59bb` / `d1a3aa8909a67d44e02282bbdbb843a22a50d530` | 1/1 complete; hasNextPage=false | new feature lane | Adds an opt-in Codex/Claude auto-ping keepalive for quota refresh; behavioural path `open-sse/services/browserPool.ts` (local counterpart `open-sse/services/browserPool.js`). Additive opt-in capability. |
| [#5104](https://github.com/cheaper-inference/OmniRoute/pull/5104) | 2026-06-26T17:08:17Z | `511ee3215cf5332d1a5740a5043f205e89c7c5ff` / `5315e73be53fce885760dc7bb64a2ff615cd041f` | 3/3 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(combo): fail over on empty-content 502 instead of exhausting the provider (#5085). 0 of 1 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/services/combo/targetExhaustion.ts` (no local counterpart at this path). |
| [#5105](https://github.com/cheaper-inference/OmniRoute/pull/5105) | 2026-06-27T01:08:28Z | `efa94ee06caf67a898565121791cbdbf7bc1e82d` / `c9fe0fb7a1f9b05f1c456c9e2f670c80c5d7e470` | 7/7 complete; hasNextPage=false | Provider Sign-in - assigned to the existing Provider Sign-in lane | New provider identity (ZenMux Free, session-cookie credential); paths include `open-sse/config/providers/registry/zenmux-free/index.ts`, `open-sse/executors/zenmux-free.ts` and `src/shared/constants/providers/web-cookie.ts`. Local counterparts `open-sse/providers/registry/zenmux-free.js` and `open-sse/executors/zenmux-free.js` already exist; the credential flow is not compared here. |
| [#5106](https://github.com/cheaper-inference/OmniRoute/pull/5106) | 2026-06-26T17:09:42Z | `2e67ea2c8839c8a6988be8042b678026e0af6edf` / `cc6741dd8c88b35758634db983f8007686d2dc56` | 3/3 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(dashboard): surface detailed credential-validation error in add-connection modal (#5088). 0 of 1 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/app/(dashboard)/dashboard/providers/[id]/components/modals/AddApiKeyModal.tsx` (no local counterpart at this path). |
| [#5107](https://github.com/cheaper-inference/OmniRoute/pull/5107) | 2026-06-26T17:10:10Z | `1b5c3396ea3a66c8f5fedc1964be79399b9645f2` / `11cb8f097653d2a7be4f2833240c02f564ba7d7b` | 10/10 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: feat(providers): allow local/private provider URLs by default with metadata-safe guard (#5066). 0 of 4 behavioural path(s) have a local counterpart; 4 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/lib/providers/validation/transport.ts` (no local counterpart at this path); `src/shared/constants/featureFlagDefinitions.ts` (no local counterpart at this path); `src/shared/network/outboundUrlGuard.ts` (no local counterpart at this path); `src/shared/network/safeOutboundFetch.ts` (no local counterpart at this path). |
| [#5112](https://github.com/cheaper-inference/OmniRoute/pull/5112) | 2026-06-27T01:24:23Z | `e2a3d9f6c07ae8bee6fe4b0aeda935b0d129268d` / `843680f6ca1f91fb87c1444b64be396e0cc77d2b` | 4/4 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: chore(deps): bump actions/cache from 5.0.5 to 6.0.0. Complete changed-path set is CI or quality tooling only (4 path(s)); no runtime module is touched. |
| [#5115](https://github.com/cheaper-inference/OmniRoute/pull/5115) | 2026-06-26T19:15:14Z | `26cfa982b81819d1d6a8407080c238e7d2bf1611` / `d486ed16437880136edf7960fa85dbcd6acccf04` | 4/4 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(db): translate pt-BR SQLite driver-fallback log lines to English (#5103). 0 of 2 behavioural path(s) have a local counterpart; 2 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/lib/db/adapters/driverFactory.ts` (no local counterpart at this path; closest local area `src/lib/db/adapters/ (per-driver adapter files, no factory module)`); `src/lib/db/core.ts` (no local counterpart at this path; closest local area `src/lib/db/driver.js and src/lib/db/index.js`). |
| [#5116](https://github.com/cheaper-inference/OmniRoute/pull/5116) | 2026-06-26T19:14:14Z | `afcb760cee74123ac4ae04b372c1d063650aa481` / `db68c9b7909ca566a8a74ec31431a4656765c69a` | 3/3 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(diagnostics): non-streaming Claude responses no longer false-502 as empty_choices (#5108). 0 of 1 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/utils/diagnostics.ts` (no local counterpart at this path). |
| [#5117](https://github.com/cheaper-inference/OmniRoute/pull/5117) | 2026-06-26T19:30:51Z | `48e276f62142e91a49751e66545dc41542131afb` / `800b04ad6da33cdd159e96c3113868836a16b22d` | 8/8 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(sse): repair release/v3.8.38 base-reds (malformed-response false positives + header casing + stale tests). 0 of 2 behavioural path(s) have a local counterpart; 2 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/config/anthropicHeaders.ts` (no local counterpart at this path); `open-sse/handlers/responseSanitizer.ts` (no local counterpart at this path; closest local area `open-sse/handlers/chatCore.js`). |
| [#5119](https://github.com/cheaper-inference/OmniRoute/pull/5119) | 2026-06-27T01:09:30Z | `c4921d7eb98e384447db9a4c3d374b43b11badd8` / `594aa94945fda33682e29c49601247822c493104` | 49/49 complete; hasNextPage=false | new feature lane | Adds click-to-edit model aliases on the provider page; behavioural paths are the provider-page model components (`ProviderModelsSection.tsx`, `ModelRow.tsx`, `PassthroughModelRow.tsx`, `CompatibleModelsSection.tsx`, `PassthroughModelsSection.tsx`), none of which has a local counterpart file. Additive dashboard surface. |
| [#5120](https://github.com/cheaper-inference/OmniRoute/pull/5120) | 2026-06-26T20:26:40Z | `e3099b9e859f38f691a3bf17994e73f61a2f1388` / `05071c011c1e2aced037f5fa1f43d190122f8646` | 2/2 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: test(release): relocate 2 orphan test files to unblock Lint (test-discovery) on #5078. Complete changed-path set is non-runtime only (0 doc, 2 test, 0 CI, 0 build path(s)); no runtime module is touched. |
| [#5121](https://github.com/cheaper-inference/OmniRoute/pull/5121) | 2026-06-27T01:20:10Z | `a105e8914cc516302a99f9e1b1fc068808ef7056` / `57bed419c4e4be25522e430339e07be122a85ee4` | 10/10 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: feat(mcp): web-session robustness — cookie dedup (PR6) + browser-pool observability (PR7) (#3368). 1 of 5 behavioural path(s) have a local counterpart; 4 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/services/browserPool.ts` -> local `open-sse/services/browserPool.js`; `open-sse/mcp-server/tools/poolTools.ts` (no local counterpart at this path); `src/lib/db/providers.ts` (no local counterpart at this path); `src/lib/db/webSessionDedup.ts` (no local counterpart at this path); `src/shared/constants/mcpScopes.ts` (no local counterpart at this path). |
| [#5122](https://github.com/cheaper-inference/OmniRoute/pull/5122) | 2026-06-26T22:12:46Z | `bcbb7d1aade3ef3a40a3fe455d3a6b139e6ad02c` / `58d942829f05179412f879b338538e963cf9d4fd` | 7/7 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(translator): preserve reasoning-replay reasoning_content + repair 3 release-green test reds (#5078). 1 of 2 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/translator/index.ts` -> local `open-sse/translator/index.js`; `open-sse/translator/helpers/openaiHelper.ts` (no local counterpart at this path). |
| [#5124](https://github.com/cheaper-inference/OmniRoute/pull/5124) | 2026-06-27T01:27:12Z | `26ff2d0618921eba5be03c119f78eac4844f8465` / `9e2c2817da8bfcec5f4a19dcc99789cbe3bd863f` | 21/21 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(streaming): harden long OpenAI-compatible SSE streams. 5 of 13 behavioural path(s) have a local counterpart; 8 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/handlers/chatCore.ts` -> local `open-sse/handlers/chatCore.js`; `open-sse/utils/stream.ts` -> local `open-sse/utils/stream.js`; `open-sse/utils/streamHandler.ts` -> local `open-sse/utils/streamHandler.js`; `open-sse/utils/streamHelpers.ts` -> local `open-sse/utils/streamHelpers.js`; `src/sse/handlers/chat.ts` -> local `src/sse/handlers/chat.js`; `open-sse/handlers/chatCore/jsonBodyToSse.ts` (no local counterpart at this path); `open-sse/handlers/responseSanitizer.ts` (no local counterpart at this path; closest local area `open-sse/handlers/chatCore.js`); `open-sse/utils/jsonToSse.ts` (no local counterpart at this path); plus 5 further behavioural path(s) spread over 12 upstream areas (`src/sse/handlers` (2), `open-sse/handlers/chatCore.ts` (1), `open-sse/handlers/chatCore` (1), `open-sse/handlers/responseSanitizer.ts` (1), `open-sse/utils/jsonToSse.ts` (1), `open-sse/utils/passthroughTailProcessor.ts` (1), `open-sse/utils/reasoningFields.ts` (1), `open-sse/utils/stream.ts` (1), `open-sse/utils/streamFailureFinalization.ts` (1), `open-sse/utils/streamHandler.ts` (1), `open-sse/utils/streamHelpers.ts` (1), `src/app/(dashboard)` (1)). The complete path list of the row is in section 7.. |
| [#5125](https://github.com/cheaper-inference/OmniRoute/pull/5125) | 2026-06-26T23:02:33Z | `ae4228b4bd1b59d14be6d402c0b516d32b58a2c4` / `fe8f1dac0f2395d4c23547a9a37df5e23f54473e` | 2/2 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: test(golden): redact live Node version from translate-path snapshot (final #5078 unblock). Complete changed-path set is non-runtime only (0 doc, 2 test, 0 CI, 0 build path(s)); no runtime module is touched. |
| [#5126](https://github.com/cheaper-inference/OmniRoute/pull/5126) | 2026-06-26T23:31:41Z | `5e7fbaae17a3b2749a8bdda6804b8fe7a4fe7949` / `d6f402e0ad0677b8d23e3fda28dbd45511e77b02` | 2/2 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: test(golden): redact app version from translate-path snapshot (Coverage shard unblock #5078). Complete changed-path set is non-runtime only (0 doc, 2 test, 0 CI, 0 build path(s)); no runtime module is touched. |
| [#5127](https://github.com/cheaper-inference/OmniRoute/pull/5127) | 2026-06-27T05:56:07Z | `4ef1c459f6e2078c82db43c4f90dc4047ee3a601` / `2b00e4e4fd549d09dbaae8417fc328b53b8f96b3` | 15/15 complete; hasNextPage=false | new feature lane | Adds an opt-in per-step fidelity gate plus a playground toggle; behavioural paths are new `open-sse/services/compression/fidelityGate*.ts` / `strategySelector.ts` modules and new studio routes; no local counterpart for the new modules. Additive compression capability. |
| [#5129](https://github.com/cheaper-inference/OmniRoute/pull/5129) | 2026-06-27T02:14:27Z | `ca62ec1e6431560723d15768ff59fd111c8ae3a1` / `b3207ab010adc4dcb36b72ebd9497b238712566d` | 3/3 complete; hasNextPage=false | already covered (ported) | Upstream `open-sse/utils/anthropicHost.ts` introduces `isOfficialAnthropicBaseUrl` using exact hostname equality instead of a substring match, and `open-sse/executors/default.ts` uses it for the Anthropic `x-api-key`/`Bearer` decision. Local `open-sse/utils/anthropicHost.js:22-28` performs the same exact-hostname check and `open-sse/executors/default.js:766` applies `baseUrl === "" || isOfficialAnthropicBaseUrl(baseUrl)`; the local file header records the port from OmniRoute `b3207ab010`. One bounded difference to confirm: upstream re-parses a scheme-less baseUrl with an assumed `https://` prefix (so `api.anthropic.com/v1` is official), while the local helper returns `false` for any unparseable value, so a scheme-less official host is treated as third-party and gets the `Bearer` fallback. |
| [#5130](https://github.com/cheaper-inference/OmniRoute/pull/5130) | 2026-06-27T02:14:18Z | `b4a90fda93e55c05e3228ba89053477256c23121` / `86b8938e2c2f772bd6d4a38781610d722a52c72f` | 3/3 complete; hasNextPage=false | already covered (ported) | Same change as #5129 re-landed for the v3.8.38 release: the changed-path set is identical (`open-sse/executors/default.ts`, `open-sse/utils/anthropicHost.ts`) and the local implementation is the one recorded at `open-sse/utils/anthropicHost.js:22-28` and `open-sse/executors/default.js:766`. Parity confirmed, with the same bounded scheme-less-host difference noted for #5129. Recorded as a duplicate source row of #5129, not as an independent gap. |
| [#5132](https://github.com/cheaper-inference/OmniRoute/pull/5132) | 2026-06-27T03:13:55Z | `8b097370f133f71c4797037c5c816f6875b8e309` / `b8cc4feef13e8178ea8b6781f30b1383cd1f35fa` | 6/6 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(proxy): repair one-click Deno & Cloudflare relay deployments (#5128). 0 of 4 behavioural path(s) have a local counterpart; 4 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/app/api/settings/proxy/cloudflare-deploy/route.ts` (no local counterpart at this path); `src/app/api/settings/proxy/test/route.ts` (no local counterpart at this path); `src/lib/db/proxies.ts` (no local counterpart at this path); `src/shared/validation/schemas/proxy.ts` (no local counterpart at this path). |
| [#5133](https://github.com/cheaper-inference/OmniRoute/pull/5133) | 2026-06-27T03:14:59Z | `2b14274ac0d130382a9654e81042682d34707b96` / `c4fc33480ca9a3fb5c75c81d779c3357fab06779` | 4/4 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(services): embed WS proxy honours LIVE_WS_HOST; reject empty messages early (#5110). 1 of 2 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/sse/handlers/chat.ts` -> local `src/sse/handlers/chat.js`; `src/lib/services/embedWsProxy.ts` (no local counterpart at this path). |
| [#5135](https://github.com/cheaper-inference/OmniRoute/pull/5135) | 2026-06-27T04:12:18Z | `fb572447ca20908b40bd81bada9bfacefa89a516` / `454eb75b31b861982e72e17c825a1eb2a4dbad26` | 3/3 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(api): resolve /v1/models/{id} case-insensitively (#5082). 0 of 1 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/app/api/v1/models/modelById.ts` (no local counterpart at this path; closest local area `src/app/api/v1/models/[...model]/`). |
| [#5136](https://github.com/cheaper-inference/OmniRoute/pull/5136) | 2026-06-27T04:13:12Z | `65c481ef81bc275bf004aa4edee331d233be456f` / `7b718134e0fab81a270b297993385a7e5bd91715` | 2/2 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(providers): add MiniMax M3 & Nemotron 3 Ultra to Cline catalog (#3321). A local counterpart exists for every behavioural path in the row. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/config/providers/registry/cline/index.ts` -> local `open-sse/providers/registry/cline.js`. |
| [#5137](https://github.com/cheaper-inference/OmniRoute/pull/5137) | 2026-06-27T04:14:38Z | `c52ccb2e8f8eebc2cf398dd5c550f7e8c7175a5b` / `1677ef55e1092cc8a10d2534055d06c7e356c5fc` | 5/5 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(proxy): tunable SOCKS5 handshake timeout (#5109 mitigation). 0 of 1 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/utils/socksConnectorWithFamily.ts` (no local counterpart at this path). |
| [#5138](https://github.com/cheaper-inference/OmniRoute/pull/5138) | 2026-06-27T06:03:43Z | `20e79ced7837f48102250331572a468a22621b7c` / `cbe82902266a8e0773ba43b0175d46dc832aed97` | 10/10 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: feat: salvage batch from closed stale PRs (#5038, #5057, #5076). 4 of 5 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/app/(dashboard)/dashboard/combos/page.tsx` -> local `src/app/(dashboard)/dashboard/combos/page.js`; `src/store/index.ts` -> local `src/store/index.js`; `src/store/providerStore.ts` -> local `src/store/providerStore.js`; `src/store/userStore.ts` -> local `src/store/userStore.js`; `src/lib/api/serverErrorMessage.ts` (no local counterpart at this path). |
| [#5139](https://github.com/cheaper-inference/OmniRoute/pull/5139) | 2026-06-27T05:22:45Z | `180c59e20c2c049f5d2d10d7ae3426d99ee0e062` / `50e66211011327dd0debcabae0205ce16d770b60` | 4/4 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: Fix resilience settings page response mapping. 0 of 2 behavioural path(s) have a local counterpart; 2 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/app/(dashboard)/dashboard/settings/components/ResilienceTab.tsx` (no local counterpart at this path); `src/app/api/resilience/route.ts` (no local counterpart at this path). |
| [#5141](https://github.com/cheaper-inference/OmniRoute/pull/5141) | 2026-06-27T05:39:29Z | `0b1d733c6f8a3e8c5b07c0dcfe1d8413ed01de43` / `5b8bd727f0a02813bdd970c393d6c6bdc4fc6d1f` | 8/8 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: feat: salvage batch 2 — diagnostics null-guard (#5096) + observed quota reset windows (#5025). 1 of 6 behavioural path(s) have a local counterpart; 5 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/lib/localDb.ts` -> local `src/lib/localDb.js`; `open-sse/utils/diagnostics.ts` (no local counterpart at this path); `src/domain/quotaCache.ts` (no local counterpart at this path); `src/lib/db/migrations/108_provider_quota_reset_events.sql` (no local counterpart at this path); `src/lib/db/quotaResetEvents.ts` (no local counterpart at this path); `src/lib/usage/apiKeyUsageLimits.ts` (no local counterpart at this path). |
| [#5142](https://github.com/cheaper-inference/OmniRoute/pull/5142) | 2026-06-27T05:38:30Z | `414b4ab5b03ae391666fd1f32bd4fc02c20fce39` / `1b446cc92d5343b349a06771a12f65e4a2118e5b` | 1/1 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(sidebar): drop orphan settings accent color (unblocks typecheck:core). 0 of 1 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/shared/constants/sidebarVisibility.ts` (no local counterpart at this path). |
| [#5143](https://github.com/cheaper-inference/OmniRoute/pull/5143) | 2026-06-27T06:08:55Z | `f27a53398e8391ae17328964f29f30fce5779b3a` / `54313b4e9501427f87a3c62f0a2f40a1b184c9f8` | 10/10 complete; hasNextPage=false | new feature lane | Adds fuzzy near-duplicate dedup as a second session-dedup pass plus a playground toggle; behavioural paths `open-sse/services/compression/engines/session-dedup/fuzzy.ts` and `.../index.ts` (local counterpart `open-sse/services/compression/engines/session-dedup/` exists, the upstream `fuzzy` module does not) and new studio routes. Additive compression capability. |
| [#5144](https://github.com/cheaper-inference/OmniRoute/pull/5144) | 2026-06-27T05:47:12Z | `3b5712892816d5c3e2e9626c783e77ba7ec4801b` / `1f83bde19e50570dd24843656fe45197b5ca70d1` | 41/41 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: docs(i18n): sync 3.8.38 CHANGELOG to 41 mirrors (unblock 'Docs accuracy' gate). Complete changed-path set is non-runtime only (41 doc, 0 test, 0 CI, 0 build path(s)); no runtime module is touched. |
| [#5145](https://github.com/cheaper-inference/OmniRoute/pull/5145) | 2026-06-27T06:03:31Z | `17745f4b9aa26771dd6cc0415d953ace2a9d2509` / `513184f281889542835989fbbedb74f3999eb2ca` | 3/3 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: test(usage): wire usageHistoryDedup under unit runner brace-list. Complete changed-path set is non-runtime only (0 doc, 0 test, 2 CI, 1 build path(s)); no runtime module is touched. |
| [#5146](https://github.com/cheaper-inference/OmniRoute/pull/5146) | 2026-06-27T06:03:59Z | `e47ec802b5b92bbe065e1c389538e7fbfaaa1135` / `b6742f038c03ab121d5c1a37efd15a12f2657ba3` | 10/10 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: test(combo): deterministic routing-decision matrix for all 17 strategies. Complete changed-path set is non-runtime only (1 doc, 7 test, 1 CI, 1 build path(s)); no runtime module is touched. |
| [#5147](https://github.com/cheaper-inference/OmniRoute/pull/5147) | 2026-06-27T06:43:12Z | `b7a19c6db73c2a9634d66ba54f8566a28ca5bb1f` / `7caa7f23f12cdd7fb9b3dee4c349f756afebf318` | 1/1 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: chore(quality): rebaseline file-size (sidebarVisibility.ts + chat.ts mid-cycle drift). Complete changed-path set is CI or quality tooling only (1 path(s)); no runtime module is touched. |
| [#5148](https://github.com/cheaper-inference/OmniRoute/pull/5148) | 2026-06-27T10:52:21Z | `51d4efdcb2e81d4105bfc150196c84f6ae235832` / `0c113e19d52245d19bf7f0e74287bb929c399116` | 12/12 complete; hasNextPage=false | new feature lane | Adds the `ionizer` compression engine (lossy JSON-array sampling, reversible via CCR); behavioural paths `open-sse/services/compression/engines/ionizer/*.ts` and the engine index; the local engine directory holds `cavemanAdapter.js`, `ccr/`, `headroomAdapter.js`, `lite.js`, `rtkAdapter.js` and `session-dedup/` and has no ionizer counterpart. Additive compression capability. |
| [#5150](https://github.com/cheaper-inference/OmniRoute/pull/5150) | 2026-06-27T11:02:59Z | `0f38ca7510c24575a0ec9b1c0cc980c30ae0a0b0` / `16449d487448d63e2758db91f48ed867dc5cd7cf` | 3/3 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: test: refresh ionizer branch release expectations. Complete changed-path set is non-runtime only (0 doc, 3 test, 0 CI, 0 build path(s)); no runtime module is touched. |
| [#5151](https://github.com/cheaper-inference/OmniRoute/pull/5151) | 2026-06-27T10:55:39Z | `a2267e0bf83ceda42272f5bc3c198b873618c22a` / `591486e1eae66a32a741edb24b08a463995e535a` | 11/11 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: test(combo): gated live smoke for combo strategies (in-process + VPS HTTP). Complete changed-path set is non-runtime only (2 doc, 4 test, 2 CI, 3 build path(s)); no runtime module is touched. |
| [#5153](https://github.com/cheaper-inference/OmniRoute/pull/5153) | 2026-06-27T10:51:58Z | `977d1b009197d39c634c999e85fec2e91567fac8` / `107e42a21cec66fac88778e63901445f29b80c4b` | 2/2 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: fix(i18n): add missing English UI labels. Complete changed-path set is documentation and test files only (1 doc path(s), 1 test path(s)); no runtime module is touched. |
| [#5155](https://github.com/cheaper-inference/OmniRoute/pull/5155) | 2026-06-27T10:52:03Z | `a384efa7667b19da9e280347d539cee5bc2d55a6` / `905616b24dc9748925b46d0ec595be605f3ae45f` | 3/3 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: Preserve non-stream reasoning fields for compatible clients. 0 of 1 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/handlers/responseSanitizer.ts` (no local counterpart at this path; closest local area `open-sse/handlers/chatCore.js`). |
| [#5156](https://github.com/cheaper-inference/OmniRoute/pull/5156) | 2026-06-28T06:09:27Z | `c47c8e6edb4392d4748861a5f2980e2ce575d6d2` / `4e705b9e002b35ed10efcdd33f48b68aca0f90da` | 2/2 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(translator): accept Claude Messages shape in non-stream malformed-200 guard. 0 of 1 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/utils/diagnostics.ts` (no local counterpart at this path). |
| [#5157](https://github.com/cheaper-inference/OmniRoute/pull/5157) | 2026-06-27T15:09:06Z | `7572084eda633b8efd5b0b136136dec0d22e82a9` / `87ac498d8a42194abb72e5b4165ba4341528f225` | 4/4 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: [codex] fix xAI OAuth test and reasoning effort. 1 of 3 behavioural path(s) have a local counterpart; 2 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/app/api/providers/[id]/test/route.ts` -> local `src/app/api/providers/[id]/test/route.js`; `src/lib/providers/xai/thinking.ts` (no local counterpart at this path); `src/lib/providers/xai/translators/openai-chat.ts` (no local counterpart at this path). |
| [#5158](https://github.com/cheaper-inference/OmniRoute/pull/5158) | 2026-06-27T15:09:02Z | `43563f736ba54d1168c7f9acaf5be9549d8f71c5` / `f82bd3129e9cf76f3ff985666550cad6f2d813aa` | 2/2 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(zenmux): normalize vendor-prefixed GLM system roles. 0 of 1 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/services/roleNormalizer.ts` (no local counterpart at this path). |
| [#5159](https://github.com/cheaper-inference/OmniRoute/pull/5159) | 2026-06-27T15:09:16Z | `36a60ecac3fe34d21c547953dc31f2f1998fa154` / `24b99cb756911c8d020b9bc46a9d057c45793605` | 3/3 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: test(security): guard PII redaction stays opt-in (default off) + Hard Rule #20. Complete changed-path set is documentation and test files only (2 doc path(s), 1 test path(s)); no runtime module is touched. |
| [#5162](https://github.com/cheaper-inference/OmniRoute/pull/5162) | 2026-06-27T15:09:11Z | `567816120e65082f8b962ecbf146cc9e3be3ae59` / `35b0850f7622feab182e55dc8f08328d2f492588` | 4/4 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: docs(i18n): add Traditional Chinese (zh-TW) README and update zh-CN to latest. Complete changed-path set is non-runtime only (4 doc, 0 test, 0 CI, 0 build path(s)); no runtime module is touched. |
| [#5163](https://github.com/cheaper-inference/OmniRoute/pull/5163) | 2026-06-27T15:08:50Z | `f1b067e54c1d9e58c4eda4ab6100fde302e9cd5e` / `0b42ffe02c29888540d00fedbb4b2814822f6381` | 17/17 complete; hasNextPage=false | new feature lane | Adds a TOON best-of-N candidate encoder and an encoder A/B table; behavioural paths `open-sse/services/compression/engines/headroom/*.ts` (TOON / smartcrusher / tabular / encoderComparison) and a new studio table; the local headroom surface is `open-sse/services/compression/engines/headroomAdapter.js` and has no per-encoder counterpart. Additive compression capability. |
| [#5164](https://github.com/cheaper-inference/OmniRoute/pull/5164) | 2026-06-28T09:58:29Z | `00cb89797b986a94617b7daf78e5e5ee404c1a1a` / `dc40911583575cfcee4f937797861c115e9c33d8` | 211/211 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: Release v3.8.39. 23 of 65 behavioural path(s) have a local counterpart; 42 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/executors/antigravity.ts` -> local `open-sse/executors/antigravity.js`; `open-sse/executors/codex.ts` -> local `open-sse/executors/codex.js`; `open-sse/executors/default.ts` -> local `open-sse/executors/default.js`; `open-sse/handlers/chatCore.ts` -> local `open-sse/handlers/chatCore.js`; `open-sse/services/accountFallback.ts` -> local `open-sse/services/accountFallback.js`; `open-sse/services/compression/engines/ccr/index.ts` -> local `open-sse/services/compression/engines/ccr/index.js`; `open-sse/services/compression/engines/headroom/encoderComparison.ts` -> local `open-sse/services/compression/engines/headroomAdapter.js`; `open-sse/services/compression/engines/headroom/index.ts` -> local `open-sse/services/compression/engines/headroomAdapter.js`; plus 57 further behavioural path(s) spread over 38 upstream areas (`src/app/api` (8), `open-sse/services/compression` (7), `src/app/(dashboard)` (5), `src/lib/oauth` (4), `bin/cli/commands` (3), `src/shared/components` (3), `open-sse/translator/response` (2), `src/lib/providers` (2), `src/server/authz` (2), `electron/main.js` (1), `open-sse/executors/antigravity.ts` (1), `open-sse/executors/codex.ts` (1), `open-sse/executors/commandCode.ts` (1), `open-sse/executors/default.ts` (1), `open-sse/handlers/chatCore.ts` (1), `open-sse/handlers/responseSanitizer.ts` (1), `open-sse/handlers/responseTranslator.ts` (1), `open-sse/mcp-server/httpTransport.ts` (1), `open-sse/mcp-server/tools` (1), `open-sse/package.json` (1), `open-sse/services/accountFallback.ts` (1), `open-sse/services/antigravityQuotaFamily.ts` (1), `open-sse/services/combo` (1), `open-sse/services/roleNormalizer.ts` (1), `open-sse/translator/deepseekWebTools.ts` (1), `open-sse/translator/request` (1), `open-sse/utils/diagnostics.ts` (1), `open-sse/utils/finishReason.ts` (1), `open-sse/utils/jsonToSse.ts` (1), `open-sse/utils/proxyDispatcher.ts` (1), `open-sse/utils/proxyDispatcherCache.ts` (1), `open-sse/utils/responsesInputNormalization.ts` (1), `public/sw.js` (1), `src/lib/proxyHealth.ts` (1), `src/mitm/cert` (1), `src/mitm/manager.ts` (1), `src/shared/utils` (1), `src/shared/validation` (1)). The complete path list of the row is in section 7.. |
| [#5168](https://github.com/cheaper-inference/OmniRoute/pull/5168) | 2026-06-27T15:51:07Z | `f7d8c4eb1a054c3fc843569da2a81dbdd22a66ed` / `239c01a3231b8fb616b2778ecff6ee08dcf0af32` | 2/2 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: test(combo): deterministic context-relay universal-handoff coverage. Complete changed-path set is non-runtime only (0 doc, 2 test, 0 CI, 0 build path(s)); no runtime module is touched. |
| [#5170](https://github.com/cheaper-inference/OmniRoute/pull/5170) | 2026-06-27T15:51:13Z | `ceed24dcf9bef4dc47fd2f90eca87afadf7f03b9` / `10ae17975d053d9018430caa6fe1f2a39e19fdbf` | 2/2 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(serve): honour HOSTNAME from .env instead of hardcoding 0.0.0.0 (#5134). 0 of 1 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `bin/cli/commands/serve.mjs` (no local counterpart at this path). |
| [#5171](https://github.com/cheaper-inference/OmniRoute/pull/5171) | 2026-06-27T15:51:10Z | `0f20a9e7e8eba596bca70cb647897ba335795a3d` / `2a41de371615f5a2a2a3e7ae4e0a6e98f6d81740` | 28/28 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: docs(i18n): full sync zh-TW and zh-CN README with canonical English v3.8.39. Complete changed-path set is non-runtime only (28 doc, 0 test, 0 CI, 0 build path(s)); no runtime module is touched. |
| [#5173](https://github.com/cheaper-inference/OmniRoute/pull/5173) | 2026-06-27T15:57:57Z | `9c591803896d070bcefcbeb522de9fc008ee7062` / `e4b3478f470958ff1977ea80dc853dc2625343e8` | 3/3 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(sse): resolve nameless deepseek-web tool blocks (#5154). 0 of 1 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/translator/deepseekWebTools.ts` (no local counterpart at this path). |
| [#5174](https://github.com/cheaper-inference/OmniRoute/pull/5174) | 2026-06-27T15:58:02Z | `d5b42b5b012e58a7576d21ffc25df8c675e1c02c` / `b2aed90711a5ee9c8354681a601b3ff0d68ef15a` | 3/3 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(sse): normalize array user content for Command Code (#5166). 0 of 1 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/executors/commandCode.ts` (no local counterpart at this path). |
| [#5175](https://github.com/cheaper-inference/OmniRoute/pull/5175) | 2026-06-27T16:00:40Z | `fa839c6e5916388ecd4c8a41151a7003dadbac15` / `09b15b72ca1f82434c70a783da6c25f910de8448` | 4/4 complete; hasNextPage=false | already covered (ported) | Upstream `open-sse/translator/response/claude-to-openai.ts` defers the literal `</think>` close marker (`state.pendingThinkClose`) so it cannot be emitted as assistant text before `tool_calls`. Local `open-sse/translator/response/claude-to-openai.js` never emits a literal `</think>` content chunk at all: thinking text flows through `reasoning_content` (`open-sse/translator/response/claude-to-openai.js:77-83`) and end-of-thinking is signalled by state only (`open-sse/translator/response/claude-to-openai.js:135-141`). The upstream leak cannot occur locally; the local behaviour is strictly stronger than the upstream deferral. |
| [#5176](https://github.com/cheaper-inference/OmniRoute/pull/5176) | 2026-06-27T16:05:43Z | `2ede1aec467313ef50e69f2fe6b9938912124bf0` / `17e599b832491066ab6e0bb09b10ab514cb920f4` | 2/2 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(dashboard): use amber for home update-step warning icon. 0 of 1 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/app/(dashboard)/dashboard/HomePageClient.tsx` (no local counterpart at this path; closest local area `src/app/(dashboard)/dashboard/page.js`). |
| [#5177](https://github.com/cheaper-inference/OmniRoute/pull/5177) | 2026-06-27T16:08:09Z | `99a12bae7e1103ce4c74c58bb3dfa8f7f56a61eb` / `ff392e694ccf1ad712746667e04754b2dc9ef3d8` | 9/9 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(api): LAN/Tailscale dashboard — ws: CSP scheme + GET-exempt version route + combo field errors (#5083). 1 of 5 behavioural path(s) have a local counterpart; 4 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/app/api/combos/[id]/route.ts` -> local `src/app/api/combos/[id]/route.js`; `src/middleware.ts` (no local counterpart at this path; closest local area `src/proxy.js and src/dashboardGuard.js`); `src/server/authz/policies/management.ts` (no local counterpart at this path; closest local area `the fork has no `src/server/authz/` layer at all`); `src/server/authz/routeGuard.ts` (no local counterpart at this path; closest local area `the fork has no `src/server/authz/` layer at all`); `src/server/csp.ts` (no local counterpart at this path). |
| [#5178](https://github.com/cheaper-inference/OmniRoute/pull/5178) | 2026-06-27T16:31:40Z | `9111673f14c6ec7afc7b36d63217106427e030c6` / `422b7bd3cf42142ab221d92c83801bc7e1166be4` | 8/8 complete; hasNextPage=false | new feature lane | Adds a graceful cert-install fallback with a manual container guide to the agent bridge; behavioural paths `src/app/api/tools/agent-bridge/cert/route.ts`, `src/app/api/tools/agent-bridge/server/route.ts`, `src/mitm/cert/install.ts`, `src/mitm/manager.ts` and the agent-bridge dashboard page. The fork keeps `src/mitm/cert/install.js` and `src/mitm/manager.js`, but has no `src/app/api/tools/agent-bridge/` routes and no agent-bridge dashboard page, so the agent-bridge surface itself has no local counterpart. Additive capability. |
| [#5179](https://github.com/cheaper-inference/OmniRoute/pull/5179) | 2026-06-27T16:31:36Z | `6df4ae6378929a9e60c4c3b13695b71fba52a8cd` / `898a1cb62dabfb2b907e04c70998bb99134ff1de` | 1/1 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: test(combo): end-to-end quota-share DRR routing-decision coverage (matrix parity). Complete changed-path set is non-runtime only (0 doc, 1 test, 0 CI, 0 build path(s)); no runtime module is touched. |
| [#5180](https://github.com/cheaper-inference/OmniRoute/pull/5180) | 2026-06-27T17:09:47Z | `5fac806c4b54fbb0e328bf971c91c62f0c8888a0` / `d878953b7d73a96bc5fa96d8c075198036c8b213` | 4/4 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(antigravity): retry accounts by quota family. 2 of 3 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/handlers/chatCore.ts` -> local `open-sse/handlers/chatCore.js`; `open-sse/services/accountFallback.ts` -> local `open-sse/services/accountFallback.js`; `open-sse/services/antigravityQuotaFamily.ts` (no local counterpart at this path). |
| [#5182](https://github.com/cheaper-inference/OmniRoute/pull/5182) | 2026-06-27T16:19:07Z | `4ce87e8c30e81cfdd572f352676048dc1ecd557a` / `b1cf8f7955e0e76b3bf224b0ebdb0899c4eeefc8` | 6/6 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(api): replace #5083 global middleware CSP with declarative ws: scheme. 0 of 2 behavioural path(s) have a local counterpart; 2 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/middleware.ts` (no local counterpart at this path; closest local area `src/proxy.js and src/dashboardGuard.js`); `src/server/csp.ts` (no local counterpart at this path). |
| [#5185](https://github.com/cheaper-inference/OmniRoute/pull/5185) | 2026-06-27T19:11:54Z | `bd89c6a27fd0b37398f4e6725691befe8d9a0299` / `edb05bb2ccaea6c11cef73f0bdf82419f670bd6e` | 3/3 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: docs(combo): sync combo/routing-strategy docs to current state + document test coverage. Complete changed-path set is non-runtime only (3 doc, 0 test, 0 CI, 0 build path(s)); no runtime module is touched. |
| [#5187](https://github.com/cheaper-inference/OmniRoute/pull/5187) | 2026-06-27T19:11:49Z | `a57a79e5b1883df4e851b4090916d88b1faebe3d` / `6e4fb24a561f671be1446ebc80be24282248c7a9` | 11/11 complete; hasNextPage=false | new feature lane | Adds CCR ranged/grep/stats retrieval with a ReDoS-safe implementation; behavioural paths `open-sse/services/compression/engines/ccr/ccrQuery.ts`, `.../ccr/index.ts`, `open-sse/mcp-server/tools/compressionTools.ts` and `src/app/api/compression/retrieve/route.ts`; the local CCR surface is `open-sse/services/compression/engines/ccr/` and has no retrieval-route counterpart. Additive compression capability. |
| [#5189](https://github.com/cheaper-inference/OmniRoute/pull/5189) | 2026-06-27T19:11:45Z | `d03d7c0b7b39357e3f1fcc1619de98f417e040ba` / `6baf966b7e9b667afa29b337c340b9a3cb1dd5e6` | 2/2 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: fix(cli): force NODE_ENV to match dev/start run mode in custom Next server. Complete changed-path set is non-runtime only (0 doc, 1 test, 0 CI, 1 build path(s)); no runtime module is touched. |
| [#5191](https://github.com/cheaper-inference/OmniRoute/pull/5191) | 2026-06-27T19:32:43Z | `adeb8d0b66aaae1b49ba3ffcd9c04606a2fe7998` / `eb53f4b60f3631e7aaaa4bc23fb4c9e972466859` | 3/3 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(mcp): return 404 (not 400) for unknown Streamable HTTP session id (#5169). 0 of 1 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/mcp-server/httpTransport.ts` (no local counterpart at this path). |
| [#5193](https://github.com/cheaper-inference/OmniRoute/pull/5193) | 2026-06-28T02:33:56Z | `9158ac8030602333d14c25d4f96cd9cf4b35db89` / `dd5529929b60198c05575654c631cbe8bb3e8457` | 7/7 complete; hasNextPage=false | Provider Sign-in - assigned to the existing Provider Sign-in lane | OAuth sign-in flow (Antigravity login no longer hangs): behavioural paths are `src/lib/oauth/constants/oauth.ts`, `src/lib/oauth/providers/antigravity.ts` and `src/shared/components/OAuthModal.tsx`. Local counterparts `src/lib/oauth/constants/oauth.js`, `src/lib/oauth/providers.js` and `src/shared/components/OAuthModal.js` exist; the flow is not compared here. |
| [#5194](https://github.com/cheaper-inference/OmniRoute/pull/5194) | 2026-06-27T20:45:14Z | `6d30cc3ab8b22258e1209c5d7a5f3865ffb10689` / `d4346354d07988c03af6323247ffde24be453a6a` | 3/3 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(api): respect blocked Auto (Zero-Config) provider in /v1/models catalog (#5192). 0 of 1 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/app/api/v1/models/catalog.ts` (no local counterpart at this path; closest local area `src/app/api/v1/models/buildModelsList.js`). |
| [#5195](https://github.com/cheaper-inference/OmniRoute/pull/5195) | 2026-06-27T21:03:33Z | `d11b017bab04d02816f9a3f88e4c97a532bc858c` / `d540d6017abace8c046dce49fdd5162115a3c51b` | 1/1 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: test(combo): deterministic context-relay codex quota-handoff coverage (closes last gap). Complete changed-path set is non-runtime only (0 doc, 1 test, 0 CI, 0 build path(s)); no runtime module is touched. |
| [#5196](https://github.com/cheaper-inference/OmniRoute/pull/5196) | 2026-06-27T21:50:20Z | `96f5198b31b7f709a032d3e2cae8549a2682d5c3` / `a5bd9d99e8d9b6c26c36f90c1f80748fb02fe966` | 2/2 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: test(ci): wire antigravity-quota-family under test:vitest (fix test-discovery orphan). Complete changed-path set is CI or quality tooling only (2 path(s)); no runtime module is touched. |
| [#5197](https://github.com/cheaper-inference/OmniRoute/pull/5197) | 2026-06-28T07:12:58Z | `4e3c83ccf09e7fb9f1c48494dd6fb62bc11e4faf` / `503e23409a00374f63e0f3b73832c98a34c00fcc` | 9/9 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: Normalize safety finish reasons across Gemini and Antigravity. 2 of 6 behavioural path(s) have a local counterpart; 4 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/executors/antigravity.ts` -> local `open-sse/executors/antigravity.js`; `open-sse/translator/response/gemini-to-openai.ts` -> local `open-sse/translator/response/gemini-to-openai.js`; `open-sse/handlers/responseSanitizer.ts` (no local counterpart at this path; closest local area `open-sse/handlers/chatCore.js`); `open-sse/handlers/responseTranslator.ts` (no local counterpart at this path); `open-sse/utils/finishReason.ts` (no local counterpart at this path); `open-sse/utils/jsonToSse.ts` (no local counterpart at this path). |
| [#5198](https://github.com/cheaper-inference/OmniRoute/pull/5198) | 2026-06-28T07:01:58Z | `8e5c4cc1c99f3a3f05b02ed1eec8f69ebb654cbd` / `7bf399251da30679dcbbf3f91cd260e94a36f980` | 2/2 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: fix(cli): raise dev server Node heap limit to 8GB to prevent OOM. Complete changed-path set is non-runtime only (0 doc, 1 test, 0 CI, 1 build path(s)); no runtime module is touched. |
| [#5200](https://github.com/cheaper-inference/OmniRoute/pull/5200) | 2026-06-28T00:44:04Z | `ef0d6f5f7fd03a81e2bc8f1506be9e9e509ea424` / `22dd424778bc62cf135e5b2668dae61a62ba697a` | 4/4 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(5193): shrink file-size freeze offenders. A local counterpart exists for every behavioural path in the row. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/services/accountFallback.ts` -> local `open-sse/services/accountFallback.js`; `src/app/api/providers/[id]/test/route.ts` -> local `src/app/api/providers/[id]/test/route.js`; `src/shared/components/OAuthModal.tsx` -> local `src/shared/components/OAuthModal.js`. |
| [#5201](https://github.com/cheaper-inference/OmniRoute/pull/5201) | 2026-06-28T07:19:46Z | `bb221c1e801993fbe04cf33dcbebc4b4d8c400a3` / `88a9100e2e26308d8e324d3bee26b389b41ed315` | 2/2 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(request-logger): never render '(-100%)' in compression badge. 0 of 1 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/shared/components/RequestLoggerDetail.tsx` (no local counterpart at this path). |
| [#5202](https://github.com/cheaper-inference/OmniRoute/pull/5202) | 2026-06-28T07:01:55Z | `8e18124337fcb865d2cfeb224abfaf14c3bf60ff` / `c2aff71a335751202cf692754beeef13ff1f4d6b` | 3/3 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(proxy): close dispatchers when clearing cache. 0 of 2 behavioural path(s) have a local counterpart; 2 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/utils/proxyDispatcher.ts` (no local counterpart at this path); `open-sse/utils/proxyDispatcherCache.ts` (no local counterpart at this path). |
| [#5203](https://github.com/cheaper-inference/OmniRoute/pull/5203) | 2026-06-28T03:04:24Z | `fd029c60ac5b6cafa5253f9c8ed9db4bb26e26da` / `c06fa4e8e12da12f91b5c72af0f59960ed0ed4a9` | 15/15 complete; hasNextPage=false | Provider Sign-in - assigned to the existing Provider Sign-in lane | New sign-in surface (remote Antigravity login via local helper plus paste-credentials): behavioural paths are `src/app/api/oauth/[provider]/paste-credentials/route.ts`, `src/lib/oauth/credentialBlob.ts`, `src/lib/oauth/pasteCredentials.ts`, `src/shared/components/OAuthModal.tsx`, `src/shared/components/oauthBlobSubmit.ts` and `src/shared/validation/schemas/auth.ts`. Local counterparts exist for the OAuth surface; the flow is not compared here. |
| [#5204](https://github.com/cheaper-inference/OmniRoute/pull/5204) | 2026-06-28T07:12:55Z | `81b926edf114633008489fe2d5214d19754b1cc8` / `50c8a495be9f150014dd369f137bfaa6eafa0cfd` | 9/9 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(responses): normalize non-array input. 3 of 5 behavioural path(s) have a local counterpart; 2 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/executors/codex.ts` -> local `open-sse/executors/codex.js`; `open-sse/executors/default.ts` -> local `open-sse/executors/default.js`; `open-sse/translator/request/openai-responses.ts` -> local `open-sse/translator/request/openai-responses.js`; `open-sse/utils/responsesInputNormalization.ts` (no local counterpart at this path); `src/shared/utils/inputSanitizer.ts` (no local counterpart at this path). |
| [#5205](https://github.com/cheaper-inference/OmniRoute/pull/5205) | 2026-06-28T07:02:01Z | `d0fbac47961d1ce39262d2f680435a0094e45745` / `4bd8054b3794127eaf785b7899460974b52555d2` | 2/2 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: fix(auth): allow synthetic no-auth fallback for mimocode. Complete changed-path set is non-runtime only (0 doc, 2 test, 0 CI, 0 build path(s)); no runtime module is touched. |
| [#5206](https://github.com/cheaper-inference/OmniRoute/pull/5206) | 2026-06-28T06:09:31Z | `86f8b2eee3cba54ce08968eb07678a9ab285d5fc` / `a5cc116397b9bfceec8f692f07a377d66cf58887` | 1/1 complete; hasNextPage=false | build/dependency-only scope | Subject: fix(cli): default dev bundler to Turbopack (16.2.x panic no longer reproduces). Complete changed-path set is build, packaging, container or dev-tooling only (1 path(s)); no gateway runtime module is touched, so there is no runtime behaviour to port. |
| [#5207](https://github.com/cheaper-inference/OmniRoute/pull/5207) | 2026-06-28T07:50:54Z | `777b1906ee10ab2eb38033caab4d69b6db7f0294` / `32c4a39a98175e7a3f2e70ece122c0ad4c1861a2` | 2/2 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(combo): reject empty Responses API output. 0 of 1 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/services/combo/validateQuality.ts` (no local counterpart at this path). |
| [#5208](https://github.com/cheaper-inference/OmniRoute/pull/5208) | 2026-06-28T07:01:53Z | `fb5b840eaff513a0d57ac8e5b5f662ed756b47ca` / `c8401ab27b25e87dc406519e6216a6c586e3f193` | 2/2 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(proxy): coalesce fast-fail health probes. 0 of 1 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/lib/proxyHealth.ts` (no local counterpart at this path). |
| [#5209](https://github.com/cheaper-inference/OmniRoute/pull/5209) | 2026-06-28T07:50:56Z | `3fe7bba4a68f300812be40e609bb563e61f578a2` / `5ef11c9eb514332f3147fdbb596918bfd282fe09` | 2/2 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(pwa): prefer cached navigation before offline page. A local counterpart exists for every behavioural path in the row. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `public/sw.js` -> local `public/sw.js`. |
| [#5213](https://github.com/cheaper-inference/OmniRoute/pull/5213) | 2026-06-28T06:56:11Z | `c0b3f597b3f2795c0745ca57f0e1acf0d160667b` / `c57aa04d410ed8d8e0dedfe9c350a11f809265bb` | 5/5 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(cli): auto-calibrate server V8 heap from physical RAM (#5172). 0 of 2 behavioural path(s) have a local counterpart; 2 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `bin/cli/commands/serve.mjs` (no local counterpart at this path); `electron/main.js` (no local counterpart at this path). |
| [#5214](https://github.com/cheaper-inference/OmniRoute/pull/5214) | 2026-06-28T07:10:02Z | `6d9a951d357b718114d4fc46a3543c87acd49316` / `14f6666f3340a09f31c03414b3934ad881e2ba25` | 3/3 complete; hasNextPage=false | Provider Sign-in - assigned to the existing Provider Sign-in lane | OAuth credential surface (Antigravity `refresh_token` preserved on an empty upstream response); behavioural path `open-sse/executors/antigravity.ts`, local counterpart `open-sse/executors/antigravity.js`. Not compared here. |
| [#5218](https://github.com/cheaper-inference/OmniRoute/pull/5218) | 2026-06-28T15:58:51Z | `a59f05f114da937269ee812167f64f68cb9f470d` / `3ee53cd56138d2893ef6413aaaf5ad91f13dc71e` | 5/5 complete; hasNextPage=false | new feature lane | Adds HTTP-auth forwarding to internal tool fetches in the MCP server; behavioural paths `open-sse/mcp-server/httpAuthContext.ts`, `httpTransport.ts`, `server.ts` and `tools/advancedTools.ts`; the local tree has no `open-sse/mcp-server/` directory (only `src/lib/mcp/`). Additive capability with no local server counterpart. |
| [#5220](https://github.com/cheaper-inference/OmniRoute/pull/5220) | 2026-06-28T15:55:43Z | `ded61b50c0e825f4bb87f36944ab3c86170e3e60` / `3ab9723a7b12293eb844d3cef0e87df272a8a545` | 1/1 complete; hasNextPage=false | new feature lane | Adds further provider icons; behavioural path `src/shared/components/lobeProviderIcons.ts` (no local counterpart file). Additive asset surface. |
| [#5221](https://github.com/cheaper-inference/OmniRoute/pull/5221) | 2026-06-28T16:36:22Z | `509806dd614c09a877d85b8df050e3065b34b6ea` / `d8a392a47766ee3deb17dfdff75ec285cfab0e92` | 3/3 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(command-code): omit max_tokens when client omits it; correct registry caps. 1 of 2 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/config/providers/registry/command-code/index.ts` -> local `open-sse/providers/registry/command-code.js`; `open-sse/executors/commandCode.ts` (no local counterpart at this path). |
| [#5222](https://github.com/cheaper-inference/OmniRoute/pull/5222) | 2026-06-28T16:05:27Z | `3bda790230931afd47d5ebad9ac61f8671c8b678` / `6f150cfd2c00eeebbd3036fd2c9591f1c0d0116a` | 2/2 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(antigravity): retry excluded accounts via fallback LRU. A local counterpart exists for every behavioural path in the row. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/sse/services/auth.ts` -> local `src/sse/services/auth.js`. |
| [#5223](https://github.com/cheaper-inference/OmniRoute/pull/5223) | 2026-06-28T10:39:27Z | `94302593f2043f6b0c2703d7e63fc4c16c377456` / `fd593c6e96f7663fec3d4a49be5b671157c6a5d8` | 44/44 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: fix(docker): copy open-sse workspace manifest before npm ci (v3.8.39 image). Complete changed-path set is non-runtime only (43 doc, 0 test, 0 CI, 1 build path(s)); no runtime module is touched. |
| [#5224](https://github.com/cheaper-inference/OmniRoute/pull/5224) | 2026-06-28T15:54:33Z | `0b124e27fd5ec269c1e40a040de1060f1fe2c1e2` / `5f4cd53b6e6266eb30a1eac92a98dd3d4c4ba342` | 15/15 complete; hasNextPage=false | Unresolved - scoping mechanism not located | Upstream `open-sse/handlers/responseSanitizer.ts` adds `shouldParseTextualReasoningTags(provider, model)` so textual `<think>` parsing is scoped to known tag-style routes, wired through `open-sse/handlers/chatCore.ts`. Local tree has no `open-sse/handlers/responseSanitizer.js`; textual reasoning handling lives in `open-sse/utils/thinkStripper.js` (`stripThinkTags`, `stripThinkFromResponse`) and `open-sse/utils/stream.js:637` (`createThinkTagStreamExtractor`), and no provider/model gate was located. Comparison scope: confirm whether the local textual think-tag extraction is provider- or model-scoped, and whether the local sanitizer path (elsewhere in `open-sse/handlers/chatCore.js`) needs the same gate. |
| [#5225](https://github.com/cheaper-inference/OmniRoute/pull/5225) | 2026-06-29T11:40:07Z | `ecb17e6b50a2d495e8c74064a26ae1b5f2e1fc37` / `7c23dab64de929686d2326f6824527ba9c746ca9` | 1007/1007 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: Release v3.8.40. 91 of 291 behavioural path(s) have a local counterpart; 200 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/config/freeModelCatalog.data.ts` -> local `open-sse/config/freeModelCatalog.data.js`; `open-sse/config/providers/index.ts` -> local `open-sse/providers/index.js`; `open-sse/config/providers/registry/chatgpt-web/index.ts` -> local `open-sse/providers/registry/chatgpt-web.js`; `open-sse/config/providers/registry/codex/index.ts` -> local `open-sse/providers/registry/codex.js`; `open-sse/config/providers/registry/command-code/index.ts` -> local `open-sse/providers/registry/command-code.js`; `open-sse/config/providers/registry/copilot-m365-web/index.ts` -> local `open-sse/providers/registry/copilot-m365-web.js`; `open-sse/config/providers/registry/gemini/cli/index.ts` -> local `open-sse/providers/registry/gemini.js`; `open-sse/config/providers/registry/grok-cli/index.ts` -> local `open-sse/providers/registry/grok-cli.js`; plus 283 further behavioural path(s) spread over 144 upstream areas (`open-sse/services/compression` (35), `src/app/(dashboard)` (31), `src/app/api` (17), `src/lib/oauth` (15), `open-sse/config/providers` (9), `src/shared/constants` (8), `open-sse/mcp-server/toolSearch` (6), `src/lib/providers` (6), `open-sse/translator/request` (5), `open-sse/translator/response` (5), `bin/cli/commands` (4), `src/lib/db` (4), `src/lib/usage` (4), `open-sse/mcp-server/schemas` (3), `src/shared/components` (3), `bin/cli/tray` (2), `open-sse/handlers/chatCore` (2), `src/lib/copilot` (2), `src/shared/utils` (2), `src/shared/validation` (2), `src/sse/handlers` (2), `src/sse/services` (2), `.mcp.json.example` (1), `@omniroute/opencode-plugin/src` (1), `bin/_ops-common.sh` (1), `bin/cold-start-bench.sh` (1), `bin/nodeRuntimeSupport.mjs` (1), `bin/restore-data.sh` (1), `bin/restore-policies.sh` (1), `bin/rollback.sh` (1), `bin/snapshot-data.sh` (1), `images/tier-flow-dark.svg` (1), `images/tier-flow-light.svg` (1), `open-sse/config/anthropicHeaders.ts` (1), `open-sse/config/cliFingerprints.ts` (1), `open-sse/config/freeModelCatalog.data.ts` (1), `open-sse/config/freeTierCatalog.ts` (1), `open-sse/config/glmProvider.ts` (1), `open-sse/config/providerHeaderProfiles.ts` (1), `open-sse/executors/adapta-web.ts` (1), `open-sse/executors/antigravity.ts` (1), `open-sse/executors/blackbox-web.ts` (1), `open-sse/executors/chatgpt-web.ts` (1), `open-sse/executors/chipotle.ts` (1), `open-sse/executors/claude-web.ts` (1), `open-sse/executors/claudeIdentity.ts` (1), `open-sse/executors/codex.ts` (1), `open-sse/executors/commandCode.ts` (1), `open-sse/executors/copilot-m365-connection.ts` (1), `open-sse/executors/copilot-m365-frames.ts` (1), `open-sse/executors/copilot-m365-web.ts` (1), `open-sse/executors/copilot-web.ts` (1), `open-sse/executors/deepseek-web.ts` (1), `open-sse/executors/default.ts` (1), `open-sse/executors/doubao-web.ts` (1), `open-sse/executors/duckduckgo-web.ts` (1), `open-sse/executors/gemini-business.ts` (1), `open-sse/executors/gemini-cli.ts` (1), `open-sse/executors/gemini-web.ts` (1), `open-sse/executors/grok-cli.ts` (1), `open-sse/executors/grok-web.ts` (1), `open-sse/executors/huggingchat.ts` (1), `open-sse/executors/index.ts` (1), `open-sse/executors/inner-ai.ts` (1), `open-sse/executors/kimi-web.ts` (1), `open-sse/executors/lmarena.ts` (1), `open-sse/executors/mimocode.ts` (1), `open-sse/executors/muse-spark-web.ts` (1), `open-sse/executors/perplexity-web.ts` (1), `open-sse/executors/phind.ts` (1), `open-sse/executors/poe-web.ts` (1), `open-sse/executors/qwen-web.ts` (1), `open-sse/executors/t3-chat-web.ts` (1), `open-sse/executors/theoldllm.ts` (1), `open-sse/executors/trae.ts` (1), `open-sse/executors/v0-vercel-web.ts` (1), `open-sse/executors/venice-web.ts` (1), `open-sse/executors/veoaifree-web.ts` (1), `open-sse/handlers/chatCore.ts` (1), `open-sse/handlers/responseSanitizer.ts` (1), `open-sse/handlers/responseTranslator.ts` (1), `open-sse/mcp-server/httpAuthContext.ts` (1), `open-sse/mcp-server/httpTransport.ts` (1), `open-sse/mcp-server/server.ts` (1), `open-sse/mcp-server/tools` (1), `open-sse/package.json` (1), `open-sse/services/antigravityHeaderScrub.ts` (1), `open-sse/services/antigravityHeaders.ts` (1), `open-sse/services/autoRefreshDaemon.ts` (1), `open-sse/services/browserBackedChat.ts` (1), `open-sse/services/browserPool.ts` (1), `open-sse/services/ccBridgeTransforms.ts` (1), `open-sse/services/claudeCodeCompatible.ts` (1), `open-sse/services/claudeTlsClient.ts` (1), `open-sse/services/claudeTurnstileSolver.ts` (1), `open-sse/services/cloudCodeThinking.ts` (1), `open-sse/services/combo.ts` (1), `open-sse/services/contextManager.ts` (1), `open-sse/services/freeWebSearch.ts` (1), `open-sse/services/geminiCliHeaders.ts` (1), `open-sse/services/grokTlsClient.ts` (1), `open-sse/services/model.ts` (1), `open-sse/services/opencodeOllamaUsage.ts` (1), `open-sse/services/payloadRules.ts` (1), `open-sse/services/provider.ts` (1), `open-sse/services/qoderCli.ts` (1), `open-sse/services/sessionPool` (1), `open-sse/services/tierConfig.ts` (1), `open-sse/services/tierDefaults.json` (1), `open-sse/services/tokenRefresh.ts` (1), `open-sse/services/usage.ts` (1), `open-sse/services/usage` (1), `open-sse/transformer/responsesTransformer.ts` (1), `open-sse/translator/formats.ts` (1), `open-sse/translator/index.ts` (1), `open-sse/types.d.ts` (1), `open-sse/utils/aiSdkCompat.ts` (1), `open-sse/utils/cursorVersionDetector.ts` (1), `open-sse/utils/proxyFallback.ts` (1), `open-sse/utils/publicCreds.ts` (1), `open-sse/utils/stream.ts` (1), `open-sse/utils/streamPayloadCollector.ts` (1), `open-sse/utils/usageTracking.ts` (1), `public/providers/gemini-cli.svg` (1), `src/app/docs` (1), `src/domain/providerExpiration.ts` (1), `src/hooks/usePreviewCompression.ts` (1), `src/lib/acp` (1), `src/lib/cloudflaredTunnel.ts` (1), `src/lib/docsI18nPath.ts` (1), `src/lib/docsSanitizer.ts` (1), `src/lib/modelAliasSeed.ts` (1), `src/lib/modelsDevSync.ts` (1), `src/lib/pricingSync.ts` (1), `src/lib/proxyHealth.ts` (1), `src/lib/services` (1), `src/lib/system` (1), `src/lib/tokenHealthCheck.ts` (1), `src/mitm/handlers` (1), `src/proxy.ts` (1), `src/server/authz` (1), `src/shared/providers` (1), `src/shared/schemas` (1), `src/shared/services` (1)). The complete path list of the row is in section 7.. |
| [#5228](https://github.com/cheaper-inference/OmniRoute/pull/5228) | 2026-06-28T13:23:35Z | `e2ebd3efe61f2adcafa4e112732263ff2bb89ab7` / `0e55bdabd4df4cf3814c19f55792b5941a816550` | 1/1 complete; hasNextPage=false | build/dependency-only scope | Subject: chore(docker): harden base image against container-scan CVEs. Complete changed-path set is build, packaging, container or dev-tooling only (1 path(s)); no gateway runtime module is touched, so there is no runtime behaviour to port. |
| [#5229](https://github.com/cheaper-inference/OmniRoute/pull/5229) | 2026-06-28T13:23:38Z | `4a74942a695fbeb8cbd7a88adddabbd557b2f7de` / `8da9e6ad3f4f80fb589d29f7839b1bf9be71e260` | 1/1 complete; hasNextPage=false | build/dependency-only scope | Subject: chore(docker): harden base image against container-scan CVEs (v3.8.40). Complete changed-path set is build, packaging, container or dev-tooling only (1 path(s)); no gateway runtime module is touched, so there is no runtime behaviour to port. |
| [#5230](https://github.com/cheaper-inference/OmniRoute/pull/5230) | 2026-06-28T16:03:09Z | `fbd1f91ce395230a0b74089f4425e0f265438806` / `6143ffc021d8c9d9044952dfc6134deb3eaf80db` | 5/5 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: fix(cli): ship scripts/build/runtime-env.mjs in npm package (#5227). Complete changed-path set is non-runtime only (1 doc, 2 test, 0 CI, 2 build path(s)); no runtime module is touched. |
| [#5233](https://github.com/cheaper-inference/OmniRoute/pull/5233) | 2026-06-28T15:29:45Z | `1f26607899437b264662ea8dd5842c2cc2f0b315` / `051285a66065ee8bebe51402aba3017d64e3d06c` | 2/2 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: test(docker): skip comment lines in #4076 builder heap-ordering check. Complete changed-path set is documentation and test files only (1 doc path(s), 1 test path(s)); no runtime module is touched. |
| [#5234](https://github.com/cheaper-inference/OmniRoute/pull/5234) | 2026-06-28T15:31:41Z | `c2e23889f85e63606529122861a66b6aa271d38f` / `bc9d18457df762d033b0acb0b3f951f9f8827d45` | 2/2 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: chore(ci): Trivy advisory scan ignores unfixed CVEs (Security-tab noise). Complete changed-path set is CI or quality tooling only (2 path(s)); no runtime module is touched. |
| [#5235](https://github.com/cheaper-inference/OmniRoute/pull/5235) | 2026-06-28T15:31:44Z | `33d833403ee4d868087658c6ff1d0c76695812f4` / `7854b1eef1e30c2b5228efc4cc5f2cce37dd57ed` | 2/2 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: chore(ci): Trivy advisory scan ignores unfixed CVEs (v3.8.40). Complete changed-path set is CI or quality tooling only (2 path(s)); no runtime module is touched. |
| [#5237](https://github.com/cheaper-inference/OmniRoute/pull/5237) | 2026-06-28T17:41:57Z | `05beb2ef23489759ca8dd67da2a0de50cff27e9b` / `0568c37eeef9272c73076f58109b6649049c094f` | 70/70 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(providers): refresh impersonation User-Agents + TLS profiles to current client versions. 20 of 54 behavioural path(s) have a local counterpart; 34 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/executors/adapta-web.ts` -> local `open-sse/executors/adapta-web.js`; `open-sse/executors/chatgpt-web.ts` -> local `open-sse/executors/chatgpt-web.js`; `open-sse/executors/chipotle.ts` -> local `open-sse/executors/chipotle.js`; `open-sse/executors/copilot-web.ts` -> local `open-sse/executors/copilot-web.js`; `open-sse/executors/duckduckgo-web.ts` -> local `open-sse/executors/duckduckgo-web.js`; `open-sse/executors/grok-cli.ts` -> local `open-sse/executors/grok-cli.js`; `open-sse/executors/grok-web.ts` -> local `open-sse/executors/grok-web.js`; `open-sse/executors/huggingchat.ts` -> local `open-sse/executors/huggingchat.js`; plus 46 further behavioural path(s) spread over 50 upstream areas (`src/lib/providers` (4), `src/app/api` (2), `open-sse/config/anthropicHeaders.ts` (1), `open-sse/config/glmProvider.ts` (1), `open-sse/config/providerHeaderProfiles.ts` (1), `open-sse/executors/adapta-web.ts` (1), `open-sse/executors/blackbox-web.ts` (1), `open-sse/executors/chatgpt-web.ts` (1), `open-sse/executors/chipotle.ts` (1), `open-sse/executors/claude-web.ts` (1), `open-sse/executors/claudeIdentity.ts` (1), `open-sse/executors/copilot-web.ts` (1), `open-sse/executors/deepseek-web.ts` (1), `open-sse/executors/doubao-web.ts` (1), `open-sse/executors/duckduckgo-web.ts` (1), `open-sse/executors/gemini-business.ts` (1), `open-sse/executors/gemini-web.ts` (1), `open-sse/executors/grok-cli.ts` (1), `open-sse/executors/grok-web.ts` (1), `open-sse/executors/huggingchat.ts` (1), `open-sse/executors/inner-ai.ts` (1), `open-sse/executors/kimi-web.ts` (1), `open-sse/executors/lmarena.ts` (1), `open-sse/executors/mimocode.ts` (1), `open-sse/executors/muse-spark-web.ts` (1), `open-sse/executors/perplexity-web.ts` (1), `open-sse/executors/phind.ts` (1), `open-sse/executors/poe-web.ts` (1), `open-sse/executors/qwen-web.ts` (1), `open-sse/executors/t3-chat-web.ts` (1), `open-sse/executors/theoldllm.ts` (1), `open-sse/executors/trae.ts` (1), `open-sse/executors/v0-vercel-web.ts` (1), `open-sse/executors/venice-web.ts` (1), `open-sse/executors/veoaifree-web.ts` (1), `open-sse/services/antigravityHeaders.ts` (1), `open-sse/services/autoRefreshDaemon.ts` (1), `open-sse/services/browserBackedChat.ts` (1), `open-sse/services/browserPool.ts` (1), `open-sse/services/ccBridgeTransforms.ts` (1), `open-sse/services/claudeCodeCompatible.ts` (1), `open-sse/services/claudeTlsClient.ts` (1), `open-sse/services/claudeTurnstileSolver.ts` (1), `open-sse/services/freeWebSearch.ts` (1), `open-sse/services/geminiCliHeaders.ts` (1), `open-sse/services/grokTlsClient.ts` (1), `open-sse/services/opencodeOllamaUsage.ts` (1), `open-sse/services/sessionPool` (1), `open-sse/services/usage.ts` (1), `open-sse/utils/cursorVersionDetector.ts` (1)). The complete path list of the row is in section 7.. |
| [#5241](https://github.com/cheaper-inference/OmniRoute/pull/5241) | 2026-06-28T18:38:49Z | `f2feb2042ce0427320c080843751d23c029ac921` / `4c4dcbd6db01db95fc75368614f36e4c982bcf23` | 8/8 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: 🛡️ Sentinel: Security hardening. 0 of 3 behavioural path(s) have a local counterpart; 3 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/app/docs/[...slug]/page.tsx` (no local counterpart at this path); `src/lib/docsI18nPath.ts` (no local counterpart at this path); `src/lib/docsSanitizer.ts` (no local counterpart at this path). |
| [#5243](https://github.com/cheaper-inference/OmniRoute/pull/5243) | 2026-06-28T18:26:45Z | `060572191b596904da3b6475f944ddcc62623fa1` / `462bca68b203366ed1b4ffa8884aae94135f672b` | 19/19 complete; hasNextPage=false | new feature lane | Adds the risk-gate pre-pass that shields sensitive spans from lossy compression; behavioural paths `open-sse/services/compression/riskGate/*.ts` and `preservation.ts`; the local compression directory has no `riskGate` counterpart. Additive compression capability. |
| [#5246](https://github.com/cheaper-inference/OmniRoute/pull/5246) | 2026-06-28T21:12:55Z | `6e37efd8dee73671ede419d18642032fc701910b` / `fa7f81cf0b4b9dab25bfb57edca58aed0e681720` | 569/569 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: Remove discontinued Gemini CLI channel. 35 of 110 behavioural path(s) have a local counterpart; 75 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/config/freeModelCatalog.data.ts` -> local `open-sse/config/freeModelCatalog.data.js`; `open-sse/config/providers/index.ts` -> local `open-sse/providers/index.js`; `open-sse/config/providers/registry/gemini/cli/index.ts` -> local `open-sse/providers/registry/gemini.js`; `open-sse/executors/antigravity.ts` -> local `open-sse/executors/antigravity.js`; `open-sse/executors/gemini-cli.ts` -> local `open-sse/executors/gemini-cli.js`; `open-sse/executors/index.ts` -> local `open-sse/executors/index.js`; `open-sse/services/model.ts` -> local `open-sse/services/model.js`; `open-sse/services/provider.ts` -> local `open-sse/services/provider.js`; plus 102 further behavioural path(s) spread over 52 upstream areas (`src/app/(dashboard)` (18), `src/lib/oauth` (13), `src/app/api` (12), `src/shared/constants` (7), `bin/cli/commands` (3), `open-sse/translator/request` (3), `open-sse/translator/response` (3), `src/shared/components` (3), `open-sse/config/providers` (2), `src/lib/copilot` (2), `src/lib/providers` (2), `src/shared/validation` (2), `@omniroute/opencode-plugin/src` (1), `images/tier-flow-dark.svg` (1), `images/tier-flow-light.svg` (1), `open-sse/config/cliFingerprints.ts` (1), `open-sse/config/freeModelCatalog.data.ts` (1), `open-sse/config/freeTierCatalog.ts` (1), `open-sse/executors/antigravity.ts` (1), `open-sse/executors/gemini-cli.ts` (1), `open-sse/executors/index.ts` (1), `open-sse/handlers/responseTranslator.ts` (1), `open-sse/mcp-server/schemas` (1), `open-sse/services/antigravityHeaderScrub.ts` (1), `open-sse/services/cloudCodeThinking.ts` (1), `open-sse/services/geminiCliHeaders.ts` (1), `open-sse/services/model.ts` (1), `open-sse/services/payloadRules.ts` (1), `open-sse/services/provider.ts` (1), `open-sse/services/tierConfig.ts` (1), `open-sse/services/tierDefaults.json` (1), `open-sse/services/tokenRefresh.ts` (1), `open-sse/services/usage.ts` (1), `open-sse/services/usage` (1), `open-sse/translator/formats.ts` (1), `open-sse/types.d.ts` (1), `open-sse/utils/publicCreds.ts` (1), `open-sse/utils/stream.ts` (1), `open-sse/utils/streamPayloadCollector.ts` (1), `open-sse/utils/usageTracking.ts` (1), `public/providers/gemini-cli.svg` (1), `src/domain/providerExpiration.ts` (1), `src/lib/acp` (1), `src/lib/cloudflaredTunnel.ts` (1), `src/lib/modelAliasSeed.ts` (1), `src/lib/modelsDevSync.ts` (1), `src/lib/pricingSync.ts` (1), `src/lib/tokenHealthCheck.ts` (1), `src/lib/usage` (1), `src/shared/schemas` (1), `src/shared/services` (1), `src/sse/services` (1)). The complete path list of the row is in section 7.. |
| [#5248](https://github.com/cheaper-inference/OmniRoute/pull/5248) | 2026-06-28T20:07:08Z | `9c3e7ca3b8ffdffdefa349f9e26d8e8f17484e14` / `dbe44bb41723a88a70c3b5245228827a9a73d2a1` | 3/3 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(combo): wire session stickiness into round-robin dispatch (#3825). A local counterpart exists for every behavioural path in the row. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/services/combo.ts` -> local `open-sse/services/combo.js`. |
| [#5249](https://github.com/cheaper-inference/OmniRoute/pull/5249) | 2026-06-29T04:33:15Z | `cf39456b1a5c2b56a13d5295e004f9c05e489f17` / `12de25b6f6e2e55e89b22ec99418a50d2b1b71bf` | 2/2 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(combo): advance to next model on 400 'model not supported'. A local counterpart exists for every behavioural path in the row. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/services/combo.ts` -> local `open-sse/services/combo.js`. |
| [#5250](https://github.com/cheaper-inference/OmniRoute/pull/5250) | 2026-06-28T20:32:10Z | `7c535baa0cc1d5988c97dcb04da44b62c63ac463` / `503b1205c61584bd6e2a4821883e7a576d807588` | 3/3 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(codex): drop local_shell tool (no longer supported upstream). A local counterpart exists for every behavioural path in the row. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/executors/codex.ts` -> local `open-sse/executors/codex.js`. |
| [#5252](https://github.com/cheaper-inference/OmniRoute/pull/5252) | 2026-06-28T21:44:44Z | `b52abe929077203a449a7a67582618fee3c806d9` / `29321452a7dfcd29fe549739b4d59cfea65f6a26` | 4/4 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: fix(deps): resolve install warnings and audit vulnerabilities. Complete changed-path set is non-runtime only (0 doc, 0 test, 2 CI, 2 build path(s)); no runtime module is touched. |
| [#5254](https://github.com/cheaper-inference/OmniRoute/pull/5254) | 2026-06-28T20:28:02Z | `fdcaa5500e98b047874a866fe018169a5d162c5d` / `cf8c161a8d87d3dd74c3a323133a92d1b6572caa` | 2/2 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(qoder): coalesce concurrent job token exchanges. 0 of 1 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/services/qoderCli.ts` (no local counterpart at this path). |
| [#5255](https://github.com/cheaper-inference/OmniRoute/pull/5255) | 2026-06-28T21:12:59Z | `9e502087da34f6d2c0e0290183befce0634fd0c6` / `b87b9abe7552151be868d45fb3d1a6d7666110ed` | 4/4 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(proxy): shorten fast-fail negative health cache. 0 of 1 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/lib/proxyHealth.ts` (no local counterpart at this path). |
| [#5256](https://github.com/cheaper-inference/OmniRoute/pull/5256) | 2026-06-28T22:19:21Z | `141b1a86e65f4e433e767d58ea7e28a7eb2ef65e` / `25139348775a592705ed8ed75ed12ca334c964d1` | 2/2 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(responses): keep shell tool caller-side. A local counterpart exists for every behavioural path in the row. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/translator/request/openai-responses.ts` -> local `open-sse/translator/request/openai-responses.js`. |
| [#5257](https://github.com/cheaper-inference/OmniRoute/pull/5257) | 2026-06-28T21:43:51Z | `4fd9e01cdfd9c15f42320ea07dd16ae4bc70e9c3` / `c779be6532bcda2da37c143e47da3323b120e611` | 3/3 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix: preserve provider request headers in logs. A local counterpart exists for every behavioural path in the row. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/handlers/chatCore.ts` -> local `open-sse/handlers/chatCore.js`. |
| [#5258](https://github.com/cheaper-inference/OmniRoute/pull/5258) | 2026-06-28T22:30:48Z | `c73a4b7514b643d3cb32b31045a18f955e600aa9` / `bce5d17e3c3f89ad948e6d9d4d0a18cd68e8ca13` | 3/3 complete; hasNextPage=false | Provider Sign-in - assigned to the existing Provider Sign-in lane | Credential-import surface (Grok CLI `auth.json` accepted as a whole object by the import-token endpoint): behavioural paths `src/lib/oauth/providers/grok-cli.ts` and `src/shared/validation/schemas/auth.ts`; local counterparts `src/lib/oauth/providers.js` and `src/shared/validation/schemas/auth.js` exist. Not compared here. |
| [#5259](https://github.com/cheaper-inference/OmniRoute/pull/5259) | 2026-06-28T22:04:52Z | `f7369ff3e4b0211824818dcde7a6eaf1bdd50ff5` / `04ae5a72f711499dbe4f5a1ba683b26331761bad` | 8/8 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: feat(kilocode): anonymous no-auth access to free models (#4019). 3 of 4 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/config/providers/registry/kilocode/index.ts` -> local `open-sse/providers/registry/kilocode.js`; `open-sse/executors/default.ts` -> local `open-sse/executors/default.js`; `src/shared/constants/providers/oauth.ts` -> local `src/shared/constants/providers.js`; `open-sse/config/providers/shared.ts` (no local counterpart at this path). |
| [#5260](https://github.com/cheaper-inference/OmniRoute/pull/5260) | 2026-06-29T00:59:46Z | `f5633bffd86529de267f0ae15fe0a4a4e73cb6fd` / `898aac5771f4c4daa102e5e5d2804f5c50f765fb` | 21/21 complete; hasNextPage=false | new feature lane | Adds the opt-in QuantumLock cache-prefix stabilization; behavioural paths `open-sse/services/compression/quantumLock/*.ts` plus the strategy selector and studio routes; the local compression directory has no `quantumLock` counterpart. Additive compression capability. |
| [#5261](https://github.com/cheaper-inference/OmniRoute/pull/5261) | 2026-06-28T22:15:47Z | `f5021a9ec0f1e8289893ce4069e81f1472e5fa88` / `8adb40e8d182dba6977cac9d34b68ed96437541e` | 2/2 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(proxy): scope fallback cache by target URL. 0 of 1 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/utils/proxyFallback.ts` (no local counterpart at this path). |
| [#5262](https://github.com/cheaper-inference/OmniRoute/pull/5262) | 2026-06-29T01:07:19Z | `4769e4437a042654c94dfcbca5aa7551262e1f82` / `5ac463781602179386a13c883b5c41faa4612df6` | 234/234 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: docs: reorganize docs/ + accuracy audit + drop Node 20 (rebased onto current release tip). 5 of 15 behavioural path(s) have a local counterpart; 10 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/services/compression/engines/headroom/index.ts` -> local `open-sse/services/compression/engines/headroomAdapter.js`; `src/app/api/oauth/[provider]/[action]/route.ts` -> local `src/app/api/oauth/[provider]/[action]/route.js`; `src/lib/oauth/constants/oauth.ts` -> local `src/lib/oauth/constants/oauth.js`; `src/lib/oauth/providers/windsurf.ts` -> local `src/lib/oauth/providers.js`; `src/shared/components/OAuthModal.tsx` -> local `src/shared/components/OAuthModal.js`; `.mcp.json.example` (no local counterpart at this path); `bin/_ops-common.sh` (no local counterpart at this path); `bin/cold-start-bench.sh` (no local counterpart at this path); plus 7 further behavioural path(s) spread over 14 upstream areas (`src/lib/oauth` (2), `.mcp.json.example` (1), `bin/_ops-common.sh` (1), `bin/cold-start-bench.sh` (1), `bin/nodeRuntimeSupport.mjs` (1), `bin/restore-data.sh` (1), `bin/restore-policies.sh` (1), `bin/rollback.sh` (1), `bin/snapshot-data.sh` (1), `open-sse/services/compression` (1), `src/app/api` (1), `src/lib/services` (1), `src/shared/components` (1), `src/shared/utils` (1)). The complete path list of the row is in section 7.. |
| [#5265](https://github.com/cheaper-inference/OmniRoute/pull/5265) | 2026-06-28T23:54:28Z | `6c91f05ca242810e451f3a983063e8b8c096e9a6` / `35f373e10f9c4667f2a6bad83ac82f94ba877da0` | 2/2 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(qoder): decouple shared job token exchange abort. 0 of 1 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/services/qoderCli.ts` (no local counterpart at this path). |
| [#5266](https://github.com/cheaper-inference/OmniRoute/pull/5266) | 2026-06-28T23:04:24Z | `ad577f55cd92086806e0876637659891a6f2156c` / `2b0c129ab6baf829b4c0da1a4fe59f0f7435ad36` | 3/3 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(dashboard): GitHub releases fallback for Update Available banner (#4100). 0 of 1 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/lib/system/versionCheck.ts` (no local counterpart at this path). |
| [#5267](https://github.com/cheaper-inference/OmniRoute/pull/5267) | 2026-06-28T23:21:48Z | `c655453b8a21ced14fb0a7e9afb1fee386eb1782` / `598bebae264170aaaa0d51b071ccf2fba4b03147` | 3/3 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(agent-bridge): unwrap cloudcode-pa .request envelope for Antigravity IDE (#4294). A local counterpart exists for every behavioural path in the row. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/mitm/handlers/antigravity.ts` -> local `src/mitm/handlers/antigravity.js`. |
| [#5268](https://github.com/cheaper-inference/OmniRoute/pull/5268) | 2026-06-29T00:58:03Z | `85e8879957bc79bf5ec2aa61a9d28fa045f3c561` / `9dc31c7e08cebfbc89fc785aad74e4b186960d71` | 15/15 complete; hasNextPage=false | new feature lane | Adds the optional RTK semantic command-output renderers (git diff, structured table, terraform plan, test green); behavioural paths `open-sse/services/compression/engines/rtk/renderers/*.ts` and `rtk/configSchema.ts`; the local RTK surface is `open-sse/services/compression/engines/rtkAdapter.js` and has no renderer counterpart. Additive compression capability. |
| [#5269](https://github.com/cheaper-inference/OmniRoute/pull/5269) | 2026-06-29T00:30:23Z | `3853f17204a53bf0ecc75bedfc6fb35907f55490` / `99b17f13b653edc1f9c5a01a33904e7ffec5b633` | 18/18 complete; hasNextPage=false | new feature lane | Adds the MCP `omniroute_tool_search` tool with one-line TypeScript signatures; behavioural paths are the whole `open-sse/mcp-server/toolSearch/` tree and the MCP schemas; the local tree has no `open-sse/mcp-server/` directory. Additive capability with no local counterpart. |
| [#5270](https://github.com/cheaper-inference/OmniRoute/pull/5270) | 2026-06-28T23:54:42Z | `6191a54bd53f006eb19f5dd851d26b8bfd99e047` / `58f9e3d8d3285f0330252b63b7791b1485a0e694` | 24/24 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(compression): keep QuantumLock selector under cap. 6 of 12 behavioural path(s) have a local counterpart; 6 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/config/providers/registry/kilocode/index.ts` -> local `open-sse/providers/registry/kilocode.js`; `open-sse/executors/default.ts` -> local `open-sse/executors/default.js`; `open-sse/handlers/chatCore.ts` -> local `open-sse/handlers/chatCore.js`; `open-sse/translator/request/openai-responses.ts` -> local `open-sse/translator/request/openai-responses.js`; `src/lib/oauth/providers/grok-cli.ts` -> local `src/lib/oauth/providers.js`; `src/shared/constants/providers/oauth.ts` -> local `src/shared/constants/providers.js`; `open-sse/config/providers/shared.ts` (no local counterpart at this path); `open-sse/services/compression/cacheAwareConfig.ts` (no local counterpart at this path); `open-sse/services/compression/entrypointWrap.ts` (no local counterpart at this path); `open-sse/services/compression/strategySelector.ts` (no local counterpart at this path); `open-sse/utils/proxyFallback.ts` (no local counterpart at this path); `src/shared/validation/schemas/auth.ts` (no local counterpart at this path). |
| [#5271](https://github.com/cheaper-inference/OmniRoute/pull/5271) | 2026-06-28T23:54:40Z | `1deff13a413d0e897dd80d40d5078c4c9be24fe0` / `3c8bade5474cc108ef42ae18cb482cbbddd895f0` | 2/2 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(compression): split RTK config schema. A local counterpart exists for every behavioural path in the row. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/services/compression/engines/rtk/configSchema.ts` -> local `open-sse/services/compression/engines/rtkAdapter.js`; `open-sse/services/compression/engines/rtk/index.ts` -> local `open-sse/services/compression/engines/rtkAdapter.js`. |
| [#5272](https://github.com/cheaper-inference/OmniRoute/pull/5272) | 2026-06-28T23:54:37Z | `3b702662b9703f158baba79bc232c6a05195fffc` / `3853f17204a53bf0ecc75bedfc6fb35907f55490` | 4/4 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(mcp): split tool search registration schema. 0 of 4 behavioural path(s) have a local counterpart; 4 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/mcp-server/schemas/toolSearch.ts` (no local counterpart at this path); `open-sse/mcp-server/schemas/tools.ts` (no local counterpart at this path); `open-sse/mcp-server/server.ts` (no local counterpart at this path); `open-sse/mcp-server/toolSearch/register.ts` (no local counterpart at this path). |
| [#5273](https://github.com/cheaper-inference/OmniRoute/pull/5273) | 2026-06-29T01:20:39Z | `db360c4002e9830c811ec86d4feed2b675b935fc` / `57f81f60d5eae0524ad3857f11b16ae1bc075eb6` | 3/3 complete; hasNextPage=false | already covered (ported) | Upstream `open-sse/executors/grok-cli.ts` deletes `presencePenalty`, `frequencyPenalty`, `logprobs` and `topLogprobs` before sending to Grok Build, and declares the same list as `unsupportedParams` in the registry entry. Local `open-sse/executors/grok-cli.js:528-532` deletes `frequencyPenalty`, `presencePenalty`, `logprobs`, `top_logprobs` and `topLogprobs`. Parity confirmed as a superset of the upstream list. |
| [#5274](https://github.com/cheaper-inference/OmniRoute/pull/5274) | 2026-06-29T01:17:39Z | `9e731f48e3955771f811f5ee5d31db49c66da3c0` / `1fd19c45ecf9ef11b7faee5e54ab1145ed5842fa` | 8/8 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: [urgent]: fix v1beta authz bypass. 1 of 3 behavioural path(s) have a local counterpart; 2 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/proxy.ts` -> local `src/proxy.js`; `src/app/api/settings/authz-inventory/route.ts` (no local counterpart at this path); `src/server/authz/classify.ts` (no local counterpart at this path; closest local area `the fork has no `src/server/authz/` layer at all`). |
| [#5276](https://github.com/cheaper-inference/OmniRoute/pull/5276) | 2026-06-29T00:39:06Z | `6ee29b8cacd9230b0296bff9ecd81a3898009bce` / `ba38e31ff43dbc8856ee73e2dae2d67b0e48eb3e` | 5/5 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(cli): wire --tray Unix path through the runtime systray2 loader (#4605). 0 of 3 behavioural path(s) have a local counterpart; 3 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `bin/cli/commands/serve.mjs` (no local counterpart at this path); `bin/cli/tray/index.mjs` (no local counterpart at this path); `bin/cli/tray/traySystray.mjs` (no local counterpart at this path). |
| [#5277](https://github.com/cheaper-inference/OmniRoute/pull/5277) | 2026-06-29T00:53:48Z | `3a0a0f5461f81b93f1bf39b1ba9bb7b5948cf63a` / `bc00e32b15194fe954cf09e0daa63ab0ff2ad24a` | 6/6 complete; hasNextPage=false | new feature lane | Records no-op compression runs so the Stacked column becomes visible in analytics; behavioural paths `open-sse/services/compression/resultMemo.ts`, `strategySelector.ts`, `types.ts`, `src/lib/db/compressionAnalytics.ts` and the analytics tab; the local compression directory has no `resultMemo` counterpart. Additive analytics capability. |
| [#5278](https://github.com/cheaper-inference/OmniRoute/pull/5278) | 2026-06-29T04:43:14Z | `7c5703340b5a541f8c8bf8ee190da15374c7ab3a` / `1c18be4f8f0e1dd458444f93ad79fe600af2b841` | 11/11 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix: centralize public origin checks for proxied dashboards. 0 of 3 behavioural path(s) have a local counterpart; 3 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/app/api/providers/health-autopilot/actions/route.ts` (no local counterpart at this path); `src/server/authz/pipeline.ts` (no local counterpart at this path; closest local area `the fork has no `src/server/authz/` layer at all`); `src/server/origin/publicOrigin.ts` (no local counterpart at this path). |
| [#5279](https://github.com/cheaper-inference/OmniRoute/pull/5279) | 2026-06-29T03:19:09Z | `9c5c86c2850d491a4517ebb576838deedc4615ca` / `9a89158414b09c9536ba5333219dfb3c108f91e7` | 13/13 complete; hasNextPage=false | new feature lane | Adds a call-log correlation ID; behavioural paths `src/lib/usage/callLogs.ts`, `src/lib/db/migrations/109_call_logs_correlation_id.sql`, `src/lib/db/schemaColumns.ts` and `open-sse/handlers/chatCore/attemptLogging.ts`. The fork's `src/lib/usage/` holds only quota adapters and has no call-log store, `src/lib/db/schemaColumns.js` and the correlation-id migration file have no local counterpart, and `open-sse/handlers/chatCore/attemptLogging.ts` has no local counterpart. Additive logging capability. |
| [#5280](https://github.com/cheaper-inference/OmniRoute/pull/5280) | 2026-06-29T03:17:14Z | `994ad8ec7ccff79c36caf945839cd8fcf5248461` / `f5445a2e5e368b64563de5f56fc99b1f9c0d3246` | 8/8 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(providers): drop retired chatgpt-web/codex models (gpt-5.2, gpt-4.5). 4 of 5 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/config/providers/registry/chatgpt-web/index.ts` -> local `open-sse/providers/registry/chatgpt-web.js`; `open-sse/config/providers/registry/codex/index.ts` -> local `open-sse/providers/registry/codex.js`; `open-sse/executors/chatgpt-web.ts` -> local `open-sse/executors/chatgpt-web.js`; `open-sse/executors/codex.ts` -> local `open-sse/executors/codex.js`; `src/app/(dashboard)/dashboard/cli-code/components/CodexToolCard.tsx` (no local counterpart at this path). |
| [#5281](https://github.com/cheaper-inference/OmniRoute/pull/5281) | 2026-06-29T03:39:31Z | `51646c0c33482f533cd2539b3d9cffba59c87293` / `c8833fd3e0cb977c2e3e9a4f7a33871576d6f4a2` | 8/8 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(dashboard): keep disabled no-auth providers visible with in-place enable (#5183). 1 of 3 behavioural path(s) have a local counterpart; 2 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/app/(dashboard)/dashboard/providers/page.tsx` -> local `src/app/(dashboard)/dashboard/providers/page.js`; `src/app/(dashboard)/dashboard/providers/components/NoAuthProvidersSection.tsx` (no local counterpart at this path); `src/shared/utils/noAuthProviders.ts` (no local counterpart at this path). |
| [#5282](https://github.com/cheaper-inference/OmniRoute/pull/5282) | 2026-06-29T03:13:45Z | `9f9e81bb7e1664b0db96bbe14659b53668db38a7` / `9b0adabb173f0fa36ae7e51bddb8ebf74a9baf80` | 5/5 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(mcp): break tools.ts ↔ toolSearch.ts cycle (check:cycles red on release). 0 of 3 behavioural path(s) have a local counterpart; 3 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/mcp-server/schemas/toolDefinition.ts` (no local counterpart at this path); `open-sse/mcp-server/schemas/toolSearch.ts` (no local counterpart at this path); `open-sse/mcp-server/schemas/tools.ts` (no local counterpart at this path). |
| [#5283](https://github.com/cheaper-inference/OmniRoute/pull/5283) | 2026-06-29T03:16:15Z | `a5cbb39410597e2a1819e99e6e4bf3337318721c` / `f8620742095f97c91f2896f3f65e7d48990a5e8e` | 5/5 complete; hasNextPage=false | new feature lane | Adds the composite-command splitter used by RTK detection; behavioural paths `open-sse/services/compression/engines/rtk/commandDetector.ts` and `rtk/splitCompositeCommand.ts`; the local RTK surface is `open-sse/services/compression/engines/rtkAdapter.js` and has no splitter counterpart. Additive compression capability. |
| [#5284](https://github.com/cheaper-inference/OmniRoute/pull/5284) | 2026-06-29T03:24:23Z | `21bae5e5809e6c2d2d2aab8305df64b268abc999` / `a71157a1b8cbd87c49589705aabde090d316cdd6` | 8/8 complete; hasNextPage=false | new feature lane | Adds the inline transparency annotation to the compression studio; behavioural paths `open-sse/services/compression/planResolution.ts`, `open-sse/services/compression/strategySelector.ts` and the new studio components `CompressionAnnotation.tsx` / `CompressionCockpit.tsx`; none of these has a local counterpart (the fork's studio is `src/app/(dashboard)/dashboard/compression-studio/page.js`). Additive compression capability. |
| [#5285](https://github.com/cheaper-inference/OmniRoute/pull/5285) | 2026-06-29T03:21:14Z | `03b259f66d3a9b8d1665643e575a5c89bf5e02ea` / `72f8bf21f18de463b103916c177b017cf093c700` | 10/10 complete; hasNextPage=false | new feature lane | Adds the saliency heatmap to the compression studio; behavioural paths `open-sse/services/compression/diffHelper.ts` and the new studio components; the local compression directory has no `diffHelper` counterpart. Additive compression capability. |
| [#5286](https://github.com/cheaper-inference/OmniRoute/pull/5286) | 2026-06-29T03:28:53Z | `85ca1f270b4c2f3619f72545182ace7d80678983` / `43da1bb98c1732f89fdecaff43315f95a9410333` | 6/6 complete; hasNextPage=false | new feature lane | Adds opt-in result memoization for deterministic compression engines; behavioural paths `open-sse/services/compression/resultMemo.ts`, `strategySelector.ts`, `types.ts`; no local `resultMemo` counterpart. Additive compression capability. |
| [#5288](https://github.com/cheaper-inference/OmniRoute/pull/5288) | 2026-06-29T04:24:38Z | `f6ed86fbe8e6541e57282dbcb75687b903b1a86d` / `fa94f38de5d0ebd8b5f2cb6b5d5d65593fa6e72a` | 5/5 complete; hasNextPage=false | new feature lane | Adds the hard-budget compression mode (compress to at most N tokens); behavioural paths `open-sse/services/compression/hardBudget.ts`, `strategySelector.ts`, `types.ts`; no local `hardBudget` counterpart. Additive compression capability. |
| [#5289](https://github.com/cheaper-inference/OmniRoute/pull/5289) | 2026-06-29T04:25:41Z | `f6bcbb72bc83d14c88611d14da98f6ba8fe66a60` / `21c1f540b3ded2e44ffc832eb3ed450b3f848726` | 9/9 complete; hasNextPage=false | new feature lane | Adds the relevance extractive compression engine; behavioural paths `open-sse/services/compression/engines/relevance/*.ts` and the engine index; the local engine directory has no `relevance` counterpart. Additive compression capability. |
| [#5291](https://github.com/cheaper-inference/OmniRoute/pull/5291) | 2026-06-29T04:40:37Z | `2ed782add531a8670bd9dd03d7e746dc371e4b29` / `4008bdc1e8aa4dbac8885511ca3c7860a4926dd8` | 3/3 complete; hasNextPage=false | new feature lane | Propagates the hard-budget unreachable-target warning through the stacked seam; the only behavioural path is `open-sse/services/compression/strategySelector.ts`, which has no local counterpart (the fork's compression directory holds `bodyAdapter.js`, `caveman.js`, `fidelityGate.js`, `preservation.js`, `ruleLoader.js`, `strategySelector`-free surface and the `engines/` tree, with no `strategySelector` module). Follow-up to #5288 and depends on the hard-budget surface that also has no local counterpart. |
| [#5294](https://github.com/cheaper-inference/OmniRoute/pull/5294) | 2026-06-29T06:46:22Z | `d63f6a154d8eb6d20493fc090592716e44a846e6` / `401a7b4430cf8d5b8a4fd689750575b49e922497` | 5/5 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(auth): compare-and-swap guard on OAuth refresh persist (#4038). A local counterpart exists for every behavioural path in the row. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/handlers/chatCore.ts` -> local `open-sse/handlers/chatCore.js`; `open-sse/services/tokenRefresh.ts` -> local `open-sse/services/tokenRefresh.js`. |
| [#5296](https://github.com/cheaper-inference/OmniRoute/pull/5296) | 2026-06-29T07:02:08Z | `fac5f43e367fd4784e8ba9b9506246fae99d2fec` / `223e67a4fbb20ce153dc367b6cd6fcba02c32d71` | 3/3 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: test(targets): add 14 unit tests for targetExhaustion handler. Complete changed-path set is non-runtime only (0 doc, 1 test, 2 CI, 0 build path(s)); no runtime module is touched. |
| [#5299](https://github.com/cheaper-inference/OmniRoute/pull/5299) | 2026-06-29T13:15:00Z | `66152de8ed3d7c56a30ac5bc8d31a8ab7e4373e0` / `604397ec0f4b1d84fd9b003d9f0ea680f1a7e9ab` | 10/10 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: [codex] Fix service dashboard console failures. 0 of 8 behavioural path(s) have a local counterpart; 8 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/app/(dashboard)/dashboard/providers/services/components/ServiceLifecycleButtons.tsx` (no local counterpart at this path); `src/app/(dashboard)/dashboard/providers/services/components/ServiceLogsPanel.tsx` (no local counterpart at this path); `src/app/(dashboard)/dashboard/providers/services/hooks/useServiceLogs.ts` (no local counterpart at this path); `src/app/api/services/9router/install/route.ts` (no local counterpart at this path); `src/app/api/services/[name]/logs/route.ts` (no local counterpart at this path); `src/app/api/services/cliproxy/install/route.ts` (no local counterpart at this path); `src/app/api/v1/providers/[provider]/models/route.ts` (no local counterpart at this path); `src/server/authz/routeGuard.ts` (no local counterpart at this path; closest local area `the fork has no `src/server/authz/` layer at all`). |
| [#5300](https://github.com/cheaper-inference/OmniRoute/pull/5300) | 2026-06-29T05:57:19Z | `21ddf0f797d32428bde1c5d069693cf4971157a7` / `5ba5bcd6d414da1b9b3b06ac5b595d1915ca4776` | 1/1 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: test(combo): reconcile #4279 stop-guard test with #5249 advance policy. Complete changed-path set is non-runtime only (0 doc, 1 test, 0 CI, 0 build path(s)); no runtime module is touched. |
| [#5302](https://github.com/cheaper-inference/OmniRoute/pull/5302) | 2026-06-29T07:03:12Z | `74f99e947cc4f86df54c400df2b04149e3e1046a` / `601e2a80cde5411b1df860c9e7c63b1e870cbba6` | 18/18 complete; hasNextPage=false | Provider Sign-in - assigned to the existing Provider Sign-in lane | New provider identity (Microsoft 365 Copilot individual); paths include `open-sse/config/providers/registry/copilot-m365-web/index.ts`, `open-sse/executors/copilot-m365-web.ts`, `open-sse/executors/copilot-m365-connection.ts`, `open-sse/executors/copilot-m365-frames.ts` and `src/shared/providers/webSessionCredentials.ts`. Local counterparts exist for the web variant (`open-sse/providers/registry/copilot-m365-web.js`, `open-sse/executors/copilot-m365-web.js`, `open-sse/executors/copilot-m365-connection.js`, `open-sse/executors/copilot-m365-frames.js`); the individual (non-web) identity is not compared here. |
| [#5303](https://github.com/cheaper-inference/OmniRoute/pull/5303) | 2026-06-29T06:48:36Z | `25ec2f1a47d9f9d6c89ae451060e7809c09a6c51` / `c0f1ee22004e85b89c39739ab82ed03b21d958b8` | 4/4 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(sse): replace synthesized kiro "Continue" turn with neutral filler (#5231). A local counterpart exists for every behavioural path in the row. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/translator/request/openai-to-kiro.ts` -> local `open-sse/translator/request/openai-to-kiro.js`. |
| [#5304](https://github.com/cheaper-inference/OmniRoute/pull/5304) | 2026-06-29T06:47:47Z | `02eaf90a6c671c75ae06f1ac93bfe5471d83e1e1` / `1a096c4b3a0ddae5cc196a8ed0aa6956e242174b` | 3/3 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(sse): omit Command Code max_tokens when client sends a non-positive value (#5166). 0 of 1 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/executors/commandCode.ts` (no local counterpart at this path). |
| [#5306](https://github.com/cheaper-inference/OmniRoute/pull/5306) | 2026-06-29T07:19:20Z | `09b85a2bdfa04b28206fd13f7e22186fee5c2d16` / `dbe750f2ae3e96a9efb5489f041b525bebace305` | 45/45 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: fix(dashboard): /dashboard/context parent route + missing sidebar.gamificationGroup i18n (#5298). 0 of 1 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/app/(dashboard)/dashboard/context/page.tsx` (no local counterpart at this path). |
| [#5309](https://github.com/cheaper-inference/OmniRoute/pull/5309) | 2026-06-29T08:05:37Z | `cdf634663c2768cb932d22bda63030e993b27e6f` / `d4c54f600b70cfd323a98b74ecdcbbd40ed92a7c` | 5/5 complete; hasNextPage=false | already covered (ported) | Upstream `open-sse/utils/aiSdkCompat.ts` and `src/sse/handlers/chat.ts` stop coercing a request to SSE when the `Accept` header lists `application/json` even if it also lists `text/event-stream` (the OpenAI / Vercel AI SDK non-stream signature). Local `open-sse/handlers/chatCore/streamFlag.js:29` starts from `bodyStream === true`, so a request whose body omits `stream` stays non-streaming regardless of the `Accept` value, and the `clientPrefersJson` branch at line 38 only ever forces non-streaming. The upstream #5305 coercion therefore cannot occur locally. One bounded difference to confirm: upstream additionally forces SSE for a client that omits `stream` but sends `Accept: text/event-stream`; the local resolver keeps that case non-streaming. |
| [#5311](https://github.com/cheaper-inference/OmniRoute/pull/5311) | 2026-06-29T08:35:57Z | `c38912e0d69c9e0ef2cc93ac3ff30845146b0ee0` / `d5b03504c845b23431d885088a88acfaca8f05a8` | 4/4 complete; hasNextPage=false | docs/tests/CI-only scope | Subject: fix(ci): re-point Docker :latest tag on release (#5301). Complete changed-path set is non-runtime only (1 doc, 1 test, 2 CI, 0 build path(s)); no runtime module is touched. |
| [#5315](https://github.com/cheaper-inference/OmniRoute/pull/5315) | 2026-06-29T13:11:33Z | `d141af03a7f05821f9aac50ed3f39edb3fe78f01` / `e0bd7a519fe5d2646e01fb525d6d46020baff1ce` | 3/3 complete; hasNextPage=false | new feature lane | Adds a relay routing-backend selection; behavioural paths `src/app/api/v1/relay/chat/completions/route.ts` and `routingBackend.ts`; no local counterpart file exists for the relay route. Additive routing surface. |
| [#5321](https://github.com/cheaper-inference/OmniRoute/pull/5321) | 2026-06-29T13:06:34Z | `a5f8a64e1769bbf457e24d4d0cac321aa207c136` / `e0bfd509cf46f28160acd0c591be91b4b1cb5360` | 6/6 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: chore: trim unused exported helpers. 1 of 3 behavioural path(s) have a local counterpart; 2 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/shared/constants/cliTools.ts` -> local `src/shared/constants/cliTools.js`; `src/shared/utils/a11yAudit.ts` (no local counterpart at this path); `src/shared/validation/helpers.ts` (no local counterpart at this path). |
| [#5322](https://github.com/cheaper-inference/OmniRoute/pull/5322) | 2026-06-29T13:06:37Z | `9ea721d02a3e478435d1b0bc2749b16310a46c71` / `8d56238685f6fdf07be5a96587f0ac6243a17ff3` | 4/4 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: chore: drop unused validation schema exports. 0 of 2 behavioural path(s) have a local counterpart; 2 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/shared/schemas/searchTools.ts` (no local counterpart at this path); `src/shared/validation/settingsSchemas.ts` (no local counterpart at this path). |
| [#5324](https://github.com/cheaper-inference/OmniRoute/pull/5324) | 2026-06-29T13:06:41Z | `dfac978ae3a182cca74a7a689be39442406bed09` / `aad63f213e15fdf305f3264a178c37f53cba54cc` | 10/10 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: chore: remove unused utility exports. 1 of 5 behavioural path(s) have a local counterpart; 4 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/lib/oauth/providers.ts` -> local `src/lib/oauth/providers.js`; `src/lib/proxyLogger.ts` (no local counterpart at this path); `src/lib/quota/sqliteQuotaStore.ts` (no local counterpart at this path); `src/shared/middleware/bodySizeGuard.ts` (no local counterpart at this path); `src/sse/services/streamState.ts` (no local counterpart at this path). |
| [#5325](https://github.com/cheaper-inference/OmniRoute/pull/5325) | 2026-06-29T13:06:44Z | `eaafc470aa0bf5ae3740da396aaa302fc94dad4f` / `0a2195e764aec863b3d40ee6054b9857d5199626` | 6/6 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: chore: remove unused domain helper exports. 0 of 3 behavioural path(s) have a local counterpart; 3 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/lib/combos/builderDraft.ts` (no local counterpart at this path); `src/lib/combos/steps.ts` (no local counterpart at this path); `src/lib/providers/catalog.ts` (no local counterpart at this path). |
| [#5327](https://github.com/cheaper-inference/OmniRoute/pull/5327) | 2026-06-29T19:51:03Z | `2fdb0c134d728d70e0d28d66159c7c47fd022816` / `78f09c8d9fcac13a5c2545282742d19772f1cadb` | 222/222 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: Release v3.8.41. 23 of 93 behavioural path(s) have a local counterpart; 70 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `open-sse/config/freeModelCatalog.data.ts` -> local `open-sse/config/freeModelCatalog.data.js`; `open-sse/config/providers/registry/gemini/index.ts` -> local `open-sse/providers/registry/gemini.js`; `open-sse/config/providers/registry/gemini/web/index.ts` -> local `open-sse/providers/registry/gemini.js`; `open-sse/executors/base.ts` -> local `open-sse/executors/base.js`; `open-sse/executors/chatgpt-web.ts` -> local `open-sse/executors/chatgpt-web.js`; `open-sse/executors/chatgptWebTools.ts` -> local `open-sse/executors/chatgptWebTools.js`; `open-sse/executors/opencode.ts` -> local `open-sse/executors/opencode.js`; `open-sse/handlers/chatCore.ts` -> local `open-sse/handlers/chatCore.js`; plus 85 further behavioural path(s) spread over 58 upstream areas (`src/app/api` (7), `src/app/(dashboard)` (6), `src/shared/constants` (6), `src/lib/providers` (4), `src/shared/utils` (4), `src/server/authz` (3), `src/shared/validation` (3), `src/sse/services` (3), `open-sse/config/providers` (2), `src/lib/combos` (2), `src/lib/db` (2), `src/lib/oauth` (2), `src/shared/middleware` (2), `src/shared/services` (2), `src/sse/handlers` (2), `bin/cli/commands` (1), `bin/cli/locales` (1), `bin/cli/runtime` (1), `open-sse/config/embeddingRegistry.ts` (1), `open-sse/config/freeModelCatalog.data.ts` (1), `open-sse/config/rerankRegistry.ts` (1), `open-sse/executors/base.ts` (1), `open-sse/executors/chatgpt-web.ts` (1), `open-sse/executors/chatgptWebTools.ts` (1), `open-sse/executors/opencode.ts` (1), `open-sse/handlers/chatCore.ts` (1), `open-sse/handlers/chatCore` (1), `open-sse/handlers/rerank.ts` (1), `open-sse/package.json` (1), `open-sse/services/accountFallback.ts` (1), `open-sse/services/apiKeyRotator.ts` (1), `open-sse/services/modelDeprecation.ts` (1), `open-sse/services/thinkingBudget.ts` (1), `open-sse/translator/request` (1), `open-sse/translator/response` (1), `open-sse/utils/proxyFetch.ts` (1), `open-sse/utils/stream.ts` (1), `open-sse/utils/thinkCloseMarker.ts` (1), `src/lib/build-profile` (1), `src/lib/config` (1), `src/lib/events` (1), `src/lib/memory` (1), `src/lib/modelAliasSeed.ts` (1), `src/lib/modelsDevSync.ts` (1), `src/lib/proxyLogger.ts` (1), `src/lib/quota` (1), `src/lib/semanticCache.ts` (1), `src/lib/services` (1), `src/lib/tokenHealthCheck.ts` (1), `src/lib/usage` (1), `src/lib/webhooks` (1), `src/server-init.ts` (1), `src/server/cors` (1), `src/server/origin` (1), `src/shared/components` (1), `src/shared/http` (1), `src/shared/schemas` (1), `src/sse/utils` (1)). The complete path list of the row is in section 7.. |
| [#5328](https://github.com/cheaper-inference/OmniRoute/pull/5328) | 2026-06-29T13:06:48Z | `f2e5903f86f5c39db9bcbee18c87b113747b243e` / `1c3c0ac871c64cdfdd1d9337d2c4c95ad6aaeae3` | 5/5 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: chore: remove unused static constant exports. 2 of 3 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/shared/constants/colors.ts` -> local `src/shared/constants/colors.js`; `src/shared/constants/config.ts` -> local `src/shared/constants/config.js`; `src/shared/constants/pricing.ts` (no local counterpart at this path). |
| [#5329](https://github.com/cheaper-inference/OmniRoute/pull/5329) | 2026-06-29T13:06:52Z | `27c27fdbb5dd6fa8b5c59e89a768e97a69a353fa` / `00b640f186537d4306935724de2b7599c91a6a32` | 3/3 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: chore: remove unused formatting helper exports. 1 of 2 behavioural path(s) have a local counterpart; 1 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/sse/utils/logger.ts` -> local `src/sse/utils/logger.js`; `src/shared/utils/formatting.ts` (no local counterpart at this path). |
| [#5330](https://github.com/cheaper-inference/OmniRoute/pull/5330) | 2026-06-29T13:06:56Z | `8c4fbe611189ebbdb0c8594d5d5d4ce72a211cc4` / `80545a5a94d5b22d3b49551e6c33d26444b30124` | 4/4 complete; hasNextPage=false | Unresolved - needs behaviour comparison | Subject: chore: remove unused runtime test helper exports. 0 of 2 behavioural path(s) have a local counterpart; 2 do not. Local behaviour was not read against the upstream change in this audit, so applicability and parity are not established. Comparison scope: `src/lib/config/runtimeSettings.ts` (no local counterpart at this path); `src/shared/services/loginShellPath.ts` (no local counterpart at this path). |

## 7. Complete changed-path index

Every changed path of every assigned row, exactly as returned by the completed pagination.
Path totals per row are stated in section 6.

### [#5008](https://github.com/cheaper-inference/OmniRoute/pull/5008) - 2026-06-25T10:24:17Z - 4 paths

- `CHANGELOG.md`
- `config/quality/file-size-baseline.json`
- `open-sse/executors/antigravity.ts`
- `tests/unit/antigravity-safetysettings-5003.test.ts`

### [#5009](https://github.com/cheaper-inference/OmniRoute/pull/5009) - 2026-06-25T10:22:28Z - 3 paths

- `CHANGELOG.md`
- `open-sse/executors/pollinations.ts`
- `tests/unit/pollinations-jsonmode-3981.test.ts`

### [#5010](https://github.com/cheaper-inference/OmniRoute/pull/5010) - 2026-06-25T10:25:08Z - 4 paths

- `CHANGELOG.md`
- `config/quality/file-size-baseline.json`
- `open-sse/executors/chatgpt-web.ts`
- `tests/unit/chatgpt-web.test.ts`

### [#5011](https://github.com/cheaper-inference/OmniRoute/pull/5011) - 2026-06-25T10:25:59Z - 6 paths

- `CHANGELOG.md`
- `config/quality/file-size-baseline.json`
- `src/app/(dashboard)/dashboard/combos/page.tsx`
- `src/i18n/messages/en.json`
- `src/shared/validation/schemas/combo.ts`
- `tests/unit/combo-description-5005.test.ts`

### [#5013](https://github.com/cheaper-inference/OmniRoute/pull/5013) - 2026-06-26T14:00:40Z - 6 paths

- `CHANGELOG.md`
- `open-sse/translator/helpers/openaiHelper.ts`
- `open-sse/translator/index.ts`
- `open-sse/translator/request/claude-to-openai.ts`
- `open-sse/utils/cacheControlPolicy.ts`
- `tests/unit/dashscope-cache-control-openai-2069.test.ts`

### [#5015](https://github.com/cheaper-inference/OmniRoute/pull/5015) - 2026-06-27T01:51:26Z - 11 paths

- `CHANGELOG.md`
- `open-sse/config/imageRegistry.ts`
- `open-sse/executors/azure-openai.ts`
- `open-sse/services/combo.ts`
- `src/app/(dashboard)/dashboard/combos/BuilderIntelligentStep.tsx`
- `src/app/(dashboard)/dashboard/combos/IntelligentComboPanel.tsx`
- `src/app/(dashboard)/dashboard/combos/page.tsx`
- `src/domain/quotaCache.ts`
- `src/lib/db/quotaSnapshots.ts`
- `tests/unit/combo-account-allowlist-3266.test.ts`
- `tests/unit/quota-cache-hydrate-5015.test.ts`

### [#5016](https://github.com/cheaper-inference/OmniRoute/pull/5016) - 2026-06-27T01:04:39Z - 4 paths

- `open-sse/handlers/chatCore.ts`
- `open-sse/handlers/chatCore/attemptLogging.ts`
- `src/shared/components/RequestLoggerDetail.tsx`
- `tests/unit/chatcore-attempt-logging.test.ts`

### [#5019](https://github.com/cheaper-inference/OmniRoute/pull/5019) - 2026-06-26T13:51:28Z - 3 paths

- `CHANGELOG.md`
- `open-sse/executors/codebuddy-cn.ts`
- `tests/unit/codebuddy-reasoning-optin.test.ts`

### [#5020](https://github.com/cheaper-inference/OmniRoute/pull/5020) - 2026-06-27T01:31:40Z - 19 paths

- `CHANGELOG.md`
- `open-sse/config/providers/index.ts`
- `open-sse/config/providers/registry/grok-cli/index.ts`
- `open-sse/executors/grok-cli.ts`
- `open-sse/executors/index.ts`
- `open-sse/utils/publicCreds.ts`
- `src/app/(dashboard)/dashboard/providers/[id]/ProviderDetailPageClient.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/ConnectionsHeaderToolbar.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/EmptyConnectionsPlaceholder.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/ProviderModalsPanel.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/modals/ImportGrokCliAuthModal.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/hooks/useProviderConnections.ts`
- `src/app/api/oauth/[provider]/[action]/route.ts`
- `src/lib/oauth/providers/grok-cli.ts`
- `src/lib/oauth/providers/index.ts`
- `src/lib/quota/planRegistry.ts`
- `src/shared/components/OAuthModal.tsx`
- `src/shared/constants/providers.ts`
- `tests/unit/grok-cli-oauth.test.ts`

### [#5021](https://github.com/cheaper-inference/OmniRoute/pull/5021) - 2026-06-26T13:52:12Z - 5 paths

- `CHANGELOG.md`
- `open-sse/config/providers/shared.ts`
- `open-sse/handlers/chatCore.ts`
- `open-sse/utils/aiSdkCompat.ts`
- `tests/unit/resolve-stream-flag.test.ts`

### [#5022](https://github.com/cheaper-inference/OmniRoute/pull/5022) - 2026-06-25T14:30:34Z - 48 paths

- `CHANGELOG.md`
- `open-sse/handlers/chatCore.ts`
- `open-sse/services/systemPrompt.ts`
- `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.tsx`
- `src/i18n/messages/ar.json`
- `src/i18n/messages/az.json`
- `src/i18n/messages/bg.json`
- `src/i18n/messages/bn.json`
- `src/i18n/messages/cs.json`
- `src/i18n/messages/da.json`
- `src/i18n/messages/de.json`
- `src/i18n/messages/en.json`
- `src/i18n/messages/es.json`
- `src/i18n/messages/fa.json`
- `src/i18n/messages/fi.json`
- `src/i18n/messages/fr.json`
- `src/i18n/messages/gu.json`
- `src/i18n/messages/he.json`
- `src/i18n/messages/hi.json`
- `src/i18n/messages/hu.json`
- `src/i18n/messages/id.json`
- `src/i18n/messages/in.json`
- `src/i18n/messages/it.json`
- `src/i18n/messages/ja.json`
- `src/i18n/messages/ko.json`
- `src/i18n/messages/mr.json`
- `src/i18n/messages/ms.json`
- `src/i18n/messages/nl.json`
- `src/i18n/messages/no.json`
- `src/i18n/messages/phi.json`
- `src/i18n/messages/pl.json`
- `src/i18n/messages/pt-BR.json`
- `src/i18n/messages/pt.json`
- `src/i18n/messages/ro.json`
- `src/i18n/messages/ru.json`
- `src/i18n/messages/sk.json`
- `src/i18n/messages/sv.json`
- `src/i18n/messages/sw.json`
- `src/i18n/messages/ta.json`
- `src/i18n/messages/te.json`
- `src/i18n/messages/th.json`
- `src/i18n/messages/tr.json`
- `src/i18n/messages/uk-UA.json`
- `src/i18n/messages/ur.json`
- `src/i18n/messages/vi.json`
- `src/i18n/messages/zh-CN.json`
- `src/lib/db/settings.ts`
- `tests/unit/custom-endpoint-system-prompt.test.ts`

### [#5023](https://github.com/cheaper-inference/OmniRoute/pull/5023) - 2026-06-25T14:30:42Z - 3 paths

- `CHANGELOG.md`
- `open-sse/services/compression/bodyAdapter.ts`
- `tests/unit/headroom-responses-format.test.ts`

### [#5024](https://github.com/cheaper-inference/OmniRoute/pull/5024) - 2026-06-25T14:30:14Z - 2 paths

- `src/lib/copilot/tools.ts`
- `tests/unit/copilot-runOmniRouteCli.test.ts`

### [#5026](https://github.com/cheaper-inference/OmniRoute/pull/5026) - 2026-06-25T19:39:56Z - 4 paths

- `src/lib/db/migrationRunner.ts`
- `src/lib/db/quotaGroups.ts`
- `src/lib/db/quotaPools.ts`
- `tests/unit/db/weak-rng-fixes.test.ts`

### [#5027](https://github.com/cheaper-inference/OmniRoute/pull/5027) - 2026-06-25T14:30:17Z - 8 paths

- `@omniroute/opencode-plugin/src/index.ts`
- `@omniroute/opencode-plugin/tests/auth.test.ts`
- `@omniroute/opencode-plugin/tests/combos.test.ts`
- `@omniroute/opencode-plugin/tests/config-shim.test.ts`
- `@omniroute/opencode-plugin/tests/features.test.ts`
- `@omniroute/opencode-plugin/tests/multi-instance.test.ts`
- `@omniroute/opencode-plugin/tests/provider.test.ts`
- `@omniroute/opencode-plugin/tests/scaffold.test.ts`

### [#5028](https://github.com/cheaper-inference/OmniRoute/pull/5028) - 2026-06-25T14:46:22Z - 5 paths

- `CHANGELOG.md`
- `config/quality/file-size-baseline.json`
- `scripts/dev/sync-env.mjs`
- `src/app/api/system/env/repair/route.ts`
- `tests/unit/sync-env-bundled-require-5006.test.ts`

### [#5029](https://github.com/cheaper-inference/OmniRoute/pull/5029) - 2026-06-25T19:38:45Z - 4 paths

- `config/quality/complexity-baseline.json`
- `config/quality/quality-baseline.json`
- `scripts/build/pack-artifact-policy.ts`
- `tests/integration/resilience-http-e2e.test.ts`

### [#5031](https://github.com/cheaper-inference/OmniRoute/pull/5031) - 2026-06-25T20:22:42Z - 3 paths

- `.dockerignore`
- `CLAUDE.md`
- `tsconfig.json`

### [#5032](https://github.com/cheaper-inference/OmniRoute/pull/5032) - 2026-06-26T14:20:18Z - 12 paths

- `CHANGELOG.md`
- `scripts/check/check-error-helper.mjs`
- `src/app/api/cli-tools/backups/route.ts`
- `src/app/api/cli-tools/guide-settings/[toolId]/route.ts`
- `src/app/api/logs/export/route.ts`
- `src/app/api/models/catalog/route.ts`
- `src/app/api/providers/test-batch/route.ts`
- `src/app/api/settings/import-json/route.ts`
- `src/app/api/usage/proxy-logs/route.ts`
- `tests/unit/check-error-helper.test.ts`
- `tests/unit/log-export-routes.test.mjs`
- `tests/unit/proxy-logs-route.test.ts`

### [#5051](https://github.com/cheaper-inference/OmniRoute/pull/5051) - 2026-06-26T14:10:33Z - 4 paths

- `CHANGELOG.md`
- `open-sse/config/videoRegistry.ts`
- `open-sse/handlers/videoGeneration.ts`
- `tests/unit/video-dashscope.test.ts`

### [#5053](https://github.com/cheaper-inference/OmniRoute/pull/5053) - 2026-06-26T05:51:07Z - 233 paths

- `.env.example`
- `.github/workflows/ci.yml`
- `.github/workflows/quality.yml`
- `.gitignore`
- `CHANGELOG.md`
- `CLAUDE.md`
- `README.md`
- `bin/cli/runtime/nativeDeps.mjs`
- `bin/cli/runtime/trayRuntime.ts`
- `bin/cli/tray/autostart.mjs`
- `config/quality/complexity-baseline.json`
- `config/quality/file-size-baseline.json`
- `config/quality/quality-baseline.json`
- `docs/README.md`
- `docs/architecture/ARCHITECTURE.md`
- `docs/architecture/RESILIENCE_GUIDE.md`
- `docs/comparison/OMNIROUTE_VS_ALTERNATIVES.md`
- `docs/diagrams/request-pipeline.mmd`
- `docs/frameworks/OPEN_SSE_ARCHITECTURE.md`
- `docs/guides/FEATURES.md`
- `docs/i18n/ar/CHANGELOG.md`
- `docs/i18n/az/CHANGELOG.md`
- `docs/i18n/bg/CHANGELOG.md`
- `docs/i18n/bn/CHANGELOG.md`
- `docs/i18n/cs/CHANGELOG.md`
- `docs/i18n/da/CHANGELOG.md`
- `docs/i18n/de/CHANGELOG.md`
- `docs/i18n/es/CHANGELOG.md`
- `docs/i18n/fa/CHANGELOG.md`
- `docs/i18n/fi/CHANGELOG.md`
- `docs/i18n/fr/CHANGELOG.md`
- `docs/i18n/gu/CHANGELOG.md`
- `docs/i18n/he/CHANGELOG.md`
- `docs/i18n/hi/CHANGELOG.md`
- `docs/i18n/hu/CHANGELOG.md`
- `docs/i18n/id/CHANGELOG.md`
- `docs/i18n/in/CHANGELOG.md`
- `docs/i18n/it/CHANGELOG.md`
- `docs/i18n/ja/CHANGELOG.md`
- `docs/i18n/ko/CHANGELOG.md`
- `docs/i18n/mr/CHANGELOG.md`
- `docs/i18n/ms/CHANGELOG.md`
- `docs/i18n/nl/CHANGELOG.md`
- `docs/i18n/no/CHANGELOG.md`
- `docs/i18n/phi/CHANGELOG.md`
- `docs/i18n/pl/CHANGELOG.md`
- `docs/i18n/pt-BR/CHANGELOG.md`
- `docs/i18n/pt/CHANGELOG.md`
- `docs/i18n/ro/CHANGELOG.md`
- `docs/i18n/ru/CHANGELOG.md`
- `docs/i18n/sk/CHANGELOG.md`
- `docs/i18n/sv/CHANGELOG.md`
- `docs/i18n/sw/CHANGELOG.md`
- `docs/i18n/ta/CHANGELOG.md`
- `docs/i18n/te/CHANGELOG.md`
- `docs/i18n/th/CHANGELOG.md`
- `docs/i18n/tr/CHANGELOG.md`
- `docs/i18n/uk-UA/CHANGELOG.md`
- `docs/i18n/ur/CHANGELOG.md`
- `docs/i18n/vi/CHANGELOG.md`
- `docs/i18n/zh-CN/CHANGELOG.md`
- `docs/openapi.yaml`
- `docs/reference/ENVIRONMENT.md`
- `docs/routing/AUTO-COMBO.md`
- `electron/package-lock.json`
- `electron/package.json`
- `next.config.mjs`
- `open-sse/config/providers/index.ts`
- `open-sse/config/providers/registry/dgrid/index.ts`
- `open-sse/config/providers/registry/github/index.ts`
- `open-sse/config/providers/registry/pioneer/index.ts`
- `open-sse/config/providers/registry/siliconflow/index.ts`
- `open-sse/config/toolCloaking.ts`
- `open-sse/executors/antigravity.ts`
- `open-sse/executors/base.ts`
- `open-sse/executors/codex.ts`
- `open-sse/executors/cursor.ts`
- `open-sse/executors/default.ts`
- `open-sse/executors/gemini-cli.ts`
- `open-sse/executors/kiro.ts`
- `open-sse/executors/qoder.ts`
- `open-sse/handlers/chatCore.ts`
- `open-sse/handlers/chatCore/headers.ts`
- `open-sse/handlers/responseSanitizer.ts`
- `open-sse/package.json`
- `open-sse/services/model.ts`
- `open-sse/services/provider.ts`
- `open-sse/services/tokenRefresh.ts`
- `open-sse/transformer/responsesTransformer.ts`
- `open-sse/translator/helpers/geminiToolsSanitizer.ts`
- `open-sse/translator/helpers/openaiHelper.ts`
- `open-sse/translator/index.ts`
- `open-sse/translator/request/antigravity-to-openai.ts`
- `open-sse/translator/request/claude-to-openai.ts`
- `open-sse/translator/request/openai-responses.ts`
- `open-sse/translator/request/openai-to-claude.ts`
- `open-sse/translator/request/openai-to-gemini.ts`
- `open-sse/translator/request/openai-to-kiro.ts`
- `open-sse/translator/response/kiro-to-openai.ts`
- `open-sse/translator/response/openai-responses.ts`
- `open-sse/utils/diagnostics.ts`
- `open-sse/utils/error.ts`
- `open-sse/utils/flattenToolHistory.ts`
- `open-sse/utils/kiroSanitizer.ts`
- `open-sse/utils/streamHandler.ts`
- `open-sse/utils/toolSources.ts`
- `open-sse/utils/usageTracking.ts`
- `package-lock.json`
- `package.json`
- `scripts/build/build-next-isolated.mjs`
- `scripts/build/validate-pack-artifact.ts`
- `scripts/check/check-build-scope.mjs`
- `src/app/(dashboard)/dashboard/api-manager/ApiManagerPageClient.tsx`
- `src/app/(dashboard)/dashboard/cli-code/components/DroidToolCard.tsx`
- `src/app/(dashboard)/dashboard/context/combos/CompressionCombosPageClient.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/modals/AddApiKeyModal.tsx`
- `src/app/api/cli-tools/droid-settings/route.ts`
- `src/app/api/headroom/start/route.ts`
- `src/app/api/headroom/status/route.ts`
- `src/app/api/headroom/stop/route.ts`
- `src/app/api/oauth/codex/import/route.ts`
- `src/app/api/oauth/cursor/auto-import/route.ts`
- `src/app/api/provider-nodes/validate/route.ts`
- `src/app/api/providers/[id]/models/route.ts`
- `src/app/globals.css`
- `src/i18n/messages/en.json`
- `src/lib/combos/autoPromote.ts`
- `src/lib/dataPaths.ts`
- `src/lib/db/combos.ts`
- `src/lib/db/core.ts`
- `src/lib/db/settings.ts`
- `src/lib/embeddings/service.ts`
- `src/lib/headroom/detect.ts`
- `src/lib/headroom/process.ts`
- `src/lib/ipUtils.ts`
- `src/lib/localDb.ts`
- `src/lib/oauth/services/codexImport.ts`
- `src/lib/providers/validation.ts`
- `src/lib/providers/validation/openaiFormat.ts`
- `src/lib/providers/xai/thinking.ts`
- `src/lib/providers/xai/translators/claude.ts`
- `src/lib/providers/xai/translators/gemini.ts`
- `src/lib/providers/xai/translators/openai-chat.ts`
- `src/lib/providers/xai/translators/openai-responses.ts`
- `src/lib/usage/providerLimits.ts`
- `src/server/authz/routeGuard.ts`
- `src/shared/components/ModelSelectModal.tsx`
- `src/shared/components/layouts/DashboardLayout.tsx`
- `src/shared/components/modelSelectModalHelpers.ts`
- `src/shared/constants/config.ts`
- `src/shared/constants/pricing/regional.ts`
- `src/shared/constants/providers/apikey/frontier-labs.ts`
- `src/shared/constants/providers/apikey/gateways.ts`
- `src/shared/services/droidCustomModels.ts`
- `src/shared/utils/circuitBreaker.ts`
- `src/shared/utils/clineAuth.ts`
- `src/shared/validation/compressionConfigSchemas.ts`
- `src/shared/validation/schemas/cli.ts`
- `src/shared/validation/schemas/combo.ts`
- `src/sse/handlers/chat.ts`
- `src/sse/handlers/chatHelpers.ts`
- `src/sse/services/auth.ts`
- `src/sse/services/model.ts`
- `src/sse/services/tokenRefresh.ts`
- `tests/snapshots/provider/translate-path.json`
- `tests/unit/antigravity-retry-hook.test.ts`
- `tests/unit/antigravity-strip-builtin-tools-funcdecls-1095.test.ts`
- `tests/unit/antigravity-tool-cloaking.test.ts`
- `tests/unit/api-manager-mask-key-passthrough.test.ts`
- `tests/unit/authz/route-guard-local-prefix.test.ts`
- `tests/unit/chat-auth-log-redaction.test.ts`
- `tests/unit/circuit-breaker-stream-controller-4602.test.ts`
- `tests/unit/cli/autostart-macos-launchctl.test.ts`
- `tests/unit/cline-workos-auth-token-shape.test.ts`
- `tests/unit/codexBulkImport.test.ts`
- `tests/unit/combo-auto-promote.test.ts`
- `tests/unit/combo-flatten-anthropic-tool-messages.test.ts`
- `tests/unit/combo-id-resolution-4446.test.ts`
- `tests/unit/compression/combos-engine-ui-schema-parity-4955.test.ts`
- `tests/unit/cursor-composer-thinking.test.ts`
- `tests/unit/dashboard-sidebar-desktop-visible.test.ts`
- `tests/unit/data-dir-writable-fallback.test.ts`
- `tests/unit/dgrid-provider.test.ts`
- `tests/unit/diagnostics.test.ts`
- `tests/unit/droid-custom-models.test.ts`
- `tests/unit/embeddings-combo-dimensions.test.ts`
- `tests/unit/executor-codex.test.ts`
- `tests/unit/executor-default-anthropic-compatible-bearer.test.ts`
- `tests/unit/executor-default-base.test.ts`
- `tests/unit/executor-gemini-cli.test.ts`
- `tests/unit/executor-strip-stainless-openai-compat.test.ts`
- `tests/unit/format-provider-error-cause.test.ts`
- `tests/unit/github-copilot-gpt-4o-mini.test.ts`
- `tests/unit/headroom-proxy-lifecycle.test.ts`
- `tests/unit/ipUtils.test.ts`
- `tests/unit/kiro-tool-args-streaming.test.ts`
- `tests/unit/kiro-tool-schema-sanitize-1375.test.ts`
- `tests/unit/model-select-passthrough-alias-485.test.ts`
- `tests/unit/next-config.test.ts`
- `tests/unit/oauth-cursor-auto-import.test.ts`
- `tests/unit/openai-responses-reasoning-effort.test.ts`
- `tests/unit/openai-to-claude-strip-temperature-thinking.test.ts`
- `tests/unit/pioneer-provider.test.ts`
- `tests/unit/provider-limits-accesstoken-fallback-on-refresh-failure.test.ts`
- `tests/unit/provider-nodes-validate-docker-hint.test.ts`
- `tests/unit/provider-registry-github-copilot-gpt-4.test.ts`
- `tests/unit/provider-translate-path-golden.test.ts`
- `tests/unit/provider-validation-specialty.test.ts`
- `tests/unit/qoder-unwrap-error-envelope.test.ts`
- `tests/unit/resolve-bare-model-to-connection-default-474.test.ts`
- `tests/unit/responses-nameless-hosted-tool-filter.test.ts`
- `tests/unit/responses-reasoning-close-before-message-466.test.ts`
- `tests/unit/responses-transformer-dense-output.test.ts`
- `tests/unit/responses-transformer.test.ts`
- `tests/unit/responses-translation-fixes.test.ts`
- `tests/unit/runtime-deps-save-exact-no-prune.test.ts`
- `tests/unit/service-token-refresh.test.ts`
- `tests/unit/siliconflow-registry-models.test.ts`
- `tests/unit/stream-handler.test.ts`
- `tests/unit/strip-reasoning-blobs-agentic-context-1599.test.ts`
- `tests/unit/strip-reasoning-header.test.ts`
- `tests/unit/t12-pricing-updates.test.ts`
- `tests/unit/token-refresh-service.test.ts`
- `tests/unit/tool-source-diagnostics.test.ts`
- `tests/unit/translator-antigravity-to-openai.test.ts`
- `tests/unit/translator-claude-to-openai-strip-billing-header.test.ts`
- `tests/unit/translator-helper-tool-description-coercion.test.ts`
- `tests/unit/translator-openai-responses-custom-tool-1007.test.ts`
- `tests/unit/translator-openai-responses-req.test.ts`
- `tests/unit/translator-openai-to-kiro.test.ts`
- `tests/unit/ui/compatible-provider-apikey-setup.test.tsx`
- `tests/unit/usage-extractor.test.ts`
- `tests/unit/xai-translators.test.ts`

### [#5054](https://github.com/cheaper-inference/OmniRoute/pull/5054) - 2026-06-25T22:38:25Z - 6 paths

- `.github/workflows/ci.yml`
- `.github/workflows/quality.yml`
- `package.json`
- `scripts/build/build-next-isolated.mjs`
- `scripts/build/validate-pack-artifact.ts`
- `scripts/check/check-build-scope.mjs`

### [#5055](https://github.com/cheaper-inference/OmniRoute/pull/5055) - 2026-06-26T14:18:22Z - 61 paths

- `CHANGELOG.md`
- `docs/providers/AGENTROUTER.md`
- `docs/security/STEALTH_GUIDE.md`
- `open-sse/handlers/chatCore.ts`
- `open-sse/services/claudeCodeCompatible.ts`
- `open-sse/services/claudeCodeCompatibleThinkingDisplay.ts`
- `src/app/(dashboard)/dashboard/providers/[id]/components/modals/AddApiKeyModal.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/modals/CcCompatibleRequestDefaultsFields.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/modals/EditConnectionModal.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/modals/ccCompatibleRequestDefaults.ts`
- `src/app/(dashboard)/dashboard/providers/[id]/components/modals/connectionProviderSpecificData.ts`
- `src/app/(dashboard)/dashboard/providers/[id]/providerPageHelpers.ts`
- `src/i18n/messages/ar.json`
- `src/i18n/messages/az.json`
- `src/i18n/messages/bg.json`
- `src/i18n/messages/bn.json`
- `src/i18n/messages/cs.json`
- `src/i18n/messages/da.json`
- `src/i18n/messages/de.json`
- `src/i18n/messages/en.json`
- `src/i18n/messages/es.json`
- `src/i18n/messages/fa.json`
- `src/i18n/messages/fi.json`
- `src/i18n/messages/fr.json`
- `src/i18n/messages/gu.json`
- `src/i18n/messages/he.json`
- `src/i18n/messages/hi.json`
- `src/i18n/messages/hu.json`
- `src/i18n/messages/id.json`
- `src/i18n/messages/in.json`
- `src/i18n/messages/it.json`
- `src/i18n/messages/ja.json`
- `src/i18n/messages/ko.json`
- `src/i18n/messages/mr.json`
- `src/i18n/messages/ms.json`
- `src/i18n/messages/nl.json`
- `src/i18n/messages/no.json`
- `src/i18n/messages/phi.json`
- `src/i18n/messages/pl.json`
- `src/i18n/messages/pt-BR.json`
- `src/i18n/messages/pt.json`
- `src/i18n/messages/ro.json`
- `src/i18n/messages/ru.json`
- `src/i18n/messages/sk.json`
- `src/i18n/messages/sv.json`
- `src/i18n/messages/sw.json`
- `src/i18n/messages/ta.json`
- `src/i18n/messages/te.json`
- `src/i18n/messages/th.json`
- `src/i18n/messages/tr.json`
- `src/i18n/messages/uk-UA.json`
- `src/i18n/messages/ur.json`
- `src/i18n/messages/vi.json`
- `src/i18n/messages/zh-CN.json`
- `src/lib/providers/requestDefaults.ts`
- `src/shared/validation/providerSpecificData.ts`
- `src/shared/validation/schemas/provider.ts`
- `tests/unit/claude-code-compatible-request.test.ts`
- `tests/unit/provider-page-helpers-3501.test.ts`
- `tests/unit/provider-specific-data-schema.test.ts`
- `tests/unit/request-defaults-store-session.test.ts`

### [#5062](https://github.com/cheaper-inference/OmniRoute/pull/5062) - 2026-06-26T02:07:52Z - 4 paths

- `CHANGELOG.md`
- `src/app/(dashboard)/dashboard/context/combos/CompressionCombosPageClient.tsx`
- `src/shared/validation/compressionConfigSchemas.ts`
- `tests/unit/compression/combos-engine-ui-schema-parity-4955.test.ts`

### [#5063](https://github.com/cheaper-inference/OmniRoute/pull/5063) - 2026-06-26T14:09:12Z - 6 paths

- `CHANGELOG.md`
- `open-sse/utils/earlyStreamKeepalive.ts`
- `open-sse/utils/streamHandler.ts`
- `src/app/api/v1/messages/route.ts`
- `tests/unit/early-stream-keepalive.test.ts`
- `tests/unit/stream-handler-client-disconnect.test.ts`

### [#5064](https://github.com/cheaper-inference/OmniRoute/pull/5064) - 2026-06-26T14:06:46Z - 5 paths

- `CHANGELOG.md`
- `open-sse/handlers/chatCore.ts`
- `open-sse/handlers/chatCore/cooldownClassification.ts`
- `src/sse/handlers/chat.ts`
- `tests/unit/self-inflicted-upstream-timeout.test.ts`

### [#5065](https://github.com/cheaper-inference/OmniRoute/pull/5065) - 2026-06-27T01:36:03Z - 6 paths

- `CHANGELOG.md`
- `docs/reference/PROVIDER_REFERENCE.md`
- `open-sse/config/providers/index.ts`
- `open-sse/config/providers/registry/factory/index.ts`
- `src/shared/constants/providers/apikey/gateways.ts`
- `tests/unit/factory-provider-registry.test.ts`

### [#5067](https://github.com/cheaper-inference/OmniRoute/pull/5067) - 2026-06-26T04:20:00Z - 11 paths

- `CLAUDE.md`
- `README.md`
- `docs/README.md`
- `docs/architecture/ARCHITECTURE.md`
- `docs/architecture/RESILIENCE_GUIDE.md`
- `docs/comparison/OMNIROUTE_VS_ALTERNATIVES.md`
- `docs/diagrams/request-pipeline.mmd`
- `docs/frameworks/OPEN_SSE_ARCHITECTURE.md`
- `docs/guides/FEATURES.md`
- `docs/openapi.yaml`
- `docs/routing/AUTO-COMBO.md`

### [#5070](https://github.com/cheaper-inference/OmniRoute/pull/5070) - 2026-06-26T04:33:42Z - 2 paths

- `src/server/authz/routeGuard.ts`
- `tests/unit/authz/route-guard-local-prefix.test.ts`

### [#5074](https://github.com/cheaper-inference/OmniRoute/pull/5074) - 2026-06-26T20:15:38Z - 6 paths

- `CHANGELOG.md`
- `config/quality/file-size-baseline.json`
- `src/app/(dashboard)/dashboard/combos/page.tsx`
- `src/i18n/messages/en.json`
- `src/shared/validation/schemas/combo.ts`
- `tests/unit/combo-config.test.ts`

### [#5078](https://github.com/cheaper-inference/OmniRoute/pull/5078) - 2026-06-27T12:07:12Z - 407 paths

- `.env.example`
- `.github/workflows/ci.yml`
- `.github/workflows/electron-release.yml`
- `.github/workflows/nightly-mutation.yml`
- `.github/workflows/nightly-resilience.yml`
- `CHANGELOG.md`
- `CONTRIBUTING.md`
- `README.md`
- `config/quality/complexity-baseline.json`
- `config/quality/file-size-baseline.json`
- `config/quality/quality-baseline.json`
- `docs/i18n/ar/CHANGELOG.md`
- `docs/i18n/az/CHANGELOG.md`
- `docs/i18n/bg/CHANGELOG.md`
- `docs/i18n/bn/CHANGELOG.md`
- `docs/i18n/cs/CHANGELOG.md`
- `docs/i18n/da/CHANGELOG.md`
- `docs/i18n/de/CHANGELOG.md`
- `docs/i18n/es/CHANGELOG.md`
- `docs/i18n/fa/CHANGELOG.md`
- `docs/i18n/fi/CHANGELOG.md`
- `docs/i18n/fr/CHANGELOG.md`
- `docs/i18n/gu/CHANGELOG.md`
- `docs/i18n/he/CHANGELOG.md`
- `docs/i18n/hi/CHANGELOG.md`
- `docs/i18n/hu/CHANGELOG.md`
- `docs/i18n/id/CHANGELOG.md`
- `docs/i18n/in/CHANGELOG.md`
- `docs/i18n/it/CHANGELOG.md`
- `docs/i18n/ja/CHANGELOG.md`
- `docs/i18n/ko/CHANGELOG.md`
- `docs/i18n/mr/CHANGELOG.md`
- `docs/i18n/ms/CHANGELOG.md`
- `docs/i18n/nl/CHANGELOG.md`
- `docs/i18n/no/CHANGELOG.md`
- `docs/i18n/phi/CHANGELOG.md`
- `docs/i18n/pl/CHANGELOG.md`
- `docs/i18n/pt-BR/CHANGELOG.md`
- `docs/i18n/pt/CHANGELOG.md`
- `docs/i18n/ro/CHANGELOG.md`
- `docs/i18n/ru/CHANGELOG.md`
- `docs/i18n/sk/CHANGELOG.md`
- `docs/i18n/sv/CHANGELOG.md`
- `docs/i18n/sw/CHANGELOG.md`
- `docs/i18n/ta/CHANGELOG.md`
- `docs/i18n/te/CHANGELOG.md`
- `docs/i18n/th/CHANGELOG.md`
- `docs/i18n/tr/CHANGELOG.md`
- `docs/i18n/uk-UA/CHANGELOG.md`
- `docs/i18n/ur/CHANGELOG.md`
- `docs/i18n/vi/CHANGELOG.md`
- `docs/i18n/zh-CN/CHANGELOG.md`
- `docs/openapi.yaml`
- `docs/ops/RELEASE_CHECKLIST.md`
- `docs/providers/AGENTROUTER.md`
- `docs/reference/ENVIRONMENT.md`
- `docs/reference/FEATURE_FLAGS.md`
- `docs/reference/PROVIDER_REFERENCE.md`
- `docs/security/STEALTH_GUIDE.md`
- `electron/package-lock.json`
- `electron/package.json`
- `open-sse/config/anthropicHeaders.ts`
- `open-sse/config/audioRegistry.ts`
- `open-sse/config/freeModelCatalog.data.ts`
- `open-sse/config/imageRegistry.ts`
- `open-sse/config/providers/index.ts`
- `open-sse/config/providers/registry/blackbox/index.ts`
- `open-sse/config/providers/registry/cline/index.ts`
- `open-sse/config/providers/registry/factory/index.ts`
- `open-sse/config/providers/registry/gemini/index.ts`
- `open-sse/config/providers/registry/grok-cli/index.ts`
- `open-sse/config/providers/registry/kiro/index.ts`
- `open-sse/config/providers/registry/minimax/cn/index.ts`
- `open-sse/config/providers/registry/minimax/index.ts`
- `open-sse/config/providers/registry/zenmux-free/index.ts`
- `open-sse/config/providers/shared.ts`
- `open-sse/config/videoRegistry.ts`
- `open-sse/executors/azure-openai.ts`
- `open-sse/executors/base.ts`
- `open-sse/executors/codebuddy-cn.ts`
- `open-sse/executors/cursor.ts`
- `open-sse/executors/default.ts`
- `open-sse/executors/grok-cli.ts`
- `open-sse/executors/index.ts`
- `open-sse/executors/kiro.ts`
- `open-sse/executors/kiroThinking.ts`
- `open-sse/executors/zenmux-free.ts`
- `open-sse/handlers/audioSpeech.ts`
- `open-sse/handlers/chatCore.ts`
- `open-sse/handlers/chatCore/attemptLogging.ts`
- `open-sse/handlers/chatCore/cooldownClassification.ts`
- `open-sse/handlers/chatCore/jsonBodyToSse.ts`
- `open-sse/handlers/responseSanitizer.ts`
- `open-sse/handlers/videoGeneration.ts`
- `open-sse/mcp-server/tools/poolTools.ts`
- `open-sse/package.json`
- `open-sse/services/accountFallback.ts`
- `open-sse/services/browserPool.ts`
- `open-sse/services/claudeCodeCompatible.ts`
- `open-sse/services/claudeCodeCompatibleThinkingDisplay.ts`
- `open-sse/services/combo.ts`
- `open-sse/services/combo/targetExhaustion.ts`
- `open-sse/services/compression/engines/index.ts`
- `open-sse/services/compression/engines/ionizer/index.ts`
- `open-sse/services/compression/engines/ionizer/sample.ts`
- `open-sse/services/compression/engines/llmlingua/worker.ts`
- `open-sse/services/compression/engines/rtk/filterLoader.ts`
- `open-sse/services/compression/engines/session-dedup/fuzzy.ts`
- `open-sse/services/compression/engines/session-dedup/index.ts`
- `open-sse/services/compression/engines/types.ts`
- `open-sse/services/compression/eval/fidelityCheck.ts`
- `open-sse/services/compression/fidelityGate.ts`
- `open-sse/services/compression/fidelityGateStep.ts`
- `open-sse/services/compression/ruleLoader.ts`
- `open-sse/services/compression/strategySelector.ts`
- `open-sse/services/compression/types.ts`
- `open-sse/translator/helpers/geminiHelper.ts`
- `open-sse/translator/helpers/openaiHelper.ts`
- `open-sse/translator/index.ts`
- `open-sse/translator/request/claude-to-openai.ts`
- `open-sse/utils/aiSdkCompat.ts`
- `open-sse/utils/cacheControlPolicy.ts`
- `open-sse/utils/composerToolCalls.ts`
- `open-sse/utils/diagnostics.ts`
- `open-sse/utils/earlyStreamKeepalive.ts`
- `open-sse/utils/jsonToSse.ts`
- `open-sse/utils/passthroughTailProcessor.ts`
- `open-sse/utils/publicCreds.ts`
- `open-sse/utils/reasoningFields.ts`
- `open-sse/utils/socksConnectorWithFamily.ts`
- `open-sse/utils/stream.ts`
- `open-sse/utils/streamFailureFinalization.ts`
- `open-sse/utils/streamHandler.ts`
- `open-sse/utils/streamHelpers.ts`
- `package-lock.json`
- `package.json`
- `scripts/check/check-db-rules.mjs`
- `scripts/check/check-env-doc-sync.mjs`
- `scripts/check/check-error-helper.mjs`
- `scripts/check/check-test-discovery.mjs`
- `scripts/sre/oncall-rotation.mjs`
- `scripts/sre/redact-logs.mjs`
- `scripts/test/_vpsClient.mjs`
- `scripts/test/combo-live-vps.mjs`
- `src/app/(dashboard)/dashboard/combos/BuilderIntelligentStep.tsx`
- `src/app/(dashboard)/dashboard/combos/IntelligentComboPanel.tsx`
- `src/app/(dashboard)/dashboard/combos/page.tsx`
- `src/app/(dashboard)/dashboard/compression/live/page.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/CompareView.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/DiffPane.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/PlayView.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/PlaygroundInput.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/compressionFlowModel.ts`
- `src/app/(dashboard)/dashboard/compression/studio/page.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/ProviderDetailPageClient.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/__tests__/providerModelsSectionVisibilityKey.test.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/CompatibleModelsSection.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/ConnectionsHeaderToolbar.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/EmptyConnectionsPlaceholder.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/ModelRow.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/PassthroughModelRow.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/PassthroughModelsSection.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/ProviderModalsPanel.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/ProviderModelsSection.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/modals/AddApiKeyModal.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/modals/CcCompatibleRequestDefaultsFields.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/modals/EditConnectionModal.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/modals/ImportGrokCliAuthModal.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/modals/ccCompatibleRequestDefaults.ts`
- `src/app/(dashboard)/dashboard/providers/[id]/components/modals/connectionProviderSpecificData.ts`
- `src/app/(dashboard)/dashboard/providers/[id]/hooks/useProviderConnections.ts`
- `src/app/(dashboard)/dashboard/providers/[id]/providerPageHelpers.ts`
- `src/app/(dashboard)/dashboard/settings/components/ProxyRegistryManager.tsx`
- `src/app/(dashboard)/dashboard/settings/components/ResilienceTab.tsx`
- `src/app/(dashboard)/dashboard/settings/components/parseBulkProxyImport.ts`
- `src/app/api/cli-tools/backups/route.ts`
- `src/app/api/cli-tools/guide-settings/[toolId]/route.ts`
- `src/app/api/compression/compare/route.ts`
- `src/app/api/compression/compare/verify/route.ts`
- `src/app/api/compression/preview/route.ts`
- `src/app/api/compression/retrieve/route.ts`
- `src/app/api/logs/export/route.ts`
- `src/app/api/models/catalog/route.ts`
- `src/app/api/oauth/[provider]/[action]/route.ts`
- `src/app/api/oauth/kiro/auto-import/route.ts`
- `src/app/api/oauth/kiro/import/route.ts`
- `src/app/api/providers/[id]/models/discoveryConfig.ts`
- `src/app/api/providers/[id]/models/route.ts`
- `src/app/api/providers/test-batch/route.ts`
- `src/app/api/resilience/route.ts`
- `src/app/api/settings/import-json/route.ts`
- `src/app/api/settings/proxy/cloudflare-deploy/route.ts`
- `src/app/api/settings/proxy/test/route.ts`
- `src/app/api/usage/proxy-logs/route.ts`
- `src/app/api/v1/messages/route.ts`
- `src/app/api/v1/models/modelById.ts`
- `src/domain/quotaCache.ts`
- `src/hooks/usePreviewCompression.ts`
- `src/i18n/messages/ar.json`
- `src/i18n/messages/az.json`
- `src/i18n/messages/bg.json`
- `src/i18n/messages/bn.json`
- `src/i18n/messages/cs.json`
- `src/i18n/messages/da.json`
- `src/i18n/messages/de.json`
- `src/i18n/messages/en.json`
- `src/i18n/messages/es.json`
- `src/i18n/messages/fa.json`
- `src/i18n/messages/fi.json`
- `src/i18n/messages/fr.json`
- `src/i18n/messages/gu.json`
- `src/i18n/messages/he.json`
- `src/i18n/messages/hi.json`
- `src/i18n/messages/hu.json`
- `src/i18n/messages/id.json`
- `src/i18n/messages/in.json`
- `src/i18n/messages/it.json`
- `src/i18n/messages/ja.json`
- `src/i18n/messages/ko.json`
- `src/i18n/messages/mr.json`
- `src/i18n/messages/ms.json`
- `src/i18n/messages/nl.json`
- `src/i18n/messages/no.json`
- `src/i18n/messages/phi.json`
- `src/i18n/messages/pl.json`
- `src/i18n/messages/pt-BR.json`
- `src/i18n/messages/pt.json`
- `src/i18n/messages/ro.json`
- `src/i18n/messages/ru.json`
- `src/i18n/messages/sk.json`
- `src/i18n/messages/sv.json`
- `src/i18n/messages/sw.json`
- `src/i18n/messages/ta.json`
- `src/i18n/messages/te.json`
- `src/i18n/messages/th.json`
- `src/i18n/messages/tr.json`
- `src/i18n/messages/uk-UA.json`
- `src/i18n/messages/ur.json`
- `src/i18n/messages/vi.json`
- `src/i18n/messages/zh-CN.json`
- `src/lib/api/serverErrorMessage.ts`
- `src/lib/compression/judgeModelClient.ts`
- `src/lib/db/adapters/driverFactory.ts`
- `src/lib/db/core.ts`
- `src/lib/db/migrations/108_provider_quota_reset_events.sql`
- `src/lib/db/models.ts`
- `src/lib/db/providers.ts`
- `src/lib/db/proxies.ts`
- `src/lib/db/quotaResetEvents.ts`
- `src/lib/db/quotaSnapshots.ts`
- `src/lib/db/webSessionDedup.ts`
- `src/lib/localDb.ts`
- `src/lib/oauth/constants/oauth.ts`
- `src/lib/oauth/providers/grok-cli.ts`
- `src/lib/oauth/providers/index.ts`
- `src/lib/providers/requestDefaults.ts`
- `src/lib/providers/validation/transport.ts`
- `src/lib/quota/planRegistry.ts`
- `src/lib/services/embedWsProxy.ts`
- `src/lib/usage/apiKeyUsageLimits.ts`
- `src/lib/usage/usageEvents.ts`
- `src/lib/usage/usageHistory.ts`
- `src/mitm/handlers/antigravity.ts`
- `src/shared/components/KiroAuthModal.tsx`
- `src/shared/components/OAuthModal.tsx`
- `src/shared/components/RequestLoggerDetail.tsx`
- `src/shared/components/Sidebar.tsx`
- `src/shared/constants/featureFlagDefinitions.ts`
- `src/shared/constants/mcpScopes.ts`
- `src/shared/constants/providers.ts`
- `src/shared/constants/providers/apikey/gateways.ts`
- `src/shared/constants/providers/oauth.ts`
- `src/shared/constants/providers/web-cookie.ts`
- `src/shared/constants/sidebarVisibility.ts`
- `src/shared/network/outboundUrlGuard.ts`
- `src/shared/network/safeOutboundFetch.ts`
- `src/shared/providers/webSessionCredentials.ts`
- `src/shared/validation/providerSpecificData.ts`
- `src/shared/validation/schemas/auth.ts`
- `src/shared/validation/schemas/combo.ts`
- `src/shared/validation/schemas/provider.ts`
- `src/shared/validation/schemas/proxy.ts`
- `src/sse/handlers/chat.ts`
- `src/sse/handlers/chatHelpers.ts`
- `src/sse/services/auth.ts`
- `src/store/index.ts`
- `src/store/providerStore.ts`
- `src/store/userStore.ts`
- `tests/integration/_comboRoutingHarness.ts`
- `tests/integration/combo-live/_liveHarness.ts`
- `tests/integration/combo-live/auto.live.test.ts`
- `tests/integration/combo-live/cost-and-fusion.live.test.ts`
- `tests/integration/combo-live/ordered.live.test.ts`
- `tests/integration/combo-matrix/auto.test.ts`
- `tests/integration/combo-matrix/cost-and-context.test.ts`
- `tests/integration/combo-matrix/fusion.test.ts`
- `tests/integration/combo-matrix/ordered.test.ts`
- `tests/integration/combo-matrix/quota-aware.test.ts`
- `tests/integration/combo-matrix/weighted.test.ts`
- `tests/snapshots/provider/translate-path.json`
- `tests/unit/_mitmHandlerHarness.ts`
- `tests/unit/anthropic-header-dedupe-1475.test.ts`
- `tests/unit/api/server-error-message.test.ts`
- `tests/unit/blackbox.test.ts`
- `tests/unit/chatcore-attempt-logging.test.ts`
- `tests/unit/check-db-rules-classification.test.ts`
- `tests/unit/check-error-helper.test.ts`
- `tests/unit/claude-code-compatible-request.test.ts`
- `tests/unit/claude-to-openai-image-toolresult.test.ts`
- `tests/unit/cline-catalog-models-3321.test.ts`
- `tests/unit/codebuddy-cn-provider.test.ts`
- `tests/unit/codebuddy-reasoning-optin.test.ts`
- `tests/unit/codex-quota-sync-no-proactive-refresh.test.ts`
- `tests/unit/combo-account-allowlist-3266.test.ts`
- `tests/unit/combo-config.test.ts`
- `tests/unit/combo-empty-content-failover-5085.test.ts`
- `tests/unit/composer-tool-calls.test.ts`
- `tests/unit/compression/compareRoute.test.ts`
- `tests/unit/compression/fidelityCheck.test.ts`
- `tests/unit/compression/fidelityGate.test.ts`
- `tests/unit/compression/fidelityGateStacked.test.ts`
- `tests/unit/compression/fidelityGateTypes.test.ts`
- `tests/unit/compression/fuzzyDedup.test.ts`
- `tests/unit/compression/ionizerEngine.test.ts`
- `tests/unit/compression/ionizerGateSkip.test.ts`
- `tests/unit/compression/ionizerSample.test.ts`
- `tests/unit/compression/llmlingua-worker-resolution.test.ts`
- `tests/unit/compression/previewRouteBreakdown.test.ts`
- `tests/unit/compression/previewRouteFidelity.test.ts`
- `tests/unit/compression/previewRouteFuzzy.test.ts`
- `tests/unit/compression/previewRouteIonizer.test.ts`
- `tests/unit/compression/previewRoutePipeline.test.ts`
- `tests/unit/compression/previewRouteTokens.test.ts`
- `tests/unit/compression/retrieveRoute.test.ts`
- `tests/unit/compression/rtk-loader-dir-resolution-5089.test.ts`
- `tests/unit/compression/sessionDedupFuzzy.test.ts`
- `tests/unit/dashscope-cache-control-openai-2069.test.ts`
- `tests/unit/db-core-init.test.ts`
- `tests/unit/db-driver-logs-english-5103.test.ts`
- `tests/unit/db-provider-cookie-dedup-3368.test.ts`
- `tests/unit/derive-discovery-config-5087.test.ts`
- `tests/unit/diagnostics-claude-thinking-5108.test.ts`
- `tests/unit/diagnostics.test.ts`
- `tests/unit/early-stream-keepalive.test.ts`
- `tests/unit/embed-ws-host-empty-messages-5110.test.ts`
- `tests/unit/executor-default-strip-client-metadata.test.ts`
- `tests/unit/factory-provider-registry.test.ts`
- `tests/unit/feature-flags-settings.test.ts`
- `tests/unit/gemini-helper-audio-input-912.test.ts`
- `tests/unit/grok-cli-oauth.test.ts`
- `tests/unit/json-to-sse-3089.test.ts`
- `tests/unit/kiro-auto-import-idc-2059.test.ts`
- `tests/unit/kiroThinking.test.ts`
- `tests/unit/lib/quota-reset-events.test.ts`
- `tests/unit/log-export-routes.test.mjs`
- `tests/unit/mcp-pool-tools-3368.test.ts`
- `tests/unit/mitm-handler-antigravity.test.ts`
- `tests/unit/oauth-providers-config.test.ts`
- `tests/unit/provider-page-helpers-3501.test.ts`
- `tests/unit/provider-specific-data-schema.test.ts`
- `tests/unit/provider-translate-path-golden.test.ts`
- `tests/unit/providers-constants-split.test.ts`
- `tests/unit/providers-validate-route.test.ts`
- `tests/unit/proxy-logs-route.test.ts`
- `tests/unit/proxy-registry-manager.test.ts`
- `tests/unit/quota-cache-hydrate-5015.test.ts`
- `tests/unit/quota-plan-registry.test.ts`
- `tests/unit/relay-deploy-5128.test.ts`
- `tests/unit/replace-custom-models-preserve-hidden-5086.test.ts`
- `tests/unit/request-defaults-store-session.test.ts`
- `tests/unit/resilience-settings-quota-preflight.test.ts`
- `tests/unit/resilience-tab-response-fields.test.ts`
- `tests/unit/resolve-stream-flag.test.ts`
- `tests/unit/response-sanitizer.test.ts`
- `tests/unit/responses-default-text-format.test.ts`
- `tests/unit/self-inflicted-upstream-timeout.test.ts`
- `tests/unit/settings-i18n-keys.test.ts`
- `tests/unit/sidebar-icon-accents-3812.test.ts`
- `tests/unit/socks-handshake-timeout-5109.test.ts`
- `tests/unit/sre-oncall-rotation.test.ts`
- `tests/unit/sre-redact-logs.test.ts`
- `tests/unit/stream-handler-client-disconnect.test.ts`
- `tests/unit/stream-handler.test.ts`
- `tests/unit/stream-non-json-sse.test.ts`
- `tests/unit/stream-utils.test.ts`
- `tests/unit/streamHelpers.test.ts`
- `tests/unit/strip-reasoning-header.test.ts`
- `tests/unit/t30-kiro-400-model-unavailable.test.ts`
- `tests/unit/ui/add-api-key-modal-validation-error-5088.test.tsx`
- `tests/unit/ui/compareView.test.tsx`
- `tests/unit/ui/diffPane.test.tsx`
- `tests/unit/ui/fidelityGateToggle.test.tsx`
- `tests/unit/ui/fuzzyDedupToggle.test.tsx`
- `tests/unit/ui/ionizerLane.test.tsx`
- `tests/unit/ui/livePage.test.tsx`
- `tests/unit/ui/model-alias-edit.test.tsx`
- `tests/unit/ui/playView.test.tsx`
- `tests/unit/ui/previewToRunModel.test.tsx`
- `tests/unit/ui/studio-pages.test.tsx`
- `tests/unit/ui/studioTabs.test.tsx`
- `tests/unit/ui/usePreviewCompression.test.tsx`
- `tests/unit/usage/usageHistoryDedup.test.ts`
- `tests/unit/v1-models-by-id-4674.test.ts`
- `tests/unit/vertex-tts.test.ts`
- `tests/unit/video-dashscope.test.ts`
- `tests/unit/web-session-dedup-3368.test.ts`
- `tests/unit/zenmux-free-provider.test.ts`

### [#5080](https://github.com/cheaper-inference/OmniRoute/pull/5080) - 2026-06-26T16:10:06Z - 29 paths

- `CHANGELOG.md`
- `open-sse/services/compression/eval/fidelityCheck.ts`
- `src/app/(dashboard)/dashboard/compression/live/page.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/CompareView.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/DiffPane.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/PlayView.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/PlaygroundInput.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/compressionFlowModel.ts`
- `src/app/(dashboard)/dashboard/compression/studio/page.tsx`
- `src/app/api/compression/compare/route.ts`
- `src/app/api/compression/compare/verify/route.ts`
- `src/app/api/compression/preview/route.ts`
- `src/app/api/compression/retrieve/route.ts`
- `src/hooks/usePreviewCompression.ts`
- `src/lib/compression/judgeModelClient.ts`
- `tests/unit/compression/compareRoute.test.ts`
- `tests/unit/compression/fidelityCheck.test.ts`
- `tests/unit/compression/previewRouteBreakdown.test.ts`
- `tests/unit/compression/previewRoutePipeline.test.ts`
- `tests/unit/compression/previewRouteTokens.test.ts`
- `tests/unit/compression/retrieveRoute.test.ts`
- `tests/unit/ui/compareView.test.tsx`
- `tests/unit/ui/diffPane.test.tsx`
- `tests/unit/ui/livePage.test.tsx`
- `tests/unit/ui/playView.test.tsx`
- `tests/unit/ui/previewToRunModel.test.tsx`
- `tests/unit/ui/studio-pages.test.tsx`
- `tests/unit/ui/studioTabs.test.tsx`
- `tests/unit/ui/usePreviewCompression.test.tsx`

### [#5086](https://github.com/cheaper-inference/OmniRoute/pull/5086) - 2026-06-26T14:13:25Z - 3 paths

- `CHANGELOG.md`
- `src/lib/db/models.ts`
- `tests/unit/replace-custom-models-preserve-hidden-5086.test.ts`

### [#5087](https://github.com/cheaper-inference/OmniRoute/pull/5087) - 2026-06-26T14:14:54Z - 6 paths

- `CHANGELOG.md`
- `open-sse/config/providers/registry/minimax/cn/index.ts`
- `open-sse/config/providers/registry/minimax/index.ts`
- `src/app/api/providers/[id]/models/discoveryConfig.ts`
- `src/app/api/providers/[id]/models/route.ts`
- `tests/unit/derive-discovery-config-5087.test.ts`

### [#5089](https://github.com/cheaper-inference/OmniRoute/pull/5089) - 2026-06-26T14:16:28Z - 6 paths

- `CHANGELOG.md`
- `open-sse/services/compression/engines/llmlingua/worker.ts`
- `open-sse/services/compression/engines/rtk/filterLoader.ts`
- `open-sse/services/compression/ruleLoader.ts`
- `tests/unit/compression/llmlingua-worker-resolution.test.ts`
- `tests/unit/compression/rtk-loader-dir-resolution-5089.test.ts`

### [#5091](https://github.com/cheaper-inference/OmniRoute/pull/5091) - 2026-06-27T01:24:16Z - 2 paths

- `src/app/(dashboard)/dashboard/providers/[id]/__tests__/providerModelsSectionVisibilityKey.test.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/ProviderModelsSection.tsx`

### [#5093](https://github.com/cheaper-inference/OmniRoute/pull/5093) - 2026-06-27T01:46:20Z - 6 paths

- `CHANGELOG.md`
- `open-sse/services/accountFallback.ts`
- `open-sse/translator/helpers/geminiHelper.ts`
- `src/sse/services/auth.ts`
- `tests/unit/gemini-helper-audio-input-912.test.ts`
- `tests/unit/resilience-settings-quota-preflight.test.ts`

### [#5100](https://github.com/cheaper-inference/OmniRoute/pull/5100) - 2026-06-26T20:11:15Z - 3 paths

- `CHANGELOG.md`
- `open-sse/translator/request/claude-to-openai.ts`
- `tests/unit/claude-to-openai-image-toolresult.test.ts`

### [#5101](https://github.com/cheaper-inference/OmniRoute/pull/5101) - 2026-06-26T20:13:20Z - 4 paths

- `CHANGELOG.md`
- `config/quality/file-size-baseline.json`
- `open-sse/executors/default.ts`
- `tests/unit/responses-default-text-format.test.ts`

### [#5102](https://github.com/cheaper-inference/OmniRoute/pull/5102) - 2026-06-26T20:20:26Z - 1 paths

- `open-sse/services/browserPool.ts`

### [#5104](https://github.com/cheaper-inference/OmniRoute/pull/5104) - 2026-06-26T17:08:17Z - 3 paths

- `CHANGELOG.md`
- `open-sse/services/combo/targetExhaustion.ts`
- `tests/unit/combo-empty-content-failover-5085.test.ts`

### [#5105](https://github.com/cheaper-inference/OmniRoute/pull/5105) - 2026-06-27T01:08:28Z - 7 paths

- `CHANGELOG.md`
- `open-sse/config/providers/index.ts`
- `open-sse/config/providers/registry/zenmux-free/index.ts`
- `open-sse/executors/index.ts`
- `open-sse/executors/zenmux-free.ts`
- `src/shared/constants/providers/web-cookie.ts`
- `tests/unit/zenmux-free-provider.test.ts`

### [#5106](https://github.com/cheaper-inference/OmniRoute/pull/5106) - 2026-06-26T17:09:42Z - 3 paths

- `CHANGELOG.md`
- `src/app/(dashboard)/dashboard/providers/[id]/components/modals/AddApiKeyModal.tsx`
- `tests/unit/ui/add-api-key-modal-validation-error-5088.test.tsx`

### [#5107](https://github.com/cheaper-inference/OmniRoute/pull/5107) - 2026-06-26T17:10:10Z - 10 paths

- `.env.example`
- `CHANGELOG.md`
- `docs/reference/ENVIRONMENT.md`
- `docs/reference/FEATURE_FLAGS.md`
- `src/lib/providers/validation/transport.ts`
- `src/shared/constants/featureFlagDefinitions.ts`
- `src/shared/network/outboundUrlGuard.ts`
- `src/shared/network/safeOutboundFetch.ts`
- `tests/unit/feature-flags-settings.test.ts`
- `tests/unit/providers-validate-route.test.ts`

### [#5112](https://github.com/cheaper-inference/OmniRoute/pull/5112) - 2026-06-27T01:24:23Z - 4 paths

- `.github/workflows/ci.yml`
- `.github/workflows/electron-release.yml`
- `.github/workflows/nightly-mutation.yml`
- `.github/workflows/nightly-resilience.yml`

### [#5115](https://github.com/cheaper-inference/OmniRoute/pull/5115) - 2026-06-26T19:15:14Z - 4 paths

- `CHANGELOG.md`
- `src/lib/db/adapters/driverFactory.ts`
- `src/lib/db/core.ts`
- `tests/unit/db-driver-logs-english-5103.test.ts`

### [#5116](https://github.com/cheaper-inference/OmniRoute/pull/5116) - 2026-06-26T19:14:14Z - 3 paths

- `CHANGELOG.md`
- `open-sse/utils/diagnostics.ts`
- `tests/unit/diagnostics-claude-thinking-5108.test.ts`

### [#5117](https://github.com/cheaper-inference/OmniRoute/pull/5117) - 2026-06-26T19:30:51Z - 8 paths

- `CHANGELOG.md`
- `open-sse/config/anthropicHeaders.ts`
- `open-sse/handlers/responseSanitizer.ts`
- `tests/unit/codebuddy-cn-provider.test.ts`
- `tests/unit/db-core-init.test.ts`
- `tests/unit/diagnostics.test.ts`
- `tests/unit/providers-constants-split.test.ts`
- `tests/unit/response-sanitizer.test.ts`

### [#5119](https://github.com/cheaper-inference/OmniRoute/pull/5119) - 2026-06-27T01:09:30Z - 49 paths

- `CHANGELOG.md`
- `src/app/(dashboard)/dashboard/providers/[id]/components/CompatibleModelsSection.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/ModelRow.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/PassthroughModelRow.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/PassthroughModelsSection.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/ProviderModelsSection.tsx`
- `src/i18n/messages/ar.json`
- `src/i18n/messages/az.json`
- `src/i18n/messages/bg.json`
- `src/i18n/messages/bn.json`
- `src/i18n/messages/cs.json`
- `src/i18n/messages/da.json`
- `src/i18n/messages/de.json`
- `src/i18n/messages/en.json`
- `src/i18n/messages/es.json`
- `src/i18n/messages/fa.json`
- `src/i18n/messages/fi.json`
- `src/i18n/messages/fr.json`
- `src/i18n/messages/gu.json`
- `src/i18n/messages/he.json`
- `src/i18n/messages/hi.json`
- `src/i18n/messages/hu.json`
- `src/i18n/messages/id.json`
- `src/i18n/messages/in.json`
- `src/i18n/messages/it.json`
- `src/i18n/messages/ja.json`
- `src/i18n/messages/ko.json`
- `src/i18n/messages/mr.json`
- `src/i18n/messages/ms.json`
- `src/i18n/messages/nl.json`
- `src/i18n/messages/no.json`
- `src/i18n/messages/phi.json`
- `src/i18n/messages/pl.json`
- `src/i18n/messages/pt-BR.json`
- `src/i18n/messages/pt.json`
- `src/i18n/messages/ro.json`
- `src/i18n/messages/ru.json`
- `src/i18n/messages/sk.json`
- `src/i18n/messages/sv.json`
- `src/i18n/messages/sw.json`
- `src/i18n/messages/ta.json`
- `src/i18n/messages/te.json`
- `src/i18n/messages/th.json`
- `src/i18n/messages/tr.json`
- `src/i18n/messages/uk-UA.json`
- `src/i18n/messages/ur.json`
- `src/i18n/messages/vi.json`
- `src/i18n/messages/zh-CN.json`
- `tests/unit/ui/model-alias-edit.test.tsx`

### [#5120](https://github.com/cheaper-inference/OmniRoute/pull/5120) - 2026-06-26T20:26:40Z - 2 paths

- `tests/unit/blackbox.test.ts`
- `tests/unit/kiro-auto-import-idc-2059.test.ts`

### [#5121](https://github.com/cheaper-inference/OmniRoute/pull/5121) - 2026-06-27T01:20:10Z - 10 paths

- `config/quality/file-size-baseline.json`
- `open-sse/mcp-server/tools/poolTools.ts`
- `open-sse/services/browserPool.ts`
- `scripts/check/check-db-rules.mjs`
- `src/lib/db/providers.ts`
- `src/lib/db/webSessionDedup.ts`
- `src/shared/constants/mcpScopes.ts`
- `tests/unit/db-provider-cookie-dedup-3368.test.ts`
- `tests/unit/mcp-pool-tools-3368.test.ts`
- `tests/unit/web-session-dedup-3368.test.ts`

### [#5122](https://github.com/cheaper-inference/OmniRoute/pull/5122) - 2026-06-26T22:12:46Z - 7 paths

- `CHANGELOG.md`
- `config/quality/file-size-baseline.json`
- `open-sse/translator/helpers/openaiHelper.ts`
- `open-sse/translator/index.ts`
- `tests/snapshots/provider/translate-path.json`
- `tests/unit/codex-quota-sync-no-proactive-refresh.test.ts`
- `tests/unit/db-core-init.test.ts`

### [#5124](https://github.com/cheaper-inference/OmniRoute/pull/5124) - 2026-06-27T01:27:12Z - 21 paths

- `CHANGELOG.md`
- `config/quality/complexity-baseline.json`
- `config/quality/quality-baseline.json`
- `open-sse/handlers/chatCore.ts`
- `open-sse/handlers/chatCore/jsonBodyToSse.ts`
- `open-sse/handlers/responseSanitizer.ts`
- `open-sse/utils/jsonToSse.ts`
- `open-sse/utils/passthroughTailProcessor.ts`
- `open-sse/utils/reasoningFields.ts`
- `open-sse/utils/stream.ts`
- `open-sse/utils/streamFailureFinalization.ts`
- `open-sse/utils/streamHandler.ts`
- `open-sse/utils/streamHelpers.ts`
- `src/app/(dashboard)/dashboard/providers/[id]/components/modals/AddApiKeyModal.tsx`
- `src/sse/handlers/chat.ts`
- `src/sse/handlers/chatHelpers.ts`
- `tests/unit/json-to-sse-3089.test.ts`
- `tests/unit/response-sanitizer.test.ts`
- `tests/unit/stream-handler.test.ts`
- `tests/unit/stream-utils.test.ts`
- `tests/unit/streamHelpers.test.ts`

### [#5125](https://github.com/cheaper-inference/OmniRoute/pull/5125) - 2026-06-26T23:02:33Z - 2 paths

- `tests/snapshots/provider/translate-path.json`
- `tests/unit/provider-translate-path-golden.test.ts`

### [#5126](https://github.com/cheaper-inference/OmniRoute/pull/5126) - 2026-06-26T23:31:41Z - 2 paths

- `tests/snapshots/provider/translate-path.json`
- `tests/unit/provider-translate-path-golden.test.ts`

### [#5127](https://github.com/cheaper-inference/OmniRoute/pull/5127) - 2026-06-27T05:56:07Z - 15 paths

- `config/quality/file-size-baseline.json`
- `open-sse/services/compression/fidelityGate.ts`
- `open-sse/services/compression/fidelityGateStep.ts`
- `open-sse/services/compression/strategySelector.ts`
- `open-sse/services/compression/types.ts`
- `src/app/(dashboard)/dashboard/compression/studio/PlayView.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/PlaygroundInput.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/compressionFlowModel.ts`
- `src/app/api/compression/preview/route.ts`
- `src/hooks/usePreviewCompression.ts`
- `tests/unit/compression/fidelityGate.test.ts`
- `tests/unit/compression/fidelityGateStacked.test.ts`
- `tests/unit/compression/fidelityGateTypes.test.ts`
- `tests/unit/compression/previewRouteFidelity.test.ts`
- `tests/unit/ui/fidelityGateToggle.test.tsx`

### [#5129](https://github.com/cheaper-inference/OmniRoute/pull/5129) - 2026-06-27T02:14:27Z - 3 paths

- `open-sse/executors/default.ts`
- `open-sse/utils/anthropicHost.ts`
- `tests/unit/anthropic-official-baseurl-host.test.ts`

### [#5130](https://github.com/cheaper-inference/OmniRoute/pull/5130) - 2026-06-27T02:14:18Z - 3 paths

- `open-sse/executors/default.ts`
- `open-sse/utils/anthropicHost.ts`
- `tests/unit/anthropic-official-baseurl-host.test.ts`

### [#5132](https://github.com/cheaper-inference/OmniRoute/pull/5132) - 2026-06-27T03:13:55Z - 6 paths

- `CHANGELOG.md`
- `src/app/api/settings/proxy/cloudflare-deploy/route.ts`
- `src/app/api/settings/proxy/test/route.ts`
- `src/lib/db/proxies.ts`
- `src/shared/validation/schemas/proxy.ts`
- `tests/unit/relay-deploy-5128.test.ts`

### [#5133](https://github.com/cheaper-inference/OmniRoute/pull/5133) - 2026-06-27T03:14:59Z - 4 paths

- `CHANGELOG.md`
- `src/lib/services/embedWsProxy.ts`
- `src/sse/handlers/chat.ts`
- `tests/unit/embed-ws-host-empty-messages-5110.test.ts`

### [#5135](https://github.com/cheaper-inference/OmniRoute/pull/5135) - 2026-06-27T04:12:18Z - 3 paths

- `CHANGELOG.md`
- `src/app/api/v1/models/modelById.ts`
- `tests/unit/v1-models-by-id-4674.test.ts`

### [#5136](https://github.com/cheaper-inference/OmniRoute/pull/5136) - 2026-06-27T04:13:12Z - 2 paths

- `open-sse/config/providers/registry/cline/index.ts`
- `tests/unit/cline-catalog-models-3321.test.ts`

### [#5137](https://github.com/cheaper-inference/OmniRoute/pull/5137) - 2026-06-27T04:14:38Z - 5 paths

- `.env.example`
- `CHANGELOG.md`
- `docs/reference/ENVIRONMENT.md`
- `open-sse/utils/socksConnectorWithFamily.ts`
- `tests/unit/socks-handshake-timeout-5109.test.ts`

### [#5138](https://github.com/cheaper-inference/OmniRoute/pull/5138) - 2026-06-27T06:03:43Z - 10 paths

- `scripts/sre/oncall-rotation.mjs`
- `scripts/sre/redact-logs.mjs`
- `src/app/(dashboard)/dashboard/combos/page.tsx`
- `src/lib/api/serverErrorMessage.ts`
- `src/store/index.ts`
- `src/store/providerStore.ts`
- `src/store/userStore.ts`
- `tests/unit/api/server-error-message.test.ts`
- `tests/unit/sre-oncall-rotation.test.ts`
- `tests/unit/sre-redact-logs.test.ts`

### [#5139](https://github.com/cheaper-inference/OmniRoute/pull/5139) - 2026-06-27T05:22:45Z - 4 paths

- `CHANGELOG.md`
- `src/app/(dashboard)/dashboard/settings/components/ResilienceTab.tsx`
- `src/app/api/resilience/route.ts`
- `tests/unit/resilience-tab-response-fields.test.ts`

### [#5141](https://github.com/cheaper-inference/OmniRoute/pull/5141) - 2026-06-27T05:39:29Z - 8 paths

- `open-sse/utils/diagnostics.ts`
- `src/domain/quotaCache.ts`
- `src/lib/db/migrations/108_provider_quota_reset_events.sql`
- `src/lib/db/quotaResetEvents.ts`
- `src/lib/localDb.ts`
- `src/lib/usage/apiKeyUsageLimits.ts`
- `tests/unit/diagnostics.test.ts`
- `tests/unit/lib/quota-reset-events.test.ts`

### [#5142](https://github.com/cheaper-inference/OmniRoute/pull/5142) - 2026-06-27T05:38:30Z - 1 paths

- `src/shared/constants/sidebarVisibility.ts`

### [#5143](https://github.com/cheaper-inference/OmniRoute/pull/5143) - 2026-06-27T06:08:55Z - 10 paths

- `open-sse/services/compression/engines/session-dedup/fuzzy.ts`
- `open-sse/services/compression/engines/session-dedup/index.ts`
- `src/app/(dashboard)/dashboard/compression/studio/PlayView.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/PlaygroundInput.tsx`
- `src/app/api/compression/preview/route.ts`
- `src/hooks/usePreviewCompression.ts`
- `tests/unit/compression/fuzzyDedup.test.ts`
- `tests/unit/compression/previewRouteFuzzy.test.ts`
- `tests/unit/compression/sessionDedupFuzzy.test.ts`
- `tests/unit/ui/fuzzyDedupToggle.test.tsx`

### [#5144](https://github.com/cheaper-inference/OmniRoute/pull/5144) - 2026-06-27T05:47:12Z - 41 paths

- `docs/i18n/ar/CHANGELOG.md`
- `docs/i18n/az/CHANGELOG.md`
- `docs/i18n/bg/CHANGELOG.md`
- `docs/i18n/bn/CHANGELOG.md`
- `docs/i18n/cs/CHANGELOG.md`
- `docs/i18n/da/CHANGELOG.md`
- `docs/i18n/de/CHANGELOG.md`
- `docs/i18n/es/CHANGELOG.md`
- `docs/i18n/fa/CHANGELOG.md`
- `docs/i18n/fi/CHANGELOG.md`
- `docs/i18n/fr/CHANGELOG.md`
- `docs/i18n/gu/CHANGELOG.md`
- `docs/i18n/he/CHANGELOG.md`
- `docs/i18n/hi/CHANGELOG.md`
- `docs/i18n/hu/CHANGELOG.md`
- `docs/i18n/id/CHANGELOG.md`
- `docs/i18n/in/CHANGELOG.md`
- `docs/i18n/it/CHANGELOG.md`
- `docs/i18n/ja/CHANGELOG.md`
- `docs/i18n/ko/CHANGELOG.md`
- `docs/i18n/mr/CHANGELOG.md`
- `docs/i18n/ms/CHANGELOG.md`
- `docs/i18n/nl/CHANGELOG.md`
- `docs/i18n/no/CHANGELOG.md`
- `docs/i18n/phi/CHANGELOG.md`
- `docs/i18n/pl/CHANGELOG.md`
- `docs/i18n/pt-BR/CHANGELOG.md`
- `docs/i18n/pt/CHANGELOG.md`
- `docs/i18n/ro/CHANGELOG.md`
- `docs/i18n/ru/CHANGELOG.md`
- `docs/i18n/sk/CHANGELOG.md`
- `docs/i18n/sv/CHANGELOG.md`
- `docs/i18n/sw/CHANGELOG.md`
- `docs/i18n/ta/CHANGELOG.md`
- `docs/i18n/te/CHANGELOG.md`
- `docs/i18n/th/CHANGELOG.md`
- `docs/i18n/tr/CHANGELOG.md`
- `docs/i18n/uk-UA/CHANGELOG.md`
- `docs/i18n/ur/CHANGELOG.md`
- `docs/i18n/vi/CHANGELOG.md`
- `docs/i18n/zh-CN/CHANGELOG.md`

### [#5145](https://github.com/cheaper-inference/OmniRoute/pull/5145) - 2026-06-27T06:03:31Z - 3 paths

- `.github/workflows/ci.yml`
- `package.json`
- `scripts/check/check-test-discovery.mjs`

### [#5146](https://github.com/cheaper-inference/OmniRoute/pull/5146) - 2026-06-27T06:03:59Z - 10 paths

- `docs/ops/RELEASE_CHECKLIST.md`
- `package.json`
- `scripts/check/check-test-discovery.mjs`
- `tests/integration/_comboRoutingHarness.ts`
- `tests/integration/combo-matrix/auto.test.ts`
- `tests/integration/combo-matrix/cost-and-context.test.ts`
- `tests/integration/combo-matrix/fusion.test.ts`
- `tests/integration/combo-matrix/ordered.test.ts`
- `tests/integration/combo-matrix/quota-aware.test.ts`
- `tests/integration/combo-matrix/weighted.test.ts`

### [#5147](https://github.com/cheaper-inference/OmniRoute/pull/5147) - 2026-06-27T06:43:12Z - 1 paths

- `config/quality/file-size-baseline.json`

### [#5148](https://github.com/cheaper-inference/OmniRoute/pull/5148) - 2026-06-27T10:52:21Z - 12 paths

- `open-sse/services/compression/engines/index.ts`
- `open-sse/services/compression/engines/ionizer/index.ts`
- `open-sse/services/compression/engines/ionizer/sample.ts`
- `open-sse/services/compression/engines/types.ts`
- `open-sse/services/compression/fidelityGateStep.ts`
- `open-sse/services/compression/strategySelector.ts`
- `src/app/(dashboard)/dashboard/compression/studio/PlaygroundInput.tsx`
- `tests/unit/compression/ionizerEngine.test.ts`
- `tests/unit/compression/ionizerGateSkip.test.ts`
- `tests/unit/compression/ionizerSample.test.ts`
- `tests/unit/compression/previewRouteIonizer.test.ts`
- `tests/unit/ui/ionizerLane.test.tsx`

### [#5150](https://github.com/cheaper-inference/OmniRoute/pull/5150) - 2026-06-27T11:02:59Z - 3 paths

- `tests/unit/check-db-rules-classification.test.ts`
- `tests/unit/quota-plan-registry.test.ts`
- `tests/unit/sidebar-icon-accents-3812.test.ts`

### [#5151](https://github.com/cheaper-inference/OmniRoute/pull/5151) - 2026-06-27T10:55:39Z - 11 paths

- `CONTRIBUTING.md`
- `docs/ops/RELEASE_CHECKLIST.md`
- `package.json`
- `scripts/check/check-env-doc-sync.mjs`
- `scripts/check/check-test-discovery.mjs`
- `scripts/test/_vpsClient.mjs`
- `scripts/test/combo-live-vps.mjs`
- `tests/integration/combo-live/_liveHarness.ts`
- `tests/integration/combo-live/auto.live.test.ts`
- `tests/integration/combo-live/cost-and-fusion.live.test.ts`
- `tests/integration/combo-live/ordered.live.test.ts`

### [#5153](https://github.com/cheaper-inference/OmniRoute/pull/5153) - 2026-06-27T10:51:58Z - 2 paths

- `src/i18n/messages/en.json`
- `tests/unit/settings-i18n-keys.test.ts`

### [#5155](https://github.com/cheaper-inference/OmniRoute/pull/5155) - 2026-06-27T10:52:03Z - 3 paths

- `open-sse/handlers/responseSanitizer.ts`
- `tests/unit/response-sanitizer.test.ts`
- `tests/unit/strip-reasoning-header.test.ts`

### [#5156](https://github.com/cheaper-inference/OmniRoute/pull/5156) - 2026-06-28T06:09:27Z - 2 paths

- `open-sse/utils/diagnostics.ts`
- `tests/unit/diagnostics.test.ts`

### [#5157](https://github.com/cheaper-inference/OmniRoute/pull/5157) - 2026-06-27T15:09:06Z - 4 paths

- `src/app/api/providers/[id]/test/route.ts`
- `src/lib/providers/xai/thinking.ts`
- `src/lib/providers/xai/translators/openai-chat.ts`
- `tests/unit/xai-translators.test.ts`

### [#5158](https://github.com/cheaper-inference/OmniRoute/pull/5158) - 2026-06-27T15:09:02Z - 2 paths

- `open-sse/services/roleNormalizer.ts`
- `tests/unit/role-normalizer.test.ts`

### [#5159](https://github.com/cheaper-inference/OmniRoute/pull/5159) - 2026-06-27T15:09:16Z - 3 paths

- `AGENTS.md`
- `CLAUDE.md`
- `tests/unit/pii-opt-in-default.test.ts`

### [#5162](https://github.com/cheaper-inference/OmniRoute/pull/5162) - 2026-06-27T15:09:11Z - 4 paths

- `README.md`
- `docs/i18n/README.md`
- `docs/i18n/zh-CN/README.md`
- `docs/i18n/zh-TW/README.md`

### [#5163](https://github.com/cheaper-inference/OmniRoute/pull/5163) - 2026-06-27T15:08:50Z - 17 paths

- `config/quality/dependency-allowlist.json`
- `open-sse/package.json`
- `open-sse/services/compression/engines/headroom/encoderComparison.ts`
- `open-sse/services/compression/engines/headroom/index.ts`
- `open-sse/services/compression/engines/headroom/smartcrusher.ts`
- `open-sse/services/compression/engines/headroom/tabular.ts`
- `open-sse/services/compression/engines/headroom/toon.ts`
- `package-lock.json`
- `src/app/(dashboard)/dashboard/compression/studio/EncoderComparisonTable.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/PlayView.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/compressionFlowModel.ts`
- `src/app/api/compression/preview/route.ts`
- `tests/unit/compression/encoderComparison.test.ts`
- `tests/unit/compression/previewRouteToon.test.ts`
- `tests/unit/compression/smartcrusherToon.test.ts`
- `tests/unit/compression/toon.test.ts`
- `tests/unit/ui/toonEncoderTable.test.tsx`

### [#5164](https://github.com/cheaper-inference/OmniRoute/pull/5164) - 2026-06-28T09:58:29Z - 211 paths

- `.env.example`
- `AGENTS.md`
- `CHANGELOG.md`
- `CLAUDE.md`
- `README.md`
- `bin/cli/commands/login.mjs`
- `bin/cli/commands/registry.mjs`
- `bin/cli/commands/serve.mjs`
- `config/quality/dependency-allowlist.json`
- `config/quality/file-size-baseline.json`
- `config/quality/quality-baseline.json`
- `docs/guides/REMOTE-MODE.md`
- `docs/i18n/README.md`
- `docs/i18n/ar/CHANGELOG.md`
- `docs/i18n/az/CHANGELOG.md`
- `docs/i18n/bg/CHANGELOG.md`
- `docs/i18n/bn/CHANGELOG.md`
- `docs/i18n/cs/CHANGELOG.md`
- `docs/i18n/da/CHANGELOG.md`
- `docs/i18n/de/CHANGELOG.md`
- `docs/i18n/es/CHANGELOG.md`
- `docs/i18n/fa/CHANGELOG.md`
- `docs/i18n/fi/CHANGELOG.md`
- `docs/i18n/fr/CHANGELOG.md`
- `docs/i18n/gu/CHANGELOG.md`
- `docs/i18n/he/CHANGELOG.md`
- `docs/i18n/hi/CHANGELOG.md`
- `docs/i18n/hu/CHANGELOG.md`
- `docs/i18n/id/CHANGELOG.md`
- `docs/i18n/in/CHANGELOG.md`
- `docs/i18n/it/CHANGELOG.md`
- `docs/i18n/ja/CHANGELOG.md`
- `docs/i18n/ko/CHANGELOG.md`
- `docs/i18n/mr/CHANGELOG.md`
- `docs/i18n/ms/CHANGELOG.md`
- `docs/i18n/nl/CHANGELOG.md`
- `docs/i18n/no/CHANGELOG.md`
- `docs/i18n/phi/CHANGELOG.md`
- `docs/i18n/pl/CHANGELOG.md`
- `docs/i18n/pt-BR/CHANGELOG.md`
- `docs/i18n/pt/CHANGELOG.md`
- `docs/i18n/ro/CHANGELOG.md`
- `docs/i18n/ru/CHANGELOG.md`
- `docs/i18n/sk/CHANGELOG.md`
- `docs/i18n/sv/CHANGELOG.md`
- `docs/i18n/sw/CHANGELOG.md`
- `docs/i18n/ta/CHANGELOG.md`
- `docs/i18n/te/CHANGELOG.md`
- `docs/i18n/th/CHANGELOG.md`
- `docs/i18n/tr/CHANGELOG.md`
- `docs/i18n/uk-UA/CHANGELOG.md`
- `docs/i18n/ur/CHANGELOG.md`
- `docs/i18n/vi/CHANGELOG.md`
- `docs/i18n/zh-CN/CHANGELOG.md`
- `docs/i18n/zh-CN/README.md`
- `docs/i18n/zh-TW/CHANGELOG.md`
- `docs/i18n/zh-TW/CLAUDE.md`
- `docs/i18n/zh-TW/CODE_OF_CONDUCT.md`
- `docs/i18n/zh-TW/CONTRIBUTING.md`
- `docs/i18n/zh-TW/GEMINI.md`
- `docs/i18n/zh-TW/README.md`
- `docs/i18n/zh-TW/SECURITY.md`
- `docs/i18n/zh-TW/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/zh-TW/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/zh-TW/docs/cloudflare-zero-trust-guide.md`
- `docs/i18n/zh-TW/docs/features/context-relay.md`
- `docs/i18n/zh-TW/docs/frameworks/A2A-SERVER.md`
- `docs/i18n/zh-TW/docs/frameworks/MCP-SERVER.md`
- `docs/i18n/zh-TW/docs/guides/FEATURES.md`
- `docs/i18n/zh-TW/docs/guides/I18N.md`
- `docs/i18n/zh-TW/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/zh-TW/docs/guides/UNINSTALL.md`
- `docs/i18n/zh-TW/docs/guides/USER_GUIDE.md`
- `docs/i18n/zh-TW/docs/ops/COVERAGE_PLAN.md`
- `docs/i18n/zh-TW/docs/ops/FLY_IO_DEPLOYMENT_GUIDE.md`
- `docs/i18n/zh-TW/docs/ops/RELEASE_CHECKLIST.md`
- `docs/i18n/zh-TW/docs/ops/VM_DEPLOYMENT_GUIDE.md`
- `docs/i18n/zh-TW/docs/reference/API_REFERENCE.md`
- `docs/i18n/zh-TW/docs/reference/CLI-TOOLS.md`
- `docs/i18n/zh-TW/docs/reference/ENVIRONMENT.md`
- `docs/i18n/zh-TW/docs/routing/AUTO-COMBO.md`
- `docs/i18n/zh-TW/llm.txt`
- `docs/openapi.yaml`
- `docs/routing/AUTO-COMBO.md`
- `docs/routing/QUOTA_SHARE.md`
- `electron/main.js`
- `electron/package-lock.json`
- `electron/package.json`
- `next.config.mjs`
- `open-sse/executors/antigravity.ts`
- `open-sse/executors/codex.ts`
- `open-sse/executors/commandCode.ts`
- `open-sse/executors/default.ts`
- `open-sse/handlers/chatCore.ts`
- `open-sse/handlers/responseSanitizer.ts`
- `open-sse/handlers/responseTranslator.ts`
- `open-sse/mcp-server/httpTransport.ts`
- `open-sse/mcp-server/tools/compressionTools.ts`
- `open-sse/package.json`
- `open-sse/services/__tests__/antigravity-quota-family.test.ts`
- `open-sse/services/accountFallback.ts`
- `open-sse/services/antigravityQuotaFamily.ts`
- `open-sse/services/combo/validateQuality.ts`
- `open-sse/services/compression/engines/ccr/ccrQuery.ts`
- `open-sse/services/compression/engines/ccr/index.ts`
- `open-sse/services/compression/engines/headroom/encoderComparison.ts`
- `open-sse/services/compression/engines/headroom/index.ts`
- `open-sse/services/compression/engines/headroom/smartcrusher.ts`
- `open-sse/services/compression/engines/headroom/tabular.ts`
- `open-sse/services/compression/engines/headroom/toon.ts`
- `open-sse/services/roleNormalizer.ts`
- `open-sse/translator/deepseekWebTools.ts`
- `open-sse/translator/request/openai-responses.ts`
- `open-sse/translator/response/claude-to-openai.ts`
- `open-sse/translator/response/gemini-to-openai.ts`
- `open-sse/utils/diagnostics.ts`
- `open-sse/utils/finishReason.ts`
- `open-sse/utils/jsonToSse.ts`
- `open-sse/utils/proxyDispatcher.ts`
- `open-sse/utils/proxyDispatcherCache.ts`
- `open-sse/utils/responsesInputNormalization.ts`
- `package-lock.json`
- `package.json`
- `public/sw.js`
- `scripts/build/runtime-env.mjs`
- `scripts/check/check-test-discovery.mjs`
- `scripts/dev/run-next.mjs`
- `src/app/(dashboard)/dashboard/HomePageClient.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/EncoderComparisonTable.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/PlayView.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/compressionFlowModel.ts`
- `src/app/(dashboard)/dashboard/tools/agent-bridge/AgentBridgePageClient.tsx`
- `src/app/api/combos/[id]/route.ts`
- `src/app/api/compression/preview/route.ts`
- `src/app/api/compression/retrieve/route.ts`
- `src/app/api/oauth/[provider]/paste-credentials/route.ts`
- `src/app/api/providers/[id]/test/route.ts`
- `src/app/api/tools/agent-bridge/cert/route.ts`
- `src/app/api/tools/agent-bridge/server/route.ts`
- `src/app/api/v1/models/catalog.ts`
- `src/i18n/messages/en.json`
- `src/lib/oauth/constants/oauth.ts`
- `src/lib/oauth/credentialBlob.ts`
- `src/lib/oauth/pasteCredentials.ts`
- `src/lib/oauth/providers/antigravity.ts`
- `src/lib/providers/xai/thinking.ts`
- `src/lib/providers/xai/translators/openai-chat.ts`
- `src/lib/proxyHealth.ts`
- `src/mitm/cert/install.ts`
- `src/mitm/manager.ts`
- `src/server/authz/policies/management.ts`
- `src/server/authz/routeGuard.ts`
- `src/shared/components/OAuthModal.tsx`
- `src/shared/components/RequestLoggerDetail.tsx`
- `src/shared/components/oauthBlobSubmit.ts`
- `src/shared/utils/inputSanitizer.ts`
- `src/shared/validation/schemas/auth.ts`
- `tests/integration/combo-matrix/context-relay-codex.test.ts`
- `tests/integration/combo-matrix/context-relay-handoff.test.ts`
- `tests/integration/combo-matrix/cost-and-context.test.ts`
- `tests/integration/combo-matrix/quota-share.test.ts`
- `tests/unit/agent-bridge-cert-install-fallback-4546.test.ts`
- `tests/unit/anthropic-stream-thinking-close-marker.test.ts`
- `tests/unit/antigravity-finish-reason-normalization.test.ts`
- `tests/unit/antigravity-oauth-no-pkce-no-openid.test.ts`
- `tests/unit/antigravity-oauth-postexchange-nonblocking.test.ts`
- `tests/unit/antigravity-refresh-empty-token-3850.test.ts`
- `tests/unit/api/combo-002-first-field.test.ts`
- `tests/unit/auth-noauth-fallback-loop-3061.test.ts`
- `tests/unit/authz/route-guard-version-get-exemption.test.ts`
- `tests/unit/chatcore-translation-paths.test.ts`
- `tests/unit/claude-to-openai-think-close-5123.test.ts`
- `tests/unit/cli-login-antigravity.test.ts`
- `tests/unit/cli-serve-hostname.test.ts`
- `tests/unit/command-code-user-array-5166.test.ts`
- `tests/unit/compression/ccrQuery.test.ts`
- `tests/unit/compression/ccrRanged.test.ts`
- `tests/unit/compression/encoderComparison.test.ts`
- `tests/unit/compression/previewRouteToon.test.ts`
- `tests/unit/compression/retrieveRouteRanged.test.ts`
- `tests/unit/compression/smartcrusherToon.test.ts`
- `tests/unit/compression/toon.test.ts`
- `tests/unit/csp-lan-ws-5083.test.ts`
- `tests/unit/deepseek-web-tools-nameless-5154.test.ts`
- `tests/unit/dev-script-heap-limit.test.ts`
- `tests/unit/diagnostics.test.ts`
- `tests/unit/gemini-finish-reason-normalization.test.ts`
- `tests/unit/guardrails/injection-extraction.test.ts`
- `tests/unit/heap-autocalibrate-5172.test.ts`
- `tests/unit/json-to-sse-3089.test.ts`
- `tests/unit/mcp-session-sweep.test.ts`
- `tests/unit/models-catalog-block-auto-5192.test.ts`
- `tests/unit/oauth-credential-blob.test.ts`
- `tests/unit/oauth-paste-credentials-route.test.ts`
- `tests/unit/oauth-paste-credentials.test.ts`
- `tests/unit/oauth-providers-config.test.ts`
- `tests/unit/pii-opt-in-default.test.ts`
- `tests/unit/proxy-dispatcher-family.test.ts`
- `tests/unit/request-log-detail-layout.test.ts`
- `tests/unit/responses-translation-fixes.test.ts`
- `tests/unit/role-normalizer.test.ts`
- `tests/unit/run-next-node-env.test.ts`
- `tests/unit/service-worker-navigation-fallback.test.ts`
- `tests/unit/stream-options-nonstreaming-3884.test.ts`
- `tests/unit/t14-proxy-fast-fail.test.ts`
- `tests/unit/ui/home-update-step-warning-color-amber.test.ts`
- `tests/unit/ui/toonEncoderTable.test.tsx`
- `tests/unit/usage/usageHistoryDedup.test.ts`
- `tests/unit/validate-response-quality.test.ts`
- `tests/unit/xai-translators.test.ts`
- `vitest.mcp.config.ts`

### [#5168](https://github.com/cheaper-inference/OmniRoute/pull/5168) - 2026-06-27T15:51:07Z - 2 paths

- `tests/integration/combo-matrix/context-relay-handoff.test.ts`
- `tests/integration/combo-matrix/cost-and-context.test.ts`

### [#5170](https://github.com/cheaper-inference/OmniRoute/pull/5170) - 2026-06-27T15:51:13Z - 2 paths

- `bin/cli/commands/serve.mjs`
- `tests/unit/cli-serve-hostname.test.ts`

### [#5171](https://github.com/cheaper-inference/OmniRoute/pull/5171) - 2026-06-27T15:51:10Z - 28 paths

- `docs/i18n/zh-CN/README.md`
- `docs/i18n/zh-TW/CHANGELOG.md`
- `docs/i18n/zh-TW/CLAUDE.md`
- `docs/i18n/zh-TW/CODE_OF_CONDUCT.md`
- `docs/i18n/zh-TW/CONTRIBUTING.md`
- `docs/i18n/zh-TW/GEMINI.md`
- `docs/i18n/zh-TW/README.md`
- `docs/i18n/zh-TW/SECURITY.md`
- `docs/i18n/zh-TW/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/zh-TW/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/zh-TW/docs/cloudflare-zero-trust-guide.md`
- `docs/i18n/zh-TW/docs/features/context-relay.md`
- `docs/i18n/zh-TW/docs/frameworks/A2A-SERVER.md`
- `docs/i18n/zh-TW/docs/frameworks/MCP-SERVER.md`
- `docs/i18n/zh-TW/docs/guides/FEATURES.md`
- `docs/i18n/zh-TW/docs/guides/I18N.md`
- `docs/i18n/zh-TW/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/zh-TW/docs/guides/UNINSTALL.md`
- `docs/i18n/zh-TW/docs/guides/USER_GUIDE.md`
- `docs/i18n/zh-TW/docs/ops/COVERAGE_PLAN.md`
- `docs/i18n/zh-TW/docs/ops/FLY_IO_DEPLOYMENT_GUIDE.md`
- `docs/i18n/zh-TW/docs/ops/RELEASE_CHECKLIST.md`
- `docs/i18n/zh-TW/docs/ops/VM_DEPLOYMENT_GUIDE.md`
- `docs/i18n/zh-TW/docs/reference/API_REFERENCE.md`
- `docs/i18n/zh-TW/docs/reference/CLI-TOOLS.md`
- `docs/i18n/zh-TW/docs/reference/ENVIRONMENT.md`
- `docs/i18n/zh-TW/docs/routing/AUTO-COMBO.md`
- `docs/i18n/zh-TW/llm.txt`

### [#5173](https://github.com/cheaper-inference/OmniRoute/pull/5173) - 2026-06-27T15:57:57Z - 3 paths

- `CHANGELOG.md`
- `open-sse/translator/deepseekWebTools.ts`
- `tests/unit/deepseek-web-tools-nameless-5154.test.ts`

### [#5174](https://github.com/cheaper-inference/OmniRoute/pull/5174) - 2026-06-27T15:58:02Z - 3 paths

- `CHANGELOG.md`
- `open-sse/executors/commandCode.ts`
- `tests/unit/command-code-user-array-5166.test.ts`

### [#5175](https://github.com/cheaper-inference/OmniRoute/pull/5175) - 2026-06-27T16:00:40Z - 4 paths

- `CHANGELOG.md`
- `open-sse/translator/response/claude-to-openai.ts`
- `tests/unit/anthropic-stream-thinking-close-marker.test.ts`
- `tests/unit/claude-to-openai-think-close-5123.test.ts`

### [#5176](https://github.com/cheaper-inference/OmniRoute/pull/5176) - 2026-06-27T16:05:43Z - 2 paths

- `src/app/(dashboard)/dashboard/HomePageClient.tsx`
- `tests/unit/ui/home-update-step-warning-color-amber.test.ts`

### [#5177](https://github.com/cheaper-inference/OmniRoute/pull/5177) - 2026-06-27T16:08:09Z - 9 paths

- `CHANGELOG.md`
- `src/app/api/combos/[id]/route.ts`
- `src/middleware.ts`
- `src/server/authz/policies/management.ts`
- `src/server/authz/routeGuard.ts`
- `src/server/csp.ts`
- `tests/unit/api/combo-002-first-field.test.ts`
- `tests/unit/authz/route-guard-version-get-exemption.test.ts`
- `tests/unit/csp-host-aware.test.ts`

### [#5178](https://github.com/cheaper-inference/OmniRoute/pull/5178) - 2026-06-27T16:31:40Z - 8 paths

- `CHANGELOG.md`
- `src/app/(dashboard)/dashboard/tools/agent-bridge/AgentBridgePageClient.tsx`
- `src/app/api/tools/agent-bridge/cert/route.ts`
- `src/app/api/tools/agent-bridge/server/route.ts`
- `src/i18n/messages/en.json`
- `src/mitm/cert/install.ts`
- `src/mitm/manager.ts`
- `tests/unit/agent-bridge-cert-install-fallback-4546.test.ts`

### [#5179](https://github.com/cheaper-inference/OmniRoute/pull/5179) - 2026-06-27T16:31:36Z - 1 paths

- `tests/integration/combo-matrix/quota-share.test.ts`

### [#5180](https://github.com/cheaper-inference/OmniRoute/pull/5180) - 2026-06-27T17:09:47Z - 4 paths

- `open-sse/handlers/chatCore.ts`
- `open-sse/services/__tests__/antigravity-quota-family.test.ts`
- `open-sse/services/accountFallback.ts`
- `open-sse/services/antigravityQuotaFamily.ts`

### [#5182](https://github.com/cheaper-inference/OmniRoute/pull/5182) - 2026-06-27T16:19:07Z - 6 paths

- `CHANGELOG.md`
- `next.config.mjs`
- `src/middleware.ts`
- `src/server/csp.ts`
- `tests/unit/csp-host-aware.test.ts`
- `tests/unit/csp-lan-ws-5083.test.ts`

### [#5185](https://github.com/cheaper-inference/OmniRoute/pull/5185) - 2026-06-27T19:11:54Z - 3 paths

- `README.md`
- `docs/routing/AUTO-COMBO.md`
- `docs/routing/QUOTA_SHARE.md`

### [#5187](https://github.com/cheaper-inference/OmniRoute/pull/5187) - 2026-06-27T19:11:49Z - 11 paths

- `config/quality/dependency-allowlist.json`
- `open-sse/mcp-server/tools/compressionTools.ts`
- `open-sse/package.json`
- `open-sse/services/compression/engines/ccr/ccrQuery.ts`
- `open-sse/services/compression/engines/ccr/index.ts`
- `package-lock.json`
- `package.json`
- `src/app/api/compression/retrieve/route.ts`
- `tests/unit/compression/ccrQuery.test.ts`
- `tests/unit/compression/ccrRanged.test.ts`
- `tests/unit/compression/retrieveRouteRanged.test.ts`

### [#5189](https://github.com/cheaper-inference/OmniRoute/pull/5189) - 2026-06-27T19:11:45Z - 2 paths

- `scripts/dev/run-next.mjs`
- `tests/unit/run-next-node-env.test.ts`

### [#5191](https://github.com/cheaper-inference/OmniRoute/pull/5191) - 2026-06-27T19:32:43Z - 3 paths

- `CHANGELOG.md`
- `open-sse/mcp-server/httpTransport.ts`
- `tests/unit/mcp-session-sweep.test.ts`

### [#5193](https://github.com/cheaper-inference/OmniRoute/pull/5193) - 2026-06-28T02:33:56Z - 7 paths

- `config/quality/file-size-baseline.json`
- `src/lib/oauth/constants/oauth.ts`
- `src/lib/oauth/providers/antigravity.ts`
- `src/shared/components/OAuthModal.tsx`
- `tests/unit/antigravity-oauth-no-pkce-no-openid.test.ts`
- `tests/unit/antigravity-oauth-postexchange-nonblocking.test.ts`
- `tests/unit/oauth-providers-config.test.ts`

### [#5194](https://github.com/cheaper-inference/OmniRoute/pull/5194) - 2026-06-27T20:45:14Z - 3 paths

- `CHANGELOG.md`
- `src/app/api/v1/models/catalog.ts`
- `tests/unit/models-catalog-block-auto-5192.test.ts`

### [#5195](https://github.com/cheaper-inference/OmniRoute/pull/5195) - 2026-06-27T21:03:33Z - 1 paths

- `tests/integration/combo-matrix/context-relay-codex.test.ts`

### [#5196](https://github.com/cheaper-inference/OmniRoute/pull/5196) - 2026-06-27T21:50:20Z - 2 paths

- `scripts/check/check-test-discovery.mjs`
- `vitest.mcp.config.ts`

### [#5197](https://github.com/cheaper-inference/OmniRoute/pull/5197) - 2026-06-28T07:12:58Z - 9 paths

- `open-sse/executors/antigravity.ts`
- `open-sse/handlers/responseSanitizer.ts`
- `open-sse/handlers/responseTranslator.ts`
- `open-sse/translator/response/gemini-to-openai.ts`
- `open-sse/utils/finishReason.ts`
- `open-sse/utils/jsonToSse.ts`
- `tests/unit/antigravity-finish-reason-normalization.test.ts`
- `tests/unit/gemini-finish-reason-normalization.test.ts`
- `tests/unit/json-to-sse-3089.test.ts`

### [#5198](https://github.com/cheaper-inference/OmniRoute/pull/5198) - 2026-06-28T07:01:58Z - 2 paths

- `package.json`
- `tests/unit/dev-script-heap-limit.test.ts`

### [#5200](https://github.com/cheaper-inference/OmniRoute/pull/5200) - 2026-06-28T00:44:04Z - 4 paths

- `open-sse/services/accountFallback.ts`
- `src/app/api/providers/[id]/test/route.ts`
- `src/shared/components/OAuthModal.tsx`
- `tests/unit/oauth-providers-config.test.ts`

### [#5201](https://github.com/cheaper-inference/OmniRoute/pull/5201) - 2026-06-28T07:19:46Z - 2 paths

- `src/shared/components/RequestLoggerDetail.tsx`
- `tests/unit/request-log-detail-layout.test.ts`

### [#5202](https://github.com/cheaper-inference/OmniRoute/pull/5202) - 2026-06-28T07:01:55Z - 3 paths

- `open-sse/utils/proxyDispatcher.ts`
- `open-sse/utils/proxyDispatcherCache.ts`
- `tests/unit/proxy-dispatcher-family.test.ts`

### [#5203](https://github.com/cheaper-inference/OmniRoute/pull/5203) - 2026-06-28T03:04:24Z - 15 paths

- `CHANGELOG.md`
- `bin/cli/commands/login.mjs`
- `bin/cli/commands/registry.mjs`
- `docs/guides/REMOTE-MODE.md`
- `src/app/api/oauth/[provider]/paste-credentials/route.ts`
- `src/i18n/messages/en.json`
- `src/lib/oauth/credentialBlob.ts`
- `src/lib/oauth/pasteCredentials.ts`
- `src/shared/components/OAuthModal.tsx`
- `src/shared/components/oauthBlobSubmit.ts`
- `src/shared/validation/schemas/auth.ts`
- `tests/unit/cli-login-antigravity.test.ts`
- `tests/unit/oauth-credential-blob.test.ts`
- `tests/unit/oauth-paste-credentials-route.test.ts`
- `tests/unit/oauth-paste-credentials.test.ts`

### [#5204](https://github.com/cheaper-inference/OmniRoute/pull/5204) - 2026-06-28T07:12:55Z - 9 paths

- `open-sse/executors/codex.ts`
- `open-sse/executors/default.ts`
- `open-sse/translator/request/openai-responses.ts`
- `open-sse/utils/responsesInputNormalization.ts`
- `src/shared/utils/inputSanitizer.ts`
- `tests/unit/chatcore-translation-paths.test.ts`
- `tests/unit/guardrails/injection-extraction.test.ts`
- `tests/unit/responses-translation-fixes.test.ts`
- `tests/unit/stream-options-nonstreaming-3884.test.ts`

### [#5205](https://github.com/cheaper-inference/OmniRoute/pull/5205) - 2026-06-28T07:02:01Z - 2 paths

- `tests/unit/auth-noauth-fallback-loop-3061.test.ts`
- `tests/unit/usage/usageHistoryDedup.test.ts`

### [#5206](https://github.com/cheaper-inference/OmniRoute/pull/5206) - 2026-06-28T06:09:31Z - 1 paths

- `.env.example`

### [#5207](https://github.com/cheaper-inference/OmniRoute/pull/5207) - 2026-06-28T07:50:54Z - 2 paths

- `open-sse/services/combo/validateQuality.ts`
- `tests/unit/validate-response-quality.test.ts`

### [#5208](https://github.com/cheaper-inference/OmniRoute/pull/5208) - 2026-06-28T07:01:53Z - 2 paths

- `src/lib/proxyHealth.ts`
- `tests/unit/t14-proxy-fast-fail.test.ts`

### [#5209](https://github.com/cheaper-inference/OmniRoute/pull/5209) - 2026-06-28T07:50:56Z - 2 paths

- `public/sw.js`
- `tests/unit/service-worker-navigation-fallback.test.ts`

### [#5213](https://github.com/cheaper-inference/OmniRoute/pull/5213) - 2026-06-28T06:56:11Z - 5 paths

- `CHANGELOG.md`
- `bin/cli/commands/serve.mjs`
- `electron/main.js`
- `scripts/build/runtime-env.mjs`
- `tests/unit/heap-autocalibrate-5172.test.ts`

### [#5214](https://github.com/cheaper-inference/OmniRoute/pull/5214) - 2026-06-28T07:10:02Z - 3 paths

- `CHANGELOG.md`
- `open-sse/executors/antigravity.ts`
- `tests/unit/antigravity-refresh-empty-token-3850.test.ts`

### [#5218](https://github.com/cheaper-inference/OmniRoute/pull/5218) - 2026-06-28T15:58:51Z - 5 paths

- `open-sse/mcp-server/__tests__/httpAuthContext.test.ts`
- `open-sse/mcp-server/httpAuthContext.ts`
- `open-sse/mcp-server/httpTransport.ts`
- `open-sse/mcp-server/server.ts`
- `open-sse/mcp-server/tools/advancedTools.ts`

### [#5220](https://github.com/cheaper-inference/OmniRoute/pull/5220) - 2026-06-28T15:55:43Z - 1 paths

- `src/shared/components/lobeProviderIcons.ts`

### [#5221](https://github.com/cheaper-inference/OmniRoute/pull/5221) - 2026-06-28T16:36:22Z - 3 paths

- `open-sse/config/providers/registry/command-code/index.ts`
- `open-sse/executors/commandCode.ts`
- `tests/unit/command-code-executor.test.ts`

### [#5222](https://github.com/cheaper-inference/OmniRoute/pull/5222) - 2026-06-28T16:05:27Z - 2 paths

- `src/sse/services/auth.ts`
- `tests/unit/auth-antigravity-account-retry-v2.test.ts`

### [#5223](https://github.com/cheaper-inference/OmniRoute/pull/5223) - 2026-06-28T10:39:27Z - 44 paths

- `CHANGELOG.md`
- `Dockerfile`
- `docs/i18n/ar/CHANGELOG.md`
- `docs/i18n/az/CHANGELOG.md`
- `docs/i18n/bg/CHANGELOG.md`
- `docs/i18n/bn/CHANGELOG.md`
- `docs/i18n/cs/CHANGELOG.md`
- `docs/i18n/da/CHANGELOG.md`
- `docs/i18n/de/CHANGELOG.md`
- `docs/i18n/es/CHANGELOG.md`
- `docs/i18n/fa/CHANGELOG.md`
- `docs/i18n/fi/CHANGELOG.md`
- `docs/i18n/fr/CHANGELOG.md`
- `docs/i18n/gu/CHANGELOG.md`
- `docs/i18n/he/CHANGELOG.md`
- `docs/i18n/hi/CHANGELOG.md`
- `docs/i18n/hu/CHANGELOG.md`
- `docs/i18n/id/CHANGELOG.md`
- `docs/i18n/in/CHANGELOG.md`
- `docs/i18n/it/CHANGELOG.md`
- `docs/i18n/ja/CHANGELOG.md`
- `docs/i18n/ko/CHANGELOG.md`
- `docs/i18n/mr/CHANGELOG.md`
- `docs/i18n/ms/CHANGELOG.md`
- `docs/i18n/nl/CHANGELOG.md`
- `docs/i18n/no/CHANGELOG.md`
- `docs/i18n/phi/CHANGELOG.md`
- `docs/i18n/pl/CHANGELOG.md`
- `docs/i18n/pt-BR/CHANGELOG.md`
- `docs/i18n/pt/CHANGELOG.md`
- `docs/i18n/ro/CHANGELOG.md`
- `docs/i18n/ru/CHANGELOG.md`
- `docs/i18n/sk/CHANGELOG.md`
- `docs/i18n/sv/CHANGELOG.md`
- `docs/i18n/sw/CHANGELOG.md`
- `docs/i18n/ta/CHANGELOG.md`
- `docs/i18n/te/CHANGELOG.md`
- `docs/i18n/th/CHANGELOG.md`
- `docs/i18n/tr/CHANGELOG.md`
- `docs/i18n/uk-UA/CHANGELOG.md`
- `docs/i18n/ur/CHANGELOG.md`
- `docs/i18n/vi/CHANGELOG.md`
- `docs/i18n/zh-CN/CHANGELOG.md`
- `docs/i18n/zh-TW/CHANGELOG.md`

### [#5224](https://github.com/cheaper-inference/OmniRoute/pull/5224) - 2026-06-28T15:54:33Z - 15 paths

- `open-sse/handlers/chatCore.ts`
- `open-sse/handlers/responseSanitizer.ts`
- `open-sse/services/contextManager.ts`
- `open-sse/transformer/responsesTransformer.ts`
- `open-sse/translator/index.ts`
- `open-sse/translator/response/gemini-to-openai.ts`
- `open-sse/translator/response/kiro-to-openai.ts`
- `open-sse/translator/response/openai-responses.ts`
- `tests/unit/context-manager.test.ts`
- `tests/unit/response-sanitizer.test.ts`
- `tests/unit/responses-transformer.test.ts`
- `tests/unit/responses-translation-fixes.test.ts`
- `tests/unit/translator-resp-antigravity-thinking-boundary.test.ts`
- `tests/unit/translator-resp-kiro-to-openai.test.ts`
- `tests/unit/translator-resp-openai-responses.test.ts`

### [#5225](https://github.com/cheaper-inference/OmniRoute/pull/5225) - 2026-06-29T11:40:07Z - 1007 paths

- `.env.example`
- `.github/workflows/docker-publish.yml`
- `.github/workflows/wiki-sync.yml`
- `.mcp.json.example`
- `@omniroute/opencode-plugin/README.md`
- `@omniroute/opencode-plugin/src/index.ts`
- `@omniroute/opencode-plugin/tests/config-shim.test.ts`
- `@omniroute/opencode-plugin/tests/gemini-sanitize.test.ts`
- `AGENTS.md`
- `CHANGELOG.md`
- `CLAUDE.md`
- `CONTRIBUTING.md`
- `Dockerfile`
- `README.md`
- `bin/_ops-common.sh`
- `bin/cli/commands/registry.mjs`
- `bin/cli/commands/serve.mjs`
- `bin/cli/commands/setup-gemini.mjs`
- `bin/cli/commands/setup-qwen.mjs`
- `bin/cli/tray/index.mjs`
- `bin/cli/tray/traySystray.mjs`
- `bin/cold-start-bench.sh`
- `bin/nodeRuntimeSupport.mjs`
- `bin/restore-data.sh`
- `bin/restore-policies.sh`
- `bin/rollback.sh`
- `bin/snapshot-data.sh`
- `config/quality/complexity-baseline.json`
- `config/quality/dependency-allowlist.json`
- `config/quality/file-size-baseline.json`
- `config/quality/quality-baseline.json`
- `docs/DOCUMENTATION_OVERHAUL_PLAN.md`
- `docs/INCIDENT_RESPONSE.md`
- `docs/PERF_BUDGETS.md`
- `docs/README.md`
- `docs/SUBMIT_PR.md`
- `docs/THREAT_MODEL.md`
- `docs/architecture/ARCHITECTURE.md`
- `docs/architecture/AUTHZ_GUIDE.md`
- `docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/architecture/MONITORING_SECTIONS.md`
- `docs/architecture/QUALITY_GATES.md`
- `docs/architecture/REPOSITORY_MAP.md`
- `docs/architecture/RESILIENCE_GUIDE.md`
- `docs/architecture/cluster-decisions.md`
- `docs/comparison/OMNIROUTE_VS_ALTERNATIVES.md`
- `docs/comparison/meta.json`
- `docs/compression/2026-06-20-unified-compression-config-panel-design.md`
- `docs/compression/2026-06-20-unified-compression-config-panel-plan.md`
- `docs/compression/2026-06-21-compression-phase2-named-profiles-design.md`
- `docs/compression/2026-06-21-compression-phase2-named-profiles-plan.md`
- `docs/compression/2026-06-21-compression-phase3-request-header-design.md`
- `docs/compression/2026-06-21-compression-phase3-request-header-plan.md`
- `docs/compression/COMPRESSION_ENGINES.md`
- `docs/compression/COMPRESSION_GUIDE.md`
- `docs/compression/COMPRESSION_LANGUAGE_PACKS.md`
- `docs/compression/COMPRESSION_RULES_FORMAT.md`
- `docs/compression/CONTEXT_EDITING.md`
- `docs/compression/EXTENDING_COMPRESSION.md`
- `docs/compression/RTK_COMPRESSION.md`
- `docs/diagrams/README.md`
- `docs/diagrams/auto-combo-12factor.mmd`
- `docs/diagrams/exported/auto-combo-12factor.svg`
- `docs/diagrams/exported/auto-combo-9factor.svg`
- `docs/diagrams/exported/mcp-tools-87.svg`
- `docs/diagrams/exported/mcp-tools-94.svg`
- `docs/diagrams/mcp-tools-94.mmd`
- `docs/frameworks/A2A-SERVER.md`
- `docs/frameworks/ACP.md`
- `docs/frameworks/AGENT-SKILLS.md`
- `docs/frameworks/AGENTBRIDGE.md`
- `docs/frameworks/AGENT_PROTOCOLS_GUIDE.md`
- `docs/frameworks/CLOUD_AGENT.md`
- `docs/frameworks/EMBEDDED-SERVICES.md`
- `docs/frameworks/EVALS.md`
- `docs/frameworks/GAMIFICATION.md`
- `docs/frameworks/MCP-SERVER.md`
- `docs/frameworks/MEMORY.md`
- `docs/frameworks/NOTION_CONTEXT.md`
- `docs/frameworks/OBSIDIAN_CONTEXT.md`
- `docs/frameworks/OPENCODE.md`
- `docs/frameworks/OPEN_SSE_ARCHITECTURE.md`
- `docs/frameworks/PLAYGROUND_STUDIO.md`
- `docs/frameworks/PLUGINS.md`
- `docs/frameworks/PLUGIN_MARKETPLACE.md`
- `docs/frameworks/PLUGIN_SDK.md`
- `docs/frameworks/SEARCH_TOOLS_STUDIO.md`
- `docs/frameworks/SKILLS.md`
- `docs/frameworks/TRAFFIC_INSPECTOR.md`
- `docs/frameworks/WEBHOOKS.md`
- `docs/frameworks/meta.json`
- `docs/getting-started/TROUBLESHOOTING.md`
- `docs/guides/CLAUDE-CODE-CONFIGURATION.md`
- `docs/guides/CLI-INTEGRATIONS.md`
- `docs/guides/CODEX-CLI-CONFIGURATION.md`
- `docs/guides/COST_TRACKING.md`
- `docs/guides/DOCKER_GUIDE.md`
- `docs/guides/ELECTRON_GUIDE.md`
- `docs/guides/FEATURES.md`
- `docs/guides/FREE_PROVIDER_RANKINGS.md`
- `docs/guides/I18N.md`
- `docs/guides/PWA_GUIDE.md`
- `docs/guides/REMOTE-MODE.md`
- `docs/guides/SETUP_GUIDE.md`
- `docs/guides/TERMUX_GUIDE.md`
- `docs/guides/TIERS.md`
- `docs/guides/TROUBLESHOOTING.md`
- `docs/guides/UNINSTALL.md`
- `docs/guides/USAGE_QUOTA_GUIDE.md`
- `docs/guides/USER_GUIDE.md`
- `docs/guides/meta.json`
- `docs/i18n/ar/CHANGELOG.md`
- `docs/i18n/ar/README.md`
- `docs/i18n/ar/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/ar/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/ar/docs/guides/FEATURES.md`
- `docs/i18n/ar/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/ar/docs/guides/USER_GUIDE.md`
- `docs/i18n/ar/docs/reference/ENVIRONMENT.md`
- `docs/i18n/ar/llm.txt`
- `docs/i18n/az/CHANGELOG.md`
- `docs/i18n/az/README.md`
- `docs/i18n/az/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/az/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/az/docs/guides/FEATURES.md`
- `docs/i18n/az/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/az/docs/guides/USER_GUIDE.md`
- `docs/i18n/az/docs/reference/ENVIRONMENT.md`
- `docs/i18n/az/llm.txt`
- `docs/i18n/bg/CHANGELOG.md`
- `docs/i18n/bg/README.md`
- `docs/i18n/bg/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/bg/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/bg/docs/guides/FEATURES.md`
- `docs/i18n/bg/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/bg/docs/guides/USER_GUIDE.md`
- `docs/i18n/bg/docs/reference/ENVIRONMENT.md`
- `docs/i18n/bg/llm.txt`
- `docs/i18n/bn/CHANGELOG.md`
- `docs/i18n/bn/README.md`
- `docs/i18n/bn/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/bn/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/bn/docs/guides/FEATURES.md`
- `docs/i18n/bn/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/bn/docs/guides/USER_GUIDE.md`
- `docs/i18n/bn/docs/reference/ENVIRONMENT.md`
- `docs/i18n/bn/llm.txt`
- `docs/i18n/cs/CHANGELOG.md`
- `docs/i18n/cs/README.md`
- `docs/i18n/cs/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/cs/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/cs/docs/guides/FEATURES.md`
- `docs/i18n/cs/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/cs/docs/guides/USER_GUIDE.md`
- `docs/i18n/cs/docs/reference/ENVIRONMENT.md`
- `docs/i18n/cs/llm.txt`
- `docs/i18n/da/CHANGELOG.md`
- `docs/i18n/da/README.md`
- `docs/i18n/da/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/da/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/da/docs/guides/FEATURES.md`
- `docs/i18n/da/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/da/docs/guides/USER_GUIDE.md`
- `docs/i18n/da/docs/reference/ENVIRONMENT.md`
- `docs/i18n/da/llm.txt`
- `docs/i18n/de/CHANGELOG.md`
- `docs/i18n/de/README.md`
- `docs/i18n/de/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/de/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/de/docs/guides/FEATURES.md`
- `docs/i18n/de/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/de/docs/guides/USER_GUIDE.md`
- `docs/i18n/de/docs/reference/ENVIRONMENT.md`
- `docs/i18n/de/llm.txt`
- `docs/i18n/es/CHANGELOG.md`
- `docs/i18n/es/README.md`
- `docs/i18n/es/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/es/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/es/docs/guides/FEATURES.md`
- `docs/i18n/es/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/es/docs/guides/USER_GUIDE.md`
- `docs/i18n/es/docs/reference/ENVIRONMENT.md`
- `docs/i18n/es/llm.txt`
- `docs/i18n/fa/CHANGELOG.md`
- `docs/i18n/fa/README.md`
- `docs/i18n/fa/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/fa/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/fa/docs/guides/FEATURES.md`
- `docs/i18n/fa/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/fa/docs/guides/USER_GUIDE.md`
- `docs/i18n/fa/docs/reference/ENVIRONMENT.md`
- `docs/i18n/fa/llm.txt`
- `docs/i18n/fi/CHANGELOG.md`
- `docs/i18n/fi/README.md`
- `docs/i18n/fi/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/fi/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/fi/docs/guides/FEATURES.md`
- `docs/i18n/fi/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/fi/docs/guides/USER_GUIDE.md`
- `docs/i18n/fi/docs/reference/ENVIRONMENT.md`
- `docs/i18n/fi/llm.txt`
- `docs/i18n/fr/CHANGELOG.md`
- `docs/i18n/fr/README.md`
- `docs/i18n/fr/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/fr/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/fr/docs/guides/FEATURES.md`
- `docs/i18n/fr/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/fr/docs/guides/USER_GUIDE.md`
- `docs/i18n/fr/docs/reference/ENVIRONMENT.md`
- `docs/i18n/fr/llm.txt`
- `docs/i18n/gu/CHANGELOG.md`
- `docs/i18n/gu/README.md`
- `docs/i18n/gu/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/gu/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/gu/docs/guides/FEATURES.md`
- `docs/i18n/gu/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/gu/docs/guides/USER_GUIDE.md`
- `docs/i18n/gu/docs/reference/ENVIRONMENT.md`
- `docs/i18n/gu/llm.txt`
- `docs/i18n/he/CHANGELOG.md`
- `docs/i18n/he/README.md`
- `docs/i18n/he/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/he/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/he/docs/guides/FEATURES.md`
- `docs/i18n/he/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/he/docs/guides/USER_GUIDE.md`
- `docs/i18n/he/docs/reference/ENVIRONMENT.md`
- `docs/i18n/he/llm.txt`
- `docs/i18n/hi/CHANGELOG.md`
- `docs/i18n/hi/README.md`
- `docs/i18n/hi/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/hi/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/hi/docs/guides/FEATURES.md`
- `docs/i18n/hi/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/hi/docs/guides/USER_GUIDE.md`
- `docs/i18n/hi/docs/reference/ENVIRONMENT.md`
- `docs/i18n/hi/llm.txt`
- `docs/i18n/hu/CHANGELOG.md`
- `docs/i18n/hu/README.md`
- `docs/i18n/hu/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/hu/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/hu/docs/guides/FEATURES.md`
- `docs/i18n/hu/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/hu/docs/guides/USER_GUIDE.md`
- `docs/i18n/hu/docs/reference/ENVIRONMENT.md`
- `docs/i18n/hu/llm.txt`
- `docs/i18n/id/CHANGELOG.md`
- `docs/i18n/id/README.md`
- `docs/i18n/id/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/id/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/id/docs/guides/FEATURES.md`
- `docs/i18n/id/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/id/docs/guides/USER_GUIDE.md`
- `docs/i18n/id/docs/reference/ENVIRONMENT.md`
- `docs/i18n/id/llm.txt`
- `docs/i18n/in/CHANGELOG.md`
- `docs/i18n/in/README.md`
- `docs/i18n/in/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/in/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/in/docs/guides/FEATURES.md`
- `docs/i18n/in/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/in/docs/guides/USER_GUIDE.md`
- `docs/i18n/in/docs/reference/ENVIRONMENT.md`
- `docs/i18n/in/llm.txt`
- `docs/i18n/it/CHANGELOG.md`
- `docs/i18n/it/README.md`
- `docs/i18n/it/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/it/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/it/docs/guides/FEATURES.md`
- `docs/i18n/it/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/it/docs/guides/USER_GUIDE.md`
- `docs/i18n/it/docs/reference/ENVIRONMENT.md`
- `docs/i18n/it/llm.txt`
- `docs/i18n/ja/CHANGELOG.md`
- `docs/i18n/ja/README.md`
- `docs/i18n/ja/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/ja/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/ja/docs/guides/FEATURES.md`
- `docs/i18n/ja/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/ja/docs/guides/USER_GUIDE.md`
- `docs/i18n/ja/docs/reference/ENVIRONMENT.md`
- `docs/i18n/ja/llm.txt`
- `docs/i18n/ko/CHANGELOG.md`
- `docs/i18n/ko/README.md`
- `docs/i18n/ko/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/ko/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/ko/docs/guides/FEATURES.md`
- `docs/i18n/ko/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/ko/docs/guides/USER_GUIDE.md`
- `docs/i18n/ko/docs/reference/ENVIRONMENT.md`
- `docs/i18n/ko/llm.txt`
- `docs/i18n/mr/CHANGELOG.md`
- `docs/i18n/mr/README.md`
- `docs/i18n/mr/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/mr/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/mr/docs/guides/FEATURES.md`
- `docs/i18n/mr/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/mr/docs/guides/USER_GUIDE.md`
- `docs/i18n/mr/docs/reference/ENVIRONMENT.md`
- `docs/i18n/mr/llm.txt`
- `docs/i18n/ms/CHANGELOG.md`
- `docs/i18n/ms/README.md`
- `docs/i18n/ms/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/ms/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/ms/docs/guides/FEATURES.md`
- `docs/i18n/ms/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/ms/docs/guides/USER_GUIDE.md`
- `docs/i18n/ms/docs/reference/ENVIRONMENT.md`
- `docs/i18n/ms/llm.txt`
- `docs/i18n/nl/CHANGELOG.md`
- `docs/i18n/nl/README.md`
- `docs/i18n/nl/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/nl/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/nl/docs/guides/FEATURES.md`
- `docs/i18n/nl/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/nl/docs/guides/USER_GUIDE.md`
- `docs/i18n/nl/docs/reference/ENVIRONMENT.md`
- `docs/i18n/nl/llm.txt`
- `docs/i18n/no/CHANGELOG.md`
- `docs/i18n/no/README.md`
- `docs/i18n/no/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/no/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/no/docs/guides/FEATURES.md`
- `docs/i18n/no/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/no/docs/guides/USER_GUIDE.md`
- `docs/i18n/no/docs/reference/ENVIRONMENT.md`
- `docs/i18n/no/llm.txt`
- `docs/i18n/phi/CHANGELOG.md`
- `docs/i18n/phi/README.md`
- `docs/i18n/phi/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/phi/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/phi/docs/guides/FEATURES.md`
- `docs/i18n/phi/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/phi/docs/guides/USER_GUIDE.md`
- `docs/i18n/phi/docs/reference/ENVIRONMENT.md`
- `docs/i18n/phi/llm.txt`
- `docs/i18n/pl/CHANGELOG.md`
- `docs/i18n/pl/README.md`
- `docs/i18n/pl/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/pl/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/pl/docs/guides/FEATURES.md`
- `docs/i18n/pl/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/pl/docs/guides/USER_GUIDE.md`
- `docs/i18n/pl/docs/reference/ENVIRONMENT.md`
- `docs/i18n/pl/llm.txt`
- `docs/i18n/pt-BR/CHANGELOG.md`
- `docs/i18n/pt-BR/README.md`
- `docs/i18n/pt-BR/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/pt-BR/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/pt-BR/docs/guides/FEATURES.md`
- `docs/i18n/pt-BR/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/pt-BR/docs/guides/USER_GUIDE.md`
- `docs/i18n/pt-BR/docs/reference/ENVIRONMENT.md`
- `docs/i18n/pt-BR/llm.txt`
- `docs/i18n/pt/CHANGELOG.md`
- `docs/i18n/pt/README.md`
- `docs/i18n/pt/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/pt/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/pt/docs/guides/FEATURES.md`
- `docs/i18n/pt/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/pt/docs/guides/USER_GUIDE.md`
- `docs/i18n/pt/docs/reference/ENVIRONMENT.md`
- `docs/i18n/pt/llm.txt`
- `docs/i18n/ro/CHANGELOG.md`
- `docs/i18n/ro/README.md`
- `docs/i18n/ro/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/ro/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/ro/docs/guides/FEATURES.md`
- `docs/i18n/ro/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/ro/docs/guides/USER_GUIDE.md`
- `docs/i18n/ro/docs/reference/ENVIRONMENT.md`
- `docs/i18n/ro/llm.txt`
- `docs/i18n/ru/CHANGELOG.md`
- `docs/i18n/ru/README.md`
- `docs/i18n/ru/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/ru/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/ru/docs/guides/FEATURES.md`
- `docs/i18n/ru/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/ru/docs/guides/USER_GUIDE.md`
- `docs/i18n/ru/docs/reference/ENVIRONMENT.md`
- `docs/i18n/ru/llm.txt`
- `docs/i18n/sk/CHANGELOG.md`
- `docs/i18n/sk/README.md`
- `docs/i18n/sk/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/sk/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/sk/docs/guides/FEATURES.md`
- `docs/i18n/sk/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/sk/docs/guides/USER_GUIDE.md`
- `docs/i18n/sk/docs/reference/ENVIRONMENT.md`
- `docs/i18n/sk/llm.txt`
- `docs/i18n/sv/CHANGELOG.md`
- `docs/i18n/sv/README.md`
- `docs/i18n/sv/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/sv/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/sv/docs/guides/FEATURES.md`
- `docs/i18n/sv/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/sv/docs/guides/USER_GUIDE.md`
- `docs/i18n/sv/docs/reference/ENVIRONMENT.md`
- `docs/i18n/sv/llm.txt`
- `docs/i18n/sw/CHANGELOG.md`
- `docs/i18n/sw/README.md`
- `docs/i18n/sw/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/sw/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/sw/docs/guides/FEATURES.md`
- `docs/i18n/sw/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/sw/docs/guides/USER_GUIDE.md`
- `docs/i18n/sw/docs/reference/ENVIRONMENT.md`
- `docs/i18n/sw/llm.txt`
- `docs/i18n/ta/CHANGELOG.md`
- `docs/i18n/ta/README.md`
- `docs/i18n/ta/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/ta/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/ta/docs/guides/FEATURES.md`
- `docs/i18n/ta/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/ta/docs/guides/USER_GUIDE.md`
- `docs/i18n/ta/docs/reference/ENVIRONMENT.md`
- `docs/i18n/ta/llm.txt`
- `docs/i18n/te/CHANGELOG.md`
- `docs/i18n/te/README.md`
- `docs/i18n/te/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/te/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/te/docs/guides/FEATURES.md`
- `docs/i18n/te/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/te/docs/guides/USER_GUIDE.md`
- `docs/i18n/te/docs/reference/ENVIRONMENT.md`
- `docs/i18n/te/llm.txt`
- `docs/i18n/th/CHANGELOG.md`
- `docs/i18n/th/README.md`
- `docs/i18n/th/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/th/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/th/docs/guides/FEATURES.md`
- `docs/i18n/th/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/th/docs/guides/USER_GUIDE.md`
- `docs/i18n/th/docs/reference/ENVIRONMENT.md`
- `docs/i18n/th/llm.txt`
- `docs/i18n/tr/CHANGELOG.md`
- `docs/i18n/tr/README.md`
- `docs/i18n/tr/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/tr/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/tr/docs/guides/FEATURES.md`
- `docs/i18n/tr/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/tr/docs/guides/USER_GUIDE.md`
- `docs/i18n/tr/docs/reference/ENVIRONMENT.md`
- `docs/i18n/tr/llm.txt`
- `docs/i18n/uk-UA/CHANGELOG.md`
- `docs/i18n/uk-UA/README.md`
- `docs/i18n/uk-UA/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/uk-UA/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/uk-UA/docs/guides/FEATURES.md`
- `docs/i18n/uk-UA/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/uk-UA/docs/guides/USER_GUIDE.md`
- `docs/i18n/uk-UA/docs/reference/ENVIRONMENT.md`
- `docs/i18n/uk-UA/llm.txt`
- `docs/i18n/ur/CHANGELOG.md`
- `docs/i18n/ur/README.md`
- `docs/i18n/ur/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/ur/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/ur/docs/guides/FEATURES.md`
- `docs/i18n/ur/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/ur/docs/guides/USER_GUIDE.md`
- `docs/i18n/ur/docs/reference/ENVIRONMENT.md`
- `docs/i18n/ur/llm.txt`
- `docs/i18n/vi/CHANGELOG.md`
- `docs/i18n/vi/README.md`
- `docs/i18n/vi/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/vi/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/vi/docs/guides/FEATURES.md`
- `docs/i18n/vi/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/vi/docs/guides/USER_GUIDE.md`
- `docs/i18n/vi/docs/reference/ENVIRONMENT.md`
- `docs/i18n/vi/llm.txt`
- `docs/i18n/zh-CN/CHANGELOG.md`
- `docs/i18n/zh-CN/README.md`
- `docs/i18n/zh-CN/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/zh-CN/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/zh-CN/docs/guides/FEATURES.md`
- `docs/i18n/zh-CN/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/zh-CN/docs/guides/USER_GUIDE.md`
- `docs/i18n/zh-CN/docs/reference/ENVIRONMENT.md`
- `docs/i18n/zh-CN/llm.txt`
- `docs/i18n/zh-TW/CHANGELOG.md`
- `docs/i18n/zh-TW/README.md`
- `docs/i18n/zh-TW/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/zh-TW/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/zh-TW/docs/guides/FEATURES.md`
- `docs/i18n/zh-TW/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/zh-TW/docs/guides/USER_GUIDE.md`
- `docs/i18n/zh-TW/docs/reference/ENVIRONMENT.md`
- `docs/i18n/zh-TW/llm.txt`
- `docs/meta.json`
- `docs/openapi.yaml`
- `docs/ops/COVERAGE_PLAN.md`
- `docs/ops/DATABASE_GUIDE.md`
- `docs/ops/DOCUMENTATION_AUDIT_REPORT.md`
- `docs/ops/E2E_DASHBOARD_SHAKEDOWN_v3.8.0.md`
- `docs/ops/FLY_IO_DEPLOYMENT_GUIDE.md`
- `docs/ops/MONITORING_GUIDE.md`
- `docs/ops/MUTATION_GATE_SPIKE_VERDICT.md`
- `docs/ops/PROXY_GUIDE.md`
- `docs/ops/RELEASE_CHECKLIST.md`
- `docs/ops/TUNNELS_GUIDE.md`
- `docs/ops/VM_DEPLOYMENT_GUIDE.md`
- `docs/ops/meta.json`
- `docs/providers/AGENTROUTER.md`
- `docs/providers/CLAUDE_WEB.md`
- `docs/providers/ZED-DOCKER.md`
- `docs/providers/meta.json`
- `docs/reference/API_REFERENCE.md`
- `docs/reference/CLI-TOOLS.md`
- `docs/reference/ENVIRONMENT.md`
- `docs/reference/FEATURE_FLAGS.md`
- `docs/reference/FREE_TIERS.md`
- `docs/reference/PROVIDER_REFERENCE.md`
- `docs/releases/v3.8.0.md`
- `docs/research/DISCOVERY_TOOL_DESIGN.md`
- `docs/research/UNLIMITED_LLM_ACCESS.md`
- `docs/routing/AUTO-COMBO.md`
- `docs/routing/QUOTA_SHARE.md`
- `docs/routing/REASONING_REPLAY.md`
- `docs/security/CLI_TOKEN.md`
- `docs/security/CLI_TOKEN_AUTH.md`
- `docs/security/COMPLIANCE.md`
- `docs/security/EGRESS_POLICY.md`
- `docs/security/ERROR_SANITIZATION.md`
- `docs/security/GUARDRAILS.md`
- `docs/security/MITM-TPROXY-DECRYPT.md`
- `docs/security/PUBLIC_CREDS.md`
- `docs/security/STEALTH_GUIDE.md`
- `docs/security/meta.json`
- `electron/package-lock.json`
- `electron/package.json`
- `images/tier-flow-dark.svg`
- `images/tier-flow-light.svg`
- `llm.txt`
- `open-sse/config/anthropicHeaders.ts`
- `open-sse/config/cliFingerprints.ts`
- `open-sse/config/freeModelCatalog.data.ts`
- `open-sse/config/freeTierCatalog.ts`
- `open-sse/config/glmProvider.ts`
- `open-sse/config/providerHeaderProfiles.ts`
- `open-sse/config/providers/index.ts`
- `open-sse/config/providers/registry/chatgpt-web/index.ts`
- `open-sse/config/providers/registry/codex/index.ts`
- `open-sse/config/providers/registry/command-code/index.ts`
- `open-sse/config/providers/registry/copilot-m365-web/index.ts`
- `open-sse/config/providers/registry/gemini/cli/index.ts`
- `open-sse/config/providers/registry/grok-cli/index.ts`
- `open-sse/config/providers/registry/kilocode/index.ts`
- `open-sse/config/providers/shared.ts`
- `open-sse/executors/adapta-web.ts`
- `open-sse/executors/antigravity.ts`
- `open-sse/executors/blackbox-web.ts`
- `open-sse/executors/chatgpt-web.ts`
- `open-sse/executors/chipotle.ts`
- `open-sse/executors/claude-web.ts`
- `open-sse/executors/claudeIdentity.ts`
- `open-sse/executors/codex.ts`
- `open-sse/executors/commandCode.ts`
- `open-sse/executors/copilot-m365-connection.ts`
- `open-sse/executors/copilot-m365-frames.ts`
- `open-sse/executors/copilot-m365-web.ts`
- `open-sse/executors/copilot-web.ts`
- `open-sse/executors/deepseek-web.ts`
- `open-sse/executors/default.ts`
- `open-sse/executors/doubao-web.ts`
- `open-sse/executors/duckduckgo-web.ts`
- `open-sse/executors/gemini-business.ts`
- `open-sse/executors/gemini-cli.ts`
- `open-sse/executors/gemini-web.ts`
- `open-sse/executors/grok-cli.ts`
- `open-sse/executors/grok-web.ts`
- `open-sse/executors/huggingchat.ts`
- `open-sse/executors/index.ts`
- `open-sse/executors/inner-ai.ts`
- `open-sse/executors/kimi-web.ts`
- `open-sse/executors/lmarena.ts`
- `open-sse/executors/mimocode.ts`
- `open-sse/executors/muse-spark-web.ts`
- `open-sse/executors/perplexity-web.ts`
- `open-sse/executors/phind.ts`
- `open-sse/executors/poe-web.ts`
- `open-sse/executors/qwen-web.ts`
- `open-sse/executors/t3-chat-web.ts`
- `open-sse/executors/theoldllm.ts`
- `open-sse/executors/trae.ts`
- `open-sse/executors/v0-vercel-web.ts`
- `open-sse/executors/venice-web.ts`
- `open-sse/executors/veoaifree-web.ts`
- `open-sse/handlers/chatCore.ts`
- `open-sse/handlers/chatCore/attemptLogging.ts`
- `open-sse/handlers/chatCore/compressionAnalyticsWrite.ts`
- `open-sse/handlers/responseSanitizer.ts`
- `open-sse/handlers/responseTranslator.ts`
- `open-sse/mcp-server/README.md`
- `open-sse/mcp-server/__tests__/essentialTools.test.ts`
- `open-sse/mcp-server/__tests__/httpAuthContext.test.ts`
- `open-sse/mcp-server/__tests__/toolSearch.catalog.test.ts`
- `open-sse/mcp-server/__tests__/toolSearch.search.test.ts`
- `open-sse/mcp-server/__tests__/toolSearch.signature.test.ts`
- `open-sse/mcp-server/__tests__/toolSearch.tool.test.ts`
- `open-sse/mcp-server/httpAuthContext.ts`
- `open-sse/mcp-server/httpTransport.ts`
- `open-sse/mcp-server/schemas/toolDefinition.ts`
- `open-sse/mcp-server/schemas/toolSearch.ts`
- `open-sse/mcp-server/schemas/tools.ts`
- `open-sse/mcp-server/server.ts`
- `open-sse/mcp-server/toolSearch/catalog.ts`
- `open-sse/mcp-server/toolSearch/handler.ts`
- `open-sse/mcp-server/toolSearch/index.ts`
- `open-sse/mcp-server/toolSearch/register.ts`
- `open-sse/mcp-server/toolSearch/search.ts`
- `open-sse/mcp-server/toolSearch/signature.ts`
- `open-sse/mcp-server/tools/advancedTools.ts`
- `open-sse/package.json`
- `open-sse/services/AGENTS.md`
- `open-sse/services/__tests__/tierResolver.test.ts`
- `open-sse/services/antigravityHeaderScrub.ts`
- `open-sse/services/antigravityHeaders.ts`
- `open-sse/services/autoRefreshDaemon.ts`
- `open-sse/services/browserBackedChat.ts`
- `open-sse/services/browserPool.ts`
- `open-sse/services/ccBridgeTransforms.ts`
- `open-sse/services/claudeCodeCompatible.ts`
- `open-sse/services/claudeTlsClient.ts`
- `open-sse/services/claudeTurnstileSolver.ts`
- `open-sse/services/cloudCodeThinking.ts`
- `open-sse/services/combo.ts`
- `open-sse/services/combo/__tests__/targetExhaustion.test.ts`
- `open-sse/services/compression/cacheAwareConfig.ts`
- `open-sse/services/compression/diffHelper.ts`
- `open-sse/services/compression/engineCatalog.ts`
- `open-sse/services/compression/engines/headroom/index.ts`
- `open-sse/services/compression/engines/index.ts`
- `open-sse/services/compression/engines/relevance/configSchema.ts`
- `open-sse/services/compression/engines/relevance/index.ts`
- `open-sse/services/compression/engines/relevance/scorer.ts`
- `open-sse/services/compression/engines/rtk/commandDetector.ts`
- `open-sse/services/compression/engines/rtk/configSchema.ts`
- `open-sse/services/compression/engines/rtk/index.ts`
- `open-sse/services/compression/engines/rtk/renderers/gitDiff.ts`
- `open-sse/services/compression/engines/rtk/renderers/index.ts`
- `open-sse/services/compression/engines/rtk/renderers/structuredTable.ts`
- `open-sse/services/compression/engines/rtk/renderers/terraformPlan.ts`
- `open-sse/services/compression/engines/rtk/renderers/testGreen.ts`
- `open-sse/services/compression/engines/rtk/renderers/types.ts`
- `open-sse/services/compression/engines/rtk/splitCompositeCommand.ts`
- `open-sse/services/compression/entrypointWrap.ts`
- `open-sse/services/compression/hardBudget.ts`
- `open-sse/services/compression/planResolution.ts`
- `open-sse/services/compression/preservation.ts`
- `open-sse/services/compression/quantumLock/index.ts`
- `open-sse/services/compression/quantumLock/quantumLock.ts`
- `open-sse/services/compression/quantumLock/quantumLockStep.ts`
- `open-sse/services/compression/quantumLock/quantumPatterns.ts`
- `open-sse/services/compression/quantumLock/strategyWrap.ts`
- `open-sse/services/compression/resultMemo.ts`
- `open-sse/services/compression/riskGate/index.ts`
- `open-sse/services/compression/riskGate/riskGate.ts`
- `open-sse/services/compression/riskGate/riskGateStep.ts`
- `open-sse/services/compression/riskGate/riskPatterns.ts`
- `open-sse/services/compression/riskGate/strategyWrap.ts`
- `open-sse/services/compression/strategySelector.ts`
- `open-sse/services/compression/types.ts`
- `open-sse/services/contextManager.ts`
- `open-sse/services/freeWebSearch.ts`
- `open-sse/services/geminiCliHeaders.ts`
- `open-sse/services/grokTlsClient.ts`
- `open-sse/services/model.ts`
- `open-sse/services/opencodeOllamaUsage.ts`
- `open-sse/services/payloadRules.ts`
- `open-sse/services/provider.ts`
- `open-sse/services/qoderCli.ts`
- `open-sse/services/sessionPool/fingerprintRotator.ts`
- `open-sse/services/tierConfig.ts`
- `open-sse/services/tierDefaults.json`
- `open-sse/services/tokenRefresh.ts`
- `open-sse/services/usage.ts`
- `open-sse/services/usage/antigravity.ts`
- `open-sse/transformer/responsesTransformer.ts`
- `open-sse/translator/formats.ts`
- `open-sse/translator/index.ts`
- `open-sse/translator/request/claude-to-gemini.ts`
- `open-sse/translator/request/gemini-to-openai.ts`
- `open-sse/translator/request/openai-responses.ts`
- `open-sse/translator/request/openai-to-gemini.ts`
- `open-sse/translator/request/openai-to-kiro.ts`
- `open-sse/translator/response/gemini-to-claude.ts`
- `open-sse/translator/response/gemini-to-openai.ts`
- `open-sse/translator/response/kiro-to-openai.ts`
- `open-sse/translator/response/openai-responses.ts`
- `open-sse/translator/response/openai-to-gemini-sse.ts`
- `open-sse/types.d.ts`
- `open-sse/utils/aiSdkCompat.ts`
- `open-sse/utils/cursorVersionDetector.ts`
- `open-sse/utils/proxyFallback.ts`
- `open-sse/utils/publicCreds.ts`
- `open-sse/utils/stream.ts`
- `open-sse/utils/streamPayloadCollector.ts`
- `open-sse/utils/usageTracking.ts`
- `package-lock.json`
- `package.json`
- `public/providers/gemini-cli.svg`
- `scripts/ad-hoc/diag-trae-auth.mjs`
- `scripts/ad-hoc/resolve_all_conflicts.js`
- `scripts/build/bootstrap-env.mjs`
- `scripts/build/pack-artifact-policy.ts`
- `scripts/check/check-docs-symbols.mjs`
- `scripts/check/check-fabricated-docs.mjs`
- `scripts/check/check-known-symbols.ts`
- `scripts/check/check-test-discovery.mjs`
- `scripts/ci/should-promote-latest.sh`
- `scripts/dev/responses-ws-proxy.mjs`
- `scripts/dev/system-info.mjs`
- `scripts/docs/sync-wiki.mjs`
- `scripts/i18n/i18n_autotranslate.py`
- `scripts/quality/mutation-radiography.mjs`
- `skills/cli-serve/SKILL.md`
- `src/app/(dashboard)/dashboard/acp-agents/page.tsx`
- `src/app/(dashboard)/dashboard/analytics/CompressionAnalyticsTab.tsx`
- `src/app/(dashboard)/dashboard/cli-code/components/CodexToolCard.tsx`
- `src/app/(dashboard)/dashboard/combos/page.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/CompressionAnnotation.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/CompressionCockpit.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/PlayView.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/PlaygroundInput.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/QuantumLockBadge.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/RiskGateBadge.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/SaliencyHeatmap.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/compressionFlowModel.ts`
- `src/app/(dashboard)/dashboard/context/page.tsx`
- `src/app/(dashboard)/dashboard/onboarding/steps/TierTour.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/ProviderDetailPageClient.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/ConnectionRow.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/ConnectionsHeaderToolbar.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/ConnectionsListPanel.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/CustomModelsSection.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/EmptyConnectionsPlaceholder.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/ProviderModalsPanel.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/modals/EditConnectionModal.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/modals/ImportGeminiAuthModal.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/modals/__tests__/authImportModals.test.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/hooks/useAuthFileHandlers.ts`
- `src/app/(dashboard)/dashboard/providers/[id]/providerPageHelpers.ts`
- `src/app/(dashboard)/dashboard/providers/components/NoAuthProvidersSection.tsx`
- `src/app/(dashboard)/dashboard/providers/components/onboarding/providerOnboardingCatalog.ts`
- `src/app/(dashboard)/dashboard/providers/page.tsx`
- `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.tsx`
- `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/providerColumns.ts`
- `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/quotaParsing.ts`
- `src/app/api/cli-tools/guide-settings/[toolId]/route.ts`
- `src/app/api/compression/preview/route.ts`
- `src/app/api/internal/codex-responses-ws/route.ts`
- `src/app/api/oauth/[provider]/[action]/route.ts`
- `src/app/api/providers/[id]/gemini-cli-auth/apply-local/route.ts`
- `src/app/api/providers/[id]/gemini-cli-auth/export/route.ts`
- `src/app/api/providers/[id]/models/route.ts`
- `src/app/api/providers/[id]/test/route.ts`
- `src/app/api/providers/agy-auth/zip-extract/route.ts`
- `src/app/api/providers/gemini-cli-auth/import-bulk/route.ts`
- `src/app/api/providers/gemini-cli-auth/import/route.ts`
- `src/app/api/providers/gemini-cli-auth/zip-extract/route.ts`
- `src/app/api/settings/authz-inventory/route.ts`
- `src/app/api/v1/messages/count_tokens/route.ts`
- `src/app/api/v1/models/catalog.ts`
- `src/app/api/v1/vscode/[token]/modelPresentation.ts`
- `src/app/api/v1/vscode/raw/[token]/modelPresentation.ts`
- `src/app/docs/[...slug]/page.tsx`
- `src/domain/providerExpiration.ts`
- `src/hooks/usePreviewCompression.ts`
- `src/i18n/messages/ar.json`
- `src/i18n/messages/az.json`
- `src/i18n/messages/bg.json`
- `src/i18n/messages/bn.json`
- `src/i18n/messages/cs.json`
- `src/i18n/messages/da.json`
- `src/i18n/messages/de.json`
- `src/i18n/messages/en.json`
- `src/i18n/messages/es.json`
- `src/i18n/messages/fa.json`
- `src/i18n/messages/fi.json`
- `src/i18n/messages/fr.json`
- `src/i18n/messages/gu.json`
- `src/i18n/messages/he.json`
- `src/i18n/messages/hi.json`
- `src/i18n/messages/hu.json`
- `src/i18n/messages/id.json`
- `src/i18n/messages/in.json`
- `src/i18n/messages/it.json`
- `src/i18n/messages/ja.json`
- `src/i18n/messages/ko.json`
- `src/i18n/messages/mr.json`
- `src/i18n/messages/ms.json`
- `src/i18n/messages/nl.json`
- `src/i18n/messages/no.json`
- `src/i18n/messages/phi.json`
- `src/i18n/messages/pl.json`
- `src/i18n/messages/pt-BR.json`
- `src/i18n/messages/pt.json`
- `src/i18n/messages/ro.json`
- `src/i18n/messages/ru.json`
- `src/i18n/messages/sk.json`
- `src/i18n/messages/sv.json`
- `src/i18n/messages/sw.json`
- `src/i18n/messages/ta.json`
- `src/i18n/messages/te.json`
- `src/i18n/messages/th.json`
- `src/i18n/messages/tr.json`
- `src/i18n/messages/uk-UA.json`
- `src/i18n/messages/ur.json`
- `src/i18n/messages/vi.json`
- `src/i18n/messages/zh-CN.json`
- `src/lib/acp/registry.ts`
- `src/lib/cloudflaredTunnel.ts`
- `src/lib/copilot/engine.ts`
- `src/lib/copilot/systemPrompt.ts`
- `src/lib/db/compressionAnalytics.ts`
- `src/lib/db/core.ts`
- `src/lib/db/migrations/109_call_logs_correlation_id.sql`
- `src/lib/db/schemaColumns.ts`
- `src/lib/docsI18nPath.ts`
- `src/lib/docsSanitizer.ts`
- `src/lib/modelAliasSeed.ts`
- `src/lib/modelsDevSync.ts`
- `src/lib/oauth/constants/oauth.ts`
- `src/lib/oauth/credentialBlob.ts`
- `src/lib/oauth/pasteCredentials.ts`
- `src/lib/oauth/providers.ts`
- `src/lib/oauth/providers/gemini.ts`
- `src/lib/oauth/providers/grok-cli.ts`
- `src/lib/oauth/providers/index.ts`
- `src/lib/oauth/providers/windsurf.ts`
- `src/lib/oauth/services/gemini.ts`
- `src/lib/oauth/services/index.ts`
- `src/lib/oauth/utils/agyAuthImport.ts`
- `src/lib/oauth/utils/cliProxyAuthImport.ts`
- `src/lib/oauth/utils/geminiAuthFile.ts`
- `src/lib/oauth/utils/geminiAuthImport.ts`
- `src/lib/oauth/utils/jsonZipExtract.ts`
- `src/lib/pricingSync.ts`
- `src/lib/providers/validation/headers.ts`
- `src/lib/providers/validation/metaAi.ts`
- `src/lib/providers/validation/openaiFormat.ts`
- `src/lib/providers/validation/urlHelpers.ts`
- `src/lib/providers/validation/webProvidersA.ts`
- `src/lib/providers/validation/webProvidersB.ts`
- `src/lib/proxyHealth.ts`
- `src/lib/services/installers/utils.ts`
- `src/lib/system/versionCheck.ts`
- `src/lib/tokenHealthCheck.ts`
- `src/lib/usage/callLogs.ts`
- `src/lib/usage/fetcher.ts`
- `src/lib/usage/providerLimits.ts`
- `src/lib/usage/usageHistory.ts`
- `src/mitm/handlers/antigravity.ts`
- `src/proxy.ts`
- `src/server/authz/classify.ts`
- `src/shared/components/OAuthModal.tsx`
- `src/shared/components/ProviderIcon.tsx`
- `src/shared/components/lobeProviderIcons.ts`
- `src/shared/constants/cliCompatProviders.ts`
- `src/shared/constants/cliTools.ts`
- `src/shared/constants/colors.ts`
- `src/shared/constants/pricing.ts`
- `src/shared/constants/pricing/oauth-subscriptions.ts`
- `src/shared/constants/providers.ts`
- `src/shared/constants/providers/oauth.ts`
- `src/shared/constants/providers/web-cookie.ts`
- `src/shared/providers/webSessionCredentials.ts`
- `src/shared/schemas/cliCatalog.ts`
- `src/shared/services/cliRuntime.ts`
- `src/shared/utils/noAuthProviders.ts`
- `src/shared/utils/nodeRuntimeSupport.ts`
- `src/shared/validation/schemas/auth.ts`
- `src/shared/validation/schemas/provider.ts`
- `src/sse/handlers/chat.ts`
- `src/sse/handlers/chatHelpers.ts`
- `src/sse/services/auth.ts`
- `src/sse/services/model.ts`
- `tests/integration/chat-pipeline.test.ts`
- `tests/snapshots/provider/translate-path.json`
- `tests/unit/antigravity-client-profile.test.ts`
- `tests/unit/api/authz-inventory.test.ts`
- `tests/unit/auth-antigravity-account-retry-v2.test.ts`
- `tests/unit/authz/classify.test.ts`
- `tests/unit/authz/pipeline.test.ts`
- `tests/unit/authz/proxy-contract.test.ts`
- `tests/unit/build/should-promote-latest-5301.test.ts`
- `tests/unit/chat-route-coverage.test.ts`
- `tests/unit/chatcore-memory-skills-injection.test.ts`
- `tests/unit/chatcore-skills-format.test.ts`
- `tests/unit/chatgpt-web.test.ts`
- `tests/unit/check-docs-symbols.test.ts`
- `tests/unit/check-known-symbols.test.ts`
- `tests/unit/claude-codex-identity-version-sync.test.ts`
- `tests/unit/cli-catalog-acpspawnable.test.ts`
- `tests/unit/cli-catalog-counts.test.ts`
- `tests/unit/cli-catalog-newentries.test.ts`
- `tests/unit/cli-plugin-system.test.ts`
- `tests/unit/cli-runtime-imports-packaged-5227.test.ts`
- `tests/unit/cli-tools-schema.test.ts`
- `tests/unit/cli-tools.test.ts`
- `tests/unit/cli/setup-gemini.test.ts`
- `tests/unit/cliproxy-auth-import-1934.test.ts`
- `tests/unit/combo-body-specific-400-stop-4279.test.ts`
- `tests/unit/combo-rr-session-stickiness-3825.test.ts`
- `tests/unit/combo-strategies.test.ts`
- `tests/unit/command-code-executor.test.ts`
- `tests/unit/command-code-maxtokens-negative-5166.test.ts`
- `tests/unit/compression/compressionAnalytics.test.ts`
- `tests/unit/compression/compressionAnnotation.test.ts`
- `tests/unit/compression/hard-budget.test.ts`
- `tests/unit/compression/heatmap-build.test.ts`
- `tests/unit/compression/quantumLockDetect.test.ts`
- `tests/unit/compression/quantumLockIntegration.test.ts`
- `tests/unit/compression/quantumLockStep.test.ts`
- `tests/unit/compression/relevance-engine.test.ts`
- `tests/unit/compression/relevance-scorer.test.ts`
- `tests/unit/compression/result-memo.test.ts`
- `tests/unit/compression/riskGateDetect.test.ts`
- `tests/unit/compression/riskGateIntegration.test.ts`
- `tests/unit/compression/riskGateStep.test.ts`
- `tests/unit/compression/rtk-command-detector.test.ts`
- `tests/unit/compression/rtk-render-gitdiff.test.ts`
- `tests/unit/compression/rtk-render-table.test.ts`
- `tests/unit/compression/rtk-render-terraform.test.ts`
- `tests/unit/compression/rtk-render-testgreen.test.ts`
- `tests/unit/compression/rtk-renderers-integration.test.ts`
- `tests/unit/compression/splitCompositeCommand.test.ts`
- `tests/unit/context-manager.test.ts`
- `tests/unit/copilot-m365-web-executor.test.ts`
- `tests/unit/dashboard/context-parent-redirect-5298.test.ts`
- `tests/unit/dockerfile-build-heap-4076.test.ts`
- `tests/unit/dockerignore-docs-coverage.test.ts`
- `tests/unit/error-classification.test.ts`
- `tests/unit/executor-antigravity.test.ts`
- `tests/unit/executor-codex.test.ts`
- `tests/unit/executor-gemini-cli.test.ts`
- `tests/unit/executor-github.test.ts`
- `tests/unit/free-tier-catalog.test.ts`
- `tests/unit/gemini-import-route.test.ts`
- `tests/unit/gemini-midstream-error-4177.test.ts`
- `tests/unit/gemini-usage-projectid.test.ts`
- `tests/unit/geminiAuthFile.test.ts`
- `tests/unit/geminiAuthImport.test.ts`
- `tests/unit/glm-executor.test.ts`
- `tests/unit/grok-cli-oauth.test.ts`
- `tests/unit/grok-cli-strip-params.test.ts`
- `tests/unit/guide-settings-route.test.ts`
- `tests/unit/kilocode-anonymous-fallback-4019.test.ts`
- `tests/unit/kiro-continue-filler-5231.test.ts`
- `tests/unit/m365-bizchat-frames-4042.test.ts`
- `tests/unit/m365-connection-4042.test.ts`
- `tests/unit/mcp/tool-definition-reexport.test.ts`
- `tests/unit/mitm-handler-antigravity.test.ts`
- `tests/unit/model-alias-seed.test.ts`
- `tests/unit/modelsDevSync.test.ts`
- `tests/unit/noauth-blocked-partition-5183.test.ts`
- `tests/unit/node-runtime-support.test.ts`
- `tests/unit/oauth-providers-config.test.ts`
- `tests/unit/oauth-redirect-uri-mismatch.test.ts`
- `tests/unit/ops-scripts.test.ts`
- `tests/unit/pack-artifact-policy.test.ts`
- `tests/unit/pricing-sync.test.ts`
- `tests/unit/provider-health-autopilot.test.ts`
- `tests/unit/provider-models-route.test.ts`
- `tests/unit/provider-request-failure-pipeline.test.ts`
- `tests/unit/provider-target-format-badge-4475.test.ts`
- `tests/unit/provider-validation-branches.test.ts`
- `tests/unit/providers-page-utils.test.ts`
- `tests/unit/proxy-connection-test.test.ts`
- `tests/unit/proxy-fallback-cache-key.test.ts`
- `tests/unit/qoder-jobtoken-exchange-4683.test.ts`
- `tests/unit/refresh-serializer.test.ts`
- `tests/unit/response-sanitizer.test.ts`
- `tests/unit/responses-transformer.test.ts`
- `tests/unit/responses-translation-fixes.test.ts`
- `tests/unit/save-call-log-persistence.test.ts`
- `tests/unit/security/docs-path-traversal.test.ts`
- `tests/unit/security/docs-sanitization.test.ts`
- `tests/unit/service-token-refresh.test.ts`
- `tests/unit/sse-nonstream-accept-5305.test.ts`
- `tests/unit/system-transforms.test.ts`
- `tests/unit/system-version-check-4100.test.ts`
- `tests/unit/t14-proxy-fast-fail.test.ts`
- `tests/unit/t19-codex-responses-empty-content.test.ts`
- `tests/unit/t20-t22-provider-headers.test.ts`
- `tests/unit/t28-model-catalog-updates.test.ts`
- `tests/unit/token-health-check.test.ts`
- `tests/unit/token-refresh-cas-guard-4038.test.ts`
- `tests/unit/translator-gemini-audio-input.test.ts`
- `tests/unit/translator-openai-responses-req.test.ts`
- `tests/unit/translator-openai-to-gemini-sse.test.ts`
- `tests/unit/translator-openai-to-gemini.test.ts`
- `tests/unit/translator-openai-to-kiro.test.ts`
- `tests/unit/translator-resp-antigravity-thinking-boundary.test.ts`
- `tests/unit/translator-resp-kiro-to-openai.test.ts`
- `tests/unit/translator-resp-openai-responses.test.ts`
- `tests/unit/tray-systray-loader-4605.test.ts`
- `tests/unit/ui/compressionAnnotation.test.tsx`
- `tests/unit/ui/quantumLockBadge.test.tsx`
- `tests/unit/ui/riskGateBadge.test.tsx`
- `tests/unit/ui/saliencyHeatmap.test.tsx`
- `tests/unit/usage-providers.test.ts`
- `tests/unit/usage-service-hardening.test.ts`
- `tests/unit/usage-utils.test.ts`
- `tests/unit/vscode-token-routes.test.ts`
- `vitest.mcp.config.ts`

### [#5228](https://github.com/cheaper-inference/OmniRoute/pull/5228) - 2026-06-28T13:23:35Z - 1 paths

- `Dockerfile`

### [#5229](https://github.com/cheaper-inference/OmniRoute/pull/5229) - 2026-06-28T13:23:38Z - 1 paths

- `Dockerfile`

### [#5230](https://github.com/cheaper-inference/OmniRoute/pull/5230) - 2026-06-28T16:03:09Z - 5 paths

- `CHANGELOG.md`
- `package.json`
- `scripts/build/pack-artifact-policy.ts`
- `tests/unit/cli-runtime-imports-packaged-5227.test.ts`
- `tests/unit/pack-artifact-policy.test.ts`

### [#5233](https://github.com/cheaper-inference/OmniRoute/pull/5233) - 2026-06-28T15:29:45Z - 2 paths

- `CHANGELOG.md`
- `tests/unit/dockerfile-build-heap-4076.test.ts`

### [#5234](https://github.com/cheaper-inference/OmniRoute/pull/5234) - 2026-06-28T15:31:41Z - 2 paths

- `.github/workflows/docker-publish.yml`
- `.trivyignore`

### [#5235](https://github.com/cheaper-inference/OmniRoute/pull/5235) - 2026-06-28T15:31:44Z - 2 paths

- `.github/workflows/docker-publish.yml`
- `.trivyignore`

### [#5237](https://github.com/cheaper-inference/OmniRoute/pull/5237) - 2026-06-28T17:41:57Z - 70 paths

- `.env.example`
- `config/quality/complexity-baseline.json`
- `config/quality/file-size-baseline.json`
- `docs/providers/AGENTROUTER.md`
- `docs/reference/ENVIRONMENT.md`
- `docs/security/STEALTH_GUIDE.md`
- `open-sse/config/anthropicHeaders.ts`
- `open-sse/config/glmProvider.ts`
- `open-sse/config/providerHeaderProfiles.ts`
- `open-sse/executors/adapta-web.ts`
- `open-sse/executors/blackbox-web.ts`
- `open-sse/executors/chatgpt-web.ts`
- `open-sse/executors/chipotle.ts`
- `open-sse/executors/claude-web.ts`
- `open-sse/executors/claudeIdentity.ts`
- `open-sse/executors/copilot-web.ts`
- `open-sse/executors/deepseek-web.ts`
- `open-sse/executors/doubao-web.ts`
- `open-sse/executors/duckduckgo-web.ts`
- `open-sse/executors/gemini-business.ts`
- `open-sse/executors/gemini-web.ts`
- `open-sse/executors/grok-cli.ts`
- `open-sse/executors/grok-web.ts`
- `open-sse/executors/huggingchat.ts`
- `open-sse/executors/inner-ai.ts`
- `open-sse/executors/kimi-web.ts`
- `open-sse/executors/lmarena.ts`
- `open-sse/executors/mimocode.ts`
- `open-sse/executors/muse-spark-web.ts`
- `open-sse/executors/perplexity-web.ts`
- `open-sse/executors/phind.ts`
- `open-sse/executors/poe-web.ts`
- `open-sse/executors/qwen-web.ts`
- `open-sse/executors/t3-chat-web.ts`
- `open-sse/executors/theoldllm.ts`
- `open-sse/executors/trae.ts`
- `open-sse/executors/v0-vercel-web.ts`
- `open-sse/executors/venice-web.ts`
- `open-sse/executors/veoaifree-web.ts`
- `open-sse/services/antigravityHeaders.ts`
- `open-sse/services/autoRefreshDaemon.ts`
- `open-sse/services/browserBackedChat.ts`
- `open-sse/services/browserPool.ts`
- `open-sse/services/ccBridgeTransforms.ts`
- `open-sse/services/claudeCodeCompatible.ts`
- `open-sse/services/claudeTlsClient.ts`
- `open-sse/services/claudeTurnstileSolver.ts`
- `open-sse/services/freeWebSearch.ts`
- `open-sse/services/geminiCliHeaders.ts`
- `open-sse/services/grokTlsClient.ts`
- `open-sse/services/opencodeOllamaUsage.ts`
- `open-sse/services/sessionPool/fingerprintRotator.ts`
- `open-sse/services/usage.ts`
- `open-sse/utils/cursorVersionDetector.ts`
- `scripts/ad-hoc/diag-trae-auth.mjs`
- `scripts/dev/responses-ws-proxy.mjs`
- `src/app/api/internal/codex-responses-ws/route.ts`
- `src/app/api/providers/[id]/models/route.ts`
- `src/lib/providers/validation/headers.ts`
- `src/lib/providers/validation/metaAi.ts`
- `src/lib/providers/validation/webProvidersA.ts`
- `src/lib/providers/validation/webProvidersB.ts`
- `tests/snapshots/provider/translate-path.json`
- `tests/unit/antigravity-client-profile.test.ts`
- `tests/unit/claude-codex-identity-version-sync.test.ts`
- `tests/unit/cli-tools.test.ts`
- `tests/unit/executor-github.test.ts`
- `tests/unit/glm-executor.test.ts`
- `tests/unit/t20-t22-provider-headers.test.ts`
- `tests/unit/usage-service-hardening.test.ts`

### [#5241](https://github.com/cheaper-inference/OmniRoute/pull/5241) - 2026-06-28T18:38:49Z - 8 paths

- `config/quality/dependency-allowlist.json`
- `package-lock.json`
- `package.json`
- `src/app/docs/[...slug]/page.tsx`
- `src/lib/docsI18nPath.ts`
- `src/lib/docsSanitizer.ts`
- `tests/unit/security/docs-path-traversal.test.ts`
- `tests/unit/security/docs-sanitization.test.ts`

### [#5243](https://github.com/cheaper-inference/OmniRoute/pull/5243) - 2026-06-28T18:26:45Z - 19 paths

- `config/quality/file-size-baseline.json`
- `open-sse/services/compression/preservation.ts`
- `open-sse/services/compression/riskGate/index.ts`
- `open-sse/services/compression/riskGate/riskGate.ts`
- `open-sse/services/compression/riskGate/riskGateStep.ts`
- `open-sse/services/compression/riskGate/riskPatterns.ts`
- `open-sse/services/compression/riskGate/strategyWrap.ts`
- `open-sse/services/compression/strategySelector.ts`
- `open-sse/services/compression/types.ts`
- `src/app/(dashboard)/dashboard/compression/studio/PlayView.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/PlaygroundInput.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/RiskGateBadge.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/compressionFlowModel.ts`
- `src/app/api/compression/preview/route.ts`
- `src/hooks/usePreviewCompression.ts`
- `tests/unit/compression/riskGateDetect.test.ts`
- `tests/unit/compression/riskGateIntegration.test.ts`
- `tests/unit/compression/riskGateStep.test.ts`
- `tests/unit/ui/riskGateBadge.test.tsx`

### [#5246](https://github.com/cheaper-inference/OmniRoute/pull/5246) - 2026-06-28T21:12:55Z - 569 paths

- `.env.example`
- `@omniroute/opencode-plugin/README.md`
- `@omniroute/opencode-plugin/src/index.ts`
- `@omniroute/opencode-plugin/tests/config-shim.test.ts`
- `@omniroute/opencode-plugin/tests/gemini-sanitize.test.ts`
- `AGENTS.md`
- `README.md`
- `bin/cli/commands/registry.mjs`
- `bin/cli/commands/setup-gemini.mjs`
- `bin/cli/commands/setup-qwen.mjs`
- `docs/architecture/ARCHITECTURE.md`
- `docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/compression/COMPRESSION_GUIDE.md`
- `docs/frameworks/ACP.md`
- `docs/getting-started/TROUBLESHOOTING.md`
- `docs/guides/CLI-INTEGRATIONS.md`
- `docs/guides/FEATURES.md`
- `docs/guides/REMOTE-MODE.md`
- `docs/guides/SETUP_GUIDE.md`
- `docs/guides/TROUBLESHOOTING.md`
- `docs/guides/USER_GUIDE.md`
- `docs/i18n/ar/README.md`
- `docs/i18n/ar/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/ar/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/ar/docs/guides/FEATURES.md`
- `docs/i18n/ar/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/ar/docs/guides/USER_GUIDE.md`
- `docs/i18n/ar/docs/reference/ENVIRONMENT.md`
- `docs/i18n/ar/llm.txt`
- `docs/i18n/az/README.md`
- `docs/i18n/az/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/az/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/az/docs/guides/FEATURES.md`
- `docs/i18n/az/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/az/docs/guides/USER_GUIDE.md`
- `docs/i18n/az/docs/reference/ENVIRONMENT.md`
- `docs/i18n/az/llm.txt`
- `docs/i18n/bg/README.md`
- `docs/i18n/bg/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/bg/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/bg/docs/guides/FEATURES.md`
- `docs/i18n/bg/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/bg/docs/guides/USER_GUIDE.md`
- `docs/i18n/bg/docs/reference/ENVIRONMENT.md`
- `docs/i18n/bg/llm.txt`
- `docs/i18n/bn/README.md`
- `docs/i18n/bn/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/bn/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/bn/docs/guides/FEATURES.md`
- `docs/i18n/bn/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/bn/docs/guides/USER_GUIDE.md`
- `docs/i18n/bn/docs/reference/ENVIRONMENT.md`
- `docs/i18n/bn/llm.txt`
- `docs/i18n/cs/README.md`
- `docs/i18n/cs/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/cs/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/cs/docs/guides/FEATURES.md`
- `docs/i18n/cs/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/cs/docs/guides/USER_GUIDE.md`
- `docs/i18n/cs/docs/reference/ENVIRONMENT.md`
- `docs/i18n/cs/llm.txt`
- `docs/i18n/da/README.md`
- `docs/i18n/da/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/da/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/da/docs/guides/FEATURES.md`
- `docs/i18n/da/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/da/docs/guides/USER_GUIDE.md`
- `docs/i18n/da/docs/reference/ENVIRONMENT.md`
- `docs/i18n/da/llm.txt`
- `docs/i18n/de/README.md`
- `docs/i18n/de/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/de/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/de/docs/guides/FEATURES.md`
- `docs/i18n/de/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/de/docs/guides/USER_GUIDE.md`
- `docs/i18n/de/docs/reference/ENVIRONMENT.md`
- `docs/i18n/de/llm.txt`
- `docs/i18n/es/README.md`
- `docs/i18n/es/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/es/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/es/docs/guides/FEATURES.md`
- `docs/i18n/es/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/es/docs/guides/USER_GUIDE.md`
- `docs/i18n/es/docs/reference/ENVIRONMENT.md`
- `docs/i18n/es/llm.txt`
- `docs/i18n/fa/README.md`
- `docs/i18n/fa/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/fa/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/fa/docs/guides/FEATURES.md`
- `docs/i18n/fa/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/fa/docs/guides/USER_GUIDE.md`
- `docs/i18n/fa/docs/reference/ENVIRONMENT.md`
- `docs/i18n/fa/llm.txt`
- `docs/i18n/fi/README.md`
- `docs/i18n/fi/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/fi/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/fi/docs/guides/FEATURES.md`
- `docs/i18n/fi/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/fi/docs/guides/USER_GUIDE.md`
- `docs/i18n/fi/docs/reference/ENVIRONMENT.md`
- `docs/i18n/fi/llm.txt`
- `docs/i18n/fr/README.md`
- `docs/i18n/fr/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/fr/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/fr/docs/guides/FEATURES.md`
- `docs/i18n/fr/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/fr/docs/guides/USER_GUIDE.md`
- `docs/i18n/fr/docs/reference/ENVIRONMENT.md`
- `docs/i18n/fr/llm.txt`
- `docs/i18n/gu/README.md`
- `docs/i18n/gu/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/gu/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/gu/docs/guides/FEATURES.md`
- `docs/i18n/gu/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/gu/docs/guides/USER_GUIDE.md`
- `docs/i18n/gu/docs/reference/ENVIRONMENT.md`
- `docs/i18n/gu/llm.txt`
- `docs/i18n/he/README.md`
- `docs/i18n/he/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/he/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/he/docs/guides/FEATURES.md`
- `docs/i18n/he/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/he/docs/guides/USER_GUIDE.md`
- `docs/i18n/he/docs/reference/ENVIRONMENT.md`
- `docs/i18n/he/llm.txt`
- `docs/i18n/hi/README.md`
- `docs/i18n/hi/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/hi/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/hi/docs/guides/FEATURES.md`
- `docs/i18n/hi/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/hi/docs/guides/USER_GUIDE.md`
- `docs/i18n/hi/docs/reference/ENVIRONMENT.md`
- `docs/i18n/hi/llm.txt`
- `docs/i18n/hu/README.md`
- `docs/i18n/hu/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/hu/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/hu/docs/guides/FEATURES.md`
- `docs/i18n/hu/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/hu/docs/guides/USER_GUIDE.md`
- `docs/i18n/hu/docs/reference/ENVIRONMENT.md`
- `docs/i18n/hu/llm.txt`
- `docs/i18n/id/README.md`
- `docs/i18n/id/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/id/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/id/docs/guides/FEATURES.md`
- `docs/i18n/id/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/id/docs/guides/USER_GUIDE.md`
- `docs/i18n/id/docs/reference/ENVIRONMENT.md`
- `docs/i18n/id/llm.txt`
- `docs/i18n/in/README.md`
- `docs/i18n/in/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/in/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/in/docs/guides/FEATURES.md`
- `docs/i18n/in/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/in/docs/guides/USER_GUIDE.md`
- `docs/i18n/in/docs/reference/ENVIRONMENT.md`
- `docs/i18n/in/llm.txt`
- `docs/i18n/it/README.md`
- `docs/i18n/it/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/it/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/it/docs/guides/FEATURES.md`
- `docs/i18n/it/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/it/docs/guides/USER_GUIDE.md`
- `docs/i18n/it/docs/reference/ENVIRONMENT.md`
- `docs/i18n/it/llm.txt`
- `docs/i18n/ja/README.md`
- `docs/i18n/ja/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/ja/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/ja/docs/guides/FEATURES.md`
- `docs/i18n/ja/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/ja/docs/guides/USER_GUIDE.md`
- `docs/i18n/ja/docs/reference/ENVIRONMENT.md`
- `docs/i18n/ja/llm.txt`
- `docs/i18n/ko/README.md`
- `docs/i18n/ko/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/ko/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/ko/docs/guides/FEATURES.md`
- `docs/i18n/ko/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/ko/docs/guides/USER_GUIDE.md`
- `docs/i18n/ko/docs/reference/ENVIRONMENT.md`
- `docs/i18n/ko/llm.txt`
- `docs/i18n/mr/README.md`
- `docs/i18n/mr/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/mr/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/mr/docs/guides/FEATURES.md`
- `docs/i18n/mr/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/mr/docs/guides/USER_GUIDE.md`
- `docs/i18n/mr/docs/reference/ENVIRONMENT.md`
- `docs/i18n/mr/llm.txt`
- `docs/i18n/ms/README.md`
- `docs/i18n/ms/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/ms/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/ms/docs/guides/FEATURES.md`
- `docs/i18n/ms/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/ms/docs/guides/USER_GUIDE.md`
- `docs/i18n/ms/docs/reference/ENVIRONMENT.md`
- `docs/i18n/ms/llm.txt`
- `docs/i18n/nl/README.md`
- `docs/i18n/nl/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/nl/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/nl/docs/guides/FEATURES.md`
- `docs/i18n/nl/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/nl/docs/guides/USER_GUIDE.md`
- `docs/i18n/nl/docs/reference/ENVIRONMENT.md`
- `docs/i18n/nl/llm.txt`
- `docs/i18n/no/README.md`
- `docs/i18n/no/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/no/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/no/docs/guides/FEATURES.md`
- `docs/i18n/no/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/no/docs/guides/USER_GUIDE.md`
- `docs/i18n/no/docs/reference/ENVIRONMENT.md`
- `docs/i18n/no/llm.txt`
- `docs/i18n/phi/README.md`
- `docs/i18n/phi/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/phi/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/phi/docs/guides/FEATURES.md`
- `docs/i18n/phi/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/phi/docs/guides/USER_GUIDE.md`
- `docs/i18n/phi/docs/reference/ENVIRONMENT.md`
- `docs/i18n/phi/llm.txt`
- `docs/i18n/pl/README.md`
- `docs/i18n/pl/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/pl/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/pl/docs/guides/FEATURES.md`
- `docs/i18n/pl/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/pl/docs/guides/USER_GUIDE.md`
- `docs/i18n/pl/docs/reference/ENVIRONMENT.md`
- `docs/i18n/pl/llm.txt`
- `docs/i18n/pt-BR/README.md`
- `docs/i18n/pt-BR/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/pt-BR/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/pt-BR/docs/guides/FEATURES.md`
- `docs/i18n/pt-BR/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/pt-BR/docs/guides/USER_GUIDE.md`
- `docs/i18n/pt-BR/docs/reference/ENVIRONMENT.md`
- `docs/i18n/pt-BR/llm.txt`
- `docs/i18n/pt/README.md`
- `docs/i18n/pt/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/pt/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/pt/docs/guides/FEATURES.md`
- `docs/i18n/pt/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/pt/docs/guides/USER_GUIDE.md`
- `docs/i18n/pt/docs/reference/ENVIRONMENT.md`
- `docs/i18n/pt/llm.txt`
- `docs/i18n/ro/README.md`
- `docs/i18n/ro/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/ro/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/ro/docs/guides/FEATURES.md`
- `docs/i18n/ro/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/ro/docs/guides/USER_GUIDE.md`
- `docs/i18n/ro/docs/reference/ENVIRONMENT.md`
- `docs/i18n/ro/llm.txt`
- `docs/i18n/ru/README.md`
- `docs/i18n/ru/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/ru/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/ru/docs/guides/FEATURES.md`
- `docs/i18n/ru/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/ru/docs/guides/USER_GUIDE.md`
- `docs/i18n/ru/docs/reference/ENVIRONMENT.md`
- `docs/i18n/ru/llm.txt`
- `docs/i18n/sk/README.md`
- `docs/i18n/sk/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/sk/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/sk/docs/guides/FEATURES.md`
- `docs/i18n/sk/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/sk/docs/guides/USER_GUIDE.md`
- `docs/i18n/sk/docs/reference/ENVIRONMENT.md`
- `docs/i18n/sk/llm.txt`
- `docs/i18n/sv/README.md`
- `docs/i18n/sv/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/sv/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/sv/docs/guides/FEATURES.md`
- `docs/i18n/sv/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/sv/docs/guides/USER_GUIDE.md`
- `docs/i18n/sv/docs/reference/ENVIRONMENT.md`
- `docs/i18n/sv/llm.txt`
- `docs/i18n/sw/README.md`
- `docs/i18n/sw/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/sw/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/sw/docs/guides/FEATURES.md`
- `docs/i18n/sw/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/sw/docs/guides/USER_GUIDE.md`
- `docs/i18n/sw/docs/reference/ENVIRONMENT.md`
- `docs/i18n/sw/llm.txt`
- `docs/i18n/ta/README.md`
- `docs/i18n/ta/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/ta/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/ta/docs/guides/FEATURES.md`
- `docs/i18n/ta/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/ta/docs/guides/USER_GUIDE.md`
- `docs/i18n/ta/docs/reference/ENVIRONMENT.md`
- `docs/i18n/ta/llm.txt`
- `docs/i18n/te/README.md`
- `docs/i18n/te/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/te/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/te/docs/guides/FEATURES.md`
- `docs/i18n/te/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/te/docs/guides/USER_GUIDE.md`
- `docs/i18n/te/docs/reference/ENVIRONMENT.md`
- `docs/i18n/te/llm.txt`
- `docs/i18n/th/README.md`
- `docs/i18n/th/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/th/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/th/docs/guides/FEATURES.md`
- `docs/i18n/th/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/th/docs/guides/USER_GUIDE.md`
- `docs/i18n/th/docs/reference/ENVIRONMENT.md`
- `docs/i18n/th/llm.txt`
- `docs/i18n/tr/README.md`
- `docs/i18n/tr/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/tr/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/tr/docs/guides/FEATURES.md`
- `docs/i18n/tr/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/tr/docs/guides/USER_GUIDE.md`
- `docs/i18n/tr/docs/reference/ENVIRONMENT.md`
- `docs/i18n/tr/llm.txt`
- `docs/i18n/uk-UA/README.md`
- `docs/i18n/uk-UA/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/uk-UA/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/uk-UA/docs/guides/FEATURES.md`
- `docs/i18n/uk-UA/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/uk-UA/docs/guides/USER_GUIDE.md`
- `docs/i18n/uk-UA/docs/reference/ENVIRONMENT.md`
- `docs/i18n/uk-UA/llm.txt`
- `docs/i18n/ur/README.md`
- `docs/i18n/ur/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/ur/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/ur/docs/guides/FEATURES.md`
- `docs/i18n/ur/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/ur/docs/guides/USER_GUIDE.md`
- `docs/i18n/ur/docs/reference/ENVIRONMENT.md`
- `docs/i18n/ur/llm.txt`
- `docs/i18n/vi/README.md`
- `docs/i18n/vi/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/vi/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/vi/docs/guides/FEATURES.md`
- `docs/i18n/vi/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/vi/docs/guides/USER_GUIDE.md`
- `docs/i18n/vi/docs/reference/ENVIRONMENT.md`
- `docs/i18n/vi/llm.txt`
- `docs/i18n/zh-CN/README.md`
- `docs/i18n/zh-CN/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/zh-CN/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/zh-CN/docs/guides/FEATURES.md`
- `docs/i18n/zh-CN/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/zh-CN/docs/guides/USER_GUIDE.md`
- `docs/i18n/zh-CN/docs/reference/ENVIRONMENT.md`
- `docs/i18n/zh-CN/llm.txt`
- `docs/i18n/zh-TW/README.md`
- `docs/i18n/zh-TW/docs/architecture/ARCHITECTURE.md`
- `docs/i18n/zh-TW/docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/i18n/zh-TW/docs/guides/FEATURES.md`
- `docs/i18n/zh-TW/docs/guides/TROUBLESHOOTING.md`
- `docs/i18n/zh-TW/docs/guides/USER_GUIDE.md`
- `docs/i18n/zh-TW/docs/reference/ENVIRONMENT.md`
- `docs/i18n/zh-TW/llm.txt`
- `docs/marketing/TIERS.md`
- `docs/reference/API_REFERENCE.md`
- `docs/reference/CLI-TOOLS.md`
- `docs/reference/ENVIRONMENT.md`
- `docs/reference/FREE_TIERS.md`
- `docs/reference/PROVIDER_REFERENCE.md`
- `docs/research/UNLIMITED_LLM_ACCESS.md`
- `docs/security/PUBLIC_CREDS.md`
- `docs/security/STEALTH_GUIDE.md`
- `images/tier-flow-dark.svg`
- `images/tier-flow-light.svg`
- `llm.txt`
- `open-sse/config/cliFingerprints.ts`
- `open-sse/config/freeModelCatalog.data.ts`
- `open-sse/config/freeTierCatalog.ts`
- `open-sse/config/providers/index.ts`
- `open-sse/config/providers/registry/gemini/cli/index.ts`
- `open-sse/executors/antigravity.ts`
- `open-sse/executors/gemini-cli.ts`
- `open-sse/executors/index.ts`
- `open-sse/handlers/responseTranslator.ts`
- `open-sse/mcp-server/schemas/tools.ts`
- `open-sse/services/AGENTS.md`
- `open-sse/services/__tests__/tierResolver.test.ts`
- `open-sse/services/antigravityHeaderScrub.ts`
- `open-sse/services/cloudCodeThinking.ts`
- `open-sse/services/geminiCliHeaders.ts`
- `open-sse/services/model.ts`
- `open-sse/services/payloadRules.ts`
- `open-sse/services/provider.ts`
- `open-sse/services/tierConfig.ts`
- `open-sse/services/tierDefaults.json`
- `open-sse/services/tokenRefresh.ts`
- `open-sse/services/usage.ts`
- `open-sse/services/usage/antigravity.ts`
- `open-sse/translator/formats.ts`
- `open-sse/translator/request/claude-to-gemini.ts`
- `open-sse/translator/request/gemini-to-openai.ts`
- `open-sse/translator/request/openai-to-gemini.ts`
- `open-sse/translator/response/gemini-to-claude.ts`
- `open-sse/translator/response/gemini-to-openai.ts`
- `open-sse/translator/response/openai-to-gemini-sse.ts`
- `open-sse/types.d.ts`
- `open-sse/utils/publicCreds.ts`
- `open-sse/utils/stream.ts`
- `open-sse/utils/streamPayloadCollector.ts`
- `open-sse/utils/usageTracking.ts`
- `public/providers/gemini-cli.svg`
- `scripts/ad-hoc/resolve_all_conflicts.js`
- `scripts/build/bootstrap-env.mjs`
- `scripts/check/check-fabricated-docs.mjs`
- `scripts/check/check-known-symbols.ts`
- `scripts/dev/system-info.mjs`
- `scripts/i18n/i18n_autotranslate.py`
- `src/app/(dashboard)/dashboard/acp-agents/page.tsx`
- `src/app/(dashboard)/dashboard/combos/page.tsx`
- `src/app/(dashboard)/dashboard/onboarding/steps/TierTour.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/ProviderDetailPageClient.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/ConnectionRow.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/ConnectionsHeaderToolbar.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/ConnectionsListPanel.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/CustomModelsSection.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/EmptyConnectionsPlaceholder.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/ProviderModalsPanel.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/modals/EditConnectionModal.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/modals/ImportGeminiAuthModal.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/modals/__tests__/authImportModals.test.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/hooks/useAuthFileHandlers.ts`
- `src/app/(dashboard)/dashboard/providers/[id]/providerPageHelpers.ts`
- `src/app/(dashboard)/dashboard/providers/components/onboarding/providerOnboardingCatalog.ts`
- `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.tsx`
- `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/providerColumns.ts`
- `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/quotaParsing.ts`
- `src/app/api/cli-tools/guide-settings/[toolId]/route.ts`
- `src/app/api/providers/[id]/gemini-cli-auth/apply-local/route.ts`
- `src/app/api/providers/[id]/gemini-cli-auth/export/route.ts`
- `src/app/api/providers/[id]/models/route.ts`
- `src/app/api/providers/[id]/test/route.ts`
- `src/app/api/providers/agy-auth/zip-extract/route.ts`
- `src/app/api/providers/gemini-cli-auth/import-bulk/route.ts`
- `src/app/api/providers/gemini-cli-auth/import/route.ts`
- `src/app/api/providers/gemini-cli-auth/zip-extract/route.ts`
- `src/app/api/v1/models/catalog.ts`
- `src/app/api/v1/vscode/[token]/modelPresentation.ts`
- `src/app/api/v1/vscode/raw/[token]/modelPresentation.ts`
- `src/domain/providerExpiration.ts`
- `src/i18n/messages/ar.json`
- `src/i18n/messages/az.json`
- `src/i18n/messages/bg.json`
- `src/i18n/messages/bn.json`
- `src/i18n/messages/cs.json`
- `src/i18n/messages/da.json`
- `src/i18n/messages/de.json`
- `src/i18n/messages/en.json`
- `src/i18n/messages/es.json`
- `src/i18n/messages/fa.json`
- `src/i18n/messages/fi.json`
- `src/i18n/messages/fr.json`
- `src/i18n/messages/gu.json`
- `src/i18n/messages/he.json`
- `src/i18n/messages/hi.json`
- `src/i18n/messages/hu.json`
- `src/i18n/messages/id.json`
- `src/i18n/messages/in.json`
- `src/i18n/messages/it.json`
- `src/i18n/messages/ja.json`
- `src/i18n/messages/ko.json`
- `src/i18n/messages/mr.json`
- `src/i18n/messages/ms.json`
- `src/i18n/messages/nl.json`
- `src/i18n/messages/no.json`
- `src/i18n/messages/phi.json`
- `src/i18n/messages/pl.json`
- `src/i18n/messages/pt-BR.json`
- `src/i18n/messages/pt.json`
- `src/i18n/messages/ro.json`
- `src/i18n/messages/ru.json`
- `src/i18n/messages/sk.json`
- `src/i18n/messages/sv.json`
- `src/i18n/messages/sw.json`
- `src/i18n/messages/ta.json`
- `src/i18n/messages/te.json`
- `src/i18n/messages/th.json`
- `src/i18n/messages/tr.json`
- `src/i18n/messages/uk-UA.json`
- `src/i18n/messages/ur.json`
- `src/i18n/messages/vi.json`
- `src/i18n/messages/zh-CN.json`
- `src/lib/acp/registry.ts`
- `src/lib/cloudflaredTunnel.ts`
- `src/lib/copilot/engine.ts`
- `src/lib/copilot/systemPrompt.ts`
- `src/lib/modelAliasSeed.ts`
- `src/lib/modelsDevSync.ts`
- `src/lib/oauth/constants/oauth.ts`
- `src/lib/oauth/credentialBlob.ts`
- `src/lib/oauth/pasteCredentials.ts`
- `src/lib/oauth/providers.ts`
- `src/lib/oauth/providers/gemini.ts`
- `src/lib/oauth/providers/index.ts`
- `src/lib/oauth/services/gemini.ts`
- `src/lib/oauth/services/index.ts`
- `src/lib/oauth/utils/agyAuthImport.ts`
- `src/lib/oauth/utils/cliProxyAuthImport.ts`
- `src/lib/oauth/utils/geminiAuthFile.ts`
- `src/lib/oauth/utils/geminiAuthImport.ts`
- `src/lib/oauth/utils/jsonZipExtract.ts`
- `src/lib/pricingSync.ts`
- `src/lib/providers/validation/openaiFormat.ts`
- `src/lib/providers/validation/urlHelpers.ts`
- `src/lib/tokenHealthCheck.ts`
- `src/lib/usage/fetcher.ts`
- `src/shared/components/OAuthModal.tsx`
- `src/shared/components/ProviderIcon.tsx`
- `src/shared/components/lobeProviderIcons.ts`
- `src/shared/constants/cliCompatProviders.ts`
- `src/shared/constants/cliTools.ts`
- `src/shared/constants/colors.ts`
- `src/shared/constants/pricing.ts`
- `src/shared/constants/pricing/oauth-subscriptions.ts`
- `src/shared/constants/providers.ts`
- `src/shared/constants/providers/oauth.ts`
- `src/shared/schemas/cliCatalog.ts`
- `src/shared/services/cliRuntime.ts`
- `src/shared/validation/schemas/auth.ts`
- `src/shared/validation/schemas/provider.ts`
- `src/sse/services/model.ts`
- `tests/integration/chat-pipeline.test.ts`
- `tests/snapshots/provider/translate-path.json`
- `tests/unit/chatcore-memory-skills-injection.test.ts`
- `tests/unit/chatcore-skills-format.test.ts`
- `tests/unit/check-known-symbols.test.ts`
- `tests/unit/cli-catalog-acpspawnable.test.ts`
- `tests/unit/cli-catalog-counts.test.ts`
- `tests/unit/cli-catalog-newentries.test.ts`
- `tests/unit/cli-tools-schema.test.ts`
- `tests/unit/cli-tools.test.ts`
- `tests/unit/cli/setup-gemini.test.ts`
- `tests/unit/cliproxy-auth-import-1934.test.ts`
- `tests/unit/error-classification.test.ts`
- `tests/unit/executor-antigravity.test.ts`
- `tests/unit/executor-gemini-cli.test.ts`
- `tests/unit/free-tier-catalog.test.ts`
- `tests/unit/gemini-import-route.test.ts`
- `tests/unit/gemini-midstream-error-4177.test.ts`
- `tests/unit/gemini-usage-projectid.test.ts`
- `tests/unit/geminiAuthFile.test.ts`
- `tests/unit/geminiAuthImport.test.ts`
- `tests/unit/guide-settings-route.test.ts`
- `tests/unit/model-alias-seed.test.ts`
- `tests/unit/modelsDevSync.test.ts`
- `tests/unit/oauth-providers-config.test.ts`
- `tests/unit/oauth-redirect-uri-mismatch.test.ts`
- `tests/unit/pricing-sync.test.ts`
- `tests/unit/provider-models-route.test.ts`
- `tests/unit/provider-target-format-badge-4475.test.ts`
- `tests/unit/provider-validation-branches.test.ts`
- `tests/unit/providers-page-utils.test.ts`
- `tests/unit/proxy-connection-test.test.ts`
- `tests/unit/refresh-serializer.test.ts`
- `tests/unit/service-token-refresh.test.ts`
- `tests/unit/system-transforms.test.ts`
- `tests/unit/t20-t22-provider-headers.test.ts`
- `tests/unit/t28-model-catalog-updates.test.ts`
- `tests/unit/token-health-check.test.ts`
- `tests/unit/translator-gemini-audio-input.test.ts`
- `tests/unit/translator-openai-to-gemini-sse.test.ts`
- `tests/unit/translator-openai-to-gemini.test.ts`
- `tests/unit/usage-providers.test.ts`
- `tests/unit/usage-service-hardening.test.ts`
- `tests/unit/usage-utils.test.ts`
- `tests/unit/vscode-token-routes.test.ts`

### [#5248](https://github.com/cheaper-inference/OmniRoute/pull/5248) - 2026-06-28T20:07:08Z - 3 paths

- `CHANGELOG.md`
- `open-sse/services/combo.ts`
- `tests/unit/combo-rr-session-stickiness-3825.test.ts`

### [#5249](https://github.com/cheaper-inference/OmniRoute/pull/5249) - 2026-06-29T04:33:15Z - 2 paths

- `open-sse/services/combo.ts`
- `tests/unit/combo-strategies.test.ts`

### [#5250](https://github.com/cheaper-inference/OmniRoute/pull/5250) - 2026-06-28T20:32:10Z - 3 paths

- `Dockerfile`
- `open-sse/executors/codex.ts`
- `tests/unit/executor-codex.test.ts`

### [#5252](https://github.com/cheaper-inference/OmniRoute/pull/5252) - 2026-06-28T21:44:44Z - 4 paths

- `config/quality/dependency-allowlist.json`
- `config/quality/file-size-baseline.json`
- `package-lock.json`
- `package.json`

### [#5254](https://github.com/cheaper-inference/OmniRoute/pull/5254) - 2026-06-28T20:28:02Z - 2 paths

- `open-sse/services/qoderCli.ts`
- `tests/unit/qoder-jobtoken-exchange-4683.test.ts`

### [#5255](https://github.com/cheaper-inference/OmniRoute/pull/5255) - 2026-06-28T21:12:59Z - 4 paths

- `.env.example`
- `docs/reference/ENVIRONMENT.md`
- `src/lib/proxyHealth.ts`
- `tests/unit/t14-proxy-fast-fail.test.ts`

### [#5256](https://github.com/cheaper-inference/OmniRoute/pull/5256) - 2026-06-28T22:19:21Z - 2 paths

- `open-sse/translator/request/openai-responses.ts`
- `tests/unit/translator-openai-responses-req.test.ts`

### [#5257](https://github.com/cheaper-inference/OmniRoute/pull/5257) - 2026-06-28T21:43:51Z - 3 paths

- `open-sse/handlers/chatCore.ts`
- `tests/unit/executor-codex.test.ts`
- `tests/unit/provider-request-failure-pipeline.test.ts`

### [#5258](https://github.com/cheaper-inference/OmniRoute/pull/5258) - 2026-06-28T22:30:48Z - 3 paths

- `src/lib/oauth/providers/grok-cli.ts`
- `src/shared/validation/schemas/auth.ts`
- `tests/unit/grok-cli-oauth.test.ts`

### [#5259](https://github.com/cheaper-inference/OmniRoute/pull/5259) - 2026-06-28T22:04:52Z - 8 paths

- `CHANGELOG.md`
- `config/quality/file-size-baseline.json`
- `open-sse/config/providers/registry/kilocode/index.ts`
- `open-sse/config/providers/shared.ts`
- `open-sse/executors/default.ts`
- `src/shared/constants/providers/oauth.ts`
- `tests/snapshots/provider/translate-path.json`
- `tests/unit/kilocode-anonymous-fallback-4019.test.ts`

### [#5260](https://github.com/cheaper-inference/OmniRoute/pull/5260) - 2026-06-29T00:59:46Z - 21 paths

- `CHANGELOG.md`
- `open-sse/handlers/chatCore.ts`
- `open-sse/services/compression/cacheAwareConfig.ts`
- `open-sse/services/compression/entrypointWrap.ts`
- `open-sse/services/compression/quantumLock/index.ts`
- `open-sse/services/compression/quantumLock/quantumLock.ts`
- `open-sse/services/compression/quantumLock/quantumLockStep.ts`
- `open-sse/services/compression/quantumLock/quantumPatterns.ts`
- `open-sse/services/compression/quantumLock/strategyWrap.ts`
- `open-sse/services/compression/strategySelector.ts`
- `open-sse/services/compression/types.ts`
- `src/app/(dashboard)/dashboard/compression/studio/PlayView.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/PlaygroundInput.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/QuantumLockBadge.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/compressionFlowModel.ts`
- `src/app/api/compression/preview/route.ts`
- `src/hooks/usePreviewCompression.ts`
- `tests/unit/compression/quantumLockDetect.test.ts`
- `tests/unit/compression/quantumLockIntegration.test.ts`
- `tests/unit/compression/quantumLockStep.test.ts`
- `tests/unit/ui/quantumLockBadge.test.tsx`

### [#5261](https://github.com/cheaper-inference/OmniRoute/pull/5261) - 2026-06-28T22:15:47Z - 2 paths

- `open-sse/utils/proxyFallback.ts`
- `tests/unit/proxy-fallback-cache-key.test.ts`

### [#5262](https://github.com/cheaper-inference/OmniRoute/pull/5262) - 2026-06-29T01:07:19Z - 234 paths

- `.github/workflows/wiki-sync.yml`
- `.mcp.json.example`
- `AGENTS.md`
- `CLAUDE.md`
- `CONTRIBUTING.md`
- `README.md`
- `bin/_ops-common.sh`
- `bin/cold-start-bench.sh`
- `bin/nodeRuntimeSupport.mjs`
- `bin/restore-data.sh`
- `bin/restore-policies.sh`
- `bin/rollback.sh`
- `bin/snapshot-data.sh`
- `docs/DOCUMENTATION_OVERHAUL_PLAN.md`
- `docs/INCIDENT_RESPONSE.md`
- `docs/PERF_BUDGETS.md`
- `docs/README.md`
- `docs/SUBMIT_PR.md`
- `docs/THREAT_MODEL.md`
- `docs/architecture/ARCHITECTURE.md`
- `docs/architecture/AUTHZ_GUIDE.md`
- `docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/architecture/MONITORING_SECTIONS.md`
- `docs/architecture/QUALITY_GATES.md`
- `docs/architecture/REPOSITORY_MAP.md`
- `docs/architecture/RESILIENCE_GUIDE.md`
- `docs/architecture/cluster-decisions.md`
- `docs/comparison/OMNIROUTE_VS_ALTERNATIVES.md`
- `docs/comparison/meta.json`
- `docs/compression/2026-06-20-unified-compression-config-panel-design.md`
- `docs/compression/2026-06-20-unified-compression-config-panel-plan.md`
- `docs/compression/2026-06-21-compression-phase2-named-profiles-design.md`
- `docs/compression/2026-06-21-compression-phase2-named-profiles-plan.md`
- `docs/compression/2026-06-21-compression-phase3-request-header-design.md`
- `docs/compression/2026-06-21-compression-phase3-request-header-plan.md`
- `docs/compression/COMPRESSION_ENGINES.md`
- `docs/compression/COMPRESSION_GUIDE.md`
- `docs/compression/COMPRESSION_LANGUAGE_PACKS.md`
- `docs/compression/COMPRESSION_RULES_FORMAT.md`
- `docs/compression/CONTEXT_EDITING.md`
- `docs/compression/EXTENDING_COMPRESSION.md`
- `docs/compression/RTK_COMPRESSION.md`
- `docs/diagrams/README.md`
- `docs/diagrams/auto-combo-12factor.mmd`
- `docs/diagrams/exported/auto-combo-12factor.svg`
- `docs/diagrams/exported/auto-combo-9factor.svg`
- `docs/diagrams/exported/mcp-tools-87.svg`
- `docs/diagrams/exported/mcp-tools-94.svg`
- `docs/diagrams/mcp-tools-94.mmd`
- `docs/frameworks/A2A-SERVER.md`
- `docs/frameworks/AGENT-SKILLS.md`
- `docs/frameworks/AGENTBRIDGE.md`
- `docs/frameworks/AGENT_PROTOCOLS_GUIDE.md`
- `docs/frameworks/CLOUD_AGENT.md`
- `docs/frameworks/EMBEDDED-SERVICES.md`
- `docs/frameworks/EVALS.md`
- `docs/frameworks/GAMIFICATION.md`
- `docs/frameworks/MCP-SERVER.md`
- `docs/frameworks/MEMORY.md`
- `docs/frameworks/NOTION_CONTEXT.md`
- `docs/frameworks/OBSIDIAN_CONTEXT.md`
- `docs/frameworks/OPENCODE.md`
- `docs/frameworks/OPEN_SSE_ARCHITECTURE.md`
- `docs/frameworks/PLAYGROUND_STUDIO.md`
- `docs/frameworks/PLUGINS.md`
- `docs/frameworks/PLUGIN_MARKETPLACE.md`
- `docs/frameworks/PLUGIN_SDK.md`
- `docs/frameworks/SEARCH_TOOLS_STUDIO.md`
- `docs/frameworks/SKILLS.md`
- `docs/frameworks/TRAFFIC_INSPECTOR.md`
- `docs/frameworks/WEBHOOKS.md`
- `docs/frameworks/meta.json`
- `docs/getting-started/TROUBLESHOOTING.md`
- `docs/guides/CLAUDE-CODE-CONFIGURATION.md`
- `docs/guides/CLI-INTEGRATIONS.md`
- `docs/guides/CODEX-CLI-CONFIGURATION.md`
- `docs/guides/COST_TRACKING.md`
- `docs/guides/DOCKER_GUIDE.md`
- `docs/guides/ELECTRON_GUIDE.md`
- `docs/guides/FEATURES.md`
- `docs/guides/FREE_PROVIDER_RANKINGS.md`
- `docs/guides/I18N.md`
- `docs/guides/PWA_GUIDE.md`
- `docs/guides/REMOTE-MODE.md`
- `docs/guides/SETUP_GUIDE.md`
- `docs/guides/TERMUX_GUIDE.md`
- `docs/guides/TIERS.md`
- `docs/guides/TROUBLESHOOTING.md`
- `docs/guides/UNINSTALL.md`
- `docs/guides/USAGE_QUOTA_GUIDE.md`
- `docs/guides/USER_GUIDE.md`
- `docs/guides/meta.json`
- `docs/i18n/ar/llm.txt`
- `docs/i18n/az/llm.txt`
- `docs/i18n/bg/llm.txt`
- `docs/i18n/bn/llm.txt`
- `docs/i18n/cs/llm.txt`
- `docs/i18n/da/llm.txt`
- `docs/i18n/de/llm.txt`
- `docs/i18n/es/llm.txt`
- `docs/i18n/fa/llm.txt`
- `docs/i18n/fi/llm.txt`
- `docs/i18n/fr/llm.txt`
- `docs/i18n/gu/llm.txt`
- `docs/i18n/he/llm.txt`
- `docs/i18n/hi/llm.txt`
- `docs/i18n/hu/llm.txt`
- `docs/i18n/id/llm.txt`
- `docs/i18n/in/llm.txt`
- `docs/i18n/it/llm.txt`
- `docs/i18n/ja/llm.txt`
- `docs/i18n/ko/llm.txt`
- `docs/i18n/mr/llm.txt`
- `docs/i18n/ms/llm.txt`
- `docs/i18n/nl/llm.txt`
- `docs/i18n/no/llm.txt`
- `docs/i18n/phi/llm.txt`
- `docs/i18n/pl/llm.txt`
- `docs/i18n/pt-BR/llm.txt`
- `docs/i18n/pt/llm.txt`
- `docs/i18n/ro/llm.txt`
- `docs/i18n/ru/llm.txt`
- `docs/i18n/sk/llm.txt`
- `docs/i18n/sv/llm.txt`
- `docs/i18n/sw/llm.txt`
- `docs/i18n/ta/llm.txt`
- `docs/i18n/te/llm.txt`
- `docs/i18n/th/llm.txt`
- `docs/i18n/tr/llm.txt`
- `docs/i18n/uk-UA/llm.txt`
- `docs/i18n/ur/llm.txt`
- `docs/i18n/vi/llm.txt`
- `docs/i18n/zh-CN/llm.txt`
- `docs/i18n/zh-TW/llm.txt`
- `docs/meta.json`
- `docs/ops/COVERAGE_PLAN.md`
- `docs/ops/DATABASE_GUIDE.md`
- `docs/ops/DOCUMENTATION_AUDIT_REPORT.md`
- `docs/ops/E2E_DASHBOARD_SHAKEDOWN_v3.8.0.md`
- `docs/ops/FLY_IO_DEPLOYMENT_GUIDE.md`
- `docs/ops/MONITORING_GUIDE.md`
- `docs/ops/MUTATION_GATE_SPIKE_VERDICT.md`
- `docs/ops/PROXY_GUIDE.md`
- `docs/ops/RELEASE_CHECKLIST.md`
- `docs/ops/TUNNELS_GUIDE.md`
- `docs/ops/VM_DEPLOYMENT_GUIDE.md`
- `docs/ops/meta.json`
- `docs/providers/AGENTROUTER.md`
- `docs/providers/CLAUDE_WEB.md`
- `docs/providers/ZED-DOCKER.md`
- `docs/providers/meta.json`
- `docs/reference/API_REFERENCE.md`
- `docs/reference/CLI-TOOLS.md`
- `docs/reference/ENVIRONMENT.md`
- `docs/reference/FEATURE_FLAGS.md`
- `docs/reference/FREE_TIERS.md`
- `docs/reference/PROVIDER_REFERENCE.md`
- `docs/releases/v3.8.0.md`
- `docs/research/DISCOVERY_TOOL_DESIGN.md`
- `docs/research/UNLIMITED_LLM_ACCESS.md`
- `docs/routing/AUTO-COMBO.md`
- `docs/routing/QUOTA_SHARE.md`
- `docs/routing/REASONING_REPLAY.md`
- `docs/security/CLI_TOKEN.md`
- `docs/security/CLI_TOKEN_AUTH.md`
- `docs/security/COMPLIANCE.md`
- `docs/security/EGRESS_POLICY.md`
- `docs/security/ERROR_SANITIZATION.md`
- `docs/security/GUARDRAILS.md`
- `docs/security/MITM-TPROXY-DECRYPT.md`
- `docs/security/PUBLIC_CREDS.md`
- `docs/security/STEALTH_GUIDE.md`
- `docs/security/meta.json`
- `llm.txt`
- `open-sse/services/compression/engines/headroom/index.ts`
- `scripts/build/pack-artifact-policy.ts`
- `scripts/check/check-docs-symbols.mjs`
- `scripts/check/check-fabricated-docs.mjs`
- `scripts/docs/sync-wiki.mjs`
- `scripts/quality/mutation-radiography.mjs`
- `skills/cli-serve/SKILL.md`
- `src/app/api/oauth/[provider]/[action]/route.ts`
- `src/i18n/messages/ar.json`
- `src/i18n/messages/az.json`
- `src/i18n/messages/bg.json`
- `src/i18n/messages/bn.json`
- `src/i18n/messages/cs.json`
- `src/i18n/messages/da.json`
- `src/i18n/messages/de.json`
- `src/i18n/messages/en.json`
- `src/i18n/messages/es.json`
- `src/i18n/messages/fa.json`
- `src/i18n/messages/fi.json`
- `src/i18n/messages/fr.json`
- `src/i18n/messages/gu.json`
- `src/i18n/messages/he.json`
- `src/i18n/messages/hi.json`
- `src/i18n/messages/hu.json`
- `src/i18n/messages/id.json`
- `src/i18n/messages/in.json`
- `src/i18n/messages/it.json`
- `src/i18n/messages/ja.json`
- `src/i18n/messages/ko.json`
- `src/i18n/messages/mr.json`
- `src/i18n/messages/ms.json`
- `src/i18n/messages/nl.json`
- `src/i18n/messages/no.json`
- `src/i18n/messages/phi.json`
- `src/i18n/messages/pl.json`
- `src/i18n/messages/pt-BR.json`
- `src/i18n/messages/pt.json`
- `src/i18n/messages/ro.json`
- `src/i18n/messages/ru.json`
- `src/i18n/messages/sk.json`
- `src/i18n/messages/sv.json`
- `src/i18n/messages/sw.json`
- `src/i18n/messages/ta.json`
- `src/i18n/messages/te.json`
- `src/i18n/messages/th.json`
- `src/i18n/messages/tr.json`
- `src/i18n/messages/uk-UA.json`
- `src/i18n/messages/ur.json`
- `src/i18n/messages/vi.json`
- `src/i18n/messages/zh-CN.json`
- `src/lib/oauth/constants/oauth.ts`
- `src/lib/oauth/providers/windsurf.ts`
- `src/lib/services/installers/utils.ts`
- `src/shared/components/OAuthModal.tsx`
- `src/shared/utils/nodeRuntimeSupport.ts`
- `tests/unit/check-docs-symbols.test.ts`
- `tests/unit/cli-plugin-system.test.ts`
- `tests/unit/dockerignore-docs-coverage.test.ts`
- `tests/unit/node-runtime-support.test.ts`
- `tests/unit/ops-scripts.test.ts`

### [#5265](https://github.com/cheaper-inference/OmniRoute/pull/5265) - 2026-06-28T23:54:28Z - 2 paths

- `open-sse/services/qoderCli.ts`
- `tests/unit/qoder-jobtoken-exchange-4683.test.ts`

### [#5266](https://github.com/cheaper-inference/OmniRoute/pull/5266) - 2026-06-28T23:04:24Z - 3 paths

- `CHANGELOG.md`
- `src/lib/system/versionCheck.ts`
- `tests/unit/system-version-check-4100.test.ts`

### [#5267](https://github.com/cheaper-inference/OmniRoute/pull/5267) - 2026-06-28T23:21:48Z - 3 paths

- `CHANGELOG.md`
- `src/mitm/handlers/antigravity.ts`
- `tests/unit/mitm-handler-antigravity.test.ts`

### [#5268](https://github.com/cheaper-inference/OmniRoute/pull/5268) - 2026-06-29T00:58:03Z - 15 paths

- `CHANGELOG.md`
- `open-sse/services/compression/engines/rtk/configSchema.ts`
- `open-sse/services/compression/engines/rtk/index.ts`
- `open-sse/services/compression/engines/rtk/renderers/gitDiff.ts`
- `open-sse/services/compression/engines/rtk/renderers/index.ts`
- `open-sse/services/compression/engines/rtk/renderers/structuredTable.ts`
- `open-sse/services/compression/engines/rtk/renderers/terraformPlan.ts`
- `open-sse/services/compression/engines/rtk/renderers/testGreen.ts`
- `open-sse/services/compression/engines/rtk/renderers/types.ts`
- `open-sse/services/compression/types.ts`
- `tests/unit/compression/rtk-render-gitdiff.test.ts`
- `tests/unit/compression/rtk-render-table.test.ts`
- `tests/unit/compression/rtk-render-terraform.test.ts`
- `tests/unit/compression/rtk-render-testgreen.test.ts`
- `tests/unit/compression/rtk-renderers-integration.test.ts`

### [#5269](https://github.com/cheaper-inference/OmniRoute/pull/5269) - 2026-06-29T00:30:23Z - 18 paths

- `CHANGELOG.md`
- `CLAUDE.md`
- `docs/frameworks/MCP-SERVER.md`
- `open-sse/mcp-server/README.md`
- `open-sse/mcp-server/__tests__/essentialTools.test.ts`
- `open-sse/mcp-server/__tests__/toolSearch.catalog.test.ts`
- `open-sse/mcp-server/__tests__/toolSearch.search.test.ts`
- `open-sse/mcp-server/__tests__/toolSearch.signature.test.ts`
- `open-sse/mcp-server/__tests__/toolSearch.tool.test.ts`
- `open-sse/mcp-server/schemas/toolSearch.ts`
- `open-sse/mcp-server/schemas/tools.ts`
- `open-sse/mcp-server/server.ts`
- `open-sse/mcp-server/toolSearch/catalog.ts`
- `open-sse/mcp-server/toolSearch/handler.ts`
- `open-sse/mcp-server/toolSearch/index.ts`
- `open-sse/mcp-server/toolSearch/register.ts`
- `open-sse/mcp-server/toolSearch/search.ts`
- `open-sse/mcp-server/toolSearch/signature.ts`

### [#5270](https://github.com/cheaper-inference/OmniRoute/pull/5270) - 2026-06-28T23:54:42Z - 24 paths

- `CHANGELOG.md`
- `config/quality/dependency-allowlist.json`
- `config/quality/file-size-baseline.json`
- `open-sse/config/providers/registry/kilocode/index.ts`
- `open-sse/config/providers/shared.ts`
- `open-sse/executors/default.ts`
- `open-sse/handlers/chatCore.ts`
- `open-sse/services/compression/cacheAwareConfig.ts`
- `open-sse/services/compression/entrypointWrap.ts`
- `open-sse/services/compression/strategySelector.ts`
- `open-sse/translator/request/openai-responses.ts`
- `open-sse/utils/proxyFallback.ts`
- `package-lock.json`
- `package.json`
- `src/lib/oauth/providers/grok-cli.ts`
- `src/shared/constants/providers/oauth.ts`
- `src/shared/validation/schemas/auth.ts`
- `tests/snapshots/provider/translate-path.json`
- `tests/unit/executor-codex.test.ts`
- `tests/unit/grok-cli-oauth.test.ts`
- `tests/unit/kilocode-anonymous-fallback-4019.test.ts`
- `tests/unit/provider-request-failure-pipeline.test.ts`
- `tests/unit/proxy-fallback-cache-key.test.ts`
- `tests/unit/translator-openai-responses-req.test.ts`

### [#5271](https://github.com/cheaper-inference/OmniRoute/pull/5271) - 2026-06-28T23:54:40Z - 2 paths

- `open-sse/services/compression/engines/rtk/configSchema.ts`
- `open-sse/services/compression/engines/rtk/index.ts`

### [#5272](https://github.com/cheaper-inference/OmniRoute/pull/5272) - 2026-06-28T23:54:37Z - 4 paths

- `open-sse/mcp-server/schemas/toolSearch.ts`
- `open-sse/mcp-server/schemas/tools.ts`
- `open-sse/mcp-server/server.ts`
- `open-sse/mcp-server/toolSearch/register.ts`

### [#5273](https://github.com/cheaper-inference/OmniRoute/pull/5273) - 2026-06-29T01:20:39Z - 3 paths

- `open-sse/config/providers/registry/grok-cli/index.ts`
- `open-sse/executors/grok-cli.ts`
- `tests/unit/grok-cli-strip-params.test.ts`

### [#5274](https://github.com/cheaper-inference/OmniRoute/pull/5274) - 2026-06-29T01:17:39Z - 8 paths

- `docs/architecture/AUTHZ_GUIDE.md`
- `src/app/api/settings/authz-inventory/route.ts`
- `src/proxy.ts`
- `src/server/authz/classify.ts`
- `tests/unit/api/authz-inventory.test.ts`
- `tests/unit/authz/classify.test.ts`
- `tests/unit/authz/pipeline.test.ts`
- `tests/unit/authz/proxy-contract.test.ts`

### [#5276](https://github.com/cheaper-inference/OmniRoute/pull/5276) - 2026-06-29T00:39:06Z - 5 paths

- `CHANGELOG.md`
- `bin/cli/commands/serve.mjs`
- `bin/cli/tray/index.mjs`
- `bin/cli/tray/traySystray.mjs`
- `tests/unit/tray-systray-loader-4605.test.ts`

### [#5277](https://github.com/cheaper-inference/OmniRoute/pull/5277) - 2026-06-29T00:53:48Z - 6 paths

- `CHANGELOG.md`
- `open-sse/handlers/chatCore.ts`
- `open-sse/handlers/chatCore/compressionAnalyticsWrite.ts`
- `src/app/(dashboard)/dashboard/analytics/CompressionAnalyticsTab.tsx`
- `src/lib/db/compressionAnalytics.ts`
- `tests/unit/compression/compressionAnalytics.test.ts`

### [#5278](https://github.com/cheaper-inference/OmniRoute/pull/5278) - 2026-06-29T04:43:14Z - 11 paths

- `.env.example`
- `.prettierignore`
- `SECURITY.md`
- `docs/guides/DOCKER_GUIDE.md`
- `docs/ops/VM_DEPLOYMENT_GUIDE.md`
- `docs/reference/ENVIRONMENT.md`
- `src/app/api/providers/health-autopilot/actions/route.ts`
- `src/server/authz/pipeline.ts`
- `src/server/origin/publicOrigin.ts`
- `tests/unit/authz/pipeline.test.ts`
- `tests/unit/authz/public-origin.test.ts`

### [#5279](https://github.com/cheaper-inference/OmniRoute/pull/5279) - 2026-06-29T03:19:09Z - 13 paths

- `config/quality/file-size-baseline.json`
- `open-sse/handlers/chatCore.ts`
- `open-sse/handlers/chatCore/attemptLogging.ts`
- `src/app/api/v1/messages/count_tokens/route.ts`
- `src/lib/db/core.ts`
- `src/lib/db/migrations/109_call_logs_correlation_id.sql`
- `src/lib/db/schemaColumns.ts`
- `src/lib/usage/callLogs.ts`
- `src/lib/usage/providerLimits.ts`
- `src/lib/usage/usageHistory.ts`
- `src/sse/handlers/chat.ts`
- `src/sse/handlers/chatHelpers.ts`
- `tests/unit/save-call-log-persistence.test.ts`

### [#5280](https://github.com/cheaper-inference/OmniRoute/pull/5280) - 2026-06-29T03:17:14Z - 8 paths

- `docs/guides/USER_GUIDE.md`
- `open-sse/config/providers/registry/chatgpt-web/index.ts`
- `open-sse/config/providers/registry/codex/index.ts`
- `open-sse/executors/chatgpt-web.ts`
- `open-sse/executors/codex.ts`
- `src/app/(dashboard)/dashboard/cli-code/components/CodexToolCard.tsx`
- `tests/unit/chatgpt-web.test.ts`
- `tests/unit/t19-codex-responses-empty-content.test.ts`

### [#5281](https://github.com/cheaper-inference/OmniRoute/pull/5281) - 2026-06-29T03:39:31Z - 8 paths

- `.github/workflows/docker-publish.yml`
- `.trivyignore`
- `CHANGELOG.md`
- `Dockerfile`
- `src/app/(dashboard)/dashboard/providers/components/NoAuthProvidersSection.tsx`
- `src/app/(dashboard)/dashboard/providers/page.tsx`
- `src/shared/utils/noAuthProviders.ts`
- `tests/unit/noauth-blocked-partition-5183.test.ts`

### [#5282](https://github.com/cheaper-inference/OmniRoute/pull/5282) - 2026-06-29T03:13:45Z - 5 paths

- `CHANGELOG.md`
- `open-sse/mcp-server/schemas/toolDefinition.ts`
- `open-sse/mcp-server/schemas/toolSearch.ts`
- `open-sse/mcp-server/schemas/tools.ts`
- `tests/unit/mcp/tool-definition-reexport.test.ts`

### [#5283](https://github.com/cheaper-inference/OmniRoute/pull/5283) - 2026-06-29T03:16:15Z - 5 paths

- `CHANGELOG.md`
- `open-sse/services/compression/engines/rtk/commandDetector.ts`
- `open-sse/services/compression/engines/rtk/splitCompositeCommand.ts`
- `tests/unit/compression/rtk-command-detector.test.ts`
- `tests/unit/compression/splitCompositeCommand.test.ts`

### [#5284](https://github.com/cheaper-inference/OmniRoute/pull/5284) - 2026-06-29T03:24:23Z - 8 paths

- `CHANGELOG.md`
- `open-sse/handlers/chatCore.ts`
- `open-sse/services/compression/planResolution.ts`
- `open-sse/services/compression/strategySelector.ts`
- `src/app/(dashboard)/dashboard/compression/studio/CompressionAnnotation.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/CompressionCockpit.tsx`
- `tests/unit/compression/compressionAnnotation.test.ts`
- `tests/unit/ui/compressionAnnotation.test.tsx`

### [#5285](https://github.com/cheaper-inference/OmniRoute/pull/5285) - 2026-06-29T03:21:14Z - 10 paths

- `CHANGELOG.md`
- `open-sse/services/compression/diffHelper.ts`
- `src/app/(dashboard)/dashboard/compression/studio/PlayView.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/PlaygroundInput.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/SaliencyHeatmap.tsx`
- `src/app/(dashboard)/dashboard/compression/studio/compressionFlowModel.ts`
- `src/app/api/compression/preview/route.ts`
- `src/hooks/usePreviewCompression.ts`
- `tests/unit/compression/heatmap-build.test.ts`
- `tests/unit/ui/saliencyHeatmap.test.tsx`

### [#5286](https://github.com/cheaper-inference/OmniRoute/pull/5286) - 2026-06-29T03:28:53Z - 6 paths

- `CHANGELOG.md`
- `config/quality/file-size-baseline.json`
- `open-sse/services/compression/resultMemo.ts`
- `open-sse/services/compression/strategySelector.ts`
- `open-sse/services/compression/types.ts`
- `tests/unit/compression/result-memo.test.ts`

### [#5288](https://github.com/cheaper-inference/OmniRoute/pull/5288) - 2026-06-29T04:24:38Z - 5 paths

- `CHANGELOG.md`
- `open-sse/services/compression/hardBudget.ts`
- `open-sse/services/compression/strategySelector.ts`
- `open-sse/services/compression/types.ts`
- `tests/unit/compression/hard-budget.test.ts`

### [#5289](https://github.com/cheaper-inference/OmniRoute/pull/5289) - 2026-06-29T04:25:41Z - 9 paths

- `CHANGELOG.md`
- `open-sse/services/compression/engineCatalog.ts`
- `open-sse/services/compression/engines/index.ts`
- `open-sse/services/compression/engines/relevance/configSchema.ts`
- `open-sse/services/compression/engines/relevance/index.ts`
- `open-sse/services/compression/engines/relevance/scorer.ts`
- `open-sse/services/compression/types.ts`
- `tests/unit/compression/relevance-engine.test.ts`
- `tests/unit/compression/relevance-scorer.test.ts`

### [#5291](https://github.com/cheaper-inference/OmniRoute/pull/5291) - 2026-06-29T04:40:37Z - 3 paths

- `config/quality/file-size-baseline.json`
- `open-sse/services/compression/strategySelector.ts`
- `tests/unit/compression/hard-budget.test.ts`

### [#5294](https://github.com/cheaper-inference/OmniRoute/pull/5294) - 2026-06-29T06:46:22Z - 5 paths

- `CHANGELOG.md`
- `config/quality/file-size-baseline.json`
- `open-sse/handlers/chatCore.ts`
- `open-sse/services/tokenRefresh.ts`
- `tests/unit/token-refresh-cas-guard-4038.test.ts`

### [#5296](https://github.com/cheaper-inference/OmniRoute/pull/5296) - 2026-06-29T07:02:08Z - 3 paths

- `open-sse/services/combo/__tests__/targetExhaustion.test.ts`
- `scripts/check/check-test-discovery.mjs`
- `vitest.mcp.config.ts`

### [#5299](https://github.com/cheaper-inference/OmniRoute/pull/5299) - 2026-06-29T13:15:00Z - 10 paths

- `src/app/(dashboard)/dashboard/providers/services/components/ServiceLifecycleButtons.tsx`
- `src/app/(dashboard)/dashboard/providers/services/components/ServiceLogsPanel.tsx`
- `src/app/(dashboard)/dashboard/providers/services/hooks/useServiceLogs.ts`
- `src/app/api/services/9router/install/route.ts`
- `src/app/api/services/[name]/logs/route.ts`
- `src/app/api/services/cliproxy/install/route.ts`
- `src/app/api/v1/providers/[provider]/models/route.ts`
- `src/server/authz/routeGuard.ts`
- `tests/unit/provider-models-v1-route.test.ts`
- `tests/unit/route-guard-private-lan.test.ts`

### [#5300](https://github.com/cheaper-inference/OmniRoute/pull/5300) - 2026-06-29T05:57:19Z - 1 paths

- `tests/unit/combo-body-specific-400-stop-4279.test.ts`

### [#5302](https://github.com/cheaper-inference/OmniRoute/pull/5302) - 2026-06-29T07:03:12Z - 18 paths

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `docs/architecture/ARCHITECTURE.md`
- `docs/architecture/CODEBASE_DOCUMENTATION.md`
- `docs/reference/PROVIDER_REFERENCE.md`
- `open-sse/config/providers/index.ts`
- `open-sse/config/providers/registry/copilot-m365-web/index.ts`
- `open-sse/executors/copilot-m365-connection.ts`
- `open-sse/executors/copilot-m365-frames.ts`
- `open-sse/executors/copilot-m365-web.ts`
- `open-sse/executors/index.ts`
- `src/shared/constants/providers/web-cookie.ts`
- `src/shared/providers/webSessionCredentials.ts`
- `tests/snapshots/provider/translate-path.json`
- `tests/unit/copilot-m365-web-executor.test.ts`
- `tests/unit/m365-bizchat-frames-4042.test.ts`
- `tests/unit/m365-connection-4042.test.ts`

### [#5303](https://github.com/cheaper-inference/OmniRoute/pull/5303) - 2026-06-29T06:48:36Z - 4 paths

- `CHANGELOG.md`
- `open-sse/translator/request/openai-to-kiro.ts`
- `tests/unit/kiro-continue-filler-5231.test.ts`
- `tests/unit/translator-openai-to-kiro.test.ts`

### [#5304](https://github.com/cheaper-inference/OmniRoute/pull/5304) - 2026-06-29T06:47:47Z - 3 paths

- `CHANGELOG.md`
- `open-sse/executors/commandCode.ts`
- `tests/unit/command-code-maxtokens-negative-5166.test.ts`

### [#5306](https://github.com/cheaper-inference/OmniRoute/pull/5306) - 2026-06-29T07:19:20Z - 45 paths

- `CHANGELOG.md`
- `src/app/(dashboard)/dashboard/context/page.tsx`
- `src/i18n/messages/ar.json`
- `src/i18n/messages/az.json`
- `src/i18n/messages/bg.json`
- `src/i18n/messages/bn.json`
- `src/i18n/messages/cs.json`
- `src/i18n/messages/da.json`
- `src/i18n/messages/de.json`
- `src/i18n/messages/en.json`
- `src/i18n/messages/es.json`
- `src/i18n/messages/fa.json`
- `src/i18n/messages/fi.json`
- `src/i18n/messages/fr.json`
- `src/i18n/messages/gu.json`
- `src/i18n/messages/he.json`
- `src/i18n/messages/hi.json`
- `src/i18n/messages/hu.json`
- `src/i18n/messages/id.json`
- `src/i18n/messages/in.json`
- `src/i18n/messages/it.json`
- `src/i18n/messages/ja.json`
- `src/i18n/messages/ko.json`
- `src/i18n/messages/mr.json`
- `src/i18n/messages/ms.json`
- `src/i18n/messages/nl.json`
- `src/i18n/messages/no.json`
- `src/i18n/messages/phi.json`
- `src/i18n/messages/pl.json`
- `src/i18n/messages/pt-BR.json`
- `src/i18n/messages/pt.json`
- `src/i18n/messages/ro.json`
- `src/i18n/messages/ru.json`
- `src/i18n/messages/sk.json`
- `src/i18n/messages/sv.json`
- `src/i18n/messages/sw.json`
- `src/i18n/messages/ta.json`
- `src/i18n/messages/te.json`
- `src/i18n/messages/th.json`
- `src/i18n/messages/tr.json`
- `src/i18n/messages/uk-UA.json`
- `src/i18n/messages/ur.json`
- `src/i18n/messages/vi.json`
- `src/i18n/messages/zh-CN.json`
- `tests/unit/dashboard/context-parent-redirect-5298.test.ts`

### [#5309](https://github.com/cheaper-inference/OmniRoute/pull/5309) - 2026-06-29T08:05:37Z - 5 paths

- `CHANGELOG.md`
- `open-sse/utils/aiSdkCompat.ts`
- `src/sse/handlers/chat.ts`
- `tests/unit/chat-route-coverage.test.ts`
- `tests/unit/sse-nonstream-accept-5305.test.ts`

### [#5311](https://github.com/cheaper-inference/OmniRoute/pull/5311) - 2026-06-29T08:35:57Z - 4 paths

- `.github/workflows/docker-publish.yml`
- `CHANGELOG.md`
- `scripts/ci/should-promote-latest.sh`
- `tests/unit/build/should-promote-latest-5301.test.ts`

### [#5315](https://github.com/cheaper-inference/OmniRoute/pull/5315) - 2026-06-29T13:11:33Z - 3 paths

- `src/app/api/v1/relay/chat/completions/route.ts`
- `src/app/api/v1/relay/chat/completions/routingBackend.ts`
- `tests/unit/api/v1/relay-routing-backend.test.ts`

### [#5321](https://github.com/cheaper-inference/OmniRoute/pull/5321) - 2026-06-29T13:06:34Z - 6 paths

- `src/shared/constants/cliTools.ts`
- `src/shared/utils/a11yAudit.ts`
- `src/shared/validation/helpers.ts`
- `tests/unit/batch-b-final.test.ts`
- `tests/unit/cli-tools-schema.test.ts`
- `tests/unit/modular-schemas.test.ts`

### [#5322](https://github.com/cheaper-inference/OmniRoute/pull/5322) - 2026-06-29T13:06:37Z - 4 paths

- `src/shared/schemas/searchTools.ts`
- `src/shared/validation/settingsSchemas.ts`
- `tests/unit/feature-flags-settings.test.ts`
- `tests/unit/search-tools-schemas.test.ts`

### [#5324](https://github.com/cheaper-inference/OmniRoute/pull/5324) - 2026-06-29T13:06:41Z - 10 paths

- `src/lib/oauth/providers.ts`
- `src/lib/proxyLogger.ts`
- `src/lib/quota/sqliteQuotaStore.ts`
- `src/shared/middleware/bodySizeGuard.ts`
- `src/sse/services/streamState.ts`
- `tests/unit/advanced-fase07-09.test.ts`
- `tests/unit/body-size-guard.test.ts`
- `tests/unit/oauth-trae.test.ts`
- `tests/unit/proxy-logs-route.test.ts`
- `tests/unit/quota-sqlite-store.test.ts`

### [#5325](https://github.com/cheaper-inference/OmniRoute/pull/5325) - 2026-06-29T13:06:44Z - 6 paths

- `src/lib/combos/builderDraft.ts`
- `src/lib/combos/steps.ts`
- `src/lib/providers/catalog.ts`
- `tests/unit/combo-builder-draft.test.ts`
- `tests/unit/combo-custom-provider-resolution.test.ts`
- `tests/unit/providers-free-tier-filter.test.ts`

### [#5327](https://github.com/cheaper-inference/OmniRoute/pull/5327) - 2026-06-29T19:51:03Z - 222 paths

- `.env.example`
- `CHANGELOG.md`
- `README.md`
- `bin/cli/commands/serve.mjs`
- `bin/cli/locales/en.json`
- `bin/cli/runtime/processSupervisor.mjs`
- `config/quality/file-size-baseline.json`
- `config/quality/quality-baseline.json`
- `docs/architecture/AUTHZ_GUIDE.md`
- `docs/i18n/ar/CHANGELOG.md`
- `docs/i18n/az/CHANGELOG.md`
- `docs/i18n/bg/CHANGELOG.md`
- `docs/i18n/bn/CHANGELOG.md`
- `docs/i18n/cs/CHANGELOG.md`
- `docs/i18n/da/CHANGELOG.md`
- `docs/i18n/de/CHANGELOG.md`
- `docs/i18n/es/CHANGELOG.md`
- `docs/i18n/fa/CHANGELOG.md`
- `docs/i18n/fi/CHANGELOG.md`
- `docs/i18n/fr/CHANGELOG.md`
- `docs/i18n/gu/CHANGELOG.md`
- `docs/i18n/he/CHANGELOG.md`
- `docs/i18n/hi/CHANGELOG.md`
- `docs/i18n/hu/CHANGELOG.md`
- `docs/i18n/id/CHANGELOG.md`
- `docs/i18n/in/CHANGELOG.md`
- `docs/i18n/it/CHANGELOG.md`
- `docs/i18n/ja/CHANGELOG.md`
- `docs/i18n/ko/CHANGELOG.md`
- `docs/i18n/mr/CHANGELOG.md`
- `docs/i18n/ms/CHANGELOG.md`
- `docs/i18n/nl/CHANGELOG.md`
- `docs/i18n/no/CHANGELOG.md`
- `docs/i18n/phi/CHANGELOG.md`
- `docs/i18n/pl/CHANGELOG.md`
- `docs/i18n/pt-BR/CHANGELOG.md`
- `docs/i18n/pt/CHANGELOG.md`
- `docs/i18n/ro/CHANGELOG.md`
- `docs/i18n/ru/CHANGELOG.md`
- `docs/i18n/sk/CHANGELOG.md`
- `docs/i18n/sv/CHANGELOG.md`
- `docs/i18n/sw/CHANGELOG.md`
- `docs/i18n/ta/CHANGELOG.md`
- `docs/i18n/te/CHANGELOG.md`
- `docs/i18n/th/CHANGELOG.md`
- `docs/i18n/tr/CHANGELOG.md`
- `docs/i18n/uk-UA/CHANGELOG.md`
- `docs/i18n/ur/CHANGELOG.md`
- `docs/i18n/vi/CHANGELOG.md`
- `docs/i18n/zh-CN/CHANGELOG.md`
- `docs/i18n/zh-TW/CHANGELOG.md`
- `docs/openapi.yaml`
- `docs/reference/ENVIRONMENT.md`
- `electron/package-lock.json`
- `electron/package.json`
- `open-sse/config/embeddingRegistry.ts`
- `open-sse/config/freeModelCatalog.data.ts`
- `open-sse/config/providers/registry/gemini/index.ts`
- `open-sse/config/providers/registry/gemini/web/index.ts`
- `open-sse/config/rerankRegistry.ts`
- `open-sse/executors/base.ts`
- `open-sse/executors/chatgpt-web.ts`
- `open-sse/executors/chatgptWebTools.ts`
- `open-sse/executors/opencode.ts`
- `open-sse/handlers/chatCore.ts`
- `open-sse/handlers/chatCore/keyHealth.ts`
- `open-sse/handlers/rerank.ts`
- `open-sse/package.json`
- `open-sse/services/accountFallback.ts`
- `open-sse/services/apiKeyRotator.ts`
- `open-sse/services/modelDeprecation.ts`
- `open-sse/services/thinkingBudget.ts`
- `open-sse/translator/request/openai-to-claude.ts`
- `open-sse/translator/response/claude-to-openai.ts`
- `open-sse/utils/proxyFetch.ts`
- `open-sse/utils/stream.ts`
- `open-sse/utils/thinkCloseMarker.ts`
- `package-lock.json`
- `package.json`
- `scripts/build/assembleStandalone.mjs`
- `scripts/build/pack-artifact-policy.ts`
- `scripts/build/runtime-env.mjs`
- `scripts/dev/standalone-server-ws.mjs`
- `scripts/dev/tls-options.mjs`
- `src/app/(dashboard)/dashboard/api-manager/ApiManagerPageClient.tsx`
- `src/app/(dashboard)/dashboard/batch/page.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/__tests__/modelVisibilityToolbarActiveCount.test.tsx`
- `src/app/(dashboard)/dashboard/providers/[id]/components/ModelRow.tsx`
- `src/app/(dashboard)/dashboard/providers/services/components/ServiceLifecycleButtons.tsx`
- `src/app/(dashboard)/dashboard/providers/services/components/ServiceLogsPanel.tsx`
- `src/app/(dashboard)/dashboard/providers/services/hooks/useServiceLogs.ts`
- `src/app/api/oauth/[provider]/[action]/route.ts`
- `src/app/api/services/9router/install/route.ts`
- `src/app/api/services/[name]/logs/route.ts`
- `src/app/api/services/cliproxy/install/route.ts`
- `src/app/api/v1/providers/[provider]/models/route.ts`
- `src/app/api/v1/relay/chat/completions/route.ts`
- `src/app/api/v1/relay/chat/completions/routingBackend.ts`
- `src/lib/build-profile/featureDisabled.ts`
- `src/lib/combos/builderDraft.ts`
- `src/lib/combos/steps.ts`
- `src/lib/config/runtimeSettings.ts`
- `src/lib/db/commandCodeAuth.ts`
- `src/lib/db/encryption.ts`
- `src/lib/events/eventBus.ts`
- `src/lib/memory/embedding/index.ts`
- `src/lib/modelAliasSeed.ts`
- `src/lib/modelsDevSync.ts`
- `src/lib/oauth/connectionPersistence.ts`
- `src/lib/oauth/providers.ts`
- `src/lib/providers/catalog.ts`
- `src/lib/providers/validation/searchProviders.ts`
- `src/lib/providers/validation/webProvidersA.ts`
- `src/lib/providers/webCookieAuth.ts`
- `src/lib/proxyLogger.ts`
- `src/lib/quota/sqliteQuotaStore.ts`
- `src/lib/semanticCache.ts`
- `src/lib/services/registry.ts`
- `src/lib/tokenHealthCheck.ts`
- `src/lib/usage/callLogs.ts`
- `src/lib/webhooks/eventDescriptions.ts`
- `src/server-init.ts`
- `src/server/authz/classify.ts`
- `src/server/authz/pipeline.ts`
- `src/server/authz/routeGuard.ts`
- `src/server/cors/origins.ts`
- `src/server/origin/publicOrigin.ts`
- `src/shared/components/NoAuthAccountCard.tsx`
- `src/shared/constants/agentSkills.ts`
- `src/shared/constants/cliTools.ts`
- `src/shared/constants/colors.ts`
- `src/shared/constants/config.ts`
- `src/shared/constants/mcpScopes.ts`
- `src/shared/constants/pricing.ts`
- `src/shared/http/apiErrorMessage.ts`
- `src/shared/middleware/bodySizeGuard.ts`
- `src/shared/middleware/correlationId.ts`
- `src/shared/schemas/searchTools.ts`
- `src/shared/services/loginShellPath.ts`
- `src/shared/services/providerLimitsSyncScheduler.ts`
- `src/shared/utils/a11yAudit.ts`
- `src/shared/utils/apiKey.ts`
- `src/shared/utils/formatting.ts`
- `src/shared/utils/requestTimeout.ts`
- `src/shared/validation/helpers.ts`
- `src/shared/validation/schemas/settings.ts`
- `src/shared/validation/settingsSchemas.ts`
- `src/sse/handlers/chat.ts`
- `src/sse/handlers/chatHelpers.ts`
- `src/sse/services/auth.ts`
- `src/sse/services/noAuthProxyResolution.ts`
- `src/sse/services/streamState.ts`
- `src/sse/utils/logger.ts`
- `tests/unit/account-fallback-service.test.ts`
- `tests/unit/advanced-fase07-09.test.ts`
- `tests/unit/agentSkills-catalog.test.ts`
- `tests/unit/api-error-message-5340.test.ts`
- `tests/unit/api-key-utils-public-surface.test.ts`
- `tests/unit/api/v1/relay-routing-backend.test.ts`
- `tests/unit/apply-executor-proxy-info-5217.test.ts`
- `tests/unit/authz/classify.test.ts`
- `tests/unit/authz/pipeline.test.ts`
- `tests/unit/authz/public-origin.test.ts`
- `tests/unit/base-thinking-budget-config-5312.test.ts`
- `tests/unit/batch-b-final.test.ts`
- `tests/unit/body-size-guard.test.ts`
- `tests/unit/call-log-trim-sql-vars-5217.test.ts`
- `tests/unit/chatgpt-web-tools-5240.test.ts`
- `tests/unit/cli-tools-schema.test.ts`
- `tests/unit/combo-builder-draft.test.ts`
- `tests/unit/combo-custom-provider-resolution.test.ts`
- `tests/unit/config-hot-reload.test.ts`
- `tests/unit/cors/origins.test.ts`
- `tests/unit/db-command-code-auth.test.ts`
- `tests/unit/db-encryption.test.ts`
- `tests/unit/embedding-family-guard.test.ts`
- `tests/unit/encryption.spec.ts`
- `tests/unit/event-bus.test.ts`
- `tests/unit/feature-flags-settings.test.ts`
- `tests/unit/formatting-public-surface.test.ts`
- `tests/unit/key-health-402-disable-5239.test.ts`
- `tests/unit/login-shell-path-3321.test.ts`
- `tests/unit/mcp-pool-tools-3368.test.ts`
- `tests/unit/memory-embedding-resolve.test.ts`
- `tests/unit/model-deprecation.test.ts`
- `tests/unit/modelsDevSync-extended.test.ts`
- `tests/unit/modular-schemas.test.ts`
- `tests/unit/noauth-proxy-resolution.test.ts`
- `tests/unit/oauth-connection-tokenexpiresat-5326.test.ts`
- `tests/unit/oauth-trae.test.ts`
- `tests/unit/observability-fase04.test.ts`
- `tests/unit/openai-to-claude-empty-messages-5245.test.ts`
- `tests/unit/openai-to-claude-redacted-replay-5312.test.ts`
- `tests/unit/opencode-proxy-rotation-4954.test.ts`
- `tests/unit/pricing-constants-split.test.ts`
- `tests/unit/provider-limits-sync-scheduler-public-surface.test.ts`
- `tests/unit/provider-models-v1-route.test.ts`
- `tests/unit/provider-registry-openai-gemini-expanded-models.test.ts`
- `tests/unit/provider-validation-specialty.test.ts`
- `tests/unit/providers-free-tier-filter.test.ts`
- `tests/unit/proxy-logs-route.test.ts`
- `tests/unit/quota-sqlite-store.test.ts`
- `tests/unit/rerank-providers-5332.test.ts`
- `tests/unit/route-guard-private-lan.test.ts`
- `tests/unit/search-tools-schemas.test.ts`
- `tests/unit/security/build-profile-stubs.test.ts`
- `tests/unit/semantic-cache.test.ts`
- `tests/unit/serve-node-options-preserve-5238.test.ts`
- `tests/unit/services/embedWsProxy.test.ts`
- `tests/unit/settings-schema-routing-strategies.test.ts`
- `tests/unit/static-constants-public-surface.test.ts`
- `tests/unit/t28-model-catalog-updates.test.ts`
- `tests/unit/think-close-marker-suppress-5245.test.ts`
- `tests/unit/thinking-budget-hydration-5312.test.ts`
- `tests/unit/tls-options.test.ts`
- `tests/unit/token-health-no-refresh-token-expired-5326.test.ts`
- `tests/unit/translator-openai-to-claude.test.ts`
- `tests/unit/ui/noauth-account-card.test.tsx`
- `tests/unit/validation-search-embedding-split.test.ts`
- `tests/unit/vscode-token-routes.test.ts`
- `tests/unit/web-cookie-auth.test.ts`
- `tests/unit/webhook-event-descriptions.test.ts`

### [#5328](https://github.com/cheaper-inference/OmniRoute/pull/5328) - 2026-06-29T13:06:48Z - 5 paths

- `src/shared/constants/colors.ts`
- `src/shared/constants/config.ts`
- `src/shared/constants/pricing.ts`
- `tests/unit/pricing-constants-split.test.ts`
- `tests/unit/static-constants-public-surface.test.ts`

### [#5329](https://github.com/cheaper-inference/OmniRoute/pull/5329) - 2026-06-29T13:06:52Z - 3 paths

- `src/shared/utils/formatting.ts`
- `src/sse/utils/logger.ts`
- `tests/unit/formatting-public-surface.test.ts`

### [#5330](https://github.com/cheaper-inference/OmniRoute/pull/5330) - 2026-06-29T13:06:56Z - 4 paths

- `src/lib/config/runtimeSettings.ts`
- `src/shared/services/loginShellPath.ts`
- `tests/unit/config-hot-reload.test.ts`
- `tests/unit/login-shell-path-3321.test.ts`

## 8. Limits and preserved uncertainty

- Row-level metadata, head and merge SHAs and complete changed-path sets are established for the
  191 assigned rows only. The other 571 records of the recovered June metadata are not
  dispositioned here and remain open in their own slices.
- The upstream diff was read for the twelve rows of section 5 only. Every other row is
  classified from its complete path list and the local tree, so a row marked unresolved may
  still turn out to be covered, absent or inapplicable once its source diff is read.
- No row is claimed to be a verified port, an already-present fix, or an applicable gap
  without a read local implementation and, for the comparison rows, the upstream final diff.
- The local fork keeps JavaScript where upstream keeps TypeScript and re-homes several
  upstream modules (`open-sse/translator/helpers/*` -> `open-sse/translator/formats/*`,
  `open-sse/config/providers/registry/*` -> `open-sse/providers/registry/*`,
  `open-sse/mcp-server/*` -> `src/lib/mcp/*`). Counterpart searches in section 6 follow that
  layout, but a re-homed module with a different name may still be reported as having no
  local counterpart.
- Provider-identity rows are routed to the existing Provider Sign-in lane. Whether a given
  provider is enabled, hidden or pending in this fork is stated where the local registry was
  read; it was not verified for every provider row.
- No live provider, credential, paid API, browser, Docker, e2e path, vulnerability
  reproduction, exploit development or full test suite was used, and no upstream message was
  sent. Bulk source metadata was not retained in the repository.

Refs #1073
