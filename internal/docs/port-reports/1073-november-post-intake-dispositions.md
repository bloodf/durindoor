# #1073 November OmniRoute merged intake: post-intake dispositions

Reconciled 2026-11-20 against current DurinDoor `febfba612e86c920971ec39ef9cdbc63421ab53e`, the original survey comment [7022476221](https://github.com/bloodf/durindoor/issues/1073#issuecomment-7022476221), and comments on [#1073](https://github.com/bloodf/durindoor/issues/1073). This is a targeted disposition audit, not a claim that every upstream diff was read.

## Inventory correction

Re-querying `repo:cheaper-inference/OmniRoute is:pr is:merged` on the fixed merge dates 2026-11-01 through 2026-11-19, in date shards below GitHub's 1,000-result search limit, returned **886** records: Nov 1–7: 409; Nov 8–14: 369; Nov 15–19: 108. The dated survey counted 874. Treat its title/size triage and grouped “import/maybe/skip” recommendations as leads, not applicability verdicts; the 12-record difference is an inventory correction, not 12 established fixes. Bulk query metadata was kept outside the repository.

## Post-intake dispositions

Landed #1073 comments and current local reports supersede several survey-era open leads:

| Source | Current disposition and evidence |
| --- | --- |
| [OmniRoute #20610](https://github.com/cheaper-inference/OmniRoute/pull/20610) | Ported in DurinDoor #2085. `1073-empty-stream-terminal.md` records terminal ordering and offline coverage. |
| [OmniRoute #20095](https://github.com/cheaper-inference/OmniRoute/pull/20095) | Existing Antigravity-specific retry policy; its separate generic retry loop is outside the existing contract. See `1073-event-stream-boundaries.md` and `1073-empty-stream-terminal.md`. |
| [OmniRoute #18312](https://github.com/cheaper-inference/OmniRoute/pull/18312) | The survey called out unsafe replay as high value. Current `open-sse/executors/base.js` owns retry policy and the tests in `tests/unit/base-executor-retry.test.js` and `tests/unit/cohere-422-transport-budget.test.js` cover replay bounds, cancellation and transport budgets. The available evidence does not establish a remaining distinct replay defect to port. |
| [OmniRoute #19225](https://github.com/cheaper-inference/OmniRoute/pull/19225), [#19248](https://github.com/cheaper-inference/OmniRoute/pull/19248), [#19107](https://github.com/cheaper-inference/OmniRoute/pull/19107), [#20553](https://github.com/cheaper-inference/OmniRoute/pull/20553) | The survey grouped these as resolved-address and search-hop SSRF work. Current `open-sse/utils/outboundUrlGuard.js`, `open-sse/utils/proxyFetch.js`, `open-sse/handlers/search/`, and the port report `1073-search-credential-destination.md` show guarded outbound resolution and per-hop search credential destination policy. DurinDoor #2084/#2088 comments record the applicable search changes. No additional missing fix was verified in this targeted pass. |
| [OmniRoute #19109](https://github.com/cheaper-inference/OmniRoute/pull/19109) | Settings authentication and PII controls are already covered by this fork's settings authorization and masking guardrails. The survey's title-level note does not identify an unaddressed route; no new auth flow is proposed. |
| [OmniRoute #19575](https://github.com/cheaper-inference/OmniRoute/pull/19575) | Follow-up landed with DurinDoor #2088: snapshot text ordering and established Antigravity tool IDs are preserved. See `1073-responses-text-and-native-content.md` and its focused offline tests. |
| [OmniRoute #12620](https://github.com/cheaper-inference/OmniRoute/pull/12620) | Applicable search credential destination policy landed in #2084 and redirect-hop follow-up in #2088. The Bifrost relay portion is inapplicable because this fork has no affected relay. See `1073-search-credential-destination.md`. |

The two precise pending defects recorded in earlier post-intake audits are resolved by the linked #2085/#2088 dispositions. Other candidates from the old survey remain outside this report's applicability set where they require new providers, features, endpoints, integrations, dashboard scope, distribution behavior, or sign-in/auth flows. No additional verifiable missing fix with a source SHA, local module seam, and offline acceptance case was established from the inspected evidence. This is a bounded result: it does not assert diff-level review of all 886 records.

Existing provider corrections and protocol boundaries remain recorded in `1073-existing-provider-request-residuals.md`, `1073-event-stream-boundaries.md`, `1073-tool-schema-and-error-classification.md`, and the linked search/Responses reports. Preserve those landed changes; do not reopen their survey recommendation rows as fresh selections.

Refs #1073
