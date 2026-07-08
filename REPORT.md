# VeoAIFree Web Executor Unblock Report

## Summary
Removed `veoaifree-web` from the `BLOCKED_OMNIROUTE_PROVIDERS` block list, wired the real `VeoAIFreeWebExecutor` into the executor dispatch map, and updated the conflicting blocked test to expect the now-unblocked behavior.

## Changes

### 1. `open-sse/executors/index.js`
- Imported `VeoAIFreeWebExecutor` from `./veoaifree-web.js`.
- Added dispatch map entries:
  - `"veoaifree-web": new VeoAIFreeWebExecutor()`
  - `"veo-free": new VeoAIFreeWebExecutor()` (registry `uiAlias`)

Now `getExecutor("veoaifree-web")` returns the concrete executor instead of the `UnsupportedOmniRouteWebSessionExecutor` 501 stub.

### 2. `open-sse/executors/unsupported-websession.js`
- Removed the `veoaifree-web` blocker object from `BLOCKED_OMNIROUTE_PROVIDERS`:

```js
"veoaifree-web": {
  aliases: ["veo-free"],
  source: [
    "open-sse/executors/veoaifree-web.ts",
    "open-sse/config/videoRegistry.ts",
    "open-sse/handlers/videoGeneration.ts",
  ],
  reason: "requires WordPress AJAX video/image workflow plumbing and video-generation routes",
},
```

### 3. `tests/unit/omniroute-websession-blocked.test.js`
- Split `portedProviders` into `webSessionProviders` (Copilot-only execute loop) and `portedProviders` (which still includes `veoaifree-web` for blocker-skip assertions).
- Updated the `excludes port-pending ...` test to assert `getProvidersByKind("video")` now **contains** `veoaifree-web`.
- Replaced the `veoaifree-web` 501 expectation test with a `yuanbao-web` example, confirming `provider_port_pending` error preservation still works for a genuinely blocked provider.

## Verification
- Confirmed `open-sse/executors/index.js` maps `veoaifree-web` and `veo-free` to `VeoAIFreeWebExecutor`.
- Confirmed `BLOCKED_OMNIROUTE_PROVIDERS` no longer contains `veoaifree-web`.
- Confirmed `tests/unit/omniroute-websession-runtime.test.js:146-160` remains the canonical routing behavior for video generation.
- Did not run tests, lint, or format per instructions. (One accidental test invocation was attempted with an incorrect path and exited before executing any tests.)

## Commit
`fix(veoaifree-web): unblock executor, dispatch to real implementation`
