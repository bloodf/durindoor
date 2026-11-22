# #1073: verified dispositions 20868..18591 (2026-11-22)

This report is incomplete. Only the rows below have been assessed against their current upstream diffs. The remaining PRs still require verification.

| PR | Title | Head SHA (12) | Disposition | Evidence |
| --- | --- | --- | --- | --- |
| [#20521](https://github.com/cheaper-inference/OmniRoute/pull/20521) | fix(openapi): make the tier checker method-aware and align the loopback annotations | `ecda81f51f72` | not applicable | The change targets upstream's OpenAPI security-tier CI checker and its route-guard annotations. DurinDoor has neither `scripts/check/check-openapi-security-tiers.mjs` nor `src/server/authz/routeGuard.ts`. |
| [#19258](https://github.com/cheaper-inference/OmniRoute/pull/19258) | fix(routing): account for preferred timeout fallback in telemetry | `6d612421003c` | not applicable | The changed branch records a hop after upstream's preferred-account response-start timeout. DurinDoor's `src/sse/handlers/chat.js` pins an explicitly preferred connection and treats its failure as terminal; it has no `preferredAccountFailover` timeout setting or equivalent branch. |
