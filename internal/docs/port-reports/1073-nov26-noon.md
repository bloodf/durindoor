# November 26 noon upstream refresh

**Status: COMPLETE.** Every row has a final disposition. 2 behaviours are ported and this census adds no port candidate.

Retrieved with paginated `gh api` between 2026-11-26T10:49:00Z and 10:49:48Z. Pull request files, commits and diffs were read afterwards. At 10:55:48Z the OmniRoute branch head and the six row heads were unchanged. Snapshots were sequential, not atomic. No live provider was called.

| Source | Head or count at retrieval |
|---|---|
| OmniRoute `release/v3.8.55` | `d05e121ae501a0827ae4690bb7d555c18dc38b56`: 13 commits after `d89f84adee8eaa49a7f4b949e628a6f959414c8f` |
| OmniRoute open pull requests | 566 |
| 9router `master` | `5ae63d22847e07042e235b40e1d926b65e509013`: identical to the baseline |
| 9router open pull requests | 1349 |

## Scope

Each open head was matched against every report outside the pending inventories. Six OmniRoute heads and no 9router head were unnamed. One OmniRoute and six 9router heads were named only on lines this check could not read a verdict from. Their numbers have a dedicated report or a later table, so they are not repeated here. Earlier port candidates were not re-reviewed.

| Disposition | Commit rows | Pull request rows | Total |
|---|---:|---:|---:|
| Ported | 0 | 2 | 2 |
| Ported earlier | 13 | 0 | 13 |
| Already present | 0 | 1 | 1 |
| Not applicable | 0 | 3 | 3 |
| Total | 13 | 6 | 19 |

## OmniRoute default-branch commits

All 13 commits belong to [#21123](https://github.com/cheaper-inference/OmniRoute/pull/21123). The net diff from the previous head to the new one has 14 files: one changelog fragment, English dashboard messages, seven provider constant files and five tests. The shared catalog under `src/shared/constants/providers/apikey` and `src/i18n/messages/en.json` are absent here; provider copy lives in [the registry](../../../open-sse/providers/registry/). A search of `src`, `open-sse` and `docs` for several replaced claims found one hit, an unrelated Deepgram credit. A probe found no free flag on any provider checked whose offer upstream ends. [The existing test](../../../tests/unit/port-omniroute-free-flags-ended-offers.test.js) covers the ported notices. Individual merge conflict resolutions were not read.

| # | Commit | Subject | Disposition | Evidence |
|---:|---|---|---|---|
| 1 | [`24c994ac438a`](https://github.com/cheaper-inference/OmniRoute/commit/24c994ac438a8081623311119ade1495d157da4c) | test(providers): pin the free flags and wizard texts of ended offers | **Ported earlier** | Branch commit of [#21123](https://github.com/cheaper-inference/OmniRoute/pull/21123): upstream tests for the ported provider copy. See the net-diff check above. |
| 2 | [`816721cfffef`](https://github.com/cheaper-inference/OmniRoute/commit/816721cfffef63e7c2446fde2fbc546a2fa015ef) | fix(providers): stop marking ended free offers as free | **Ported earlier** | The [#21123](https://github.com/cheaper-inference/OmniRoute/pull/21123) behaviour, ported in [1073-nov25-port-amprs-d.md](1073-nov25-port-amprs-d.md) at head `49a2394efd4b`. See the net-diff check above. |
| 3 | [`7f96745702ee`](https://github.com/cheaper-inference/OmniRoute/commit/7f96745702ee5d6cce1665b346e0c169f438758b) | docs(changelog): add the fragment for #21123 | **Ported earlier** | Changelog fragment of [#21123](https://github.com/cheaper-inference/OmniRoute/pull/21123); follows row 2. `changelog.d` is absent. |
| 4 | [`49a2394efd4b`](https://github.com/cheaper-inference/OmniRoute/commit/49a2394efd4b61dfa8923f9a30f7ca9e00b702a1) | Merge remote-tracking branch 'origin/fix/free-catalog-reaudit-20261118' into fix/provider-free-flags-ended-offers | **Ported earlier** | Merge on the [#21123](https://github.com/cheaper-inference/OmniRoute/pull/21123) branch: follows row 2. |
| 5 | [`830fb3057d02`](https://github.com/cheaper-inference/OmniRoute/commit/830fb3057d02272f13be738611a7a914f58fd31b) | Merge remote-tracking branch 'origin/release/v3.8.55' into fix/provider-free-flags-ended-offers | **Ported earlier** | Merge on the [#21123](https://github.com/cheaper-inference/OmniRoute/pull/21123) branch: follows row 2. |
| 6 | [`282690b7248c`](https://github.com/cheaper-inference/OmniRoute/commit/282690b7248ccc917423ce414b5e14bcfd002f2f) | Merge remote-tracking branch 'origin/release/v3.8.55' into fix/provider-free-flags-ended-offers | **Ported earlier** | Merge on the [#21123](https://github.com/cheaper-inference/OmniRoute/pull/21123) branch: follows row 2. |
| 7 | [`288fd8a16554`](https://github.com/cheaper-inference/OmniRoute/commit/288fd8a165545a42b4ddc6eca134274ed34b1e8c) | Merge remote-tracking branch 'origin/fix/free-catalog-reaudit-20261118' into fix/provider-free-flags-ended-offers | **Ported earlier** | Merge on the [#21123](https://github.com/cheaper-inference/OmniRoute/pull/21123) branch: follows row 2. |
| 8 | [`7435a48fc1f4`](https://github.com/cheaper-inference/OmniRoute/commit/7435a48fc1f46d6896b142858dc47454c1d47fbe) | Merge remote-tracking branch 'origin/fix/free-catalog-reaudit-20261118' into fix/provider-free-flags-ended-offers | **Ported earlier** | Merge on the [#21123](https://github.com/cheaper-inference/OmniRoute/pull/21123) branch: follows row 2. |
| 9 | [`8f6746395f06`](https://github.com/cheaper-inference/OmniRoute/commit/8f6746395f06701f0584be1462e7df8bca3577f3) | Merge remote-tracking branch 'origin/fix/free-catalog-reaudit-20261118' into fix/provider-free-flags-ended-offers | **Ported earlier** | Merge on the [#21123](https://github.com/cheaper-inference/OmniRoute/pull/21123) branch: follows row 2. |
| 10 | [`503ed8a521c0`](https://github.com/cheaper-inference/OmniRoute/commit/503ed8a521c0e7915c5e3c70aaa929a9bd52b170) | Merge remote-tracking branch 'origin/fix/free-catalog-reaudit-20261118' into fix/provider-free-flags-ended-offers | **Ported earlier** | Merge on the [#21123](https://github.com/cheaper-inference/OmniRoute/pull/21123) branch: follows row 2. |
| 11 | [`b7b27d60af59`](https://github.com/cheaper-inference/OmniRoute/commit/b7b27d60af591516c5127fe92fe6b5ed53ce6799) | Merge remote-tracking branch 'origin/fix/free-catalog-reaudit-20261118' into fix/provider-free-flags-ended-offers | **Ported earlier** | Merge on the [#21123](https://github.com/cheaper-inference/OmniRoute/pull/21123) branch: follows row 2. |
| 12 | [`33ce9850cd58`](https://github.com/cheaper-inference/OmniRoute/commit/33ce9850cd58c197d2aec5965b8422be99c11aea) | Merge remote-tracking branch 'origin/release/v3.8.55' into fix/provider-free-flags-ended-offers | **Ported earlier** | Merge on the [#21123](https://github.com/cheaper-inference/OmniRoute/pull/21123) branch: follows row 2. |
| 13 | [`d05e121ae501`](https://github.com/cheaper-inference/OmniRoute/commit/d05e121ae501a0827ae4690bb7d555c18dc38b56) | Merge PR #21123: fix(providers): stop marking ended free offers as free (@diegosouzapw) | **Ported earlier** | Merge of [#21123](https://github.com/cheaper-inference/OmniRoute/pull/21123); its second parent is the head recorded in [1073-nov26-late.md](1073-nov26-late.md). |

## OmniRoute open pull requests

| # | PR | Exact head | Title | Disposition | Evidence |
|---:|---|---|---|---|---|
| 1 | [#21281](https://github.com/cheaper-inference/OmniRoute/pull/21281) | [`75867749e743`](https://github.com/cheaper-inference/OmniRoute/commit/75867749e7436ce37de3e4c56336b3cb958c4bd0) | fix(combo): clamp the Anthropic output-ceiling fallback | **Not applicable** | Salvage of #20803, recorded as not applicable in [1073-nov22-verify-ob02.md](1073-nov22-verify-ob02.md). The fix changes a hard output-limit filter. In [the combo loop](../../../open-sse/services/combo.js) a requested output above a model cap only lowers its task score, and [context requirements](../../../open-sse/services/combo/contextRequirements.js) filter by context window. `open-sse/services/combo/outputLimitPolicy.js` and `open-sse/services/combo/comboStructure.js` are absent. |
| 2 | [#21280](https://github.com/cheaper-inference/OmniRoute/pull/21280) | [`a1f307f0d2f2`](https://github.com/cheaper-inference/OmniRoute/commit/a1f307f0d2f25eb232f755b45b00025c3ad49e85) | fix(translators): preserve native Gemini 4 reasoning tiers | **Ported** | Salvage of #20802. [1073-nov22-verify-ob02.md](1073-nov22-verify-ob02.md) recorded that pull request as already present on its fixed-tier ids, which still holds. It did not assess the second commit, on disabled thinking. A probe showed `includeThoughts: true` for effort `none` and for Claude `thinking: disabled` on Gemini 4 over the Gemini and Vertex routes. [The thinking step](../../../open-sse/translator/concerns/thinkingUnified.js) now sends `false`; `minimal` and real levels still show thoughts. [Test](../../../tests/unit/port-omniroute-21280-gemini4-declined-thoughts.test.js). The rest is under Open items. |
| 3 | [#21279](https://github.com/cheaper-inference/OmniRoute/pull/21279) | [`888e2e1e547e`](https://github.com/cheaper-inference/OmniRoute/commit/888e2e1e547ed9f45edd61780dc6fa5f6e533659) | fix(sse): route the OpenAI GPT-6 and GPT-5.6+ families to Responses before the catalog lists them | **Ported** | Bug in existing code: an unlisted GPT-6 or GPT-5.6+ id on `openai` kept Chat Completions for a Chat client. [Target format resolution](../../../open-sse/config/providerModels.js) now picks Responses after the catalog lookup, for `openai` only. [Test](../../../tests/unit/port-omniroute-21279-openai-family-responses.test.js). |
| 4 | [#21278](https://github.com/cheaper-inference/OmniRoute/pull/21278) | [`3db65ae5e4c7`](https://github.com/cheaper-inference/OmniRoute/commit/3db65ae5e4c740cf254381c5bb59b2c9e39705f2) | fix(sse): count in-flight streams for backpressure cap and apply TTL in getActiveSessionCount | **Not applicable** | The head was rewritten after [1073-nov26-late.md](1073-nov26-late.md) and is now one commit. Its description and file list still target a connection cap that counted sticky sessions; the verdict stands, with [the concurrency gate](../../../open-sse/services/concurrencyGate.js) counting requests. `src/sse/utils/backpressure.js` and `src/sse/services/streamState.js` are absent. The patch was not read. |
| 5 | [#21247](https://github.com/cheaper-inference/OmniRoute/pull/21247) | [`bfd1ec42a235`](https://github.com/cheaper-inference/OmniRoute/commit/bfd1ec42a23538c48cce1dc86f6cf3570aec832a) | fix(sse): require readiness for keyless auto routing (#19385) | **Already present** | The one new commit is a merge of base head `d89f84adee8e` into `204be59ab124`, recorded as already present in [1073-nov26-midday.md](1073-nov26-midday.md). The readiness gate stays not applicable: `open-sse/services/autoCombo` is absent. Merge conflict resolutions were not read. |
| 6 | [#20391](https://github.com/cheaper-inference/OmniRoute/pull/20391) | [`d05e121ae501`](https://github.com/cheaper-inference/OmniRoute/commit/d05e121ae501a0827ae4690bb7d555c18dc38b56) | Release v3.8.55 | **Not applicable** | Release train; its head is commit row 13. `changelog.d` is absent. |

## 9router

### Default-branch commits

No rows: the comparison head is identical to the baseline.

### Open pull requests

No rows: no open head needed a new disposition.

## Open items

- **#21280, native `xhigh`.** Upstream also keeps `xhigh` for Hydrogen and Neon on the direct Gemini route. Here that route sends `high`, and only Antigravity keeps `xhigh`, as [1073-nov22-verify-ob02.md](1073-nov22-verify-ob02.md) records. Not changed.
- **#21280, defaults.** With no thinking control, the probed Gemini and Vertex routes send no thinking level, while upstream sets one for some Gemini 4 families and fixed-tier ids. Antigravity tier ids keep their catalog presets. Not changed.
- **#21280, other models.** The opt-out fix is limited to Gemini 4. Other Gemini tiers with a `low` floor were not assessed.

## Limits

- **#21279.** Routing was tested offline. OpenAI's rejection text comes from the upstream pull request.
- **#21280.** The request body was tested offline; no Gemini or Vertex call was made.
