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
`GITHUB_TOKEN` do not trigger other workflows.** Both workflows authenticate
their writes with `${{ secrets.RELEASE_PAT || secrets.GITHUB_TOKEN }}`:

- In `release-prepare.yml` the token drives the release-branch push, PR
  creation/update, and auto-merge. Without the PAT, `ci.yml`, `test.yml`,
  and `commitlint.yml` never run on the release PR, the ruleset's required
  checks can never go green, and auto-merge stalls forever. The workflow
  prints a loud warning; run the §6.4 checks locally, record them in the
  PR, and merge with a maintainer account.
- In `release-tag.yml` the Release created with the PAT fires the
  `release: published` trigger of `release.yml`; with `GITHUB_TOKEN` the
  Release would be created but the npm publish would silently never run. A
  loud warning with manual fallback instructions is printed when the PAT is
  absent.

One more secret note: the one-time setup scopes are **`contents: write`**
plus **`pull-requests: write`** for `RELEASE_PAT` (PR creation/update and
auto-merge live in Release Prepare).

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

**The squash title is part of the contract.** Release Tag fires only when
the bump commit's first subject line is exactly `chore(release): bump
version to X.Y.Z` (the ` (#PR)` suffix squash-merge appends is allowed) and
the version in that subject equals both `package.json` versions at the
pushed commit. If a maintainer merges manually with a renamed title — or a
merge/rebase merge produces any other subject — tagging silently does not
fire. Fallback: **Actions → Release Tag → Run workflow** with
`version: X.Y.Z`; the manual path pins the checkout to `main`, validates the
requested version against both manifests, and tags the pinned SHA.

**If main advances while the release PR is open**, the waiting PR's version
and changelog were computed from the older main and would ship the
intervening commits without notes. Close the PR and re-dispatch Release
Prepare: it recomputes everything from the latest main, replaces the stale
`release/vX.Y.Z` branch (retry policy), and updates or recreates the PR.

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
`tests/unit/release-notes.test.js`. `extract` reads `CHANGELOG.md` only — it
resolves no git baseline, so it works even in a checkout with no reachable
`v*` tag (first release, or recovery after the sole tag was removed).

Release Prepare also runs the §6.3 pre-push gate itself: after committing
the bump it installs commitlint and runs `npx commitlint
--from=origin/main --to=HEAD` plus a title check (`echo "<pr-title>" | npx
commitlint`) before pushing.

## Failure and rollback playbook

| Stage | Failure | Recovery |
| --- | --- | --- |
| Release Prepare | "No commits since tag" | Nothing to release; no state created. |
| Release Prepare | Run failed after the branch push (PR create / auto-merge) | Just re-dispatch: the retry policy replaces the stale `release/vX.Y.Z` branch (`--force-with-lease` against the observed SHA) and updates or recreates the PR. |
| Release Prepare | PR open, CI red | Push fixes to `release/vX.Y.Z`, or close the PR and re-dispatch. |
| Release Prepare | PR stalled with no checks (RELEASE_PAT absent) | Expected: GITHUB_TOKEN pushes don't trigger CI. Run the §6.4 checks locally, note them in the PR, merge with a maintainer account. |
| Release Tag | Push ran but no tag created | The merge subject didn't match the contract; re-run Release Tag manually with `version: X.Y.Z`. |
| Release Tag | Tag already exists | The guard refuses to re-tag; bump the version instead. |
| After merge, before npm publish | Bad release | `gh release delete vX.Y.Z --repo bloodf/durindoor --yes`, `git push origin :refs/tags/vX.Y.Z`, then revert the bump commit on `main`. |
| After npm publish | Bad release | npm does not unpublish cleanly — publish a fixed patch version and mark the bad one deprecated (`npm deprecate`). |

## Manual fallback

When `RELEASE_PAT` is missing, `release-tag.yml` still creates the Release
with `GITHUB_TOKEN` but `release.yml` will **not** fire. Either:

```bash
# Re-create the release with a maintainer PAT so the publish workflow fires
# (delete first — the automated run already created it with GITHUB_TOKEN)
gh release delete vX.Y.Z --repo bloodf/durindoor --yes
gh release create vX.Y.Z --repo bloodf/durindoor --title vX.Y.Z --target <bump-commit-sha> --notes-file release-notes.md

# Or publish the CLI directly (full gate first)
npm run lint && npm run build && (cd tests && npm run test:ci)
NPM_TOKEN=... npm run cli:publish
```

A maintainer can also re-run the whole tag step manually via
**Actions → Release Tag → Run workflow** with an explicit `version` input.
