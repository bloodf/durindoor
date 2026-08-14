# Upstream PR Port — #10243 Codex OAuth Fingerprint Convergence (2026-08-14)

| PR | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| [#10243](https://github.com/diegosouzapw/OmniRoute/pull/10243) `feat(codex): add OAuth fingerprint convergence modes` (`8417ace4b37`) | PORTED | Codex OAuth client identity had no user-selectable convergence policy; upstream added modes for preserving caller identity or deriving account-scoped device/session/thread carriers. | Added `codexFingerprintMode` with `off`, `device`, `session`, and `full`; route resolved carriers to Codex headers and `client_metadata`; preserve caller identity in `off`; skip compact requests; expose setting in Codex OAuth create/edit UI. Tests: `tests/unit/codex-identity.test.js`, `tests/unit/codex-fingerprint-execute.test.js`. |

## Fork adaptations

- Ported TypeScript behavior to this fork's JavaScript `open-sse` implementation without adding dependencies.
- Used DurinDoor-specific deterministic salts; never copied OmniRoute branding into persisted identity seeds.
- Kept existing ChatGPT account binding and local responses-lite request handling.
- Excluded unrelated upstream dependency, `.gitignore`, and quality-baseline changes.

## Verification

- Red before production changes: `tests/unit/codex-identity.test.js` committed as `5fb8b6f9c`.
- Focused command for orchestrator: `tests/node_modules/.bin/vitest run --root . --config tests/vitest.config.js tests/unit/codex-identity.test.js tests/unit/codex-fingerprint-execute.test.js`.
- This worktree did not run validation by campaign contract.
