# Kiro Region Routing Fix

## Problem

`open-sse/executors/kiro.js:getOrderedBaseUrls(credentials)` derived the AWS region only from `credentials?.providerSpecificData?.region`. For IAM Identity Center (IdC) accounts homed outside `us-east-1`, the region is encoded in the `profileArn` (e.g. `arn:aws:codewhisperer:eu-central-1:...`), not in a separate `region` field. Without that extraction, IdC tokens minted in `eu-central-1` were sent to the hardcoded `us-east-1` endpoints, causing 403 "bearer token invalid".

`open-sse/config/kiroConstants.js` already exported a `resolveKiroRegion` shim that accepts either a string or a credentials object and delegates to `resolveKiroRegionFromCredentials` in `kiroRegions.js`, which reads `providerSpecificData.region` and falls back to `regionFromProfileArn(profileArn)`. `kiro.js` imported the bare `resolveKiroRegion` from `kiroRegions.js` and never called it.

## Change

### `open-sse/executors/kiro.js`

- Import `resolveKiroRegion` from `../config/kiroConstants.js` (alongside the already-imported `resolveKiroDataPlaneUrl`).
- Remove the now-unused direct import from `../config/kiroRegions.js`.
- In `getOrderedBaseUrls`, compute `const region = resolveKiroRegion(credentials)` once and use it for both the regional data-plane URL and the regionalization fallback.

Before:

```js
const regional = resolveKiroDataPlaneUrl(credentials?.providerSpecificData?.region);
// ...
const region = (credentials?.providerSpecificData?.region || "us-east-1").trim();
const regionalize = (u) =>
  region && region !== "us-east-1" && u.includes("amazonaws.com")
    ? u.replace(/([a-z]+)\.[a-z0-9-]+\.amazonaws\.com/, `$1.${region}.amazonaws.com`)
    : u;
```

After:

```js
const region = resolveKiroRegion(credentials);
const regional = resolveKiroDataPlaneUrl(region);
// ...
const regionalize = (u) =>
  region && region !== "us-east-1" && u.includes("amazonaws.com")
    ? u.replace(/([a-z]+)\.[a-z0-9-]+\.amazonaws\.com/, `$1.${region}.amazonaws.com`)
    : u;
```

### `tests/unit/kiro-region.test.js`

Added a new `describe` block covering `KiroExecutor.getOrderedBaseUrls` region routing:

- Default `us-east-1` ordering when no region or `profileArn` is provided.
- Regional routing for an IdC credential whose `profileArn` is homed in `eu-central-1`.

The new test asserts that an IdC credentials object with
`profileArn: arn:aws:codewhisperer:eu-central-1:123456789:profile/abcdef`
produces base URLs containing `eu-central-1` (specifically `https://q.eu-central-1.amazonaws.com/generateAssistantResponse`).

## Verification

A `tests/` working-directory attempt failed with a module resolution issue:

```bash
cd /home/cortexos/Developer/github.com/bloodf/durindoor/.omc/wt-v2-kiro-region/tests
npx vitest run --config vitest.config.js ../tests/unit/kiro-region.test.js --reporter=dot
```

Result:

```
Error: Cannot find module '/home/cortexos/Developer/github.com/bloodf/durindoor/.omc/wt-v2-kiro-region/tests/stream' imported from /home/cortexos/Developer/github.com/bloodf/durindoor/tests/node_modules/vitest/dist/module-evaluator.js
```

Retrying from the worktree root with the config path relative to repo root passed:

```bash
cd /home/cortexos/Developer/github.com/bloodf/durindoor/.omc/wt-v2-kiro-region
npx vitest run --config tests/vitest.config.js tests/unit/kiro-region.test.js 2>&1 | tail -40
```

Result:

```
 RUN  v4.1.10 /home/cortexos/Developer/github.com/bloodf/durindoor/.omc/wt-v2-kiro-region

 Test Files  1 passed (1)
      Tests  10 passed (10)
   Start at  23:39:58
   Duration  648ms (transform 350ms, setup 0ms, import 544ms, tests 5ms, environment 0ms)
```

All 10 tests in `kiro-region.test.js` pass, including the new `profileArn`-derived routing assertions. I did not run `npm install` or modify `package.json` / `package-lock.json`.

## Out of scope

- SSE parser changes (P0 #8) — not touched.
- `https://undefined` guard in `buildKiroProfileEndpoint` (P2 #31) — not touched.

## Commit

```
fix(kiro): route by region derived from profileArn
```
