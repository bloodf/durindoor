# V5 production acceptance audit (#1300)

Status: **COMPLETE** for the tested checkout. Candidate requested: `31cfbb7d70c1` ([PR #2347](https://github.com/bloodf/durindoor/pull/2347), V5 default). Tested checkout: `78aef4edadc5`. The requested commit exists locally but is not an ancestor of this checkout, so these results do not establish exact-head evidence for `31cfbb7d70c1`.

## Method

Built Storybook with `pnpm run storybook:build`, then ran `tests/unit/v5-route-evidence.browser.test.js` with Chromium, the configured headless shell, dark and light themes, and widths 1440 and 360. The registry has 79 JSON files, 78 distinct surfaces, and 410 story entries (1640 unique story/theme/width cases). Routes were sharded through `V5_EVIDENCE_ROUTES`; timed shards were rerun by surface. Screenshots remain in the ignored `.impeccable/review/v5/production/` directory. The [machine-readable results](./results.json) record each case, axe violation counts by impact, console error count, overflow pixels, and the candidate/tested checkout identifiers.

The gate rejects Storybook render failures, console/page/request errors, serious or critical axe violations, V5 attribute mismatch, and horizontal overflow at 360px.

The combos error stories report 1px of horizontal overflow at 1440px; all 360px cases report 0px and pass the responsive overflow assertion.

## Surface results

`Cases passed` counts story × theme × width cases. Axe column is serious/critical violation count. Overflow is maximum horizontal overflow in pixels across the surface.

| Surface | Stories | Cases passed | Axe S/C | Console errors | Overflow px |
|---|---:|---:|---:|---:|---:|
| `dialog/Modal` | 3 | 12/12 | 0/0 | 0 | 0 |
| `dialog/AddApiKeyModal` | 3 | 12/12 | 0/0 | 0 | 0 |
| `dialog/AddCompatibleModal` | 3 | 12/12 | 0/0 | 0 | 0 |
| `dialog/AddCustomModelModal` | 3 | 12/12 | 0/0 | 0 | 0 |
| `dialog/AddSystemoneCompatibleModal` | 4 | 16/16 | 0/0 | 0 | 0 |
| `dialog/AutoPingScheduleModal` | 5 | 20/20 | 0/0 | 0 | 0 |
| `dialog/BulkImportCodexModal` | 3 | 12/12 | 0/0 | 0 | 0 |
| `dialog/BulkImportGrokCliModal` | 3 | 12/12 | 0/0 | 0 | 0 |
| `dialog/BulkReviewModal` | 2 | 8/8 | 0/0 | 0 | 0 |
| `dialog/CookieImportModal` | 3 | 12/12 | 0/0 | 0 | 0 |
| `dialog/EditCompatibleNodeModal` | 3 | 12/12 | 0/0 | 0 | 0 |
| `dialog/EditConnectionModal` | 5 | 20/20 | 0/0 | 0 | 0 |
| `dialog/ProviderErrorRulesModal` | 4 | 16/16 | 0/0 | 0 | 0 |
| `dialog/VisibleModelsModal` | 3 | 12/12 | 0/0 | 0 | 0 |
| `error/dashboard/providers/[id]` | 1 | 4/4 | 0/0 | 0 | 0 |
| `dialog/CursorAuthModal` | 3 | 12/12 | 0/0 | 0 | 0 |
| `dialog/GheCopilotAuthModal` | 3 | 12/12 | 0/0 | 0 | 0 |
| `dialog/GitLabAuthModal` | 2 | 8/8 | 0/0 | 0 | 0 |
| `dialog/IFlowCookieModal` | 2 | 8/8 | 0/0 | 0 | 0 |
| `dialog/ImportTokenModal` | 2 | 8/8 | 0/0 | 0 | 0 |
| `dialog/KiroAuthModal` | 3 | 12/12 | 0/0 | 0 | 0 |
| `dialog/KiroSocialOAuthModal` | 3 | 12/12 | 0/0 | 0 | 0 |
| `dialog/OAuthModal` | 3 | 12/12 | 0/0 | 0 | 0 |
| `dialog/OrcaRouterAuthModal` | 3 | 12/12 | 0/0 | 0 | 0 |
| `dialog/WebLoginModal` | 3 | 12/12 | 0/0 | 0 | 0 |
| `dialog/XiaomiMimoAuthModal` | 3 | 12/12 | 0/0 | 0 | 0 |
| `dialog/AddCustomEmbeddingModal` | 3 | 12/12 | 0/0 | 0 | 0 |
| `dialog/ChangelogModal` | 3 | 12/12 | 0/0 | 0 | 0 |
| `dialog/ManualConfigModal` | 3 | 12/12 | 0/0 | 0 | 0 |
| `dialog/McpMarketplaceModal` | 4 | 16/16 | 0/0 | 0 | 0 |
| `dialog/PricingModal` | 3 | 12/12 | 0/0 | 0 | 0 |
| `error/dashboard/combos` | 2 | 8/8 | 0/0 | 0 | 0 |
| `error/dashboard/mcp-gateway/keys` | 2 | 8/8 | 0/0 | 0 | 0 |
| `error/dashboard/mcp-gateway` | 2 | 8/8 | 0/0 | 0 | 0 |
| `error/dashboard/mitm` | 1 | 4/4 | 0/0 | 0 | 0 |
| `error/dashboard/pxpipe` | 1 | 4/4 | 0/0 | 0 | 0 |
| `error/dashboard/translator` | 1 | 4/4 | 0/0 | 0 | 0 |
| `dialog/ApiKeyModelAccessModal` | 2 | 8/8 | 0/0 | 0 | 0 |
| `dialog/ComboFormModal` | 2 | 8/8 | 0/0 | 0 | 0 |
| `dialog/ModelSelectModal` | 2 | 8/8 | 0/0 | 0 | 0 |
| `shell` | 19 | 76/76 | 0/0 | 0 | 0 |
| `/callback` | 8 | 32/32 | 0/0 | 0 | 0 |
| `/login` | 16 | 64/64 | 0/0 | 0 | 0 |
| `/dashboard/providers` | 10 | 40/40 | 0/0 | 0 | 0 |
| `/dashboard/providers/[id]` | 23 | 92/92 | 0/0 | 0 | 0 |
| `/dashboard/combos` | 6 | 24/24 | 0/0 | 0 | 1 |
| `/dashboard/usage` | 11 | 44/44 | 0/0 | 0 | 0 |
| `/dashboard/token-saver/settings` | 4 | 16/16 | 0/0 | 0 | 0 |
| `/dashboard/token-saver` | 7 | 28/28 | 0/0 | 0 | 0 |
| `/dashboard/health` | 5 | 20/20 | 0/0 | 0 | 0 |
| `/dashboard/monitoring` | 4 | 16/16 | 0/0 | 0 | 0 |
| `/dashboard/timeline/[id]` | 9 | 36/36 | 0/0 | 0 | 0 |
| `/dashboard/timeline` | 11 | 44/44 | 0/0 | 0 | 0 |
| `/dashboard/console-log` | 4 | 16/16 | 0/0 | 0 | 0 |
| `/dashboard/skills` | 2 | 8/8 | 0/0 | 0 | 0 |
| `/dashboard/translator` | 6 | 24/24 | 0/0 | 0 | 0 |
| `/dashboard/compression-studio` | 3 | 12/12 | 0/0 | 0 | 0 |
| `/dashboard/headroom` | 3 | 12/12 | 0/0 | 0 | 0 |
| `/dashboard/playground` | 3 | 12/12 | 0/0 | 0 | 0 |
| `/dashboard/pxpipe` | 5 | 20/20 | 0/0 | 0 | 0 |
| `/dashboard/endpoint` | 16 | 64/64 | 0/0 | 0 | 0 |
| `/dashboard/keys` | 23 | 92/92 | 0/0 | 0 | 0 |
| `/dashboard/mcp-gateway/keys` | 15 | 60/60 | 0/0 | 0 | 0 |
| `/dashboard/mcp-gateway` | 13 | 52/52 | 0/0 | 0 | 0 |
| `/dashboard/media-providers/combo/[id]` | 3 | 12/12 | 0/0 | 0 | 0 |
| `/dashboard/media-providers/[kind]/[id]` | 6 | 24/24 | 0/0 | 0 | 0 |
| `/dashboard/media-providers/[kind]` | 4 | 16/16 | 0/0 | 0 | 0 |
| `/dashboard/media-providers/web` | 5 | 20/20 | 0/0 | 0 | 0 |
| `/dashboard/media-routes` | 4 | 16/16 | 0/0 | 0 | 0 |
| `/dashboard/auto-configure` | 4 | 16/16 | 0/0 | 0 | 0 |
| `/dashboard/cli-tools/[toolId]` | 6 | 24/24 | 0/0 | 0 | 0 |
| `/dashboard/cli-tools` | 5 | 20/20 | 0/0 | 0 | 0 |
| `/dashboard/mitm` | 3 | 12/12 | 0/0 | 0 | 0 |
| `/dashboard/proxy-pools` | 9 | 36/36 | 0/0 | 0 | 0 |
| `/dashboard/profile` | 13 | 52/52 | 0/0 | 0 | 0 |
| `/dashboard/quota` | 4 | 16/16 | 0/0 | 0 | 0 |
| `/dashboard/settings/database` | 6 | 24/24 | 0/0 | 0 | 0 |
| `/dashboard/settings/pricing` | 3 | 12/12 | 0/0 | 0 | 0 |

Summary: 1640/1640 cases recorded; 0 failing cases, 0 missing cases, 0 unexpected cases.

## Independent review and open items

Independent review found one medium issue: the combos strategy flow could apply a stale settings read after a strategy save. It was fixed with the regression test [v5-int-09-combos.test.js](../../../../tests/unit/v5-int-09-combos.test.js), which checks that an overlapping settings read is ignored.

- Chromium evidence and the independent review satisfy the #1300 UI-review item for the tested integrated checkout.
- Firefox and WebKit runtime evidence remain open under [#1067](https://github.com/bloodf/durindoor/issues/1067).
- The legacy pending Storybook inventory rows (422 source rows and approximately 1,486 references) remain open under #1067.
- S21 legacy removal remains deferred until #1067 acceptance.
- Exact-candidate attribution remains open: the current worktree was at `78aef4edadc5`, not a checkout containing `31cfbb7d70c1`.
