# #1072: 9router master commits since v0.5.119 (2026-11-23)

This report is incomplete. Six commits still require disposition and applicable ports.

| Commit | Title | Date | Disposition | Evidence |
| --- | --- | --- | --- | --- |
| [6b8b7ceb9f](https://github.com/decolua/9router/commit/6b8b7ceb9f8809b6df73a4c3bf4d6c98295cd734) | fix(antigravity): align the client identity with the live IDE and keep the UA shape | 2026-11-22 | ported | `src/mitm/antigravityIdeVersion.js::rewriteAntigravityUserAgent`, `open-sse/providers/shared.js`, `AntigravityExecutor.buildHeaders`; `tests/unit/port9r-identity-6b8b7ce.test.js`. |
| [1da78e2bfa](https://github.com/decolua/9router/commit/1da78e2bfabb0ed743b4ea345cd8438cb5ed3879) | fix(kiro): send the IDE identity on token refresh and align the Hydrogen changelog | 2026-11-22 | ported | `DefaultExecutor.refreshKiro`, `refreshKiroToken`, and `refreshOAuthToken` use the existing shared identity; `tests/unit/port9r-kiro-refresh-1da78e2.test.js`. Hydrogen default is part of the still-unfinished model correction. |
| [35b920c667](https://github.com/decolua/9router/commit/35b920c66709095e1cbb14e9b398fabfb93c15c3) | fix(systemone): unwrap Cloudflare's result envelope | 2026-11-20 | already present | `open-sse/handlers/systemoneCore.js::handleSystemoneCore` unwraps `result.answers`. |
