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
`durindoor-demo:` localStorage prefix. Unknown routes return a generic success
and log once with `console.debug`. Nothing under `../src` is modified.

Static assets the shared UI expects (fonts, provider logos, icons, i18n
literals, Monaco) are copied from `../public` and `node_modules` by
`scripts/sync-public.mjs` on `predev` and `prebuild`; the copies are gitignored.

## Homepage

Sections live in `src/components/home/{hero,flow,sections}`; copy and figures are in
`src/components/home/data.js` and `content.js`, each number commented with the file
it was derived from. The token savers panel runs the real `open-sse/rtk` `find`
filter at build time, so its byte counts are genuine output.

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

## Commands

```sh
npm install          # .npmrc sets legacy-peer-deps
npm run dev          # http://localhost:3000
npm run build
npm run start
npm run mock:smoke   # calls every mocked route once, reports throws
```

## Deploy

Vercel project `durindoor` (team `hr-teconologia`), Root Directory `website`,
framework Next.js, production branch `main`. `NEXT_PUBLIC_SITE_URL` sets the
absolute base for Open Graph URLs.

## Known gaps

- Browser OAuth flows and the MCP "Connect" button open a second tab before completing.
- "Open Headroom Dashboard" links to `/api/headroom/proxy/dashboard`, which has no mock route.
- The demo login only checks a single fixed password (`melon`); it does not model rate limiting, lockouts, or the real password-change flow.
