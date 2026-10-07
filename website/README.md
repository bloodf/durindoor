# DurinDoor website

Public site for DurinDoor, deployed on Vercel. One Next.js app, three surfaces:

| Path | What it is |
| --- | --- |
| `/` | Single-page animated homepage: WebGL Durin's Door hero, service kinds, request flow with fallback tiers, providers constellation, token savers, quota ledger, features, comparison, quick start, live demo, final CTA. |
| `/dashboard/*`, `/login` | The real dashboard UI running against a fully mocked, browser-local backend. Every page of the production dashboard is reachable; adds, edits and deletes persist in `localStorage`. |
| `/docs` | Operator and contributor documentation. Fumadocs compiles MDX from `../docs`. |

## How the demo reuses the real dashboard

`next.config.mjs` aliases `@` to `../src` and `open-sse` to `../open-sse`, enables
`experimental.externalDir`, and pins `resolve.modules` to `website/node_modules`
so the shared UI and this app share one React. Pages under `src/app/dashboard/`
re-export the production page modules; the few server-component pages get a thin
page that renders the same client component with fixture props.

`source.config.mjs` sets `dir: "../docs"` and collects `**/*.mdx`.
`src/lib/source.js` loads that collection with `baseUrl: "/docs"`.
The MDX plugin reads the repo-root docs folder in place; nothing under
`../docs` is copied into `website/`.

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

Signing in needs the demo password, so the login page shows it in a persistent
notice above the form with a copy button, and the homepage teaser repeats it
next to the demo link. Both read `src/mock/demoPassword.js`, the same module
the mocked login checks, so the displayed value cannot drift from the accepted
one.

Static assets the shared UI expects (fonts, provider logos, icons, i18n
literals, Monaco) are copied from `../public` and `node_modules` by
`scripts/sync-public.mjs` on `predev` and `prebuild`; the copies are gitignored.

## Homepage

Sections live in `src/components/home/{hero,flow,sections}`; copy and figures are in
`src/components/home/data.js` and `content.js`, each number commented with the file
it was derived from. The token savers panel runs the real `open-sse/rtk` `find`
filter when the server module loads, so its byte counts are genuine output.

The public identity is fantasy themed, inspired by Durin's Door at Moria. The
canonical SVG emblem, outlined wordmarks, app icon, illustration, presentation
board, and usage guide live in `../assets/brand/`. `sync-public.mjs` copies those
assets to `/brand` during development and builds. Cormorant Garamond carries
headings, and Space Grotesk carries UI copy. Both fonts are locally served.

The hero code-splits its React Three Fiber scene after hydration and keeps a
static illustration underneath, visible while the texture loads. The scene uses a custom emerald mist shader,
pointer parallax, and scroll-linked light and depth. It caps DPR at 1.5 and pauses when
the hero is offscreen or the tab is hidden. Missing WebGL, context loss, and
reduced motion keep the static illustration. Motion and native CSS scroll
timelines reveal the sections. Supporting routing-line effects use CSS. Decorative marquee copies are inert
so keyboard users reach each integration link only once.

The marketing site uses a consistent moonlit forest palette. Docs support light
and dark reading themes with the same green emblem and typography. The mocked
dashboard retains the production application's design and behavior.

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

See [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md) for the website tree.

## Homepage and embedded preview

The homepage gate restores the perspective 3D stone arch, procedural moonlit inscriptions, mist, and bloom. Two beveled arched slabs rotate about their outer hinges, revealing a recessed passage with four arches and a lit stone floor. Pointer movement subtly changes the camera angle; scroll and the explicit toggle share one smoothed opening state. Rendering pauses offscreen and in hidden tabs. Scroll opens the leaves, and the Open the door button explicitly opens or closes them when WebGL animation is available. The toggle is hidden with static fallback artwork. Reduced-motion preferences, unavailable WebGL, and context loss preserve the static artwork.

The homepage iframe loads `/demo-preview`, a website-only entry that authenticates the browser-local sample session before mounting the production `DashboardLayout` and `EndpointPageClient`. Sidebar navigation continues through the shared dashboard routes. No separate marketing dashboard is drawn. The preview uses the same mock handlers and sample store as `/dashboard`; monitoring is derived from its usage fixtures.

Marketing copy names OpenAI and Anthropic APIs. Endpoint URLs belong in setup examples and the actual dashboard. Supporting content is visible by default. Feature illustrations use an asymmetric bento layout with emerald gradients; reduced motion disables their packet and caret effects. The vector brand assets remain under `assets/brand/` and are synchronized into the website by `scripts/sync-public.mjs`.

### Navigation and routing presentation

The navigation drawer constrains the shared sidebar to its available height. Its route list scrolls independently so the brand and Settings remain available. The request diagram reads clients → DurinDoor → providers and stacks in that order on phones. Fallback shows a labeled example of user-configured combo member order; it does not simulate live statuses or prescribe three pricing tiers. Docs links have a consistent gap after their section content.

### Documentation reading experience

The docs index introduces both OpenAI and Anthropic APIs and guides readers through installation, provider connection, and their first request. Its directory links replace duplicated navigation and hardcoded page counts. Guide pages use a bounded reading measure, larger titles, clear section spacing, and code blocks with the existing copy controls. Light mode uses parchment and green ink; dark mode uses the website's forest palette. The sidebar Demo link opens the authenticated sample preview.

The quick start sets dashboard credentials before the first boot. The first-request guide has separate OpenAI Chat, Anthropic Messages, and OpenAI Responses tabs. Placeholder model IDs must be replaced with IDs exposed by the running instance.

The root Vitest suite also exercises website components. Install dependencies in the root, `website/`, and `tests/` before running that suite; its website tests use the website’s React runtime. The test workflow installs all three packages.

The docs navigation uses the canonical `durindoor-mark.svg` from the shared brand kit. Root asset filenames retained for existing consumers are generated from the same emblem, outlined wordmarks, and social image. Fork acknowledgment appears in the root README.
