# Upstream PR Port — #10243 Codex OAuth Fingerprint Convergence (2026-08-14)

| PR | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| [#10243](https://github.com/diegosouzapw/OmniRoute/pull/10243) `feat(codex): add OAuth fingerprint convergence modes` (`8417ace4b37`) | PORTED | Codex OAuth client identity had no user-selectable convergence policy; upstream added modes for preserving caller identity or deriving account-scoped device/session/thread carriers. | Added `codexFingerprintMode` with `off`, `device`, `session`, and `full`; route resolved carriers to Codex headers and `client_metadata`; preserve caller identity in `off`; skip compact requests; expose setting in Codex OAuth create/edit UI. Tests: `tests/unit/codex-identity.test.js`, `tests/unit/codex-fingerprint-execute.test.js`. |

## Fork adaptations

- Ported TypeScript behavior to this fork's JavaScript `open-sse` implementation without adding dependencies.
- Used DurinDoor-specific deterministic salts; never copied OmniRoute branding into persisted identity seeds.
- Kept existing ChatGPT account binding and local responses-lite request handling.
- Excluded unrelated upstream dependency, `.gitignore`, and quality-baseline changes.

- Persist only the validated `codexFingerprintMode`; strip request-scoped identity snapshots on every provider save path and again when building request-local credentials.
- For `session` and `full`, replace caller identity carriers in headers and nested `client_metadata` before writing the generated account identity. Preserve upstream `device` metadata merge behavior.
- Bound the selected mode to OAuth flows, and applied it to generic OAuth, access-token import, and Codex bulk-import creation paths. Removed unreachable Codex API-key UI.
- Client connection payloads expose only a validated durable mode; transient identity data remains server-only.
- Added focused unit tests for persisted-transient scrub, durable mode survival, request-boundary carrier replacement, and `device` metadata merge before the production edit.

## Verification

- Red before production changes: focused failing tests landed ahead of implementation in `702452dcb test(codex): reject persisted transient identity` and `723608756 test(codex): cover durable fingerprint metadata`.
- Production, UI, routing, normalizer, and sanitizer changes are committed on `port/upstream-20260814-a03`; latest write-boundary fix: `48cfa930ca4bc95f30375d08015241432b264c30 fix(codex): normalize provider metadata write boundaries`.
- Focused write-boundary validation passed at that commit: `tests/unit/api-providers-id-priority-6626.test.js` and `tests/unit/codex-bulk-import-identity.test.js` — 2 files, 4 tests.
- Broader fingerprint command remains: `tests/node_modules/.bin/vitest run --root . --config tests/vitest.config.js tests/unit/codex-identity.test.js tests/unit/codex-fingerprint-execute.test.js`.
