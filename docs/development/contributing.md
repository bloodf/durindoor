# Contributing to DurinDoor

DurinDoor uses `main` as its default integration and release branch. Create one focused branch per change and open pull requests against `main`.

Read the [Code of Conduct](../../CODE_OF_CONDUCT.md) and [security policy](../../.github/SECURITY.md) before contributing.

## Requirements

- Node.js `20.20.2`
- npm `10.8.2`
- Git

## Setup

```bash
nvm use
npm ci --no-audit --no-fund
cd tests && npm ci --no-audit --no-fund
```

Use an isolated worktree for each task. Set `HOME` and `DATA_DIR` to disposable locations when a command could start the app or inspect storage.

## Development workflow

1. Branch from current `origin/main`.
2. Make one focused change.
3. Add documentation for every change.
4. Add unit coverage for code or behavior changes.
5. Run focused checks, then the required gates.
6. Commit with Conventional Commits.
7. Open a pull request targeting `main` and complete the template.

## Commit and PR titles

Allowed commit types are defined in `.commitlintrc.cjs`: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `ci`, `chore`, `revert`, `merge`, `port`, and `sync`.

```text
type(scope): short description
```

Before pushing:

```bash
npx commitlint --from=origin/main --to=HEAD
```

Validate the proposed PR title because squash merge uses it as the final commit subject:

```bash
printf '%s\n' 'docs: describe the change' | npx commitlint
```

## Required gates

```bash
npm run lint
npm run lint:anti-slop
npm run build
npm run check:docs
npm run check:agent-index
npm run check:registry-index
npm run catalog:diff
cd tests && npm run test:ci
```

`npm run lint` already includes the anti-slop/oxlint gate (zero diagnostics required). Husky `pre-commit` runs `npm run lint:anti-slop` directly. See [Anti-slop gate](anti-slop.md).

Run the smallest relevant test first. The full test gate must not add entries to `tests/__baseline__/known-fails.txt`.

## Documentation changes

Repository Markdown is canonical. Do not add a docs website or a generated translation tree.

- Keep English documentation under `docs/`.
- Link to one canonical page instead of copying procedures.
- Use repository-relative links and copy-pasteable examples.
- Use `YOUR_DURINDOOR_API_KEY` and `CHANGE_ME` placeholders, never real credentials.
- Run `npm run check:docs`.

## Provider changes

1. Add or update `open-sse/providers/registry/{id}.js`.
2. Run `npm run gen:registry-index`; commit the generated index.
3. Add an executor only when the upstream is not handled by the default OpenAI-compatible executor.
4. Update models and capability metadata in the provider registry.
5. Add focused tests for auth, request format, streaming, refresh, or provider-specific behavior.
6. Update `docs/providers/`.

## Translator changes

The request path is source → OpenAI → target; responses run target → OpenAI → source. Direct routes are required when the OpenAI bridge would lose data.

Every test that calls `translateRequest` or `translateResponse` must import `tests/translator/registerAll.js`. Always use the repository Vitest config:

```bash
cd tests
npx vitest run --config vitest.config.js translator/path-to-test.test.js
```

Use `it.fails` only for a confirmed, unfixed translator bug. Convert it to a regular test when the bug is fixed.

## Review expectations

Reviewers check correctness, migration and credential safety, provider compatibility, tests, documentation, baseline impact, and unresolved review threads. AI review comments are advisory; verify each concern before changing code.
