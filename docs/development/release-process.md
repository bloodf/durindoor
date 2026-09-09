# Release Process

DurinDoor releases are a three-workflow chain: a human triggers **Release
Prepare**, a release PR is merged to `main`, **Release Tag** tags the version
and creates the GitHub Release, and the existing **Release** workflow
publishes the CLI to npm.

## Overview

```
workflow_dispatch (bump, automerge)
        |
        v
+-------------------+   squash merge    +----------------+   release: published   +-----------------+
| Release Prepare   | ----------------> | Release Tag    | ---------------------> | Release         |
| release-prepare.yml|                  | release-tag.yml|                       | release.yml     |
| - compute version  |                  | - tag vX.Y.Z   |                       | - lint/build/test |
| - bump package.json|                  | - gh release   |                       | - npm publish CLI |
|   (root + cli)     |                  |   create       |                       |                   |
| - changelog section|                  |                |                       |                   |
| - PR to main       |                  |                |                       |                   |
+-------------------+                   +----------------+                       +-----------------+
```

## One-time setup

Two repository secrets on `bloodf/durindoor`:

- **`NPM_TOKEN`** — already in place; used by `release.yml` to publish the
  `durindoor` CLI package.
- **`RELEASE_PAT`** (new, required for full automation) — a fine-grained
  personal access token with **contents: write** on this repository.

`RELEASE_PAT` exists because of a GitHub rule: **events created with
`GITHUB_TOKEN` do not trigger other workflows.** The Release created by
`release-tag.yml` must fire the `release: published` trigger of
`release.yml`; with `GITHUB_TOKEN` the Release would be created but the npm
publish would silently never run. `release-tag.yml` therefore authenticates
`gh` with `${{ secrets.RELEASE_PAT || secrets.GITHUB_TOKEN }}` and prints a
loud warning with manual fallback instructions when the PAT is absent.

## Cutting a release

### From the UI

1. **Actions → Release Prepare → Run workflow.**
2. Pick `bump` (`auto` derives it from conventional commits since the last
   tag; `patch`/`minor`/`major` force it) and leave `automerge` on unless you
   want to review the PR first.
3. The workflow opens a PR titled `chore(release): bump version to X.Y.Z`.

### From the CLI

```bash
gh workflow run release-prepare.yml --repo bloodf/durindoor -f bump=auto -f automerge=true
```

Merging the release PR is the point of no return for automation: the push to
`main` fires **Release Tag**, which tags `vX.Y.Z`, extracts the version's
section from `CHANGELOG.md` (`node scripts/release-notes.mjs extract X.Y.Z`),
and creates the GitHub Release. Publishing that Release fires `release.yml`,
which runs the full lint/agent-index/build/Vitest gate and then publishes
the CLI to npm.

## Editing the release PR before merge

The changelog section is generated from commit subjects and grouped into
`## Features` / `## Fixes` / `## Upstream ports` / `## Maintenance`. The
wording is safe to edit directly on the `release/vX.Y.Z` branch — push a
follow-up commit touching `CHANGELOG.md` only. Do not change the version in
`package.json` / `cli/package.json` or the commit/PR title format:
`release-tag.yml` verifies the bump commit subject against the version.

## Versioning policy

- `auto` bump derives from Conventional Commit subjects on
  `<last-tag>..main`: any breaking marker (`type!:` / `type(scope)!:`) →
  **major**; else any `feat` → **minor**; else **patch**. The repo is
  post-1.0, so breaking changes are major bumps.
- Tags are `vX.Y.Z`; `CHANGELOG.md` keeps one `# X.Y.Z` top-level section
  per version, newest first.
- Both `package.json` (root) and `cli/package.json` (the published npm
  package) are bumped together and must always carry the same version.

## Tooling

`scripts/release-notes.mjs` is the single source of version math and
changelog generation:

```bash
node scripts/release-notes.mjs next-version [--bump auto|patch|minor|major] [--from <tag>]
node scripts/release-notes.mjs notes <version> [--from <tag>]
node scripts/release-notes.mjs extract <version>
```

All three are pure over git history / `CHANGELOG.md` and are unit-tested in
`tests/unit/release-notes.test.js`.

## Failure and rollback playbook

| Stage | Failure | Recovery |
| --- | --- | --- |
| Release Prepare | "No commits since tag" | Nothing to release; no state created. |
| Release Prepare | PR open, CI red | Push fixes to `release/vX.Y.Z`, or close the PR and re-dispatch. |
| Release Tag | Tag already exists | The guard refuses to re-tag; bump the version instead. |
| After merge, before npm publish | Bad release | `gh release delete vX.Y.Z --repo bloodf/durindoor --yes`, `git push origin :refs/tags/vX.Y.Z`, then revert the bump commit on `main`. |
| After npm publish | Bad release | npm does not unpublish cleanly — publish a fixed patch version and mark the bad one deprecated (`npm deprecate`). |

## Manual fallback

When `RELEASE_PAT` is missing, `release-tag.yml` still creates the Release
with `GITHUB_TOKEN` but `release.yml` will **not** fire. Either:

```bash
# Re-create the release with a maintainer PAT so the publish workflow fires
gh release delete vX.Y.Z --repo bloodf/durindoor --yes
gh release create vX.Y.Z --repo bloodf/durindoor --title vX.Y.Z --target main --notes-file release-notes.md

# Or publish the CLI directly (full gate first)
npm run lint && npm run build && (cd tests && npm run test:ci)
NPM_TOKEN=... npm run cli:publish
```

A maintainer can also re-run the whole tag step manually via
**Actions → Release Tag → Run workflow** with an explicit `version` input.
