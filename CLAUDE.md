# DurinDoor

DurinDoor is a self-hosted AI Gateway that unifies multiple LLM providers behind a single OpenAI-compatible API. Forked from 9router with enhanced features and LOTR-inspired branding.

This file is a project overview. The **operational contract for any agent working in this repo** is `AGENTS.md` in this same directory. Read it before doing anything non-trivial. In particular:

- Agent contract, forbidden edits, commit types → `AGENTS.md` §1–§3
- Translator layer conventions and pitfalls → `AGENTS.md` §4
- open-sse layout, lifecycle, conventions → `AGENTS.md` §5
- **DinoStack (Hermes-only) install + AI-review/CI workflow rules → `AGENTS.md` §6–§7**
- Quick commands → `AGENTS.md` §8

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

This project uses conventional commits with a custom `port` type. The full type list and the `port(upstream): #N - <title>` format are defined in `.commitlintrc.json` and `AGENTS.md` §3.

## Branch Model

Two-branch release model:
- `main` — controlled production releases via GitHub Releases (`release.yml`, publishes to npm on `release: published`)
- `dev` — active development + nightly pre-releases (`nightly.yml`, runs daily at 02:00 UTC, marked `prerelease: true`)

Default PR target is `dev`. PR target rules, worktree discipline, CI gates, and AI-review handling are in `AGENTS.md` §7.
