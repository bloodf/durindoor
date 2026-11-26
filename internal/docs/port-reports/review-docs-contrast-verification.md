# Provider discovery dark mode contrast verification

## Result

Not reproduced in Chromium. Chromium is installed (`Google Chrome 158.0.8127.36`). The normal linked Playwright entry points resolve to a stale package symlink; invoking the package's existing `cli.js` directly gets past that, but the disposable web server cannot start because `website/node_modules/next/dist/bin/next` is also missing through the linked dependency tree. The test therefore failed before browser launch. No exact failing link, computed colors, ratio, or browser-triggering route could be established; do not treat the source inspection below as a reproduction.

## Source inspected

The test at `website/tests/docs.spec.mjs:552` visits `/docs`, toggles `html.dark`, and runs axe. The docs palette in `website/src/app/docs/docs.css` maps Fumadocs primary links through `--color-fd-primary: var(--dd-accent)`. In dark docs mode, the token values are `--dd-accent: #6ee7b7`, `--dd-bg: #0c1410`, and `--dd-text-muted: #adbbb0`. This identifies the intended theme mapping, but without computed browser styles it does not establish which element axe flags or its effective background.

`origin/main` and the locally available `orq/tp3r51/review-2627-followup-a1` both contain the same test body at this location. The supplied frozen `#2627` head was not independently identifiable from local refs, so no frozen-head runtime comparison was made.

## Attempted reproduction

From a disposable `git archive HEAD` checkout with linked dependencies, private HOME/cache, and the installed Chromium executable (the Playwright CLI was invoked from the existing package directory because its normal symlink was stale):

```sh
HOME=/tmp/durindoor-contrast-repro/home XDG_CACHE_HOME=/tmp/durindoor-contrast-repro/cache NEXT_TELEMETRY_DISABLED=1 WEBSITE_CHROMIUM_EXECUTABLE=/home/stormtrooper/.local/bin/google-chrome WEBSITE_TRANSIENT_PORT=39127 timeout 300s node /home/stormtrooper/Developer/github.com/bloodf/durindoor-network/website/node_modules/.pnpm/@playwright+test@1.63.0/node_modules/@playwright/test/cli.js test tests/docs.spec.mjs -g 'provider discovery links lead' --workers=1 --reporter=list
```

It exited before browser launch with `Cannot find module '/tmp/durindoor-contrast-repro/repo/website/node_modules/next/dist/bin/next'`. A first CLI invocation through the normal package symlink also failed because the symlink target was absent. Dependencies were not installed, deleted, or modified, and the app and tests were not edited.
