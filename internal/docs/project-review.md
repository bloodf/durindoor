# Project documentation review

Reviewed against baseline `0e7307831` on 2026-10-07. Public chapters are covered by the usage, runtime, and reference review records after integration.

| Document | Review and source evidence |
| --- | --- |
| `docs/index.mdx`, `docs/meta.json` | Retained ordered install/connect/request steps and task directory. Removed contributor navigation. `website/source.config.mjs` collects only the public directory. |
| `README.md` | Retained complete local setup, OpenAI and Anthropic examples, provider support boundaries, Docker persistence, and user guide links. Clarified that model discovery does not validate a key. Moved implementation and branding references to the repository-only contributor entry. |
| `cli/README.md` | Added explicit loopback binding, signing-secret persistence, initial-password setup, dashboard location, and links to complete CLI/startup reference. `cli/cli.js` performs startup cleanup. |
| `CONTRIBUTING.md`, `.github/CONTRIBUTING.md` | Updated repository-local reference paths. Kept contributor contract and license terms. |
| `AGENTS.md`, `CLAUDE.md` | Added the internal documentation entry point and publication boundary. Corrected overview to include Anthropic. Qualified the declared nightly schedule with the workflow's disabled-state note. |
| `internal/docs/index.mdx`, `local-development.mdx`, `testing.mdx` | Retained full setup, isolated runtime storage, generators, separate test package, translator registration, and fail-closed baseline requirements. Updated repository map and relocated reference links. |
| `internal/docs/architecture.mdx`, `postgres-migrations.mdx` | Retained request lifecycle and database details. Corrected Headroom ordering against `open-sse/handlers/chatCore.js` and explicit empty-PG-variable behavior against `src/lib/db/driver.js`. |
| `internal/docs/provider-registry.mdx`, `translators.mdx` | Kept generator ownership, schema conventions, direct routes, RTK Cursor exception, and focused test requirements. Repaired links to public operator guides. |
| `internal/docs/upstream-sync.mdx` | Preserved historical anchors and deferred work. Explicitly labeled dated PR watch rows as historical. Added current porting workflow link. |
| `internal/docs/release-process.mdx` | Preserved full release and rollback procedures. Repaired workflow references to the relocated file. |
| `internal/docs/brand-guide.mdx`, `design-system.mdx`, `provider-brand-assets.mdx` | Preserved all rules, current versus migration-target distinction, source ownership, component limitations, vector paths, and vendor rights. Updated prompt path and runtime-image-only publication. |
| `internal/docs/brand-prompts.md`, `provider-expansion-audit.json` | Retained complete generation inputs and audit evidence. Marked prompts as historical inputs rather than current normative tokens. Audit already states its date and verification limits. |
| `assets/brand/README.md`, `website/README.md`, `src/shared/ui/README.md`, `tests/README.md` | Fixed reference paths and documented the publication boundary. Canonical vectors stay in the repository. |
| `.github/pr-templates/postgres-engine.md`, release workflow text | Replaced stale documentation paths. Removed an obsolete research-file reference. Workflow behavior is unchanged. |
| `PRODUCT.md`, `DESIGN.md` | Product guide records document audiences. Incumbent visual rules remain in their canonical location for AI readers. |

Legal policies and historical changelog entries retain their terms and history. Generated provider catalog content remains owned by its generator.
