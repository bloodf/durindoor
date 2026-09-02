# Page map

> Authoritative table for the migration campaign. Every real dashboard
> route (and the one `/dashboard/settings/pricing` route outside the
> `(dashboard)` group) maps to exactly one DS mock or to "no mock — port
> from closest pattern". The status column starts at `pending`; flip
> to `migrated` when the matching PR merges.

## Real route → mock → DS components

| # | Route path | Real page file | DS mock dir | DS components consumed | Risk | Special notes | Status |
| - | --- | --- | --- | --- | --- | --- | --- |
| 1 | `/dashboard/api-docs` | `src/app/(dashboard)/dashboard/api-docs/page.js` | `src/shared/ui/pages/api-docs/ApiDocsPage.jsx` | `PageHeader`, `Card`, `CardContent` | low | Static, server-rendered | pending |
| 2 | `/dashboard/mcp-help` | `src/app/(dashboard)/dashboard/mcp-help/page.js` | `src/shared/ui/pages/mcp-help/McpHelpPage.jsx` | `PageHeader`, `Card`, `Tabs` (if expanded), `Code`-like blocks (no DS wrapper; use `bg-dd-surface-2 font-mono rounded-dd p-3`) | low | Static help text; 0 native selects in real file | pending |
| 3 | `/dashboard/health` | `src/app/(dashboard)/dashboard/health/page.js` | `src/shared/ui/pages/health/HealthPage.jsx` | `PageHeader`, `StatCard`, `Card`, `CardHeader`, `CardContent`, `DataTable` + `pagination`, `StatusDot`, `Badge`, `ProviderLogo`, `Button` | low | Worked example in [`playbook.md`](./playbook.md) | pending |
| 4 | `/dashboard/skills` | `src/app/(dashboard)/dashboard/skills/page.js` | `src/shared/ui/pages/skills/SkillsPage.jsx` | `PageHeader`, `Card`, `Input`, `Select`, `Button` (copy-state), `Tabs` | low | Static catalog; copy-to-clipboard feedback | pending |
| 5 | `/dashboard/endpoint` | `src/app/(dashboard)/dashboard/endpoint/page.js` + `EndpointPageClient.jsx` | `src/shared/ui/pages/endpoint/EndpointPage.jsx` | `PageHeader`, `Card`, `Input`, `Select`, `Button`, `DataTable` + `pagination`, `ConfirmDialog`, `PromptDialog` | medium | Native `<select>` × 2 in `EndpointPageClient.jsx:1306,1583` | pending |
| 6 | `/dashboard/cli-tools` | `src/app/(dashboard)/dashboard/cli-tools/page.js` + `CLIToolsPageClient.js` | `src/shared/ui/pages/cli-tools/CliToolsPage.jsx` | `PageHeader`, `Card`, `Tabs`, `Select`, `Input`, `Button`, `PromptDialog`, `ConfirmDialog` | medium | `window.prompt` × 2 (`cli-tools/components/BaseUrlSelect.js:107`, `EndpointPresetControl.js:70`); native `<select>` × 2 in same files; `MitmModelMappingRow.js:49`, `ClaudeToolCard.js:359` | pending |
| 6b | `/dashboard/cli-tools/[toolId]` | `src/app/(dashboard)/dashboard/cli-tools/[toolId]/page.js` | no mock | `PageHeader`, `Card`, `Input`, `Button` | medium | Port pattern from `cli-tools` mock | pending |
| 7 | `/dashboard/combos` | `src/app/(dashboard)/dashboard/combos/page.js` | `src/shared/ui/pages/combos/CombosPage.jsx` | `PageHeader`, `Card`, `DataTable` + `pagination`, `StatusDot`, `Badge`, `Modal` (`ComboFormModal` — keep in `src/shared/components/` as domain modal; the modal chrome is `bg-dd-surface rounded-dd-lg border border-dd-border`), `Button` | medium | CRUD + table; `ComboFormModal` is a domain modal, not a generic one | pending |
| 8 | `/dashboard/providers` | `src/app/(dashboard)/dashboard/providers/page.js` | `src/shared/ui/pages/providers/ProvidersPage.jsx` | `PageHeader`, `Card`, `ProviderLogo`, `Toggle`, `StatusDot`, `Badge`, `Select`, `Input`, `Button`, `StatCard` | medium | Hex literals in `providers/page.js` (`#10A37F`, `#D97757`) and `providers/components/ModelAvailabilityBadge.js` (`#22c55e`, `#f59e0b`, `#ef4444`, `#6b7280`) — replace with `var(--dd-success)` / `var(--dd-warning)` / `var(--dd-danger)` / `var(--dd-muted)` | pending |
| 9 | `/dashboard/providers/[id]` | `src/app/(dashboard)/dashboard/providers/[id]/page.js` | no mock | `PageHeader`, `Card`, `Tabs`, `Modal`, `Input`, `Select`, `Button`, `Toggle`, `Badge`, `ProviderLogo` | medium | Native `<select>` × 2 in `page.js:1647,2035`; `AddCustomModelModal.js:246`; hex literals in `CompatibleModelsSection.js:...` (`#f97316`); heavy OAuth modal surface — keep domain modals (`OAuthModal`, `KiroAuthModal`, `KiroOAuthWrapper`, `KiroSocialOAuthModal`, `CursorAuthModal`, `ImportTokenModal`, `IFlowCookieModal`, `GitLabAuthModal`, `EditConnectionModal`) | pending |
| 10 | `/dashboard/mcp-gateway` | `src/app/(dashboard)/dashboard/mcp-gateway/page.js` | `src/shared/ui/pages/mcp-gateway/McpGatewayPage.jsx` | `PageHeader`, `Card`, `DataTable` + `pagination`, `Badge`, `Button`, `PromptDialog`, `ConfirmDialog`, `Input` | medium | `window.prompt` × 1 at `mcp-gateway/page.js:237` | pending |
| 11 | `/dashboard/console-log` | `src/app/(dashboard)/dashboard/console-log/page.js` + `ConsoleLogClient.js` | `src/shared/ui/pages/console-log/ConsoleLogPage.jsx` | `PageHeader`, `Card`, `Tabs`, `StatusDot`, `Badge`, `Select`, `Input`, `Button` | medium | Native `<select>` × 1 in `ConsoleLogClient.js:111` | pending |
| 12 | `/dashboard/proxy-pools` | `src/app/(dashboard)/dashboard/proxy-pools/page.js` | `src/shared/ui/pages/proxy-pools/ProxyPoolsPage.jsx` | `PageHeader`, `Card`, `DataTable` + `pagination`, `Badge`, `StatusDot`, `Button`, `ConfirmDialog` | medium | Card list / table | pending |
| 13 | `/dashboard/headroom` | `src/app/(dashboard)/dashboard/headroom/page.js` + `HeadroomClient.js` | `src/shared/ui/pages/headroom/HeadroomPage.jsx` | `PageHeader`, `StatCard`, `Card`, `DataTable` + `pagination`, `Toggle`, `Button` | medium | Read-only metrics + settings toggle | pending |
| 14 | `/dashboard/usage` | `src/app/(dashboard)/dashboard/usage/page.js` | `src/shared/ui/pages/usage/UsagePage.jsx` | `PageHeader`, `RangeSelector`, `StatCard`, `DataTable` + `pagination` (×3 tables: per-key, per-provider, recent), `Drawer`, `KeyValue`, `LineChart` (Recharts; primary `var(--dd-accent)`, secondary `var(--dd-accent-2)`) | medium-high | Hex literals in `usage/components/UsageChart.js` (`#6366f1`, `#f59e0b`) — replace with `var(--dd-accent)`, `var(--dd-accent-2)`; native `<select>` in `usage/page.js:186`; native `<select>` in `RequestDetailsTab.js:233`; `usage/components/ProviderLimits/index.js` has hex color map (`#000000`/`#4285F4`/`#10A37F`/`#FF9900`/`#EC4899`/`#D97757`/`#6B7280`) and native `<select>` × 3 (`1427,1441,1840`) — replace with `ProviderLogo` where possible | pending |
| 15 | `/dashboard/timeline` | `src/app/(dashboard)/dashboard/timeline/page.js` | `src/shared/ui/pages/timeline/TimelinePage.jsx` | `PageHeader`, `Select`, `Toggle`, `Drawer`, `KeyValue`, `DataTable` + `pagination` | medium-high | Live area chart + filters + `Drawer`; mock owns the filter-to-data flow | pending |
| 16 | `/dashboard/timeline/[id]` | `src/app/(dashboard)/dashboard/timeline/[id]/page.js` | no mock | `PageHeader`, `Card`, `DataTable` + `pagination` | medium-high | Port from `pages/timeline/TimelinePage.jsx`; deeper sub-row view | pending |
| 17 | `/dashboard/quota` | `src/app/(dashboard)/dashboard/quota/page.js` | `src/shared/ui/pages/quota/QuotaPage.jsx` | `PageHeader`, `Card`, `StatCard`, `DataTable` + `pagination`, `StatusDot`, `Badge` | medium | Multi-provider cards | pending |
| 18 | `/dashboard/token-saver` | `src/app/(dashboard)/dashboard/token-saver/page.js` + `TokenSaverClient.jsx` (`view="overview"`) | `src/shared/ui/pages/token-saver/TokenSaverStatsPage.jsx` | `PageHeader`, `StatCard`, `Card`, `DataTable` + `pagination`, `Tabs`, `RangeSelector` | medium-high | Stats + per-tool breakdown; token-saver suite is large | pending |
| 19 | `/dashboard/token-saver/settings` | `src/app/(dashboard)/dashboard/token-saver/settings/page.js` (reuses `TokenSaverClient.jsx` with `view="settings"`) | `src/shared/ui/pages/token-saver-settings/SettingsPage.jsx` | `PageHeader`, `Card`, `Toggle`, `Input`, `Select`, `Button` | medium | Same client file, different view — restructure inside `TokenSaverClient.jsx` so the `view` switch uses DS components on each branch | pending |
| 20 | `/dashboard/compression-studio` | `src/app/(dashboard)/dashboard/compression-studio/page.js` | `src/shared/ui/pages/test-savers/TestSaversPage.jsx` | `PageHeader`, `Tabs`, `Card`, `Select`, `Input`, `Button` | medium | Diff viewer; mock uses tabs heavily | pending |
| 21 | `/dashboard/playground` | `src/app/(dashboard)/dashboard/playground/page.js` + `PlaygroundPageClient.js` | `src/shared/ui/pages/playground/PlaygroundPage.jsx` | `PageHeader`, `Card`, `Select`, `ProviderLogo`, `Input`, `Textarea`, `Button`, `Tabs`, `StatCard` | high | Composer, model picker, SSE preview; large client; native select usage to verify | pending |
| 22 | `/dashboard/profile` | `src/app/(dashboard)/dashboard/profile/page.js` | `src/shared/ui/pages/settings/SettingsPage.jsx` | `PageHeader`, `Tabs`, `Card`, `Input`, `Select`, `Toggle`, `Button` | medium | Native `<select>` in `profile/page.js:1354`; ThemeProvider consumers | pending |
| 23 | `/dashboard/media-providers/[kind]` | `src/app/(dashboard)/dashboard/media-providers/[kind]/page.js` | `src/shared/ui/pages/media-providers/MediaProvidersPage.jsx` | `PageHeader`, `Card`, `ProviderLogo`, `DataTable` + `pagination`, `Badge`, `Button`, `Modal` (keep `AddCustomEmbeddingModal` as domain modal) | medium-high | Mock only covers `embedding` (`activePath: /dashboard/media-providers/embedding`); port pattern to other kinds (`tts`, `stt`, `image`, `realtime`) | pending |
| 24 | `/dashboard/media-providers/[kind]/[id]` | `src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/page.js` | no mock | `PageHeader`, `Card`, `Input`, `Select`, `Button`, `Tabs`, `Textarea` | high | 5 native `<select>` across 4 sub-components: `SttExampleCard.js:112,226`, `EmbeddingExampleCard.js:117`, `TtsExampleCard.js:270,288,386,424`, `GenericExampleCard.js:232,289,402,435`; hex in `localEmbeddingResolver.js` and `page.js` (`#6366F1`) | pending |
| 25 | `/dashboard/media-providers/combo/[id]` | `src/app/(dashboard)/dashboard/media-providers/combo/[id]/page.js` | no mock | `PageHeader`, `Card`, `DataTable` + `pagination` | high | Port from the `[kind]` mock | pending |
| 26 | `/dashboard/media-providers/web` | `src/app/(dashboard)/dashboard/media-providers/web/page.js` | no mock | `PageHeader`, `Card`, `Input`, `Button` | medium | Port from the `[kind]` mock | pending |
| 27 | `/dashboard/auto-configure` | `src/app/(dashboard)/dashboard/auto-configure/page.js` + `AutoConfigureClient.js` | no mock | `PageHeader`, `Card`, `Select`, `Input`, `Button`, `StatCard` | medium | Hex in `AutoConfigureClient.js`; port from closest pattern | pending |
| 28 | `/dashboard/translator` | `src/app/(dashboard)/dashboard/translator/page.js` | no mock | `PageHeader`, `Card`, `Input`, `Textarea`, `Button` | medium | Hex literals in `translator/page.js`; port from closest pattern | pending |
| 29 | `/dashboard/pxpipe` | `src/app/(dashboard)/dashboard/pxpipe/page.js` + `PxpipeClient.js` | no mock | `PageHeader`, `Card`, `Input`, `Button`, `StatusDot` | medium | Port from closest pattern | pending |
| 30 | `/dashboard/mitm` | `src/app/(dashboard)/dashboard/mitm/page.js` + `MitmPageClient.js` | no mock | `PageHeader`, `Card`, `Input`, `Select`, `Button`, `DataTable` + `pagination` | medium | Port from closest pattern | pending |
| 31 | `/dashboard/settings/pricing` | `src/app/dashboard/settings/pricing/page.js` (note: outside the `(dashboard)` group) | no mock | `PageHeader`, `Card`, `Button`, `Modal` (`PricingModal` — keep as domain modal) | low | Pricing flow; small surface | pending |
| - | `/dashboard` (root) | `src/app/(dashboard)/dashboard/page.js` | n/a | n/a | n/a | No-op (`redirect("/dashboard/usage")`); skip | n/a |

## Native `<select>` call sites in `src/app/**` (replace with `Select`)

Source: `grep -rn "<select" src/app`. Migration PRs MUST replace every
entry. The only allowed exception is the rows-per-page control that
`Pagination` renders internally in `src/shared/ui/components/Pagination.jsx`
— the DS `Pagination` already owns it.

| File | Line | Owner route |
| --- | --- | --- |
| `src/app/(dashboard)/dashboard/cli-tools/components/BaseUrlSelect.js` | 156 | `/dashboard/cli-tools` |
| `src/app/(dashboard)/dashboard/cli-tools/components/ClaudeToolCard.js` | 359 | `/dashboard/cli-tools/[toolId]` |
| `src/app/(dashboard)/dashboard/cli-tools/components/EndpointPresetControl.js` | 96 | `/dashboard/cli-tools` |
| `src/app/(dashboard)/dashboard/cli-tools/components/MitmModelMappingRow.js` | 49 | `/dashboard/mitm` |
| `src/app/(dashboard)/dashboard/console-log/ConsoleLogClient.js` | 111 | `/dashboard/console-log` |
| `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.jsx` | 1306, 1583 | `/dashboard/endpoint` |
| `src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/components/EmbeddingExampleCard.js` | 117 | `/dashboard/media-providers/[kind]/[id]` |
| `src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/components/GenericExampleCard.js` | 232, 289, 402, 435 | `/dashboard/media-providers/[kind]/[id]` |
| `src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/components/SttExampleCard.js` | 112, 226 | `/dashboard/media-providers/[kind]/[id]` |
| `src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/components/TtsExampleCard.js` | 270, 288, 386, 424 | `/dashboard/media-providers/[kind]/[id]` |
| `src/app/(dashboard)/dashboard/profile/page.js` | 1354 | `/dashboard/profile` |
| `src/app/(dashboard)/dashboard/providers/[id]/AddCustomModelModal.js` | 246 | `/dashboard/providers/[id]` |
| `src/app/(dashboard)/dashboard/providers/[id]/page.js` | 1647, 2035 | `/dashboard/providers/[id]` |
| `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js` | 1427, 1441, 1840 | `/dashboard/usage` |
| `src/app/(dashboard)/dashboard/usage/components/RequestDetailsTab.js` | 233 | `/dashboard/usage` |
| `src/app/(dashboard)/dashboard/usage/page.js` | 186 | `/dashboard/usage` |

## `window.prompt` / `window.confirm` / `confirm(` call sites in `src/app/**`

Source: `grep -rEn "(window\.prompt|window\.confirm|confirm\(|\bprompt\()" src/app`.
Replace `window.prompt` / bare `prompt(` with `PromptDialog`; replace
`window.confirm` / bare `confirm(` with `ConfirmDialog`. The 6 sites
below are the complete list as of the campaign start.

| File | Line | Replacement | Owner route |
| --- | --- | --- | --- |
| `src/app/(dashboard)/dashboard/cli-tools/components/BaseUrlSelect.js` | 107 | `PromptDialog` | `/dashboard/cli-tools` |
| `src/app/(dashboard)/dashboard/cli-tools/components/EndpointPresetControl.js` | 70 | `PromptDialog` | `/dashboard/cli-tools` |
| `src/app/(dashboard)/dashboard/mcp-gateway/page.js` | 237 | `PromptDialog` | `/dashboard/mcp-gateway` |
| `src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/page.js` | 25 | `ConfirmDialog` | `/dashboard/media-providers/[kind]/[id]` |
| `src/app/(dashboard)/dashboard/media-providers/combo/[id]/page.js` | 164 | `ConfirmDialog` | `/dashboard/media-providers/combo/[id]` |
| `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js` | 885 | `ConfirmDialog` | `/dashboard/usage` |

## Mock ↔ route mismatches

### Routes without mocks (port pattern from closest)

- `/dashboard` (root, redirect — skip).
- `/dashboard/cli-tools/[toolId]` — port from `pages/cli-tools/CliToolsPage.jsx`.
- `/dashboard/providers/[id]` — port from `pages/providers/ProvidersPage.jsx`.
- `/dashboard/timeline/[id]` — port from `pages/timeline/TimelinePage.jsx`.
- `/dashboard/media-providers/[kind]` for `kind != "embedding"` (`tts`,
  `stt`, `image`, `realtime`) — mock only declares `embedding` in its
  `activePath`. Port pattern from the same mock.
- `/dashboard/media-providers/[kind]/[id]` — port from `[kind]` mock.
- `/dashboard/media-providers/combo/[id]` — port from `[kind]` mock.
- `/dashboard/media-providers/web` — port from `[kind]` mock.
- `/dashboard/auto-configure` — port from closest settings form pattern.
- `/dashboard/translator` — port from closest form pattern.
- `/dashboard/pxpipe` — port from closest pattern.
- `/dashboard/mitm` — port from closest pattern.
- `/dashboard/settings/pricing` — port from `pages/settings/SettingsPage.jsx`.

### Mocks without routes

None. Every DS mock corresponds to exactly one real route (or to
`/dashboard/profile` for `pages/settings`).
