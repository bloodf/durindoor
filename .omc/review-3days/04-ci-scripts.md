# 04 - CI, scripts, harness review

**Range:** `cfb25e641..origin/dev`
**Scope:** `.github/workflows/**`, `package.json`, `scripts/**`, `.commitlintrc.*`, `open-sse/AGENT-INDEX.md`
**Reviewer posture:** verified findings only. Items here are risks; some depend on user-visible behavior I could not confirm without runtime access.

## Evidence sources

- `read .github/workflows/ci.yml`
- `read .github/workflows/test.yml`
- `read .github/workflows/commitlint.yml`
- `read .github/workflows/release.yml`
- `read .github/workflows/gitbook-pages.yml`
- `read scripts/check-agent-index.mjs`
- `read .gitignore:55-65` for lockfile ignore
- `glob .github/workflows/*.yml`
- `glob package-lock.json; cli/package-lock.json`
- `bash git ls-files package-lock.json` (verified: file is tracked in git, blob `f14fbf48`)

## Verified findings

### P1 - `release.yml` uses `npm ci` + `cache: npm`; `ci.yml` comment still claims lockfile is gitignored

- `origin/dev:.github/workflows/release.yml:15-19`:
  ```yaml
  node-version: 22
  cache: npm
  registry-url: https://registry.npmjs.org
  - run: npm ci
  ```
- Root `package-lock.json` IS tracked in git (verified: `git ls-files package-lock.json` returns the path; `git ls-tree HEAD package-lock.json` shows blob `f14fbf48`). So `npm ci` will find it on a fresh checkout. The previous P0 claim that release would fail from a missing lockfile is false.
- `.gitignore:61` still lists `package-lock.json` for exclusion. Git tracking an ignored file is unusual; the rule has no effect now, but it is a foot-gun: a future developer who runs `git rm --cached package-lock.json` will remove the tracked file, and a subsequent `git add` will be blocked by the ignore.
- `origin/dev:.github/workflows/ci.yml:31-33` still has the comment `repo gitignores package-lock.json` - that comment is now stale and misleading.
- `cli/package-lock.json` is absent (verified via glob). The release job uses `npm --prefix cli install --include=dev` (not `npm ci`) for the cli subdir, so the missing cli lockfile is not a release blocker. But it means the cli install is not reproducible.

Recommended cleanup:
1. Update the `ci.yml:31-33` comment to reflect reality ("root lockfile is tracked in git; cli lockfile intentionally absent").
2. Remove the now-dead `package-lock.json` rule from `.gitignore:61` (or add `# tracked intentionally; do not git rm --cached`).
3. Decide whether to commit `cli/package-lock.json`; if yes, run `npm --prefix cli ci --include=dev` instead of `npm install` for reproducibility. If no, accept the current trade-off and document it.


### P2 - `test.yml` uses `actions/checkout@v5` + `actions/setup-node@v5`; `ci.yml` and `commitlint.yml` use v4

- `test.yml:25,28` use `@v5`; `ci.yml:25,28` and `commitlint.yml:9` use `@v4`.
- Mixed major versions can produce different node_modules layouts and checkout behavior. Not a confirmed defect; just a consistency note.

### P2 - `gitbook-pages.yml` deploys to `gh-pages` (was `9router/9router.github.io`)

- Diff: dropped `external_repository: 9router/9router.github.io`; switched `publish_branch` from `main` to `gh-pages`.
- Intent: rebrand to DurinDoor, deploy to repo's own `gh-pages` branch.
- I cannot verify whether inbound links to `9router.github.io` still work. That requires a follow-up with the user; the change is intentional rebrand, not a defect.

## Risks (not confirmed)

### R1 - `test.yml` is not invoked by branch protection

- `origin/dev:.github/workflows/test.yml:9-13` triggers on `push` to `dev` and `main` and on `pull_request`. So PRs do trigger it. But since branch protection is currently absent, the workflow's success or failure does not block merges.

## Bug summary

| Severity | File:line | Issue | Verified? |
|---|---|---|---|
| P1 | `.github/workflows/release.yml:15-19` + `ci.yml:31-33` + `.gitignore:61` | release uses `npm ci` + `cache: npm`; root lock IS tracked so it works, but the comment in ci.yml is stale and the ignore rule is dead | yes |
| P2 | `test.yml` vs `ci.yml` actions versions | v4 vs v5 mixed | yes |
| P2 | `gitbook-pages.yml` | Re-brand, intent not confirmed with user | partial |

## Source artifacts

- `read .github/workflows/{ci,test,commitlint,release,gitbook-pages}.yml`
- `read scripts/check-agent-index.mjs`
- `glob .github/workflows/*.yml`
- `git ls-files package-lock.json` (tracked)
