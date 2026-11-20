# #1073: May 2026 OmniRoute merged-source scope

Reviewed 2026-11-20. Source: [`cheaper-inference/OmniRoute`](https://github.com/cheaper-inference/OmniRoute), against the public repository state available during this review. This is a bounded source-scope reconciliation, not a completion ledger.

Gate: Heitor's orq gate supersedes the older HOLD and independent receipt rules for this work. Review was read-only; no product code, tests, credentials, provider calls, paid API, Docker, browser, or e2e activity. Bulk search results were kept in `/tmp/omni-may-2026-search.json` and are not part of this change. No owner selection list was produced.

## Window and method

GitHub Search was queried in four non-overlapping merged-date windows for `repo:cheaper-inference/OmniRoute is:pr is:merged`:

| Merged window (UTC date) | Results |
| --- | ---: |
| 2026-05-01..2026-05-07 | 80 |
| 2026-05-08..2026-05-14 | 114 |
| 2026-05-15..2026-05-21 | 130 |
| 2026-05-22..2026-05-31 | 289 |
| **Total** | **613** |

The counts reconcile to the verified May query total of **613**. Search metadata (PR number, title, merge date, body) was used to navigate; selected candidates' final file lists and head/merge SHAs were checked through the pull request API. File names and titles alone were not treated as evidence of applicability. Local conclusions below are limited to static source presence and documented local reports; they are not claims that the upstream implementation was ported verbatim.

The #1073 issue body describes a separate 2026-10-08 archive of 15,357 records (8,409 merged PRs). Its cut-off predates these May 2026 PRs, so it cannot provide a May denominator or May port mapping. Its title/domain navigation aids are not applicability findings.

## Confirmed local defensive behavior relevant to reviewed fixes

| OmniRoute source | Source evidence | Local static evidence and disposition |
| --- | --- | --- |
| [#2595](https://github.com/cheaper-inference/OmniRoute/pull/2595), merged `901827df7f03ae51b00a521a5076b4b041948741`, head `ce384c89d41d3362a59236c4429d647eb86279fe` | Final file list changes `src/shared/network/outboundUrlGuard.ts`; title identifies DB feature-flag override in private-URL policy. | Local `open-sse/utils/outboundUrlGuard.js` is the outbound URL policy surface. The source fix is relevant to a concrete security boundary, but this review did not compare the full upstream diff to local policy branches. **No missing behavior is asserted; retain as a scoped follow-up until a line-level diff comparison establishes equivalence or an exact gap.** Acceptance: compare the final source diff to all local private-URL policy branches, including stored DB override, defaults and both callers; record the exact predicate and evidence for each branch. Any gap requires regression coverage proving the override cannot enable private targets contrary to the local policy.
| [#2718](https://github.com/cheaper-inference/OmniRoute/pull/2718), merged `ac76863deda9916f72e69607ef2f7136b6dd4263`, head `5c06b52a1b039c05d9c118451372d2597074df77` | Final paths include token refresh, Codex auth import, provider refresh/test routes, and race/error tests. | The local tree has `open-sse/services/tokenRefresh.js` and Codex auth handling, plus serializer/report evidence elsewhere in this worktree. Presence of related files does not prove the upstream race/property. **Exact parity remains unverified.** Acceptance: map changed upstream refresh critical section and account identity to local lifecycle paths; demonstrate concurrent refresh cannot rotate/revoke another account's token family, with deterministic race coverage over the affected entry points.
| [#2828](https://github.com/cheaper-inference/OmniRoute/pull/2828), merged `f1eb08c7b501c7d9691cb6bfde6e94d1dd911dca`, head `c791af7db3b3c6990a9111522e02a976c9de9cb6` | Final paths include Antigravity request/response normalization, stream utilities, sanitizer, and 429 classification. | Local static tree contains corresponding Antigravity and stream handling. This PR is a concrete protocol/provider hardening candidate, but the upstream final diff was not line-mapped to local behavior in this bounded review. **Do not infer parity from shared path names.** Acceptance: inspect each changed branch against local format conversion and resource-exhaustion classification; identify any observable request/response or retry difference and require focused offline protocol assertions for only that difference.
| [#2923](https://github.com/cheaper-inference/OmniRoute/pull/2923), merged `a800dc8e2e1f2375a19e51e274cb3ff9457e1495`, head `49ed952710c3f1399611afee15f220404e084282` | Final paths include `open-sse/utils/proxyFetch.ts`, chat/combo model parsing, and a focused dispatcher retry test. | Local `open-sse/utils/proxyFetch.js` is the corresponding transport boundary; prior #1073 evidence also establishes existing defensive proxy dispatch behavior. The exact non-string `error.code` and retry conditions were not compared here. **No additional gap is confirmed.** Acceptance: map guards and retry/fallback ordering from the final diff to local dispatcher error normalization, ensuring one bounded retry and unchanged native fallback; add a focused offline test only for any demonstrated discrepancy.
| [#2941](https://github.com/cheaper-inference/OmniRoute/pull/2941), merged `697946381d571b410810f8d107819ec4fc492ccc`, head `c0b2c41eb2c1860cdf8e0198b477dd3dc1971e03` | Final paths add `refreshSerializer` and alter chat/token refresh; title explicitly identifies Codex multi-account refresh-token family revocation. | Local tree has `open-sse/services/refreshSerializer.js` and token refresh use. This strongly matches a sensitive race boundary, but is not enough to claim source-to-local semantic equivalence. **Exact account-family isolation remains unverified by this audit.** Acceptance: trace serialization keys and refresh-token replacement across all Codex refresh entry points; deterministic two-account interleaving must show each account retains only its own token family and no retry can revoke the other account.

These candidates are not a finding that fixes are absent: local matching modules and the final source paths establish where to review, while this report deliberately avoids claiming parity without an exact diff-to-behavior match. Existing local source and port reports should be consulted before any new implementation ticket.

## Exclusions and unresolved inventory

The May search includes many release bundles, new providers and model catalogs, dashboards, CLI/product features, endpoints/integrations, and OAuth/sign-in flow work. These are outside this order and were excluded; no applicability judgment is made for them. This also excludes title-only candidates whose final source change was not inspected. Fork PRs or local commit titles are not treated as proof of an OmniRoute source mapping unless their actual port maps to the upstream record.

Dependency-security records remain unresolved where the review did not establish the affected local package/version, lockfile entry, or patch state. Do not close these as inapplicable based on a title or dependency name. Acceptance: obtain the upstream advisory/PR's affected range and patched version from its final source metadata; map that package to the local manifest and lockfile, establish the installed/resolved version and any backport, then record either a concrete unaffected/mitigated disposition or the exact vulnerable dependency path and required remediation. No dependency was installed or modified for this audit.

## Explicit verification limits

This review verifies the four date-slice counts and final source file lists for the five selected candidates above. It does **not** line-review all 613 merged PR diffs, classify every record as applicable/inapplicable, reconcile every source PR to a fork merge, audit every May dependency update, or establish current upstream state for all candidates. The five listed candidates are review targets with exact acceptance criteria, not a complete May backlog. No claim is made that the remaining records are unported, unsafe, or out of scope.
