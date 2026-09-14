# DurinDoor website

Public site for DurinDoor, deployed on Vercel. One Next.js app, two surfaces:

| Path | What it is |
| --- | --- |
| `/` | Single-page animated homepage: WebGL Durin's Door hero, service kinds, request flow with fallback tiers, providers constellation, token savers, quota ledger, features, comparison, quick start, live demo, final CTA. |
| `/dashboard/*`, `/login` | The real dashboard UI running against a fully mocked, browser-local backend. Every page of the production dashboard is reachable; adds, edits and deletes persist in `localStorage`. |

## How the demo reuses the real dashboard

`next.config.mjs` aliases `@` to `../src` and `open-sse` to `../open-sse`, enables
`experimental.externalDir`, and pins `resolve.modules` to `website/node_modules`
so the shared UI and this app share one React. Pages under `src/app/dashboard/`
re-export the production page modules; the few server-component pages get a thin
page that renders the same client component with fixture props.

`src/mock/install.js` patches `fetch` and `EventSource` in the browser. Every
`/api/*` call the dashboard makes is answered by `src/mock/handlers/*` from an
in-memory store seeded by `src/mock/fixtures/*` and persisted under the
`durindoor-demo:` localStorage prefix. Endpoints the demo does not implement
answer `501` instead of a generic success, so a missing mock is visible rather
than silently green. Nothing under `../src` is modified.

Every seeded provider carries more than one account, each with its own
identity, priority, state and provider-shaped quota. Quota windows, reset
credits and cooldown state live on the connection row (`demoQuota`), so
redeeming a Codex reset credit clears that one account's exhausted windows,
leaves its siblings untouched, and survives a reload. API key scopes, selective
data transfer and proxy pool bindings all read the stored connections, so an
account you add or delete shows up in each of those surfaces.

Static assets the shared UI expects (fonts, provider logos, icons, i18n
literals, Monaco) are copied from `../public` and `node_modules` by
`scripts/sync-public.mjs` on `predev` and `prebuild`; the copies are gitignored.

## Homepage

Sections live in `src/components/home/{hero,flow,sections}`; copy and figures are in
`src/components/home/data.js` and `content.js`, each number commented with the file
it was derived from. The token savers panel runs the real `open-sse/rtk` `find`
filter when the server module loads, so its byte counts are genuine output.

Decorative backgrounds use native-canvas components from
[ThreeUI Community](https://threeui.com) (`@designcodeio/threeui`, MIT):
`StreamConvergenceBackground` (flow), `LaserCollection` (providers, token savers),
`EmeraldHorizonBackground` (quota), `BellFieldBackground` and `LumenCta` (final CTA).
`src/components/home/threeui/ThreeStage.jsx` code-splits each one, mounts it only
near the viewport, skips it for reduced motion or missing WebGL (a CSS fallback is
always painted), and the components pause themselves off-screen. The iframe-based
"Neuform" effects are avoided because they load third-party CDNs.
`next.config.mjs` aliases ThreeUI's pinned `three128` to the app's `three` so the
page ships one Three.js instance.

The site is dark by default; with a light theme preference the daylight sections
switch to parchment (`src/app/(home)/light.css`) while the hero, code blocks and
WebGL bands stay dark.

### Languages

The homepage ships complete message catalogs for English, Portuguese (pt-BR),
Spanish, German, Japanese and Chinese (zh-CN) in `src/i18n/locales/`, selected
through the same `locale` cookie the dashboard uses. Source strings are keys,
not fallbacks: a missing key throws rather than silently rendering English.
Choosing a language persists the cookie and reloads, so the rendered text,
`<html lang>`, page title and social metadata always agree. Brand names, model
identifiers and shell commands stay untranslated by design.

## Commands

```sh
npm install          # .npmrc sets legacy-peer-deps
npm run dev          # http://localhost:3000
npm run build
npm run start
npm run mock:smoke   # runs the demo's behavioral scenarios; exits 1 on failure
```

`mock:smoke` with no argument exercises the login session, key secrecy and
mutations, combo mutations, selective provider import with key scopes, and the
live proxy deletion guard. Pass a paths file (`/api/path` or
`METHOD /api/path {"json":"body"}` per line) to check specific routes; a missing
route, a throwing handler or a 5xx response exits non-zero.

## Deploy

Vercel project `durindoor` (team `hr-teconologia`), Root Directory `website`,
framework Next.js, production branch `main`. `NEXT_PUBLIC_SITE_URL` sets the
absolute base for Open Graph URLs.

## Known gaps

- Browser OAuth flows and the MCP "Connect" button open a second tab before completing.
- "Open Headroom Dashboard" links to `/api/headroom/proxy/dashboard`, which has no mock route.
- The demo login only checks a single fixed password (`melon`); it does not model rate limiting, lockouts, or the real password-change flow.
