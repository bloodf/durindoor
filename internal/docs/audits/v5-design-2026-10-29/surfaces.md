# Route classification

The gateway operator is the primary role. B is daily work; C is configuration, access or destructive work. Mixed routes classify their write regions as C. No feature deletion is proposed.

| Route | Source | Surface | Business variable | Coverage boundary |
|---|---|---|---|---|
| `/dashboard/auto-configure` | `src/app/(dashboard)/dashboard/auto-configure/page.js` | B/C | Inspect planned changes and apply local configuration | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard/cli-tools/[toolId]` | `src/app/(dashboard)/dashboard/cli-tools/[toolId]/page.js` | B/C | Configure CLI endpoint/model/key while preserving working settings | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard/cli-tools` | `src/app/(dashboard)/dashboard/cli-tools/page.js` | B/C | Configure CLI endpoint/model/key while preserving working settings | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard/combos` | `src/app/(dashboard)/dashboard/combos/page.js` | B/C | Choose routing members, ordering, strategy, weights and restrictions | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard/compression-studio` | `src/app/(dashboard)/dashboard/compression-studio/page.js` | B | Compare compression engines against a request preview | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard/console-log` | `src/app/(dashboard)/dashboard/console-log/page.js` | B/C | Inspect and clear server logs with truthful stream state | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard/endpoint` | `src/app/(dashboard)/dashboard/endpoint/page.js` | B/C | Choose endpoint and configure intended authentication/exposure | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard/headroom` | `src/app/(dashboard)/dashboard/headroom/page.js` | B/C | Inspect and control context compression | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard/health` | `src/app/(dashboard)/dashboard/health/page.js` | B | Assess reachability without confusing unknown with down | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard/keys` | `src/app/(dashboard)/dashboard/keys/page.js` | B/C | Manage credentials, grants, limits and revocation | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard/mcp-gateway/keys` | `src/app/(dashboard)/dashboard/mcp-gateway/keys/page.js` | B/C | Manage upstream tool servers and gateway credentials | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard/mcp-gateway` | `src/app/(dashboard)/dashboard/mcp-gateway/page.js` | B/C | Manage upstream tool servers and gateway credentials | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard/media-providers/[kind]/[id]` | `src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/page.js` | B/C | Manage typed media models, accounts, provider chains and examples | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard/media-providers/[kind]` | `src/app/(dashboard)/dashboard/media-providers/[kind]/page.js` | B/C | Manage typed media models, accounts, provider chains and examples | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard/media-providers/combo/[id]` | `src/app/(dashboard)/dashboard/media-providers/combo/[id]/page.js` | B/C | Manage typed media models, accounts, provider chains and examples | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard/media-providers/web` | `src/app/(dashboard)/dashboard/media-providers/web/page.js` | B/C | Manage typed media models, accounts, provider chains and examples | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard/media-routes` | `src/app/(dashboard)/dashboard/media-routes/page.js` | B/C | Configure model defaults and fallbacks per media operation | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard/mitm` | `src/app/(dashboard)/dashboard/mitm/page.js` | B/C | Configure supported traffic interception with explicit trust controls | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard/monitoring` | `src/app/(dashboard)/dashboard/monitoring/page.js` | B | Identify gateway/runtime failures | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard` | `src/app/(dashboard)/dashboard/page.js` | B | Redirect to Usage | No independent screen |
| `/dashboard/playground` | `src/app/(dashboard)/dashboard/playground/page.js` | B/C | Send, stop and compare requests through connected models | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard/profile` | `src/app/(dashboard)/dashboard/profile/page.js` | B/C | Configure preferences, security, routing, network, retention and backups | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard/providers/[id]` | `src/app/(dashboard)/dashboard/providers/[id]/page.js` | B/C | Manage provider connections, models, routing and automatic discovery | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard/providers` | `src/app/(dashboard)/dashboard/providers/page.js` | B/C | Manage provider connections, models, routing and automatic discovery | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard/proxy-pools` | `src/app/(dashboard)/dashboard/proxy-pools/page.js` | B/C | Manage proxy egress, imports, health and relay deployment | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard/pxpipe` | `src/app/(dashboard)/dashboard/pxpipe/page.js` | B/C | Inspect image compression and estimated savings | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard/quota` | `src/app/(dashboard)/dashboard/quota/page.js` | B/C | Find remaining capacity and manage eligible accounts | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard/settings/database` | `src/app/(dashboard)/dashboard/settings/database/page.js` | C | Inspect pricing or change database configuration with recovery | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard/skills` | `src/app/(dashboard)/dashboard/skills/page.js` | B | Copy instructions with the intended endpoint and key | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard/timeline/[id]` | `src/app/(dashboard)/dashboard/timeline/[id]/page.js` | B | Trace request hops and inspect a selected trace | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard/timeline` | `src/app/(dashboard)/dashboard/timeline/page.js` | B | Trace request hops and inspect a selected trace | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard/token-saver` | `src/app/(dashboard)/dashboard/token-saver/page.js` | B/C | Inspect measured and estimated savings separately; configure compression | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard/token-saver/settings` | `src/app/(dashboard)/dashboard/token-saver/settings/page.js` | B/C | Inspect measured and estimated savings separately; configure compression | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard/translator` | `src/app/(dashboard)/dashboard/translator/page.js` | B/C | Admin resource inspection and configuration | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard/usage` | `src/app/(dashboard)/dashboard/usage/page.js` | B/C | Investigate usage and costs; customize reports without deleting data | Source reviewed; representative Storybook fixture views in evidence.json |
| `/callback` | `src/app/callback/page.js` | C | Finish authorization and recover from callback failure | Source reviewed; representative Storybook fixture views in evidence.json |
| `/dashboard/settings/pricing` | `src/app/dashboard/settings/pricing/page.js` | C | Inspect pricing or change database configuration with recovery | Source reviewed; representative Storybook fixture views in evidence.json |
| `/landing` | `src/app/landing/page.js` | A | Marketing acquisition; outside this admin audit | Source inventoried only; public-site design and acquisition/distribution review excluded |
| `/login` | `src/app/login/page.js` | C | Authenticate and recover access through password, MFA or OIDC | Source reviewed; representative Storybook fixture views in evidence.json |
| `/` | `src/app/page.js` | B | Redirect to dashboard | No independent screen |
| `/dashboard/workspaces` | `src/shared/ui/v5/dashboards/WorkspacesPage.jsx` | B/C | Compose and edit personal dashboards from all data sources | Storybook-only proposed route |
