# Page map

> Dashboard inventory subordinate to the all-page gauntlet contract in
> [`README.md`](./README.md) and [`plans/README.md`](../../../plans/README.md).
> Those contracts are authoritative for complete surface execution. This map
> totals 37 rows: 35 actionable visual surfaces (32 dashboard rows plus
> `/login`, `/landing`, `/callback`) and 2 redirect verification rows
> (`/` → `/dashboard`, `/dashboard` → `/dashboard/usage`). Redirects are
> verified, not visually migrated. Status stays `pending` until
> consumer/render proof and merge; this plan marks no row migrated.

## Real route → mock → DS components

| # | Route path | Real page file | DS mock dir | DS components consumed | Risk | Special notes | Status |
| - | --- | --- | --- | --- | --- | --- | --- |
| 1 | `/dashboard/api-docs` | `src/app/(dashboard)/dashboard/api-docs/page.js` | `src/shared/ui/pages/api-docs/ApiDocsPage.jsx` | `PageHeader`, `Card`, `CardContent` | low | Static, server-rendered | pending |
| 2 | `/dashboard/mcp-help` | `src/app/(dashboard)/dashboard/mcp-help/page.js` | `src/shared/ui/pages/mcp-help/McpHelpPage.jsx` | `PageHeader`, `Card`, `Tabs` (if expanded), `Code`-like blocks (no DS wrapper; use `bg-dd-surface-2 font-mono rounded-dd p-3`) | low | Static help text; 0 native selects in real file | pending |
| 3 | `/dashboard/health` | `src/app/(dashboard)/dashboard/health/page.js` | `src/shared/ui/pages/health/HealthPage.jsx` | `PageHeader`, `StatCard`, `Card`, `CardHeader`, `CardContent`, `DataTable` + `pagination`, `StatusDot`, `Badge`, `ProviderLogo`, `Button` | low | Worked example in [`playbook.md`](./playbook.md) | pending |
| 4 | `/dashboard/skills` | `src/app/(dashboard)/dashboard/skills/page.js` | `src/shared/ui/pages/skills/SkillsPage.jsx` | `PageHeader`, `Card`, `Input`, `Select`, `Button` (copy-state), `Tabs` | low | Static catalog; copy-to-clipboard feedback | pending |
| 5 | `/dashboard/endpoint` | `src/app/(dashboard)/dashboard/endpoint/page.js` + `EndpointPageClient.jsx` | `src/shared/ui/pages/endpoint/EndpointPage.jsx` | `PageHeader`, `Card`, `Input`, `Select`, `Button`, `DataTable` + `pagination`, `ConfirmDialog`, `PromptDialog` | medium | Native `<select>` × 2 in `EndpointPageClient.jsx:1306,1583` | pending |
| 6 | `/dashboard/cli-tools` | `src/app/(dashboard)/dashboard/cli-tools/page.js` + `CLIToolsPageClient.js` | `src/shared/ui/pages/cli-tools/CliToolsPage.jsx` | `PageHeader`, `Card`, `Tabs`, `Select`, `Input`, `Button`, `PromptDialog`, `ConfirmDialog` | medium | `window.prompt` × 2 (`cli-tools/components/BaseUrlSelect.js:107`, `EndpointPresetControl.js:70`); native `<select>` × 2 in same files | pending |
| 7 | `/dashboard/cli-tools/[toolId]` | `src/app/(dashboard)/dashboard/cli-tools/[toolId]/page.js` | no mock | `PageHeader`, `Card`, `Input`, `Button` | medium | Port pattern from `cli-tools` mock; `ClaudeToolCard.js` select is this route | pending |
| 8 | `/dashboard/combos` | `src/app/(dashboard)/dashboard/combos/page.js` | `src/shared/ui/pages/combos/CombosPage.jsx` | `PageHeader`, `Card`, `DataTable` + `pagination`, `StatusDot`, `Badge`, `Modal` (`ComboFormModal` — keep in `src/shared/components/` as domain modal; the modal chrome is `bg-dd-surface rounded-dd-lg border border-dd-border`), `Button` | medium | CRUD + table; `ComboFormModal` is a domain modal, not a generic one | pending |
| 9 | `/dashboard/providers` | `src/app/(dashboard)/dashboard/providers/page.js` | `src/shared/ui/pages/providers/ProvidersPage.jsx` | `PageHeader`, `Card`, `ProviderLogo`, `Toggle`, `StatusDot`, `Badge`, `Select`, `Input`, `Button`, `StatCard` | medium | Hex literals in providers surfaces migrate to DS tokens | pending |
| 10 | `/dashboard/providers/[id]` | `src/app/(dashboard)/dashboard/providers/[id]/page.js` | no mock | `PageHeader`, `Card`, `Tabs`, `Modal`, `Input`, `Select`, `Button`, `Toggle`, `Badge`, `ProviderLogo` | medium | Heavy OAuth domain-modal surface; preserve shared modal imports | pending |
| 11 | `/dashboard/mcp-gateway` | `src/app/(dashboard)/dashboard/mcp-gateway/page.js` | `src/shared/ui/pages/mcp-gateway/McpGatewayPage.jsx` | `PageHeader`, `Card`, `DataTable` + `pagination`, `Badge`, `Button`, `PromptDialog`, `ConfirmDialog`, `Input` | medium | `window.prompt` × 1 at `mcp-gateway/page.js:237` | pending |
| 12 | `/dashboard/console-log` | `src/app/(dashboard)/dashboard/console-log/page.js` + `ConsoleLogClient.js` | `src/shared/ui/pages/console-log/ConsoleLogPage.jsx` | `PageHeader`, `Card`, `Tabs`, `StatusDot`, `Badge`, `Select`, `Input`, `Button` | medium | Tabs + log buffer | pending |
| 13 | `/dashboard/proxy-pools` | `src/app/(dashboard)/dashboard/proxy-pools/page.js` | `src/shared/ui/pages/proxy-pools/ProxyPoolsPage.jsx` | `PageHeader`, `Card`, `DataTable` + `pagination`, `Badge`, `StatusDot`, `Button`, `ConfirmDialog` | medium | Card list / table | pending |
| 14 | `/dashboard/headroom` | `src/app/(dashboard)/dashboard/headroom/page.js` + `HeadroomClient.js` | `src/shared/ui/pages/headroom/HeadroomPage.jsx` | `PageHeader`, `StatCard`, `Card`, `DataTable` + `pagination`, `Toggle`, `Button` | medium | Read-only metrics + settings toggle | pending |
| 15 | `/dashboard/usage` | `src/app/(dashboard)/dashboard/usage/page.js` | `src/shared/ui/pages/usage/UsagePage.jsx` | `PageHeader`, `RangeSelector`, `StatCard`, `DataTable` + `pagination`, `Drawer`, `KeyValue`, `LineChart` | medium-high | Charts, select, prompts, and token colors migrate with behavior intact | pending |
| 16 | `/dashboard/timeline` | `src/app/(dashboard)/dashboard/timeline/page.js` | `src/shared/ui/pages/timeline/TimelinePage.jsx` | `PageHeader`, `Select`, `Toggle`, `Drawer`, `KeyValue`, `DataTable` + `pagination` | medium-high | Live area chart + filters + drawer | pending |
| 17 | `/dashboard/timeline/[id]` | `src/app/(dashboard)/dashboard/timeline/[id]/page.js` | no mock | `PageHeader`, `Card`, `DataTable` + `pagination` | medium-high | Port from `pages/timeline/TimelinePage.jsx` | pending |
| 18 | `/dashboard/quota` | `src/app/(dashboard)/dashboard/quota/page.js` | `src/shared/ui/pages/quota/QuotaPage.jsx` | `PageHeader`, `Card`, `StatCard`, `DataTable` + `pagination`, `StatusDot`, `Badge` | medium | Multi-provider cards | pending |
| 19 | `/dashboard/token-saver` | `src/app/(dashboard)/dashboard/token-saver/page.js` + `TokenSaverClient.jsx` (`view="overview"`) | `src/shared/ui/pages/token-saver/TokenSaverStatsPage.jsx` | `PageHeader`, `StatCard`, `Card`, `DataTable` + `pagination`, `Tabs`, `RangeSelector` | medium-high | Stats + per-tool breakdown | pending |
| 20 | `/dashboard/token-saver/settings` | `src/app/(dashboard)/dashboard/token-saver/settings/page.js` | `src/shared/ui/pages/token-saver-settings/SettingsPage.jsx` | `PageHeader`, `Card`, `Toggle`, `Input`, `Select`, `Button` | medium | Same client, distinct settings view | pending |
| 21 | `/dashboard/compression-studio` | `src/app/(dashboard)/dashboard/compression-studio/page.js` | `src/shared/ui/pages/test-savers/TestSaversPage.jsx` | `PageHeader`, `Tabs`, `Card`, `Select`, `Input`, `Button` | medium | Diff viewer | pending |
| 22 | `/dashboard/playground` | `src/app/(dashboard)/dashboard/playground/page.js` + `PlaygroundPageClient.js` | `src/shared/ui/pages/playground/PlaygroundPage.jsx` | `PageHeader`, `Card`, `Select`, `ProviderLogo`, `Input`, `Textarea`, `Button`, `Tabs`, `StatCard` | high | Composer, model picker, SSE preview | pending |
| 23 | `/dashboard/profile` | `src/app/(dashboard)/dashboard/profile/page.js` | `src/shared/ui/pages/settings/SettingsPage.jsx` | `PageHeader`, `Tabs`, `Card`, `Input`, `Select`, `Toggle`, `Button` | medium | ThemeProvider consumers | pending |
| 24 | `/dashboard/media-providers/[kind]` | `src/app/(dashboard)/dashboard/media-providers/[kind]/page.js` | `src/shared/ui/pages/media-providers/MediaProvidersPage.jsx` | `PageHeader`, `Card`, `ProviderLogo`, `DataTable` + `pagination`, `Badge`, `Button`, `Modal` | medium-high | Cover embedding, rerank, image, imageToText, tts, stt, video, music; webSearch/webFetch redirect to `/dashboard/media-providers/web`; no realtime | pending |
| 25 | `/dashboard/media-providers/[kind]/[id]` | `src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/page.js` | no mock | `PageHeader`, `Card`, `Input`, `Select`, `Button`, `Tabs`, `Textarea` | high | Every supported dynamic kind; preserve `AddCustomEmbeddingModal` domain widget | pending |
| 26 | `/dashboard/media-providers/combo/[id]` | `src/app/(dashboard)/dashboard/media-providers/combo/[id]/page.js` | no mock | `PageHeader`, `Card`, `DataTable` + `pagination` | high | Port from `[kind]` mock | pending |
| 27 | `/dashboard/media-providers/web` | `src/app/(dashboard)/dashboard/media-providers/web/page.js` | no mock | `PageHeader`, `Card`, `Input`, `Button` | medium | Target for webSearch/webFetch redirects | pending |
| 28 | `/dashboard/auto-configure` | `src/app/(dashboard)/dashboard/auto-configure/page.js` + `AutoConfigureClient.js` | no mock | `PageHeader`, `Card`, `Select`, `Input`, `Button`, `StatCard` | medium | Port from closest pattern | pending |
| 29 | `/dashboard/translator` | `src/app/(dashboard)/dashboard/translator/page.js` | no mock | `PageHeader`, `Card`, `Input`, `Textarea`, `Button` | medium | Port from closest pattern | pending |
| 30 | `/dashboard/pxpipe` | `src/app/(dashboard)/dashboard/pxpipe/page.js` + `PxpipeClient.js` | no mock | `PageHeader`, `Card`, `Input`, `Button`, `StatusDot` | medium | Port from closest pattern | pending |
| 31 | `/dashboard/mitm` | `src/app/(dashboard)/dashboard/mitm/page.js` + `MitmPageClient.js` | no mock | `PageHeader`, `Card`, `Input`, `Select`, `Button`, `DataTable` + `pagination` | medium | Port from closest pattern | pending |
| 32 | `/dashboard/settings/pricing` | `src/app/dashboard/settings/pricing/page.js` (outside `(dashboard)`) | no mock | `PageHeader`, `Card`, `Button`, `Modal` (`PricingModal` domain modal) | low | Pricing flow | pending |
| 33 | `/login` | `src/app/login/page.js` | no mock | `Card`, `Button`, `Input` | high | Auth/password/OIDC/rate-limit/change-password states; preserve security flow | pending |
| 34 | `/landing` | `src/app/landing/page.js` + `components/**` | no mock | closest DS landing pattern | medium | Public marketing surface; inventory all component states | pending |
| 35 | `/callback` | `src/app/callback/page.js` | no mock | `Card`, status treatment | high | OAuth callback transport/error states; preserve origin and replay protections | pending |
| 36 | `/` | `src/app/page.js` | n/a | n/a | low | Verify redirect to `/dashboard`; not visual migration | pending |
| 37 | `/dashboard` | `src/app/(dashboard)/dashboard/page.js` | n/a | n/a | low | Verify redirect to `/dashboard/usage`; not visual migration | pending |

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
| `src/app/(dashboard)/dashboard/cli-tools/components/MitmModelMappingRow.js` | 49 | `/dashboard/mitm` (rendered by `MitmToolCard.js` imported by `MitmPageClient.js`) |
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

- `/` and `/dashboard` redirects — verify behavior; neither is a visual migration.
- `/login`, `/landing`, `/callback` — no mock; port from closest DS pattern
  while preserving auth/public/callback behavior.
- `/dashboard/cli-tools/[toolId]` — port from `pages/cli-tools/CliToolsPage.jsx`.
- `/dashboard/providers/[id]` — port from `pages/providers/ProvidersPage.jsx`.
- `/dashboard/timeline/[id]` — port from `pages/timeline/TimelinePage.jsx`.
- `/dashboard/media-providers/[kind]` covers `embedding`, `rerank`, `image`,
  `imageToText`, `tts`, `stt`, `video`, `music`; `webSearch`/`webFetch` use
  `/dashboard/media-providers/web`; no `realtime` branch exists.
- `/dashboard/media-providers/[kind]/[id]` — port from `[kind]` mock.
- `/dashboard/media-providers/combo/[id]` — port from `[kind]` mock.
- `/dashboard/media-providers/web` — port from `[kind]` mock.
- `/dashboard/auto-configure` — port from closest settings form pattern.
- `/dashboard/translator` — port from closest form pattern.
- `/dashboard/pxpipe` — port from closest pattern.
- `/dashboard/mitm` — port from closest pattern.
- `/dashboard/settings/pricing` — port from `pages/settings/SettingsPage.jsx`.

### Supplemental error boundaries and shared domain surfaces

No custom `/setup`, `loading.js`, or `not-found.js` surface exists. Inventory
and preserve four `error.js` boundaries with their owner routes:
`/dashboard/combos`, `/dashboard/mcp-gateway`, `/dashboard/mitm`, and
`/dashboard/providers/[id]`. Page owners also retain shared domain modals and
their live imports; generic primitive cleanup requires zero-consumer and
consumer/render proof.

### Mocks without routes

None. Every DS mock corresponds to exactly one real route (or to
`/dashboard/profile` for `pages/settings`).
