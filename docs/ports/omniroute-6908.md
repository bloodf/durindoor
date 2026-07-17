# Port log: OmniRoute PR #6908

- **Source:** https://github.com/diegosouzapw/OmniRoute/pull/6908
- **Port branch:** `port/omniroute-6908`

## Behavior ported

Upstream's standalone CLI bundle crashed at boot with `MODULE_NOT_FOUND`: the server entry imported `head-response-guard.cjs`, but the packaging step had no entry copying it into the bundle. Upstream shipped the sidecar via an extra-module manifest entry and added a regression test deriving required sidecars from the entry's own relative imports.

DurinDoor has the same hazard shape: `custom-server.js` carries the #6608 HEAD body-suppression inline and lives OUTSIDE Next.js's standalone trace, so nothing guaranteed a sidecar would travel with it.

## DurinDoor adaptation

- The inline #6608 HEAD guard was extracted with identical runtime semantics (body bytes dropped, status/headers preserved, real `end` invoked with exactly one callback) into the root sidecar `head-response-guard.cjs`; `custom-server.js` now `require()`s it. Behavior of the guard itself is unchanged — no `Connection: close` is added.
- `cli/scripts/standaloneSidecars.js` (new) owns `STANDALONE_SIDECARS` + `copyRequiredStandaloneSidecars(appDir, cliAppDir)`, which copies each root sidecar into the CLI bundle and FAILS HARD when one is missing — a silent skip ships a boot-crashing bundle.
- `cli/scripts/build-cli.js` step 3a now copies `custom-server.js` + `head-response-guard.cjs` through that helper (same hard-fail contract as before).
- `scripts/build-app.mjs` copies `head-response-guard.cjs` into `.next/standalone` next to `custom-server.js` so root `npm run build` + `npm start` keeps booting.
- The test derives EVERY root-level relative `require("./…")` in `custom-server.js` (excluding generated `server.js` and the `src/` + `open-sse/` trees, which have their own copy steps) and asserts each is in `STANDALONE_SIDECARS` — the upstream-style guard against the NEXT omitted sidecar.

## Files (8)

- `head-response-guard.cjs` (new — extracted #6608 guard)
- `custom-server.js` (require sidecar; inline guard removed)
- `cli/scripts/standaloneSidecars.js` (new — sidecar manifest + copy)
- `cli/scripts/build-cli.js` (step 3a uses the helper)
- `scripts/build-app.mjs` (copy guard into standalone)
- `tests/unit/standalone-sidecars-6908.test.js` (new)
- `tests/unit/mitm-runtime-lifecycle.test.js` (assertion follows the helper call)
- `docs/ports/omniroute-6908.md`

## Verification

```text
cd tests && node node_modules/vitest/vitest.mjs run unit/standalone-sidecars-6908.test.js unit/mitm-runtime-lifecycle.test.js unit/api-hardening.test.js
Test Files  3 passed (3)
Tests       71 passed (71)
```

Red-proof: removing `head-response-guard.cjs` from `STANDALONE_SIDECARS` fails 3 tests in `standalone-sidecars-6908.test.js` (copy completeness + derived-require guard); restored helper → 71/71 green again.

Artifact proof (real `npm pack --dry-run --json` against a temp `cli/` whose `app/` was staged by `copyRequiredStandaloneSidecars`):

```text
app entries: ["app/custom-server.js","app/head-response-guard.cjs"]
TARBALL-OK guard bytes=2722
```
