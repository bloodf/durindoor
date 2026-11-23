# #1072: deferred PRs resolved (2026-11-22)

| PR | Title | Head SHA (12) | Disposition | Evidence |
| --- | --- | --- | --- | --- |
| [#1375](https://github.com/decolua/9router/pull/1375) | Fix Provider Kiro erro: Improperly formed request | 8323de800f24 | split | Dedicated Kiro tool-name unit: update both request translators, historical tool uses, name mapping and both response translators. Preserve unique names within the 64-character limit, round-trip original names, and existing schema normalization. Test collisions, history, and OpenAI and Claude streaming responses. |
| [#1347](https://github.com/decolua/9router/pull/1347) | fix(models): persist custom model token limits | f6f39561e479 | split | Dedicated model metadata unit: update custom model API and alias repository, list and info endpoints and effective metadata resolution. Define and test validation, persistence, alias matching and precedence against static and live metadata, including duplicate models. |
| [#1340](https://github.com/decolua/9router/pull/1340) | Handle non-JSON OAuth errors | 61e23952afe4 | ported | OAuth response parsing handles text and empty errors in exchange, device polling, status polling and fixed proxy flows. `tests/unit/port9r-oauth-errors-1340.test.js` covers text errors, polling data and empty responses. |
