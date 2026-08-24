# Local Development

## Requirements

- Node.js `20.20.2`
- npm `10.8.2`
- Git
- A browser for dashboard work

## Install

```bash
nvm use
npm ci --no-audit --no-fund
cd tests && npm ci --no-audit --no-fund
```

## Isolate development data

Do not point development commands at an operator database.

```bash
export HOME="$PWD/.dev-home"
export DATA_DIR="$PWD/.data-dev"
mkdir -p "$HOME" "$DATA_DIR"
```

These directories contain credentials and databases. Keep them untracked and remove them only after confirming they are disposable.

## Run the app

```bash
npm run dev
```

Open `http://localhost:20127/dashboard`. Production and CLI starts use port `20128`.

```bash
npm run build
npm start
```

## Repository map

| Path | Purpose |
| --- | --- |
| `src/app` | Next.js dashboard and API routes. |
| `src/sse` | Client request handlers and routing entry points. |
| `open-sse` | Provider executors, translators, modality handlers, fallback, and usage logic. |
| `open-sse/providers/registry` | Provider definitions, endpoints, models, aliases, and capabilities. |
| `src/lib/db` | SQLite schema, migrations, repositories, and backups. |
| `src/lib/oauth` | OAuth flows and token handling. |
| `src/mitm` | Optional interception and certificate logic. |
| `cli` | Published CLI package and packaged runtime. |
| `docs` | Canonical Markdown documentation. |
| `tests` | Vitest suite and fail-closed baseline gate. |

## Focused tests

Run Vitest from `tests/` and always load `vitest.config.js`:

```bash
cd tests
npx vitest run --config vitest.config.js unit/example.test.js
npx vitest run --config vitest.config.js translator/example.test.js
```

Translator tests that call translation entry points must import `translator/registerAll.js`.

## Full checks

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

See [Anti-slop gate](anti-slop.md) for the vendored oxlint plugin and clean-tree workflow.

## Generated indexes

After provider registry changes:

```bash
npm run gen:registry-index
npm run check:registry-index
```

After provider or executor navigation changes:

```bash
npm run gen:agent-index
npm run check:agent-index
```

Commit generated output when it changes.

## Debugging

Use test data before enabling detailed logs:

```bash
LOG_LEVEL=DEBUG
ENABLE_REQUEST_LOGS=true
VALIDATE_OUTBOUND=false
CURSOR_STREAM_DEBUG=1
CURSOR_PROTOBUF_DEBUG=1
DEBUG_MITM=1
```

Request logs may include prompts, responses, filenames, and URLs. Disable them after diagnosis.
