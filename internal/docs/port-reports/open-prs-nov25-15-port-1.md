# Port report: open PRs rows 561–600, port candidates 1–8

Source: [open-prs-nov25-15.md](open-prs-nov25-15.md). That report has four port-candidate rows, so this batch covers all of them. The current head of each PR matched the head SHA in the source report. All four PRs were still open.

| Row # | PR | Final disposition | Evidence |
|---:|---|---|---|
| 564 | [decolua/9router#3219](https://github.com/decolua/9router/pull/3219) | Ported in this change | `describeProviderError` in [error.js](../../../open-sse/utils/error.js) cut the stored reason at 100 characters, and [connectionsRepo.js](../../../src/lib/db/repos/connectionsRepo.js) replaced any longer reason with a generic one. Both now use `ACCOUNT_ERROR_MESSAGE_MAX_CHARS` (2000) from [runtimeConfig.js](../../../open-sse/config/runtimeConfig.js). Sanitising still applies. Test: [port-3219-account-error-reason.test.js](../../../tests/unit/port-3219-account-error-reason.test.js). |
| 575 | [decolua/9router#3194](https://github.com/decolua/9router/pull/3194) | Already present | Commit `f265d08e925` (#422). [accountErrors.js](../../../src/sse/services/auth/accountErrors.js) matches the same five invalidation markers on a Codex 401, sets the account inactive with `reauth_required`, and returns fallback with no cooldown. `mergeCodexReauthorization` in [connectionsRepo.js](../../../src/lib/db/repos/connectionsRepo.js) reactivates the same account. Test: [codex-reauth-required.test.js](../../../tests/unit/codex-reauth-required.test.js). |
| 577 | [decolua/9router#3190](https://github.com/decolua/9router/pull/3190) | Already present | DurinDoor uses separate provider IDs instead of upstream's `authType` transport field. Every transport of [kimi.js](../../../open-sse/providers/registry/kimi.js) (API key) is on Moonshot Open Platform with Bearer auth. [kimi-coding.js](../../../open-sse/providers/registry/kimi-coding.js) (OAuth) stays on Kimi Code. The connection test in `src/app/api/providers/[id]/test/testUtils.js` probes the platform URL and rejects only 401 and 403, so 402 and 429 count as authenticated. The earlier test fix is commit `d991f95f440` (#420). Upstream's balance warning is not ported: this connection test returns no warning field. This change adds a routing pin: [port-3190-kimi-auth-routing.test.js](../../../tests/unit/port-3190-kimi-auth-routing.test.js). |
| 591 | [decolua/9router#3163](https://github.com/decolua/9router/pull/3163) | Already present | Commit `8ff5ea0683c` (#399). The usage chart component sends the browser time zone, [the chart route](../../../src/app/api/usage/chart/route.js) forwards `tz`, and `getChartData` in [usageRepo.js](../../../src/lib/db/repos/usageRepo.js) validates it and uses it for day boundaries and hour labels. Tests: [usage-period-tz.test.js](../../../tests/unit/usage-period-tz.test.js) and [usage-period-routes.test.js](../../../tests/unit/usage-period-routes.test.js). |

## Behaviour change in #3219

- Within one request, the client already received the full upstream error. The cut affected the stored account error, and the replay of it to later requests while a 400 or 402 model lock was active.
- [error-sanitize.test.js](../../../tests/unit/error-sanitize.test.js) expected the 100-character limit. Its two boundary tests now use the shared constant. This is the intended change of the ported PR.
- Rate-limit failures still store the fixed text `Rate limited`.

## Not changed

These are outside the four PR diffs.

- The Qoder quota disable path in [accountErrors.js](../../../src/sse/services/auth/accountErrors.js) keeps its own 200-character cut.
- With a `tz` value, the `today` chart in [usageRepo.js](../../../src/lib/db/repos/usageRepo.js) always builds 24 hour buckets. A day with a clock change has 23 or 25 hours. The upstream diff also uses 24. The path without `tz` counts the real hours.
- The `kimi` connection test sends the model ID `kimi-for-coding`, which the platform catalog in [kimi.js](../../../open-sse/providers/registry/kimi.js) does not list. The test reads only 401 and 403 as failure.
