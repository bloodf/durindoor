# Markdown Documentation Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace DurinDoor's duplicated and incomplete documentation surfaces with one accurate, navigable, tested Markdown handbook for users, operators, contributors, and API/reference readers.

**Architecture:** `README.md` provides the shortest successful path and routes readers to `docs/README.md`. `docs/` owns canonical product documentation; package READMEs own package-specific details and link back to the handbook. A dependency-free Node.js checker enforces links, anchors, required assets, public reachability, standard community files, and forbidden website references.

**Tech Stack:** GitHub-flavored Markdown, HTML `<img>` blocks, Node.js 20.20.2 standard library, npm 10.8.2, Vitest 4.1.10.

## Global Constraints

- Work only in `.omc/wt-docs-overhaul` on `docs/markdown-overhaul`, based on `origin/main` v3.9.0.
- Treat all 118 tracked baseline Markdown files as reviewed inventory; classify every retained file as public, package, internal, generated, community, or active design record.
- Keep `README.md` and `docs/README.md` as public entry points.
- Keep one canonical page per fact; link instead of copying detailed tables or procedures.
- Remove the `gitbook/` website and duplicate content after migrating unique facts.
- Extract lasting facts from historical notes before deleting them.
- Use both `assets/durindoor-banner.png` and `assets/durindoor-wordmark-theme-aware.svg` in both entry-point READMEs.
- Image `src` values use `raw.githubusercontent.com`; image links use the supplied `github.com/.../blob/main/assets/...` URLs.
- Keep English Markdown canonical; do not add a docs framework, static-site generator, translation tree, or documentation dependency.
- Preserve intentional 9Router compatibility names and upstream attribution; remove stale DurinDoor-facing 9router domains and product branding.
- Do not modify `tests/__baseline__/known-fails.txt`.
- Do not delete `AGENTS.md`, `CLAUDE.md`, `.sources.md`, `model-catalog-report.md`, or `open-sse/AGENT-INDEX.md` while current tooling still consumes them.
- Use current source, config, scripts, workflows, and routes as evidence; never use one old document to validate another.
- Documentation-only changes need no product unit test. `scripts/check-docs.mjs` is behavior and receives focused unit tests.

---

### Task 1: Add the Markdown integrity contract

**Files:**
- Create: `scripts/check-docs.mjs`
- Create: `tests/unit/check-docs.test.js`
- Modify: `package.json:11-26`

**Interfaces:**
- Produces: `validateDocumentation({ root, files, readText }): Promise<string[]>`
- Produces: `githubSlug(value: string): string`
- Produces: `npm run check:docs`
- Consumes: tracked Markdown from `git ls-files -z -- '*.md'` at CLI runtime.

- [ ] **Step 1: Write focused failing tests**

Create fixtures in the test temp directory and assert observable failures:

```js
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { githubSlug, validateDocumentation } from "../../scripts/check-docs.mjs";

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function fixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), "durindoor-docs-"));
  roots.push(root);
  await Promise.all(Object.entries(files).map(async ([name, text]) => {
    const target = path.join(root, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, text);
  }));
  return root;
}

async function check(files) {
  const root = await fixture(files);
  return validateDocumentation({ root, files: Object.keys(files) });
}

describe("documentation integrity", () => {
  it("uses GitHub-compatible heading slugs", () => {
    expect(githubSlug("API & Reference")).toBe("api--reference");
    expect(githubSlug("API & Reference")).toBe("api--reference");
  });

  it("reports missing files and anchors", async () => {
    const issues = await check({
      "README.md": "[missing](docs/missing.md) [anchor](docs/guide.md#nope)",
      "docs/guide.md": "# Present heading\n",
    });
    expect(issues).toEqual([
      "README.md: missing target docs/missing.md",
      "README.md: missing anchor #nope in docs/guide.md",
    ]);
  });

  it("requires both approved assets in both entry points", async () => {
    const issues = await check({ "README.md": "# DurinDoor", "docs/README.md": "# Docs" });
    expect(issues).toContain("README.md: missing durindoor-banner.png");
    expect(issues).toContain("README.md: missing durindoor-wordmark-theme-aware.svg");
    expect(issues).toContain("docs/README.md: missing durindoor-banner.png");
    expect(issues).toContain("docs/README.md: missing durindoor-wordmark-theme-aware.svg");
  });

  it("reports forbidden website URLs and public orphans", async () => {
    const issues = await check({
      "README.md": "[Docs](docs/README.md)",
      "docs/README.md": "# Docs",
      "docs/orphan.md": "https://bloodf.github.io/durindoor/",
    });
    expect(issues).toContain("docs/orphan.md: forbidden URL bloodf.github.io/durindoor");
    expect(issues).toContain("docs/orphan.md: public document is not reachable from README.md or docs/README.md");
  });
});
```

- [ ] **Step 2: Run the tests and confirm contract failures**

Run:

```bash
cd tests
npx vitest run --config vitest.config.js unit/check-docs.test.js
```

Expected: FAIL because `scripts/check-docs.mjs` does not exist.

- [ ] **Step 3: Implement the dependency-free checker**

Implement `githubSlug` and `validateDocumentation` with `node:fs/promises`, `node:path`, and `node:child_process`. Parse inline Markdown links plus HTML `<img src>` and `<a href>` values. Ignore fenced code blocks, URL schemes, mail links, and pure `#anchor` links only after resolving them against the current file. Decode URL fragments before slug comparison. Collect headings, add duplicate-heading suffixes (`-1`, `-2`), walk public links from both entry points, and sort issues before returning.

Use these explicit classifications:

```js
export const INTERNAL_PREFIXES = [
  "docs/superpowers/",
];

export const INTERNAL_FILES = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  ".sources.md",
  "model-catalog-report.md",
  "open-sse/AGENT-INDEX.md",
  "tests/README.md",
]);

export const COMMUNITY_FILES = new Set([
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  ".github/CONTRIBUTING.md",
  ".github/SECURITY.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/ISSUE_TEMPLATE/bug_report.md",
  ".github/ISSUE_TEMPLATE/feature_request.md",
]);

export const PACKAGE_FILES = new Set([
  "cli/README.md",
  "skills/README.md",
  "skills/durindoor/SKILL.md",
  "skills/durindoor-chat/SKILL.md",
  "skills/durindoor-embeddings/SKILL.md",
  "skills/durindoor-image/SKILL.md",
  "skills/durindoor-stt/SKILL.md",
  "skills/durindoor-tts/SKILL.md",
  "skills/durindoor-web-fetch/SKILL.md",
  "skills/durindoor-web-search/SKILL.md",
]);

export const REQUIRED_ASSETS = [
  "durindoor-banner.png",
  "durindoor-wordmark-theme-aware.svg",
];

export const FORBIDDEN_PUBLIC_TEXT = [
  "bloodf.github.io/durindoor",
  "https://9router.com",
];
```

CLI behavior:

```js
if (import.meta.url === `file://${process.argv[1]}`) {
  const issues = await validateRepository(process.cwd());
  if (issues.length) {
    console.error(issues.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Documentation integrity checks passed.");
  }
}
```

- [ ] **Step 4: Wire the project command**

Add to root `package.json` scripts:

```json
"check:docs": "node scripts/check-docs.mjs"
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
cd tests
npx vitest run --config vitest.config.js unit/check-docs.test.js
```

Expected: all `check-docs.test.js` tests pass.

- [ ] **Step 6: Run the checker against the pre-cleanup tree**

Run:

```bash
npm run check:docs
```

Expected: non-zero exit listing current missing assets in `docs/README.md`, forbidden GitHub Pages URLs, stale public `9router.com` URLs, and public orphan files. Save output for comparison; do not weaken rules to make the old tree pass.

- [ ] **Step 7: Commit the contract**

```bash
git add package.json scripts/check-docs.mjs tests/unit/check-docs.test.js
git commit -m "test(docs): enforce Markdown integrity"
```

### Task 2: Rebuild both documentation entry points

**Files:**
- Rewrite: `README.md`
- Rewrite: `docs/README.md`

**Interfaces:**
- Consumes: required asset and reachability rules from Task 1.
- Produces: canonical public roots for every retained public page.

- [ ] **Step 1: Replace both headers with approved assets**

Use this exact block in both files:

```html
<p align="center">
  <a href="https://github.com/bloodf/durindoor/blob/main/assets/durindoor-banner.png">
    <img src="https://raw.githubusercontent.com/bloodf/durindoor/main/assets/durindoor-banner.png" alt="Ancient stone portal glowing green in dark ruins" width="100%">
  </a>
</p>

<p align="center">
  <a href="https://github.com/bloodf/durindoor/blob/main/assets/durindoor-wordmark-theme-aware.svg">
    <img src="https://raw.githubusercontent.com/bloodf/durindoor/main/assets/durindoor-wordmark-theme-aware.svg" alt="DurinDoor — Speak, friend, and enter. One guarded gateway for every AI provider" width="760">
  </a>
</p>
```

- [ ] **Step 2: Rewrite root README as the product landing page**

Keep badges. Replace detailed catalog-maintainer instructions and duplicated configuration tables with:

- one paragraph defining the self-hosted gateway;
- capability links for chat/responses, embeddings, images, audio, web, MCP, combos, and usage;
- CLI quick start using `npm install --global durindoor` and `http://localhost:20128/dashboard`;
- Docker and source-install links;
- four audience links to Users, Operators, Contributors, and API & Reference headings in `docs/README.md`;
- compatibility note for `~/.9router`, the `9router` CLI alias, accepted headers, and legacy keys;
- security, contributing, Code of Conduct, changelog, license, and attribution links.

- [ ] **Step 3: Rewrite docs index with four audience lanes**

Create headings named exactly:

```markdown
## Users
## Operators
## Contributors
## API & Reference
## Package Documentation
## Community and Project
```

Index every canonical user-facing page retained or added by Tasks 4–8. Keep the core-concepts and default-endpoints tables. State that repository Markdown is canonical and DurinDoor has no documentation website.

- [ ] **Step 4: Run the checker**

Run `npm run check:docs`.

Expected: asset failures disappear. Remaining failures belong to stale links, historical files, or pages created in later tasks.

- [ ] **Step 5: Commit entry points**

```bash
git add README.md docs/README.md
git commit -m "docs: rebuild Markdown entry points"
```

### Task 3: Consolidate open-source community documentation

**Files:**
- Create: `CODE_OF_CONDUCT.md`
- Rewrite: `CONTRIBUTING.md`
- Rewrite: `.github/CONTRIBUTING.md`
- Rewrite: `.github/SECURITY.md`
- Review and retain: `.github/ISSUE_TEMPLATE/bug_report.md`
- Review and retain: `.github/ISSUE_TEMPLATE/feature_request.md`
- Review and retain: `.github/PULL_REQUEST_TEMPLATE.md`
- Review and retain: `.github/CHANGELOG_TEMPLATE.md`
- Review and retain: `CHANGELOG.md`
- Review and retain: `LICENSE`

**Interfaces:**
- Produces: non-conflicting standard GitHub community surfaces.
- Consumes: full workflow from `docs/development/contributing.md` until Task 8 updates it.

- [ ] **Step 1: Add Contributor Covenant 2.1**

Create `CODE_OF_CONDUCT.md` using the unmodified Contributor Covenant v2.1 body, set enforcement contact to private GitHub maintainer contact through repository security/advisory channels, and preserve the upstream attribution URL required by that text.

- [ ] **Step 2: Make root contribution file the concise standard entry point**

Keep branch target `main`, Node.js `20.20.2`, npm `10.8.2`, required documentation and tests, commitlint expectations, and links to:

```markdown
- [Detailed contributor guide](docs/development/contributing.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security policy](.github/SECURITY.md)
```

Remove any independent workflow detail that can drift from the detailed guide.

- [ ] **Step 3: Make `.github/CONTRIBUTING.md` route to root guidance**

Use a short GitHub-discoverable summary and links to `../CONTRIBUTING.md` and `../docs/development/contributing.md`. Keep `main` as the only normal PR target.

- [ ] **Step 4: Expand security policy without unsupported promises**

Add:

```markdown
## Supported Versions

Security fixes target the latest released DurinDoor version. Reproduce a report on the latest release before submitting when possible.

## Reporting a Vulnerability

Use GitHub Security Advisories. Do not open a public issue, discussion, or pull request containing exploit details or credentials.

Include the affected version, deployment method, impact, reproduction steps, and a minimal proof of concept with secrets removed.

## Disclosure

Maintainers will confirm receipt through the private advisory, investigate, coordinate a fix and release, and agree on public disclosure after affected users can update. Response and release time depend on severity and reproducibility.
```

- [ ] **Step 5: Check standard templates against current branch and policy**

Verify that issue and PR templates request version, reproduction, test coverage, documentation coverage, baseline impact, and migration/wire-format concerns where applicable. Change only missing or stale fields.

- [ ] **Step 6: Validate and commit**

Run `npm run check:docs` and `git diff --check`.

```bash
git add CODE_OF_CONDUCT.md CONTRIBUTING.md .github/CONTRIBUTING.md .github/SECURITY.md .github/ISSUE_TEMPLATE .github/PULL_REQUEST_TEMPLATE.md .github/CHANGELOG_TEMPLATE.md
git commit -m "docs: complete community health files"
```

### Task 4: Repair installation, deployment, and operator lifecycle guides

**Files:**
- Rewrite: `DOCKER.md`
- Modify: `.env.example`
- Modify: `docs/getting-started/installation.md`
- Modify: `docs/getting-started/quick-start.md`
- Modify: `docs/deployment/localhost.md`
- Rewrite: `docs/deployment/cloud.md`
- Modify: `docs/deployment/static-assets.md`
- Modify: `docs/operations/startup.md`
- Modify: `docs/operations/security.md`
- Create: `docs/operations/upgrading.md`
- Create: `docs/operations/data-management.md`
- Modify: `docs/troubleshooting.md`
- Modify: `docs/faq.md`
- Review: `Dockerfile`
- Review: `docker-compose.yml`

**Interfaces:**
- Produces: canonical install, deploy, upgrade, backup/restore, uninstall, recovery, health, and security guidance.
- Consumes: current package engines, Docker image, runtime ports, data paths, and environment defaults.

- [ ] **Step 1: Verify live runtime facts before prose edits**

Check `package.json`, `Dockerfile`, `docker-compose.yml`, `.env.example`, `custom-server.js`, `scripts/build-app.mjs`, and data-directory utilities. Record confirmed values in working notes: Node/npm versions, bind defaults, ports, image name, volume path, data path, health route, and Headroom sidecar behavior.

- [ ] **Step 2: Make `DOCKER.md` a concise Docker entry point**

Keep one tested `docker run` command, one compose command, persistent-volume warning, update command, and links to `docs/deployment/cloud.md`, `docs/operations/data-management.md`, and `docs/operations/security.md`. Remove duplicated full operator material, emoji headings, obsolete `v0.5.x`, and malformed `<<...>>` paths.

- [ ] **Step 3: Repair `.env.example` and environment-facing examples**

Remove `CLOUD_URL=https://9router.com`, `NEXT_PUBLIC_CLOUD_URL=https://9router.com`, and unused `INSTANCE_NAME=9router`. Explain `DATA_DIR` as an explicit deployment choice instead of a false runtime default. Keep `SEARXNG_URL` documented. Do not invent a DurinDoor cloud service URL.

- [ ] **Step 4: Rewrite cloud deployment as the canonical production guide**

Cover image pinning, compose, persistent volumes, optional Headroom, reverse proxy/TLS, required secrets, health checks, logs, upgrades, backups, and rollback preparation. State that `latest` is convenient but version tags are safer for production.

- [ ] **Step 5: Add upgrading guidance**

`docs/operations/upgrading.md` must cover release notes, backup first, version pin changes, image/source update commands, schema migration behavior, health verification, and rollback limits. Link `CHANGELOG.md` and `data-management.md`.

- [ ] **Step 6: Add data lifecycle guidance**

`docs/operations/data-management.md` must identify `$DATA_DIR`, database and backup paths, safe application shutdown, filesystem backup, restore into an empty/test location first, container volume handling, uninstall choices, and explicit warnings against deleting `~/.9router` or backups without operator confirmation.

- [ ] **Step 7: Repair startup, security, troubleshooting, and FAQ cross-links**

Add direct links between health checks, logs, upgrades, backups, credential reconnection, and recovery. Keep security-sensitive requirements precise. Remove website assumptions and stale cloud-service language.

- [ ] **Step 8: Validate operator commands**

Run safe offline checks:

```bash
node --version
npm --version
docker compose config
npm run check:docs
git diff --check
```

Expected: versions match documented requirements; compose parses when Docker is available; docs checker may still report only later-task files.

- [ ] **Step 9: Commit operator documentation**

```bash
git add DOCKER.md .env.example docs/getting-started docs/deployment docs/operations docs/troubleshooting.md docs/faq.md
git commit -m "docs: complete deployment and operations handbook"
```

### Task 5: Repair user, provider, integration, CLI, and skill guides

**Files:**
- Modify: `docs/guides/usage.md`
- Modify: `docs/providers/subscription.md`
- Modify: `docs/providers/cheap.md`
- Modify: `docs/providers/free.md`
- Modify: `docs/providers/local-router-providers.md`
- Merge/delete: `docs/providers/omniroute-open-provider-catalog.md`
- Modify: all eight `docs/integration/*.md`
- Modify: `cli/README.md`
- Modify: `skills/README.md`
- Modify: all eight `skills/*/SKILL.md`

**Interfaces:**
- Produces: verified provider/model examples and package-to-handbook links.
- Consumes: `open-sse/providers/registry/*.js`, API routes, CLI help/version output, and skill endpoint contracts.

- [ ] **Step 1: Verify examples against live registries and routes**

For every provider, model, combo, endpoint, and CLI flag named in these files, locate its current source. Replace volatile model examples with stable discovered examples or instruct readers to use `GET /v1/models` when no stable example exists. Remove claims about a hosted DurinDoor cloud endpoint.

- [ ] **Step 2: Consolidate provider catalog port notes**

Move lasting setup, credential-type, or capability facts from `docs/providers/omniroute-open-provider-catalog.md` into the appropriate canonical provider guide. Delete the port-oriented catalog file.

- [ ] **Step 3: Repair all integration guides**

Use `http://localhost:20128` or a reader-owned HTTPS deployment URL. State when a tool cannot access localhost and link to cloud deployment rather than inventing a hosted endpoint. Standardize API key placeholders and troubleshooting links.

- [ ] **Step 4: Repair CLI README**

Confirm `durindoor --help` and `durindoor --version` output. Link to `../docs/README.md`, remove GitHub Pages links, document supported data migration behavior, and keep package-specific flags in this file rather than the root README.

- [ ] **Step 5: Repair skills documentation**

Link `skills/README.md` to `../docs/README.md` and API reference. In every `SKILL.md`, verify endpoint paths and model-discovery steps, remove unverified hardcoded combo names, and use `GET /v1/models` for current IDs. Keep raw GitHub skill-install URLs because consumers fetch file bytes.

- [ ] **Step 6: Run focused CLI and documentation checks**

```bash
node cli/cli.js --help
node cli/cli.js --version
cd tests
npx vitest run --config vitest.config.js unit/cli-fast-path.test.js
cd ..
npm run check:docs
git diff --check
```

- [ ] **Step 7: Commit user and package docs**

```bash
git add docs/guides docs/providers docs/integration cli/README.md skills
git commit -m "docs: verify provider and integration guides"
```

### Task 6: Consolidate feature and API reference documentation

**Files:**
- Retain/modify: `docs/features/smart-routing.md`
- Retain/modify: `docs/features/combos.md`
- Retain/modify: `docs/features/quota-tracking.md`
- Create: `docs/features/mcp-gateway.md`
- Create: `docs/features/compression.md`
- Create: `docs/features/realtime.md`
- Merge/delete: `docs/pr-mcp-gateway.md`
- Merge/delete: `docs/mcp-control.md`
- Merge/delete: `docs/mcp-gateway-oauth.md`
- Merge/delete: `docs/compression/README.md`
- Merge/delete: `docs/compression-studio.md`
- Merge/delete: `docs/realtime.md`
- Modify: `docs/reference/api.md`
- Modify: `docs/reference/environment.md`
- Modify: `docs/reference/provider-plugin-manifest.md`
- Modify: `docs/ARCHITECTURE.md`

**Interfaces:**
- Produces: one canonical feature page for MCP, compression, and realtime.
- Consumes: live route handlers, runtime config, MCP code, compression modules, and architecture.

- [ ] **Step 1: Verify feature claims against implementation**

Map routes, config keys, limitations, security boundaries, and status semantics for MCP Gateway, compression, and realtime. Separate public setup from maintainer implementation notes.

- [ ] **Step 2: Consolidate MCP pages**

Create `docs/features/mcp-gateway.md` with purpose, prerequisites, managed routes/keys, OAuth flow, token handling, control endpoint, security model, operations, and troubleshooting. Preserve useful facts from all three old files, then delete them.

- [ ] **Step 3: Consolidate compression pages**

Create `docs/features/compression.md` covering compression seam, Studio controls, supported savers, bypass header precedence, fail-open behavior, error-result preservation, configuration, observability, and troubleshooting. Remove port chronology and delete both old pages.

- [ ] **Step 4: Move realtime into the feature lane**

Create `docs/features/realtime.md` from the verified WebSocket bridge content. Keep unsupported modality statements only when current handlers prove them. Delete `docs/realtime.md`.

- [ ] **Step 5: Complete API and environment references**

Add realtime route details, authentication expectations, modality caveats, and links to feature pages in `docs/reference/api.md`. Remove `9router.com` values from environment docs, mark `NINE_ROUTER_*` variables as compatibility names, and separate updater internals from operator-facing variables.

- [ ] **Step 6: Update architecture cross-links**

Keep Mermaid because GitHub renders it. Link architecture components to detailed feature/reference pages and state Node.js 20.20.2 from `package.json` rather than a generic Node 20 claim.

- [ ] **Step 7: Validate and commit**

```bash
npm run check:docs
git diff --check
git add docs/features docs/reference docs/ARCHITECTURE.md
git commit -m "docs: consolidate feature and API reference"
```

### Task 7: Extract lasting history and remove obsolete documentation systems

**Files:**
- Delete: `gitbook/`
- Delete after extraction: `docs/ports/`
- Delete after extraction: `docs/campaigns/`
- Delete after extraction: `docs/omniroute-api-cloud-review-fixes.md`
- Delete after extraction: `docs/omniroute-local-review-fixes.md`
- Delete after extraction: `docs/development/dev-recovery-ci.md`
- Delete after extraction: `docs/development/dev-zero-test-recovery.md`
- Delete after extraction: `docs/development/omniroute-provider-port-audit.md`
- Delete after extraction: `docs/development/omniroute-simple-provider-runtime.md`
- Delete after extraction: `audit/mirror-gaps.md`
- Review/remove obsolete: old completed files under `docs/superpowers/plans/` and `docs/superpowers/specs/`, excluding the active overhaul spec and plan until implementation closes
- Modify: `.gitignore`
- Modify only if required by live repository contract: `AGENTS.md`

**Interfaces:**
- Consumes: canonical pages completed in Tasks 2–6.
- Produces: one documentation tree with no website implementation or orphan historical records.

- [ ] **Step 1: Build a deletion evidence table before removing files**

For each file, record the unique lasting fact and its canonical destination. Use `none` only when the file contains release chronology, branch state, verification logs, or duplicated prose with no current product contract. Confirm current source/test/workflow references before deletion.

- [ ] **Step 2: Migrate lasting feature and compatibility facts**

Port notes that describe current behavior move into the relevant provider, feature, API, architecture, or contributor page. Campaign status, PR metadata, branch names, commit SHAs, and old verification logs do not move into public docs.

- [ ] **Step 3: Remove GitBook and obsolete history**

Delete exact paths listed above. Remove `.gitignore` entries that only support the retired GitBook app. If `AGENTS.md` still names `gitbook/content/<locale>/` as a valid documentation destination, replace that option with `docs/` so future agents do not recreate the deleted system.

- [ ] **Step 4: Prove no deleted path remains referenced**

Run:

```bash
npm run check:docs
git diff --check
```

Also search tracked files for `gitbook/`, `docs/ports/`, deleted campaign filenames, deleted MCP filenames, deleted compression filenames, and deleted realtime path. Historical changelog sentences may retain the word GitBook when describing a past release; active instructions may not.

- [ ] **Step 5: Commit deletion cutover**

```bash
git add -A gitbook docs audit .gitignore AGENTS.md
git commit -m "docs: remove obsolete documentation systems"
```

### Task 8: Complete contributor and maintainer documentation

**Files:**
- Rewrite: `docs/development/contributing.md`
- Rewrite: `docs/development/local-development.md`
- Modify: `tests/README.md`
- Review/regenerate: `open-sse/AGENT-INDEX.md`
- Review: `.sources.md`
- Review/regenerate: `model-catalog-report.md`

**Interfaces:**
- Produces: current contributor workflow and explicit internal/generated classification.
- Consumes: `AGENTS.md`, package scripts, test package, translator conventions, provider registry workflow, commitlint config, and generation scripts.

- [ ] **Step 1: Rewrite contributor workflow from live contracts**

Document `main` PR target, Node/npm versions, setup, branch discipline, commit types, PR title validation, documentation requirement, unit-test requirement for behavior, baseline protection, provider workflow, translator `registerAll.js`, and local gates. Link Code of Conduct and security policy.

- [ ] **Step 2: Rewrite local development guide**

Cover repository map, install/build/dev commands, ports, test package setup, focused Vitest invocation with `--config tests/vitest.config.js`, registry/agent index generation, environment isolation, and safe data-directory usage. Use `cd tests && npm install --no-audit --no-fund && npm run test:ci` for the full test gate.

- [ ] **Step 3: Repair test README**

Rename stale 9router product language to DurinDoor while preserving compatibility references. Replace stale coverage counts with stable suite descriptions. Document targeted and full commands without claiming a fixed number of tests.

- [ ] **Step 4: Verify generated/internal artifacts**

Run:

```bash
npm run check:agent-index
npm run catalog:diff
```

Keep `.sources.md`, `model-catalog-report.md`, and `open-sse/AGENT-INDEX.md` out of public navigation. Regenerate only when their source scripts report drift.

- [ ] **Step 5: Validate and commit**

```bash
npm run check:docs
git diff --check
git add docs/development tests/README.md open-sse/AGENT-INDEX.md model-catalog-report.md .sources.md
git commit -m "docs: complete contributor handbook"
```

### Task 9: Run final four-audience and repository verification

**Files:**
- Modify only for discovered defects: all retained documentation and checker files
- Update active implementation record: `docs/superpowers/plans/2026-07-23-markdown-documentation-overhaul.md`

**Interfaces:**
- Consumes: every deliverable from Tasks 1–8.
- Produces: fresh evidence that all requirements pass together.

- [ ] **Step 1: Run the Markdown contract**

```bash
npm run check:docs
```

Expected: `Documentation integrity checks passed.` and exit 0.

- [ ] **Step 2: Run focused checker tests**

```bash
cd tests
npx vitest run --config vitest.config.js unit/check-docs.test.js
```

Expected: all tests pass.

- [ ] **Step 3: Run repository gates required by changed behavior**

```bash
npm run lint
npm run check:agent-index
npm run check:registry-index
npm run catalog:diff
cd tests
npm run test:ci
```

Expected: every command exits 0 and `tests/__baseline__/known-fails.txt` has not grown.

- [ ] **Step 4: Run asset and stale-link proofs**

Confirm both `README.md` and `docs/README.md` contain:

```text
https://github.com/bloodf/durindoor/blob/main/assets/durindoor-banner.png
https://raw.githubusercontent.com/bloodf/durindoor/main/assets/durindoor-banner.png
https://github.com/bloodf/durindoor/blob/main/assets/durindoor-wordmark-theme-aware.svg
https://raw.githubusercontent.com/bloodf/durindoor/main/assets/durindoor-wordmark-theme-aware.svg
```

Confirm no active documentation contains `bloodf.github.io/durindoor`, `https://9router.com`, or links into deleted paths.

- [ ] **Step 5: Review each audience lane manually**

Follow each path from `docs/README.md`:

1. **User:** install, open dashboard, connect provider, create key, send request, configure one integration.
2. **Operator:** deploy, secure, monitor, back up, upgrade, restore, uninstall.
3. **Contributor:** set up, find code, run focused/full tests, add provider/translator docs, prepare PR.
4. **API/reference:** find authentication, endpoint, environment, compatibility, MCP, realtime, and compression details.

Repair every missing link, contradictory value, unexplained prerequisite, or dead end found.

- [ ] **Step 6: Check the final diff and commit fixes**

```bash
git diff --check
git status --short
git add -A
git commit -m "docs: finalize repository handbook"
```

Skip the commit only when no files changed after the prior commit.

- [ ] **Step 7: Validate commit history before any push**

```bash
npx commitlint --from=origin/main --to=HEAD
```

Expected: exit 0.

## Baseline Disposition Map

This map makes the 118-file review explicit. Implementation updates the list if `origin/main` moves before execution.

### Rewrite or merge into canonical public documentation

- `README.md`
- `CONTRIBUTING.md`
- `DOCKER.md`
- `.github/CONTRIBUTING.md`
- `.github/SECURITY.md`
- `cli/README.md`
- `docs/README.md`
- `docs/ARCHITECTURE.md`
- `docs/compression-studio.md`
- `docs/compression/README.md`
- `docs/deployment/cloud.md`
- `docs/deployment/localhost.md`
- `docs/deployment/static-assets.md`
- `docs/development/contributing.md`
- `docs/development/local-development.md`
- `docs/faq.md`
- `docs/features/combos.md`
- `docs/features/quota-tracking.md`
- `docs/features/smart-routing.md`
- `docs/getting-started/installation.md`
- `docs/getting-started/quick-start.md`
- `docs/guides/usage.md`
- `docs/integration/claude-code.md`
- `docs/integration/cline.md`
- `docs/integration/codex.md`
- `docs/integration/continue.md`
- `docs/integration/cursor.md`
- `docs/integration/ollama-claude.md`
- `docs/integration/other-tools.md`
- `docs/integration/roo.md`
- `docs/mcp-control.md`
- `docs/mcp-gateway-oauth.md`
- `docs/operations/security.md`
- `docs/operations/startup.md`
- `docs/pr-mcp-gateway.md`
- `docs/providers/cheap.md`
- `docs/providers/free.md`
- `docs/providers/local-router-providers.md`
- `docs/providers/omniroute-open-provider-catalog.md`
- `docs/providers/subscription.md`
- `docs/realtime.md`
- `docs/reference/api.md`
- `docs/reference/environment.md`
- `docs/reference/provider-plugin-manifest.md`
- `docs/troubleshooting.md`
- `skills/README.md`
- `skills/durindoor/SKILL.md`
- `skills/durindoor-chat/SKILL.md`
- `skills/durindoor-embeddings/SKILL.md`
- `skills/durindoor-image/SKILL.md`
- `skills/durindoor-stt/SKILL.md`
- `skills/durindoor-tts/SKILL.md`
- `skills/durindoor-web-fetch/SKILL.md`
- `skills/durindoor-web-search/SKILL.md`
- `tests/README.md`

### Review and retain at standard or generated paths

- `.github/CHANGELOG_TEMPLATE.md`
- `.github/ISSUE_TEMPLATE/bug_report.md`
- `.github/ISSUE_TEMPLATE/feature_request.md`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.sources.md`
- `AGENTS.md`
- `CHANGELOG.md`
- `CLAUDE.md`
- `model-catalog-report.md`
- `open-sse/AGENT-INDEX.md`

### Extract lasting facts, then delete

- `audit/mirror-gaps.md`
- `docs/campaigns/upstream-omniroute-2026-07-23-ledger.md`
- `docs/campaigns/upstream-omniroute-endpoint-ledger.md`
- `docs/campaigns/upstream-omniroute-port-roadmap.md`
- `docs/development/dev-recovery-ci.md`
- `docs/development/dev-zero-test-recovery.md`
- `docs/development/omniroute-provider-port-audit.md`
- `docs/development/omniroute-simple-provider-runtime.md`
- `docs/omniroute-api-cloud-review-fixes.md`
- `docs/omniroute-local-review-fixes.md`
- `docs/ports/README.md`
- `docs/ports/omniroute-6626.md`
- `docs/ports/omniroute-6871.md`
- `docs/ports/omniroute-6886.md`
- `docs/ports/omniroute-6890.md`
- `docs/ports/omniroute-6907-combo-context-requirements.md`
- `docs/ports/omniroute-6908.md`
- `docs/ports/omniroute-6937.md`
- `docs/ports/omniroute-6964.md`
- `docs/ports/omniroute-6965-responses-trailing-usage.md`
- `docs/ports/omniroute-7108.md`
- `docs/ports/upstream-2526.md`
- `docs/ports/upstream-2530.md`
- `docs/ports/upstream-2541.md`
- `docs/ports/upstream-2573.md`
- `docs/ports/upstream-2580.md`
- `docs/ports/upstream-2585.md`
- `docs/ports/upstream-2590.md`
- `docs/ports/upstream-2605.md`
- `docs/ports/upstream-2622.md`
- `docs/ports/upstream-2634.md`
- `docs/superpowers/plans/2026-07-09-pr145-api-key-usage-backfill.md`
- `docs/superpowers/specs/2026-07-22-control-mcp-parity-roadmap.md`
- `docs/superpowers/specs/2026-07-23-markdown-documentation-overhaul-design.md` after implementation closes and its durable decisions are reflected in canonical documentation

### Delete duplicated GitBook website and content

- `gitbook/content/en/deployment/cloud.md`
- `gitbook/content/en/deployment/localhost.md`
- `gitbook/content/en/faq.md`
- `gitbook/content/en/features/combos.md`
- `gitbook/content/en/features/quota-tracking.md`
- `gitbook/content/en/features/smart-routing.md`
- `gitbook/content/en/getting-started/installation.md`
- `gitbook/content/en/getting-started/quick-start.md`
- `gitbook/content/en/index.md`
- `gitbook/content/en/integration/claude-code.md`
- `gitbook/content/en/integration/cline.md`
- `gitbook/content/en/integration/codex.md`
- `gitbook/content/en/integration/continue.md`
- `gitbook/content/en/integration/cursor.md`
- `gitbook/content/en/integration/other-tools.md`
- `gitbook/content/en/integration/roo.md`
- `gitbook/content/en/providers/cheap.md`
- `gitbook/content/en/providers/free.md`
- `gitbook/content/en/providers/subscription.md`
- `gitbook/content/en/troubleshooting.md`

Non-Markdown GitBook application files under `gitbook/` are deleted in the same cutover.
