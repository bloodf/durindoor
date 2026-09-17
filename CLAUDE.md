# DurinDoor

DurinDoor is a self-hosted AI gateway that puts many LLM providers behind one OpenAI-compatible API. It is a fork of 9router. The look is LOTR-inspired.

This file is a project overview. The contributor contract is `AGENTS.md` in this directory. Read that first.

## Quick reference

- npm package: `durindoor`
- GitHub: https://github.com/bloodf/durindoor
- Port: 20128 (production), 20127 (dev)
- Data dir: DATA_DIR, default ~/.9router (shared with 9router installs)

## Compatibility

Default everywhere is DurinDoor (display) / `durindoor` (lowercase IDs).

The server accepts legacy 9router identifiers at the runtime boundary only, for read-only support of existing user installs:

- Legacy API keys in the `sk-<8 hex>` shape keep working; new keys use `sk-<machineId>-<keyId>-<crc8>` (`src/shared/utils/apiKey.js`)
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

The suite lives in `tests/`, its own package. From the repo root:

```bash
cd tests && npm install && npm run test:ci
```

`test:ci` runs Vitest, then `tests/__baseline__/verify-no-regression.mjs`. `tests/__baseline__/known-fails.txt` is empty, so every failing assertion is a regression. Do not add lines to that file. A checked-in `baseline-results.json` is an old report from another tree; it is not a live count for this checkout.

Translator tests that call `translateRequest` or `translateResponse` must import `translator/registerAll.js`. Live provider tests under `tests/translator/real/` run only with `RUN_REAL=1`.

## Conventional commits

The full rules live in `AGENTS.md`. The same limits are repeated here so they stay visible in the overview.

### Allowed types

From `.commitlintrc.cjs` `type-enum`:

- `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `ci`, `chore`, `revert`, `merge`, `port`, `sync`
- `port` is custom; conventional scopes are `port(upstream)` and `port(omniroute)`:
  - `port(upstream): #<N> - <title>` for upstream 9router PR ports
  - `port(omniroute): <title>` for OmniRoute cross-fork ports
- `sync` is allowed. Bare upstream release-tag subjects matching the regex `^# v\d+\.\d+\.\d+ \([^)]+\)$` (e.g. `# v1.2.3 (anything-without-closing-paren)`) are ignored by commitlint and skip every rule; durindoor's own `sync:` commits still must pass all rules. The date form (`# vX.Y.Z (YYYY-MM-DD)`) is the repo convention, but the ignored pattern is broader.

### Length rules

- Subject text (`<subject>` in `type(scope): <subject>`) is max 100 characters (`subject-max-length: [2, "always", 100]`). This does not include the type/scope prefix; `header-max-length` is disabled.
- Body lines are max 200 characters (`body-max-line-length: [1, "always", 200]`), enforced as a warning.
- Header and footer line length are not enforced; `subject-case` is disabled.
- `subject-empty` and `type-empty` are hard errors.

### Pre-push checklist

```bash
npx commitlint --from=origin/main --to=HEAD
```

Must exit `0` before every `git push`; rewrite commits if it fails.

### PR title checklist

Squash-merge uses the PR title as the commit subject.

```bash
echo "<pr-title>" | npx commitlint
```

Replace `<pr-title>` with the actual PR title; rewrite the title if it fails.

### Good examples

- `fix(translator): stop leaking literal <think> markers into OpenAI chunks`
- `feat(config): add per-model timeout to combo fallback`
- `port(upstream): #2646 - per-model timeout for faster combo fallback`

### Bad examples

- `fixed translator bug` (missing type prefix)
- `fix(translator): stop leaking literal <think> markers into OpenAI chunks and also handle nested reasoning blocks that some providers emit` (subject text exceeds 100 characters)
- `build: add release script` (`build` is not in the allowed `type-enum` list)

## Branch model

`main` is the default branch (post v2.2.0) and the source for both production releases and nightly pre-releases. Release flow: feature PR to `main`, then tag (`vX.Y.Z`). `release.yml` publishes to npm. `docker-publish.yml` builds multi-arch images. `nightly.yml` runs daily at 02:00 UTC and publishes a `nightly-YYYY-MM-DD` GitHub pre-release.

Default PR target is `main`. PR checklist, commit rules, and test workflow are in `AGENTS.md`.
