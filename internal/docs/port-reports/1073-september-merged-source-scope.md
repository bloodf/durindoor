# #1073 — September 1–29 OmniRoute merged-source scope

Read-only review on 2026-11-20 against [DurinDoor #1073](https://github.com/bloodf/durindoor/issues/1073) and local tree `2237ae771`. This is a bounded metadata and source comparison, not complete adjudication or a port selection list. September 30–October 6 is outside this window.

## Upstream population and archive reconciliation

GitHub search used `repo:cheaper-inference/OmniRoute is:pr is:merged` and the following inclusive UTC `merged:` windows. Each was paged at 100 results, below the 1,000-result search cap.

| Merge dates | Search total | Retrieved unique PRs |
| --- | ---: | ---: |
| September 1–7 | 281 | 281 |
| September 8–14 | 187 | 187 |
| September 15–21 | 478 | 478 |
| September 22–29 | 608 | 608 |
| **Total** | **1,554** | **1,554** |

There are 1,554 distinct upstream PR numbers across the four non-overlapping windows. The archive describes 15,357 records, including 8,409 merged PRs, collected on October 8. Comparing the actual 38 inventory pages by source number and state finds **1,552** of these September PRs recorded as merged; [#13206](https://github.com/cheaper-inference/OmniRoute/pull/13206) and [#13201](https://github.com/cheaper-inference/OmniRoute/pull/13201) are absent from the archive rows. These are upstream evaluation-runner fixes, and their absence is a snapshot discrepancy, not evidence of local applicability. The search list, rather than archive labels, establishes the population.

An earlier count of **287** was of merge records in the DurinDoor fork, not the upstream population. Fork merges can corroborate a specific local port only when tied to its behavior; they are neither the denominator nor evidence that all upstream records were covered. Archive suggested areas and titles are navigation aids only.

## Concrete existing-feature source comparisons

### Responses-style usage in Claude streaming

[OmniRoute #14205](https://github.com/cheaper-inference/OmniRoute/pull/14205), merge `844a34254abb38685bb2e89d2646dcda268a19fc`, adds `input_tokens`/`output_tokens` and `input_tokens_details` fallbacks to its OpenAI-to-Claude stream translator, giving numeric Chat Completions fields precedence. Its final diff includes usage-only chunks and cache counters.

Local `open-sse/translator/response/openai-to-claude.js` calls `toClaudeUsage` for a chunk's usage, but that function reads only `prompt_tokens`, `completion_tokens`, and `prompt_tokens_details`. Thus the source-level alias gap exists on this translator path; this observation does not establish the behavior of every other usage path. Offline acceptance for any later repair: synthetic trailing usage-only chunks should carry Responses-style totals and cached/cache-creation details into Claude usage; numeric Chat Completions values must win when both are supplied, and classic inputs and stream finalization must remain unchanged. Include explicit zero and absent values, without provider calls. No implementation is made here.

### Existing search credential defense

[OmniRoute #12620](https://github.com/cheaper-inference/OmniRoute/pull/12620), merge `4a37c7f46eb43ddece4494de5fe6e90af4aa241b`, includes a search destination credential-binding fix along with other security changes. Local commit `5daa01bb1` and `open-sse/handlers/search/baseUrl.js` implement a local destination policy; `open-sse/handlers/search/index.js` applies it to search dispatch. The detailed [local disposition](1073-search-credential-destination.md) describes the source, different local policy, per-hop binding and offline fixtures. This corroborates coverage of that specific search defense, not the whole upstream PR or all security paths. Offline acceptance is the synthetic destination and redirect policy coverage named in that report; no network exposure probe is needed.

## Triage boundaries and unresolved material

- [#14159](https://github.com/cheaper-inference/OmniRoute/pull/14159), merge `7a921299c5b4c28dcf837f56a1c312b61414a646`, introduces configurable vector and Redis semantic-cache architecture. That new architecture is outside this existing-feature audit; its description also identifies carried-over cache fixes, which cannot be dismissed merely because the PR introduces a feature.
- [#13375](https://github.com/cheaper-inference/OmniRoute/pull/13375), merge `db6feb6fad4137b288e462cb23b4d26944fe9eb1`, concerns dashboard session authentication claims. Sign-in/session redesign is outside this work order; any overlapping local security boundary remains unresolved until the actual local callers are compared.
- [#12703](https://github.com/cheaper-inference/OmniRoute/pull/12703), merge `7da6e10c4eeb7a51ffcfec6e44f9cfc944ad9213`, pins CLI tools in upstream Docker packaging. That packaging change is outside this audit. [#12496](https://github.com/cheaper-inference/OmniRoute/pull/12496) combines i18n tooling with runtime locale aliases and packaging, so it is mixed rather than proof that all its changes are pure tooling.
- Dependency and security fixes remain unresolved where the affected local version, call path or exposure has not been established. Changed paths and titles alone cannot prove a fix irrelevant or already present. In particular, packaging or authentication labels do not dispose of mixed security changes.

## Method and limits

Bulk search and batched GraphQL merge-ID and changed-path metadata are stored in mode-0700 private scratch under `/tmp/durin-1073-sep-1795183487`, not in the repository. GraphQL returned merge IDs and changed-path metadata for 775 distinct PRs in 18 successful batches; all 775 had merge SHAs, and 89 had more changed files than the requested first 50 or 20 paths. The other 779 PRs lack this batch metadata after repeated GitHub HTTP 502 responses; they remain unresolved. Candidates with truncated lists need pagination before path-level conclusions. This incomplete metadata coverage limits the audit. Metadata triage is not a complete row-by-row disposition, and only the examples above received focused source comparison. No runtime change, dependency installation, provider call, credentials, browser, workflow, baseline change, or vulnerability reproduction was used.

Refs #1073
