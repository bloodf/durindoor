# Upstream PR Port — #3194 Codex OAuth Reauthorization (2026-08-11)

| PR | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| [#3194](https://github.com/decolua/9router/pull/3194) `fix(codex): require reauthorization after permanent OAuth invalidation` | PORTED | Permanent Codex OAuth invalidation responses were handled as transient model cooldowns, leaving unusable credentials eligible after the short lock expired. A successful reauthorization retained the old quarantine, errors, and model locks. | Recognize permanent invalidation signatures, quarantine with `reauth_required`, retain HTTP `401` error code, clear persisted model locks, and reactivate/clean a same-account OAuth reauthorization. Tests: `tests/unit/codex-reauth-required.test.js`, `tests/unit/github-monthly-usage-lock.test.js`. |

## Fork adaptations

- Retain `errorCode: 401`, matching this fork's existing Codex invalidation regression and preserving the stored upstream HTTP status.
- Clear existing `modelLock_*` fields as `null` on quarantine so database state cannot retain a stale cooldown.
- Reauthorization matches this fork's resolved Codex account identity; same-email rows without the same account ID remain distinct.

## Verification

- Red before production changes: `tests/unit/codex-reauth-required.test.js` — 2 failed, 1 passed; permanent invalidation took normal cooldown and reauthorization preserved `isActive: false` / `testStatus: "reauth_required"`.
- Green: `tests/node_modules/.bin/vitest run --root . --config tests/vitest.config.js tests/unit/codex-reauth-required.test.js tests/unit/github-monthly-usage-lock.test.js` — 2 files passed, 7 tests passed.
