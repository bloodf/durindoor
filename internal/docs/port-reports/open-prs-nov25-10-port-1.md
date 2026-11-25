# Port report — open PR batch 10, port candidates 1–8

Scope: port candidates 1–8 of [the batch 10 dispositions](open-prs-nov25-10.md), counted over port-candidate rows in table order. That report has only one port-candidate row (395), so this unit has one source row. On 2026-11-25 the current head SHA matched the one in that report.

| Row | PR | Final disposition | Evidence |
|---:|---|---|---|
| 395 | [#4025](https://github.com/decolua/9router/pull/4025) | ported in this change | Neither half had landed: no commit mentioned #4025. The source row says prompt-cache usage was already recognized, but [the usage mapper](../../../open-sse/translator/concerns/usage.js) returned only prompt, completion and total counts for CommandCode. It now passes cached and reasoning counts through as details, without adding them to the totals ([cache usage](../../../tests/unit/port9r-commandcode-cache-usage-4025.test.js)). The quota gap is closed by [the CommandCode usage reader](../../../open-sse/services/usage/commandcode.js), registered in [the usage dispatcher](../../../open-sse/services/usage.js) and enabled in [the registry](../../../open-sse/providers/registry/commandcode.js) ([quota](../../../tests/unit/commandcode-usage.test.js)). |

## Differences from the upstream diff

- Requests reuse the registry CLI headers instead of a second hard-coded client version.
- Each read refuses redirects and has one 10-second deadline for headers and body. A failed optional read does not drop the other rows. Upstream error bodies are not copied into messages.
- Billing-period and subscription reads both use the organization scope from `whoami`; upstream leaves the subscription read unscoped.
- A window without a cap produces no row. A month without a remaining balance produces no row, and so does a month without period spend when the plan has no known cap. Upstream would show these as exhausted or untouched.
- Credit amounts are numbers rounded to two decimals, not upstream's preformatted strings, because [account grouping](<../../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/grouping.js>) sums only numeric rows.
- No `commandcode` case was added to the dashboard parser. Its generic branch already keeps `remainingPercentage`, which the quota test checks.

## Related follow-on: OmniRoute #20347

[The earlier disposition](1073-20895-train-e2.md) marked [OmniRoute #20347](https://github.com/cheaper-inference/OmniRoute/pull/20347) (Command Code plan aliases and credit caps) not applicable only because no usage reader existed. [The pin test](../../../tests/unit/omni-nov21-provider-usage-plans.test.js) asks whoever adds one to port that behaviour, so it is ported here in its own commit. Short plan ids resolve to canonical ids, and a known cap sizes the monthly row. Purchased and free credits stay out of that row, which covers only the monthly allowance. Upstream's combined credits row and plan display names were not adopted.

The pin test's expectation changed on purpose: `commandcode` now has a usage handler and feature flags, so it left that list. The separate `command-code` provider and `mistral` are still pinned without one; #4025 does not cover `command-code`.

## Not verified

No live Command Code call was made and no credentials were used. The endpoint shapes come from the two upstream changes and their offline fixtures. The plan caps are copied from OmniRoute and were not checked against Command Code billing.

Totals: 1 ported in this change, 0 already present, 0 not applicable. None remaining.
