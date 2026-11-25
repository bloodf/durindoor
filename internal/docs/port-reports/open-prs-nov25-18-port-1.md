# Open upstream PR ports, report 18, batch 1

Source: [report 18](open-prs-nov25-18.md), port-candidate rows 1–8 in table order. All are `decolua/9router` PRs. Heads match the report's pinned SHAs. Each was compared with this branch before any change.

| Row | PR | Disposition | Evidence |
|---:|---|---|---|
| 682 | #2699 | Already present | Commit `8ac6283c16a` ported it. [nodeFlags.js](../../../cli/hooks/nodeFlags.js) puts `--dns-result-order=ipv4first` first for both server spawns, and [cli.js](../../../cli/cli.js) passes it to the tray child. [cli-dns-order-2699.test.js](../../../tests/unit/cli-dns-order-2699.test.js) covers it. |
| 684 | #2691 | Already present | [azure.js](../../../open-sse/executors/azure.js) normalizes reasoning deployments and calls the shared rename in [paramSupport.js](../../../open-sse/translator/concerns/paramSupport.js). A temporary probe ran every model id in the upstream test through `AzureExecutor.transformRequest`: the reasoning ids sent `max_completion_tokens`, the other ids kept `max_tokens`, and an explicit modern limit won. |
| 689 | #2672 | Ported in this change | The report row understated what existed: [xaiQuotaAdapter.js](../../../src/lib/usage/xaiQuotaAdapter.js) already read OAuth billing. The usage route (`src/app/api/usage/[connectionId]/route.js`) returned early for xAI, so the dashboard never showed it, and the plan name was never read. The route now merges billing quotas and the subscription plan, through the connection's proxy policy. [Test](../../../tests/unit/xai-oauth-account-quota-2672.test.js). The generic dashboard parser already forwards `remainingPercentage`, so xAI was not moved to the Grok CLI parser. |
| 690 | #2668 | Not applicable | A new portable-export feature rather than a fix. [Usage and quota](../../../docs/guides/usage-and-quota.mdx) states that the downloaded backup deliberately leaves out request usage history and points to an engine-level backup. [db/index.js](../../../src/lib/db/index.js) has no `usageHistory`, `usageDaily` or `usageMeta` export keys; it keeps per-key totals and event receipts, and keeps local history on restore. Adding raw history would also work against the 16 MiB import limit in [quota.js](../../../src/shared/constants/quota.js), and upstream's two-table copy does not cover the local rollups. Taking this on is a product decision. |
| 696 | #2647 | Ported in this change (residual gaps only) | New [grokCliResponsesCompat.js](../../../open-sse/executors/grokCliResponsesCompat.js): developer to system, Codex metadata removal, call/output pairing, string or typed outputs, valid JSON arguments, search-tool dedupe, a 200-tool cap that keeps hosted and selected tools, and `tool_choice` normalization. `max` effort is sent as `xhigh`, and native X search history is no longer converted. [Test](../../../tests/unit/grok-cli-responses-history-2647.test.js). See the differences below. |
| 703 | #2589 | Not applicable | The lifecycle coupling pairs MITM with a WARP `wireproxy` sidecar (proxy re-egress). `src/lib/network/wireproxyLifecycle.js`, `warpHealth.js`, `proxyDispatcher.js` and `strictProxyPolicy.js` are absent, and this checkout has no sidecar to couple. The rest of the head is a bulk fork dump. [proxyFetch.js](../../../open-sse/utils/proxyFetch.js) already fails closed under strict proxy and rethrows caller aborts before any direct fallback. |
| 707 | #2554 | Ported in this change (residual gap only) | REST bootstrap, ETag polling and a silence watchdog already existed, which the report row missed. `onopen` disarmed the watchdog, so a tunnel that forwarded headers but buffered events stayed silent. Only a first event disarms it now, in the console transport (`src/app/(dashboard)/dashboard/console-log/transport.js`). [Test](../../../tests/unit/console-log-open-silent-stream-2554.test.js). |
| 709 | #2550 | Ported in this change | [circularCombos.js](../../../src/shared/utils/circularCombos.js) finds the edited combo and every combo that reaches it. [ModelSelectModal.js](../../../src/shared/components/ModelSelectModal.js) disables those choices, and keeps an already added one removable. Both combo form modals pass the context. The server's save-time cycle check is unchanged. [Test](../../../tests/unit/combo-picker-circular-2550.test.js). |

## #2647 behaviour deliberately not taken

- Foreign reasoning items stay, without their ciphertext. Upstream drops the whole item.
- Unknown input item, role, content and tool types pass through. Upstream returns a local 400.
- Request headers, per-account agent ids and request-id reuse are unchanged.
- `instructions` stays a top-level field, and the request is not rebuilt from a new allowlist. `text` and `web_search` options keep their current handling.
- An orphan tool output becomes user text instead of being dropped.
- A real output separated from its call by another item stays paired. Upstream repairs each contiguous run on its own.

## Test changes

[xai-supergrok-quota-route.test.js](../../../tests/unit/xai-supergrok-quota-route.test.js) gained a quota-adapter stub so the new billing read cannot reach a live host. Its assertions are unchanged. No failure baseline entry was added.

All checks were offline. No live xAI, Grok or Azure request was made, so provider acceptance of the repaired Grok CLI wire and of the profile read is unverified. The combo picker and console fallback were not checked in a real browser.
