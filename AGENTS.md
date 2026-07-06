# AGENTS.md

This file is the operational contract for any agent — including the Hermes cron agent looking after this repository, the OMC agent, durindoor-bot, and bots operating in maintainer workflows (Codex, CodeRabbit, Copilot) — that edits code in this repository on behalf of a maintainer.

## Repository-agent contract

Per the user requirement: *"the hermes agent that is taking care of the repository must always add documentation, unit testing for everything that he is developing."*

Every change developed in this repository — regardless of stream (upstream-port, rebrand, refactor, feature, fix, CI, docs) — MUST include:

1. **Documentation updates — ALWAYS required.** Pick the smallest fitting form:
   - Inline JSDoc / module-header comments for the change site.
   - A `README.md`, `docs/`, or `gitbook/content/<locale>/` update.
   - A scoped `.md` file committed with the change (e.g. an ADR for architecture decisions).
   - For docs-only / config-only PRs, the PR body serves as the documentation; link from `CHANGELOG.md` if user-visible.

2. **Unit tests — REQUIRED when the change is code or behavior.** When the PR modifies runtime behavior (new function, altered call chain, schema migration, translator logic, parse changes), include at least one test in `tests/unit/*.test.js` or `tests/translator/*.test.js` (or functional/API test under `tests/`). For docs-only, format-only (`.md` reword with no behavior change), or CI-only changes, tests are not required but recommended if cheap.
   - Tests must pass locally: `cd tests && npm run test:ci`.
   - Tests MUST NOT grow `tests/__baseline__/known-fails.txt`.

The Hermes cron agent — and any other look-after-the-repo agent — MUST verify both items are satisfied in a PR before merging, fast-forwarding, or otherwise declaring the work complete.

## Forbidden edits in this repository

- Do NOT rewrite existing API key secret strings (e.g. user keys stored in the DB). The server's validator (`src/shared/utils/apiKey.js`) accepts both legacy `sk-<8 hex>` and current `sk-<machineId>-<keyId>-<crc8>` shapes; legacy keys remain valid without rotation.
- Do NOT modify `tests/__baseline__/known-fails.txt` (unless removing entries for tests fixed in this PR).
- Do NOT push to `main` directly.
- Do NOT delete `~/.9router` user files or `~/.9router-backup-*.tar` backups.

## Conventions

- Commit messages follow Conventional Commits with the project's custom types:
  - `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:`, `style:`, `perf:`, `build:`
  - `port(upstream): #<N> - <title>` for upstream 9router PR ports
  - `port(omniroute): <title>` for OmniRoute cross-fork ports
  - `feat(rebrand): <title>` / `chore(rebrand): <title>` / `docs(rebrand): <title>` for the DurinDoor brand refresh
- Branching: one branch per independent PR; never share a worktree between PRs. Force-push only on the branch being amended.
- Tests baseline: `tests/__baseline__/known-fails.txt` is the curated list of pre-existing test failures. Adding entries is a hard gate — reverts required if a port adds new failures.
- Wire-format compat (read-only at server boundary):
  - Existing stored API keys remain valid as `sk-<8 hex>` or `sk-<machineId>-<keyId>-<crc8>`
  - `[providers.9router]` section labels accepted in incoming CLI tool configs
  - `X-Msh-Platform: 9router` request headers accepted
  - `~/.9router/` data directory accepted
  Default generated keys use the `sk-...` format; `sk_durindoor` is only a local no-auth placeholder used in CLI setup snippets.
