# PXPIPE Remote Dashboard Access Design

## Problem

DurinDoor's production runtime bundles `pxpipe-proxy` and executes its transforms in-process. The package is installed, loaded, and healthy, but a dashboard opened through the public reverse proxy cannot read or manage it. `src/dashboardGuard.js` classifies the complete `/api/pxpipe/*` prefix as local-only, so valid remote dashboard sessions receive HTTP 403 with `Local only: CLI token required`.

Both the Token Saver settings client and the PXPIPE overview store that error body as PXPIPE status without checking `response.ok`. Because the body has no `installed` property, their falsy checks render `Not installed`; the settings card also recommends reinstalling the application.

## Decision

Replace the blanket PXPIPE local-only classification with a dedicated PXPIPE authorization branch:

- A non-local/proxied request must carry a valid dashboard JWT or machine-bound CLI token, regardless of the `requireLogin` setting.
- A direct local request preserves the current dashboard policy: a valid JWT or CLI token is accepted, and `requireLogin=false` permits local access.
- An unauthorized non-local request receives HTTP 401 instead of being mislabeled as a missing dependency.

Authenticated remote sessions can use status, health, logs, statistics, start, stop, and restart. No PXPIPE route falls through to the generic `isAuthenticated()` branch for non-local requests, because that branch deliberately treats `requireLogin=false` as authenticated.

This differs from upstream 9router PR #3078, which protected an older PXPIPE design with a runtime-install/command-execution surface. DurinDoor's current routes never install packages or spawn commands: start imports the declared dependency, stop drops the in-process module cache, and restart performs both operations.

## Client behavior

Both status consumers will check the HTTP response before replacing status. A failed request will preserve an explicit unavailable/error state rather than manufacturing `installed: false`.

A small pure status-view helper in the PXPIPE dashboard module will classify the API state for both clients so the UI and unit test share one contract:

- `installed === false`: the dependency is genuinely missing;
- status request error: PXPIPE status is unavailable and the server's error is shown;
- `installed === true`: render the running, stopped, or healthy state normally.

The settings card's dependency warning and disabled toggle will use an exact `installed === false` check rather than treating missing status data as proof that the package is absent. The overview will show the same `Unavailable` classification and diagnostic. The health response remains separate and continues to show its own actionable diagnostics.

## Security

- No PXPIPE endpoint becomes public.
- Every proxied/non-local request requires a valid dashboard JWT or CLI token even when `requireLogin=false`.
- Direct local no-login access remains available when the operator explicitly disables login.
- No API key grants PXPIPE management access.
- No runtime package installation, shell execution, arbitrary module path, or request-content disclosure is introduced.
- Package resolution remains constrained to the declared `pxpipe-proxy` dependency and its `./transform` export.

## Verification

1. Add dashboard-guard tests proving a proxied request with a valid dashboard JWT is accepted and the same request without JWT/CLI authentication is rejected, including when `requireLogin=false`.
2. Unit-test the pure PXPIPE status-view helper to prove an API error is classified as unavailable with its diagnostic, never as `Not installed` or a reinstall recommendation.
3. Keep the existing install-detection test proving a genuinely absent dependency maps to `installed: false`.
4. Run focused dashboard-guard, PXPIPE, and Token Saver tests.
5. Deploy the release and verify through the public dashboard origin that status reports `pxpipe-proxy` v0.9.0, health passes, and authenticated start, stop, and restart controls work.
