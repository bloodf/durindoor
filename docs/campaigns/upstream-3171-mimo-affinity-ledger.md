# Upstream PR Port — #3171 MiMo affinity (2026-08-11)

| PR | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| [#3171](https://github.com/decolua/9router/pull/3171) `fix(mimo): use connection id for session affinity` | PORTED | `MimoFreeExecutor` created one executor-scoped `sessionId`, so different connections sharing an executor emitted the same `x-session-affinity` value. | Resolve session affinity from `credentials.connectionId` for each request. Generate a fresh `ses_` fallback when absent. Tests prove distinct supplied connection IDs and independent fallback calls. |

## Adaptation

Fork adaptation: this fork represents public no-auth credentials with `connectionId: "noauth"`; treat that sentinel like an absent ID so every request gets a fresh generated affinity instead of the literal string `noauth`.

## Verification

- RED: production-shape `{ connectionId: "noauth" }` calls produced header `x-session-affinity: noauth` on every call — not a `ses_[a-z0-9]{24}` value, and identical across calls (fails uniqueness).
- GREEN: `tests/unit/mimo-free.test.js` passed 31/31. Full `tests && npm run test:ci` reported `Raw failures: 0`; lint and production build exited 0; docs integrity passed; `tests/__baseline__/known-fails.txt` was unchanged.
