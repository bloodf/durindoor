# Local Development

This page is for contributors working on DurinDoor itself.

## Prerequisites

- Node.js compatible with the repository's Next.js version.
- npm.
- Git.
- A browser for dashboard testing.
- Optional provider credentials for live provider testing.

## Install Dependencies

```bash
npm install --no-audit --no-fund
```

## Start the Development Server

```bash
npm run dev
```

Open:

```text
http://localhost:20127/dashboard
```

Use a separate `DATA_DIR` for development so local testing does not modify production credentials:

```bash
DATA_DIR="$PWD/.data-dev" npm run dev
```

## Build

```bash
npm run build
```

If `next` is missing, run `npm install --no-audit --no-fund` first.

## Lint

```bash
npm run lint
```

## Tests

```bash
npm run test:ci
```

Translator-focused tests live under `tests/translator/`. Some tests are offline; real-provider smoke tests require local credentials and explicit flags.

## Project Layout

| Path | Purpose |
| --- | --- |
| `src/app` | Next.js app routes and dashboard pages. |
| `src/app/api` | Dashboard and compatibility API routes. |
| `src/sse` | Request handlers and routing layer. |
| `open-sse` | Provider execution, translation, streaming, and core modality logic. |
| `src/lib/db` | SQLite schema, migrations, repositories, and persistence paths. |
| `src/lib/oauth` | OAuth provider flows and helpers. |
| `src/mitm` | Optional MITM server and certificate logic. |
| `cli` | Global CLI package, tray helpers, and local menus. |
| `docs` | Markdown documentation. |
| `tests` | Vitest tests and baselines. |

## Development Data

Default development data still resolves to the compatibility path unless `DATA_DIR` is set. Use a disposable path while developing:

```bash
export DATA_DIR="$PWD/.data-dev"
```

Do not commit `.data-dev`, provider credentials, database files, local logs, or runtime artifacts.

## Debugging

Useful variables:

```bash
LOG_LEVEL=DEBUG
ENABLE_REQUEST_LOGS=true
VALIDATE_OUTBOUND=false
CURSOR_STREAM_DEBUG=1
CURSOR_PROTOBUF_DEBUG=1
DEBUG_MITM=1
```

Only enable request body logging with test data.

