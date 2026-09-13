# DurinDoor website

Public site for DurinDoor, deployed on Vercel. One Next.js app, two surfaces:

| Path | What it is |
| --- | --- |
| `/` | Single-page animated homepage: WebGL Durin's Door hero, how-it-works flow, features, quick start, live demo teaser. |
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
- Request headers are invisible to the mock handlers, so password prompts accept anything.
- Landing hero shaders and effects are hand-written; ThreeUI components can be dropped in with `npx @designcodeio/threeui-cli add <id>` once signed in.
