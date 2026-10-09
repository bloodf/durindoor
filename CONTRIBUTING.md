# Contributing to DurinDoor

The contributor guide is at [internal/docs/index.mdx](internal/docs/index.mdx).

## Local CI (`V5 Local CI`)

Pull requests no longer trigger GitHub Actions. `.github/workflows/ci.yml`, `test.yml` and `commitlint.yml` are retained and run only on push to `main` and manual `workflow_dispatch`; these three were the only workflows with PR triggers. Release, nightly and other workflows are unchanged. The ruleset still requires PRs, squash merge, resolved threads and an up-to-date branch, and also requires the status `V5 Local CI`, which stays pending (never success) until a separate approved verifier publishes it.

`scripts/local-ci.mjs` is the evidence runner for that gate. It is implementation only: it has not been executed or verified yet, and the status stays pending until a separate, approved verifier runs it against the exact PR head and publishes the status. The runner never calls the GitHub API and never publishes a status.

```bash
node scripts/local-ci.mjs --base <full-base-sha> --head <full-head-sha> \
  [--repo DIR] [--out NEW_DIR] [--path-prepend DIR_WITH_NODE_20.20.2] \
  [--website auto|always] [--title "PR title"]
```

- `--base` and `--head` are required full commit SHAs. Refs and ranges are rejected, and both must exist in `--repo` (default: cwd).
- Prerequisites: git, network access for `npm ci` and a private install of `@commitlint/cli@18.6.1` plus `@commitlint/config-conventional@18.6.3` (the pins in `commitlint.yml`, installed with `--no-save --no-package-lock` into the runner's own tool directory, never the checkout), and Node `20.20.2` with npm `10.8.2` on `PATH` (use `--path-prepend`). A wrong version stops the run with exit 2; nothing is silently substituted. Installed commitlint versions are recorded in the evidence.
- The runner clones `--head` into a fresh `--out` directory (default `~/.cache/durindoor-local-ci/<head12>-<utc>`) and checks that the tree is identical and clean. It uses a private `HOME` and npm cache there, so the original checkout and `~/.9router` are untouched. The build and the Vitest run get separate private `DATA_DIR`s (`durindoor-data-build`, `durindoor-data-test`) and Vitest also gets its own `HOME`, matching the separate CI jobs. `--out` must not already exist.
- Steps mirror the old workflows: `npm ci`, `lint`, `check:agent-index`, `check:postgres-migrations`, `build` (isolated `DATA_DIR`), website `npm ci`, website build, `check:docs`, `check:provider-catalog`, tests `npm ci`, `test:ci` with `BASELINE_BASE_REF=<base>` and private `HOME`/`DATA_DIR`, a non-empty check of `tests/.test-results.json` and `.junit.xml`, and commitlint with `.commitlintrc.cjs` over exactly `base..head`. `--title` is optional and never inferred: the old workflow linted commits only, so a title is linted (as an extra step) only when you pass one, and otherwise that step is recorded as `skipped`.
- Website build, `check:docs` and `check:provider-catalog` run locally only when `git diff BASE HEAD -- docs website` is non-empty (`--website always` forces them). A skipped website is recorded as `skipped` with the reason, never as a pass. The retained `main`/manual workflows always build the website.
- A failing step marks later steps in the same job `not-run`; independent jobs still run. Ctrl-C or SIGTERM stops the running command, records it, and exits 130.
- Output: `<out>/evidence.json` holds base/head/tree SHAs, SHA-256 of the three lockfiles, `.nvmrc` and `.commitlintrc.cjs`, tool versions, and per step the argv, cwd, env overrides, start/end times, exit code or signal, and log path and hash. Logs are in `<out>/logs/`. Exit 0 means every step passed or was an explicit conditional skip, 1 a failure, 2 a usage or prerequisite error.

Open an issue before large changes. Pull requests target `bloodf/durindoor:main`. Submit changes to this repository.

Use Node.js 20.20.2 and npm 10.8.2. A behaviour change needs a doc update and a test. Pure docs and CI edits can skip tests.

Commit with Conventional Commits: `type(scope): description`. Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `ci`, `chore`, `revert`, `merge`, `port`, `sync`. Subject text maxes out at 100 characters.

By contributing, you agree that your contributions will be licensed under the MIT License.
