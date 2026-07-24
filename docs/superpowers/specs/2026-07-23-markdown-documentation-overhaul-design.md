# Markdown Documentation Overhaul Design

**Date:** 2026-07-23  
**Status:** Approved design, pending written-spec review  
**Branch:** `docs/markdown-overhaul`  
**Baseline:** `origin/main` at `f430a32e5` (`v3.9.0`), with 118 tracked Markdown files

## Goal

Make the repository the complete, canonical home for DurinDoor documentation. DurinDoor will not maintain a dedicated documentation website. GitHub-rendered Markdown must serve users, operators, contributors, and API consumers without requiring the GitBook application or duplicated content trees.

The overhaul must review every tracked Markdown file and every open-source community surface, verify technical claims against the current repository, repair missing guidance, remove obsolete documentation after preserving lasting facts, and leave a navigable Markdown system with automated integrity checks.

## Decisions

1. `README.md` and `docs/README.md` are the two public entry points.
2. Documentation uses audience lanes for users, operators, contributors, and API/reference readers.
3. One canonical page owns each fact. Other pages link to it instead of copying it.
4. `docs/` is the only canonical product documentation tree.
5. The `gitbook/` application and duplicated GitBook content will be removed after unique facts are checked and migrated.
6. Port notes, campaign ledgers, PR descriptions, recovery reports, and audit notes will be deleted after lasting product, operational, or contributor facts are extracted into canonical documentation.
7. Both approved brand assets will appear in `README.md` and `docs/README.md`.
8. English Markdown remains canonical. Product UI localization remains outside this documentation system.
9. Generated or agent-facing references remain outside public navigation when active tooling still consumes them.

## Audiences and Entry Paths

### Users

Users need the shortest path from installation to a successful request. Their lane covers:

- choosing an installation method;
- opening the dashboard;
- connecting a provider;
- creating a DurinDoor API key;
- selecting a model or combo;
- configuring supported tools;
- calling supported API families;
- solving common errors.

### Operators

Operators need production and lifecycle guidance. Their lane covers:

- Docker and source deployments;
- environment configuration;
- reverse proxy and TLS setup;
- persistent data and backups;
- upgrades and rollback considerations;
- health checks, logs, and startup behavior;
- security hardening and credential handling;
- recovery, uninstall, and troubleshooting.

### Contributors

Contributors need an accurate repository contract. Their lane covers:

- supported Node.js and npm versions;
- source setup and local ports;
- repository structure;
- test, lint, build, registry, and commit gates;
- translator registration and test conventions;
- provider and executor additions;
- documentation rules;
- branch, pull request, review, and release expectations.

### API and Reference Readers

Reference readers need stable lookup pages for:

- API routes and payload families;
- environment variables;
- compatibility names and wire formats;
- provider manifests and model identifiers;
- MCP Gateway behavior;
- realtime behavior;
- compression behavior;
- architecture and data flow.

## Canonical Information Architecture

```text
README.md                  Product landing page and fastest successful path
docs/README.md             Complete documentation hub

docs/getting-started/      Installation and first request
docs/guides/               Daily user workflows
docs/integrations/         Tool-specific setup
docs/providers/            Provider and credential setup
docs/features/             Product capabilities
docs/deployment/           Local, Docker, and remote deployment
docs/operations/           Security, upgrades, backup, recovery, troubleshooting
docs/reference/            API, environment, manifests, compatibility
docs/contributing/         Contribution workflow, local development, testing
docs/architecture/         Runtime, translator, provider, data, and security design

cli/README.md              CLI package reference
skills/README.md           Agent-skill catalog
tests/README.md            Test-suite reference
CHANGELOG.md               Released changes
CODE_OF_CONDUCT.md         Community behavior policy
.github/SECURITY.md         Private vulnerability reporting policy
.github/CONTRIBUTING.md     GitHub-discoverable contribution entry point
```

Directory names may be migrated from singular forms such as `integration/` and `development/` only when every inbound link is updated in the same change. Stable, useful paths should remain when renaming adds no reader value.

## README Design

Both `README.md` and `docs/README.md` will begin with the same two approved assets:

```html
<p align="center">
  <a href="https://github.com/bloodf/durindoor/blob/main/assets/durindoor-banner.png">
    <img src="https://raw.githubusercontent.com/bloodf/durindoor/main/assets/durindoor-banner.png"
         alt="Ancient stone portal glowing green in dark ruins"
         width="100%">
  </a>
</p>

<p align="center">
  <a href="https://github.com/bloodf/durindoor/blob/main/assets/durindoor-wordmark-theme-aware.svg">
    <img src="https://raw.githubusercontent.com/bloodf/durindoor/main/assets/durindoor-wordmark-theme-aware.svg"
         alt="DurinDoor — Speak, friend, and enter. One guarded gateway for every AI provider"
         width="760">
  </a>
</p>
```

The raw URLs render image bytes on GitHub. Each image links to the corresponding user-supplied canonical asset page under `/blob/main/assets/`.

The banner is 1920×815 and has no embedded text. Full-width display preserves the central doorway and allows side cropping on narrow screens. The wordmark SVG has a 1920×520 view box and uses `prefers-color-scheme` to switch text colors for light and dark hosts.

### Root README

The root README will contain:

1. brand assets and status badges;
2. one precise product description;
3. key capabilities with links to detailed pages;
4. the shortest supported CLI quick start;
5. links for Docker and source installation;
6. links for Users, Operators, Contributors, and API & Reference;
7. compatibility and migration summary;
8. security, contribution, license, and acknowledgment links.

It will not contain maintainer catalog procedures, exhaustive environment tables, duplicated deployment instructions, or detailed architecture.

### Documentation Hub

`docs/README.md` will contain:

1. the same approved brand header;
2. four audience lanes;
3. a complete topic index;
4. core concept and endpoint summaries;
5. explicit links to CLI, skills, tests, community, security, changelog, and license surfaces;
6. an ownership statement that repository Markdown is canonical and no docs website exists.

## Content Review and Repair

Every tracked Markdown file at the implementation baseline must receive one explicit disposition:

- **keep:** accurate and correctly placed;
- **rewrite:** same purpose, repaired content;
- **merge:** lasting content moves into a canonical page;
- **move:** active content belongs under a clearer canonical section;
- **delete:** duplicate, obsolete, or historical content with no remaining unique value;
- **internal/generated:** active tooling reference excluded from public navigation.

The review must verify documentation against source, config, scripts, workflows, manifests, and runtime routes. It must not trust old documentation as evidence for another document.

### Required Technical Repairs

The implementation must check and repair at least:

- production port `20128` and development port `20127`;
- dashboard path and API base path;
- Node.js `20.20.2` and npm `10.8.2` requirements;
- supported npm install commands and project scripts;
- Docker image, compose services, volumes, optional Headroom behavior, and data paths;
- current branch target and commitlint rules;
- environment variables and defaults;
- compatibility paths, aliases, headers, and API key formats;
- provider and model examples against the live registry;
- API endpoint inventory against current routes;
- CLI commands and package behavior;
- translator registration and test requirements;
- security-sensitive advice against current authentication and proxy behavior.

### Required Missing Topics

Canonical documentation must include clear guidance for:

- upgrades and version pinning;
- backup and restore;
- health checks, logs, and service startup;
- reverse proxy and TLS deployment;
- production security and credential handling;
- uninstall and data-retention choices;
- recovery from failed startup or migration;
- provider connection types and fallback behavior;
- API authentication and endpoint families;
- MCP Gateway, realtime, compression, and skills;
- contributor testing and documentation expectations.

## Consolidation and Deletion

### GitBook

Delete the entire `gitbook/` tree after checking every content file against its canonical `docs/` equivalent. Existing GitBook content is duplicated, stale, or superseded. GitBook-specific React rendering, navigation, localization routing, emoji transformation, and package dependencies have no role in a Markdown-only repository.

### Historical Markdown

Extract lasting facts, then delete:

- `docs/ports/` port records;
- `docs/campaigns/` ledgers and roadmaps;
- PR-description documents such as `docs/pr-mcp-gateway.md`;
- one-off review-fix reports;
- obsolete recovery and zero-test reports;
- stale audit artifacts whose conclusions are represented in current docs;
- completed agent plans/specs that do not remain active architectural records.

Deletion must follow reference analysis. A file with an active source, test, workflow, or documentation citation cannot be removed until that citation is updated or the file is proven load-bearing and retained.

### Duplicate Community Files

GitHub should discover contribution and security policies at standard locations. The root `CONTRIBUTING.md`, `.github/CONTRIBUTING.md`, and detailed contributor documentation must not contain competing instructions. One file owns the full workflow; shorter standard-path files route to it.

Add `CODE_OF_CONDUCT.md`. Expand `.github/SECURITY.md` to cover supported versions, private reporting, response expectations, and coordinated disclosure without promising response times the maintainers cannot guarantee.

### Internal and Generated Files

Do not delete active internal files only because they are absent from public navigation. Preserve files such as:

- `AGENTS.md`;
- `CLAUDE.md`;
- `.sources.md`;
- `model-catalog-report.md` when still produced or consumed;
- `open-sse/AGENT-INDEX.md` when still generated by repository scripts;
- test-suite documentation required by contributors.

Mark their audience through surrounding indexes rather than adding decorative disclaimers to generated files.

## Link and Writing Rules

- Use repository-relative links for repository Markdown.
- Use raw GitHub URLs only when an image byte response is required.
- Use `/blob/main/` URLs as clickable asset destinations, not image sources.
- Avoid hardcoded GitHub Pages or removed docs-site URLs.
- Give every public page an inbound link from `docs/README.md` or a linked section index.
- Prefer copy-pasteable examples with explicit prerequisites.
- State current facts directly. Remove promotional filler, apology text, implementation diary language, and unverified future claims.
- Explain compatibility names where users see them; do not rename required wire-format compatibility.
- Avoid duplicating version-sensitive model and pricing tables when the dashboard or registry is authoritative.
- Keep headings stable where possible so external anchors survive.

## Automated Integrity Contract

Add a repository-local Markdown validation command using existing runtime capabilities and no new documentation framework. The check must validate:

1. tracked Markdown links resolve;
2. relative heading anchors resolve where GitHub semantics are deterministic;
3. local image paths and required raw image URLs resolve structurally;
4. both required assets occur in `README.md` and `docs/README.md`;
5. removed GitBook/GitHub Pages URLs do not reappear;
6. stale DurinDoor-facing 9router domains and branding are absent except approved compatibility or attribution contexts;
7. every public documentation page is reachable from a canonical index;
8. documented root npm scripts exist in `package.json`;
9. required standard community files exist.

The checker should classify explicit internal/generated paths so they do not appear as public orphans.

## Verification

Implementation verification must include:

1. the Markdown integrity command;
2. searches proving no GitBook website links or stale public domains remain;
3. searches proving both required assets appear in both entry-point READMEs;
4. checks that every deleted file has no remaining inbound reference;
5. execution of safe, offline commands documented as primary smoke paths;
6. repository-required documentation gates;
7. `npm run lint` and the relevant existing test gate when non-documentation scripts change;
8. a final review from each audience lane: user, operator, contributor, and API/reference reader.

Documentation-only edits do not need product unit tests. The Markdown integrity checker is the runnable contract for the new documentation system. If the checker itself adds behavior, it requires focused tests for broken links, missing assets, orphan pages, and allowed compatibility references.

## Completion Criteria

The overhaul is complete when:

- both approved assets render from `README.md` and `docs/README.md` with accessible alt text;
- all 118 baseline Markdown files have a recorded disposition, adjusted for files added or removed on the implementation branch;
- all retained public pages are accurate, indexed, and assigned to an audience lane;
- all lasting facts from deleted historical records are present in canonical pages;
- GitBook and stale docs-site references are gone;
- standard open-source community files are complete and non-conflicting;
- required user, operator, contributor, and reference topics are covered;
- automated Markdown integrity checks pass;
- documented primary commands and repository gates pass with fresh output.

## Non-Goals

- Building or deploying a documentation website.
- Adding a Markdown framework, static-site generator, or documentation dependency.
- Translating canonical documentation inside this repository.
- Rewriting active compatibility names in storage, headers, API keys, or CLI behavior.
- Replacing the dashboard model/provider catalog with manually maintained Markdown tables.
- Deleting agent contracts or generated references that current repository tooling still needs.
