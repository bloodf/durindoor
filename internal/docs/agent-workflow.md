# AI implementation workflow

Read this file before changing features, protocols, database behavior, or the visual identity. [`AGENTS.md`](../../AGENTS.md) is the contributor contract and takes precedence over explanatory references.

## Establish the current state

1. Read the requested behavior and relevant public guide under `docs/`.
2. Inspect `git status --short` and preserve existing edits. Use a focused branch. Do not push directly to `main`.
3. Identify the responsible route, service, executor, translator, database adapter, or UI component. Read the complete call path before editing.
4. Read the detailed reference here and the generated executor/provider map in [`open-sse/AGENT-INDEX.md`](../../open-sse/AGENT-INDEX.md).
5. Treat dated provider audits and upstream watch lists as historical evidence. Verify current code and the final upstream diff before making a port decision.

## Locate the implementation

| Task | Starting point | Detailed reference |
| --- | --- | --- |
| Gateway request lifecycle | `src/app/api`, `open-sse/handlers/chatCore.js` | [Architecture](./architecture.mdx) |
| Provider metadata and capabilities | `open-sse/providers/registry`, `open-sse/providers/schema.js`, `open-sse/providers/capabilities.js` | [Provider registry](./provider-registry.mdx) |
| Request and response translation | `open-sse/translator/index.js`, `open-sse/translator/schema` | [Translators](./translators.mdx) |
| Upstream feature ports | final upstream diff, `.github/upstream-ported.json`, commit subjects | [Upstream sync](./upstream-sync.mdx) |
| Database schema changes | `src/lib/db/migrations`, `scripts/migrate-sqlite-ddl-to-pg.mjs` | [Postgres migrations](./postgres-migrations.mdx) |
| Branding and future admin design | `assets/brand`, `website/src/app`, `src/shared/ui` | [Brand guide](./brand-guide.mdx), [design system](./design-system.mdx) |
| Provider identification assets | `public/providers`, `src/shared/components` | [Provider asset policy](./provider-brand-assets.mdx) |
| CLI and release artifacts | `cli`, `.github/workflows/release-prepare.yml`, `.github/workflows/release-tag.yml` | [Release process](./release-process.mdx) |

Use `rg --files` and `rg` to locate the current owner. These are starting points, not a complete caller inventory. Source paths can move.

## Port a feature

1. Confirm that the upstream change is merged. Record the upstream PR or commit and exact diff. A PR title is not a behavior specification.
2. Compare intended behavior with current implementation and tests. Check whether the change is already present or conflicts with local authentication, routing, fallback, quota, database, or UI behavior.
3. Adapt the smallest coherent change to local contracts. Preserve schema constants, provider metadata ownership, direct translator routes, and fail-open compression.
4. Add a focused behavioral test. Preserve a regression case for a bug fix. Translator tests must import their registration helper.
5. Update public instructions when users see different behavior. Record call paths, source ownership, compatibility choices, rejected alternatives, and verification limits here.
6. Regenerate generated files through their scripts. Do not hand-edit the provider barrel or agent index.
7. Run focused tests and repository gates. Do not add baseline failures or rewrite stored credentials to pass tests.
8. Use the required `port(upstream)` or `port(omniroute)` subject and target a PR at `bloodf/durindoor:main`.

The watch workflow creates issues when dispatched. Reading this guide does not authorize dispatching it, sending messages, or operating external accounts.

## Verify and describe the result

Use [Testing](./testing.mdx) for the separate test package and [Local development](./local-development.mdx) for isolated storage and UI checks. Root `npm test` is not the CI gate.

Required PR checks include root lint and `cd tests && npm run test:ci`. Run documentation checks after moving or editing references. Build the website when public docs, shared demo components, site code, or asset publication change.

Describe resulting behavior, source scope, tests, public documentation, internal references, and baseline impact. Distinguish offline assertions, browser behavior, credential-backed checks, and production evidence. A registry entry is not proof that a real provider account works.

## Keep the publication boundary

Public `docs/` contains operator instructions and externally callable API contracts. `internal/docs/` contains AI porting context, maintenance procedures, brand rules, audit evidence, and implementation detail. Public navigation and search must not include these internal references.

Update implementation notes and user instructions together when behavior changes. Identify preserved pre-rewrite content as historical when corrections supersede it. Publish runtime images through the asset copy script. Keep prompts, maintenance Markdown, and vector archives in the repository.
