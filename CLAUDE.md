# DurinDoor

DurinDoor is a self-hosted AI Gateway that unifies multiple LLM providers behind a single OpenAI-compatible API. Forked from 9router with enhanced features and LOTR-inspired branding.

This file is a project overview. The **operational contract for any agent working in this repo** is `AGENTS.md` in this same directory. Read it before doing anything non-trivial. In particular:

- Agent contract, forbidden edits, commit types → `AGENTS.md` §1–§3
- Translator layer conventions and pitfalls → `AGENTS.md` §4
- open-sse layout, lifecycle, conventions → `AGENTS.md` §5
- PR workflow, CI gates, and AI-review handling → `AGENTS.md` §6
- Quick commands → `AGENTS.md` §7

## Quick Reference

- **npm package**: `durindoor`
- **GitHub**: https://github.com/bloodf/durindoor
- **Port**: 11434 (production), 20127 (dev)
- **Data dir**: `/opt/cortexos/.9router` (shared with 9router for migration compat)

## Compatibility

Default everywhere is **DurinDoor** (display) / **durindoor** (lowercase IDs).

The server accepts legacy 9router identifiers **at the runtime boundary only**, for read-only support of existing user installs:
- API key prefix `sk_9router-*` (existing keys continue to work; new keys are minted as `sk_durindoor-*`)
- Provider section labels `9router` in incoming CLI tool configs
- HTTP request header `X-Msh-Platform: 9router`
- Data directory `~/.9router/`

A one-shot cutover script ships as `scripts/migrate-from-9router.mjs` (idempotent; backup-before-any-move; never rewrites API key secrets).

## Build

```bash
npm install --no-audit --no-fund
npm run build          # Next.js production build (--webpack)
npm run dev            # Dev server on port 20127
```

## Test

```bash
cd tests && npm install && npx vitest run --reporter=verbose
```

## Conventional Commits

This project uses conventional commits. The authoritative contract is `AGENTS.md` §3 and §6.3; the same rules are summarized here so every contributor sees them in the project overview.

**Allowed types** (from `.commitlintrc.cjs` `type-enum`):
- `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `ci`, `chore`, `revert`, `merge`, `port`, `sync`
- `port` is custom; conventional scopes are `port(upstream)` and `port(omniroute)`:
  - `port(upstream): #<N> - <title>` for upstream 9router PR ports
  - `port(omniroute): <title>` for OmniRoute cross-fork ports
- `sync` is allowed. Bare upstream release-tag subjects matching the regex `^# v\d+\.\d+\.\d+ \([^)]+\)$` (e.g. `# v1.2.3 (anything-without-closing-paren)`) are ignored by commitlint and skip every rule; durindoor's own `sync:` commits still must pass all rules. The date form (`# vX.Y.Z (YYYY-MM-DD)`) is the repo convention, but the ignored pattern is broader.

**Enforced length/tolerances**:
- Subject text (`<subject>` in `type(scope): <subject>`) is **max 100 characters** (`subject-max-length: [2, "always", 100]`). This does not include the type/scope prefix; `header-max-length` is disabled.
- Body lines are **max 200 characters** (`body-max-line-length: [1, "always", 200]`), enforced as a warning.
- Header and footer line length are not enforced; `subject-case` is disabled.
- `subject-empty` and `type-empty` are hard errors.

**Mandatory pre-push checklist**:
```bash
npx commitlint --from=origin/dev --to=HEAD
```
Must exit `0` before every `git push`; rewrite commits if it fails.

**Mandatory PR-title checklist** (squash-merge uses the PR title as the commit subject):
```bash
echo "<pr-title>" | npx commitlint
```
Replace `<pr-title>` with the actual PR title; rewrite the title if it fails.

**Good examples:**
- `fix(translator): stop leaking literal <think> markers into OpenAI chunks`
- `feat(config): add per-model timeout to combo fallback`
- `port(upstream): #2646 - per-model timeout for faster combo fallback`

**Bad examples:**
- `fixed translator bug` — missing type prefix
- `fix(translator): stop leaking literal <think> markers into OpenAI chunks and also handle nested reasoning blocks that some providers emit` — subject text exceeds 100 characters
- `build: add release script` — `build` is not in the allowed `type-enum` list

## Branch Model

Two-branch release model:
- `main` — controlled production releases via GitHub Releases (`release.yml`, publishes to npm on `release: published`)
- `dev` — active development + nightly pre-releases (`nightly.yml`, runs daily at 02:00 UTC, marked `prerelease: true`)

Default PR target is `dev`. PR target rules, worktree discipline, CI gates, and AI-review handling are in `AGENTS.md` §6.
