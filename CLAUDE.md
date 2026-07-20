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
---

# Upstream CLAUDE.md (ported from decolua/9router #2354)

This section is DurinDoor's port of upstream CLAUDE.md guidance. Treat the package/repo/data-dir references here as 9router-shaped (port 20128, `9router-app`, `~/.9router`); DurinDoor-specific overrides live in the sections above.

## What this is

9Router (`9router-app`) — a local AI routing gateway + Next.js dashboard. It exposes one OpenAI-compatible endpoint (`/v1/*`) and routes traffic across 40+ upstream providers with format translation, model-combo fallback, multi-account fallback, OAuth/API-key credential management, token refresh, quota/usage tracking, and optional cloud sync.

Two published artifacts live in this one repo:
- The **dashboard + gateway** (root `package.json`, `9router-app`) — the Next.js server that does the actual routing.
- The **CLI launcher** (`cli/`, published to npm as `9router`) — a separate package that installs/starts the server and manages the tray. It has its own `package.json`, version, and build.

The code lives in `src/` (Next.js app + dashboard/compat APIs), `open-sse/` (the provider-agnostic routing/translation engine), `cli/` (the launcher package), and `tests/`.

## Commands

Dashboard/gateway (run from repo root):
```bash
cp .env.example .env
npm install
PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev   # dev (webpack, port 20127 by default via next dev)
npm run build && PORT=20128 HOSTNAME=0.0.0.0 npm run start           # production
```
- Bun variants: `npm run dev:bun` / `build:bun` / `start:bun`.
- Default runtime port is **20128** (dashboard at `/dashboard`, API at `/v1`).
- Lint: `npx eslint .` (config `eslint.config.mjs`, extends `eslint-config-next`).

CLI package (`cli/`):
```bash
npm run cli:pack       # build + npm pack from root
cd cli && npm run dev  # nodemon watch
```

Tests (vitest, in `tests/`, an **independent** ESM package — not wired into root `npm test`):
```bash
npm install                             # ROOT deps first — tests import from src/ which needs `open`, `undici`, etc.
cd tests && npm install                 # then tests' own deps (vitest) → tests/node_modules (allowed by tests/.gitignore)
npx vitest run                          # all tests; auto-discovers tests/vitest.config.js
npx vitest run unit/capabilities.test.js   # single file (path relative to tests/)
```
> The committed `tests/package.json` `test` script hardcodes Unix paths (`NODE_PATH=/tmp/node_modules …`) — a shared-install workaround from upstream. On Windows (or anywhere), ignore it and use the `npx vitest` form above; `vitest.config.js` resolves the `open-sse`/`@/` aliases from the repo root regardless of where vitest lives.
>
> **The suite is NOT expected to be all-green on a plain checkout.** ~938 pass, ~64 fail. Judge regressions with `tests/__baseline__/verify-no-regression.mjs`, not a raw run. Expected red:
> - 26 catalogued in `tests/__baseline__/known-fails.txt` (rtk, oauth-cursor-auto-import, translator-request-normalization, …).
> - `unit/embeddings.cloud.test.js` imports `cloud/src/handlers/embeddings.js` — the `cloud/` worker dir is **not in this repo**, so it always fails here.
> - `unit/xai-oauth-service.test.js` times out (5s) when the xAI endpoint-discovery fetch isn't reachable/mocked.
> - `real/*.real.test.js` make live provider calls — need credentials, skip otherwise.
- `*.real.test.js` under `tests/translator/real/` make live provider calls — skip unless credentials are set.
- Regression baselines: `tests/__baseline__/verify-*.mjs` compare against committed snapshots (providers, aliases, OAuth URLs). Run these after touching provider registry / alias logic.

## Architecture

Two authoritative docs already exist — read them before working in these areas rather than re-deriving:
- `docs/ARCHITECTURE.md` — full system: request lifecycle, combo/account fallback, OAuth + token refresh, cloud sync, data model.
- `open-sse/AGENTS.md` — the routing/translation engine's own conventions and "how to add a provider/executor/translator". **Read this before editing anything under `open-sse/`.**

### Request flow (the thing to understand first)
`src/app/api/v1/*` route (Next rewrite maps `/v1/*` → `/api/v1/*` in `next.config.mjs`)
→ `src/sse/handlers/chat.js` (parse, combo expansion, account-selection loop)
→ `open-sse/handlers/chatCore.js` (detect source format, translate request, dispatch to executor, retry/refresh, stream setup)
→ `open-sse/executors/*` (per-provider upstream call; `default.js` handles any OpenAI-compatible provider)
→ `open-sse/translator/*` (client format ↔ provider format)
→ SSE back to client.

`src/sse/` is the app-side entry glue; `open-sse/` is the provider-agnostic engine (also usable standalone). Cross that boundary consciously.

### Translator engine (`open-sse/translator/`)
- Pivots through **OpenAI as the intermediate format**. A translator registered on an exact `source:target` pair (e.g. `claude:kiro`) runs as a **direct route**, skipping the lossy double-hop. Prefer a direct route for fragile pairs (thinking blocks, tool ids, non-base64 images, `is_error`).
- Translators **self-register** via `register(from, to, reqFn, resFn)` as an import side effect — a new translator file MUST be imported in `open-sse/translator/index.js` or it never runs.
- Never hardcode role/block/model strings — use `open-sse/translator/schema/` and `open-sse/config/` constants. Config-driven and DRY is enforced by convention here.

### Provider registry (`open-sse/providers/registry/*`)
- One file per provider. `providers/registry/index.js` is an **auto-generated** static import list — regenerate it with `scripts/migrate-registry.mjs` / `injectDisplayToRegistry.mjs`, don't hand-edit.
- Add a provider: copy `providers/REGISTRY_TEMPLATE.js`, add models to `config/providerModels.js`. Only add an executor for non-OpenAI-compatible upstreams.

### Persistence — IMPORTANT (ARCHITECTURE.md is stale here)
State is **no longer `db.json`**. It's a SQLite layer under `src/lib/db/` with an adapter fallback chain (`driver.js`): `bun:sqlite` → `better-sqlite3` (optional native dep) → `node:sqlite` (Node ≥22.5) → `sql.js` (pure-JS fallback, always works). `better-sqlite3` is deliberately in `optionalDependencies` so install never fails without build tools.
- `src/lib/localDb.js` is a **backward-compat shim** re-exporting `src/lib/db/index.js`. New code should import from `@/lib/db/index.js`; per-entity logic lives in `src/lib/db/repos/*`. Schema/migrations in `src/lib/db/migrations/`.
- DB file location resolves via `src/lib/db/paths.js` (`DATA_DIR`, else `~/.9router/`).
- Usage/logs (`src/lib/usageDb.js`, `usage.json` + `log.txt`) still live under `~/.9router` and do **not** follow `DATA_DIR`.

### RTK token saver (`open-sse/rtk/`)
Pre-translate hooks that compress `tool_result` content in-place to cut tokens. **Fail-open**: any error returns null and leaves the body untouched — never throw out of them. Skips `is_error`/`status:"error"` results to preserve traces.

## Conventions & gotchas

- Plain JavaScript (ESM), no TypeScript. `@/*` path alias → `src/*` (`jsconfig.json`).
- `custom-server.js` wraps the Next standalone server to derive client IP from the TCP socket and strip attacker-controlled `X-Forwarded-For` — trusting forwarding headers only from a loopback reverse proxy. Preserve this when touching request/IP/rate-limit code.
- Security-sensitive env: `JWT_SECRET` (session cookie), `INITIAL_PASSWORD` (default `123456` — must override), `API_KEY_SECRET`, `MACHINE_ID_SALT`. Full env contract in `.env.example` and ARCHITECTURE.md's env matrix.
- Binary/protobuf upstreams (kiro EventStream, cursor protobuf, commandcode NDJSON) don't round-trip through OpenAI — they're handled inside their own executor, not the translator.
- Versioning: root and `cli/` are versioned independently; changes are logged in `CHANGELOG.md`. Commit style is Conventional Commits (`fix(translator): …`, `feat(...)`).
