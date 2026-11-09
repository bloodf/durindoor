# Deployment gates and hosted CI

Tooling only. Product remains HOLD. Do not push this patch or create its PR until
the central tooling owner confirms live containment. Branches with older config
can still trigger deployments before this patch is integrated. This patch makes
no live settings, authentication, DNS, protection, or status changes.

## Repository and deployment audit

Inspected on 2026-11-08 from clean `main`, HEAD and local `origin/main`
`87c9ae525c63e8bf741865c40f1fd7e9de8bd6bf`. GitHub reports `main` as the default
branch. No branch switches, installs, builds, hosted runs, pushes or PRs occurred.

The current main commit's GitHub status names Vercel team `hr-teconologia`, project
`durindoor`, deployment `6HnFLDyvWHE5KimEgyV7vxqBHkPP`. README advertises
`durindoor.vercel.app`. `website/README.md` identifies the public site as a Vercel
app, and `website/vercel.json` is its tracked project config. Its Next config
imports `../src` and `../open-sse`; its MDX source reads `../docs`; prebuild copies
`../public`, `../assets/brand` and shared CSS. Those paths are deployment inputs.

There are no local `.vercel/project.json` files. Live Root Directory, project ID,
team ID, and a complete census of linked Vercel projects are therefore unverified.
The dashboard project slug does not prove its Root Directory. Repo audit found
two Next applications: `website/` and the gateway/dashboard at repository root.
The new root `vercel.json` also guards any project using the root application;
it does not create or link a Vercel project. CLI, extension and lint-tool package
manifests are not additional proven Vercel sites. No other tracked Vercel app
configuration was found. Provider-side Vercel deployment code is product code
and is outside this tooling patch.

Recent GitHub deployments include Vercel Preview deployment IDs `7645426314`
and `7645197109`, plus Production `7630521018` at the inspected main SHA. These
prove previews existed; they do not establish current live containment.

## Main-only Git deployments

Both project configs use `git.deploymentEnabled` with `"**": false` and
`"main": true`. Vercel documents minimatch branch matching and that any matching
true rule permits a deployment. `**` also covers feature branches containing `/`.
This prevents automatic preview creation for revisions carrying this config.

The ignored build command runs before dependency installation, from either
project Root Directory. `website/scripts/vercel-ignore-build.sh` defaults to
website inputs; root config passes `app` for root application inputs. Exit `0`
cancels, exit `1` builds. Only `VERCEL_ENV=production` and
`VERCEL_GIT_COMMIT_REF=main` reach the input comparison. A production flag alone
cannot authorize a feature branch, and a preview of main is canceled.

The baseline is exclusively `VERCEL_GIT_PREVIOUS_SHA`, the project's last
successful deployment on this branch. Comparing endpoint trees covers multiple
commits, merge commits, and squash merges. `--no-renames` checks both sides of a
rename and detects deletions. An unchanged endpoint tree is skipped. There is
no `HEAD^` fallback, dependency installation, remote fetch, or API call.

Both targets watch shared source, runtime, public assets, scripts, dependency
patches, root manifests/lockfiles/workspace files and build/toolchain config.
Website additionally watches all `website/`, public `docs/` and `assets/brand/`.
Root app additionally watches root JavaScript sidecars. Changes only to root
README, internal docs, tests or workflow YAML skip deployment when history is
available. Directory-wide source/script matching is conservative; it can build
for a source file that the selected app does not currently import.

Missing, malformed, zero, unavailable or shallow-clone baseline, unverifiable
ancestry, commit-metadata mismatch, unknown target or diff failure cancels the build
with a diagnostic and requires operator review. Unknown history never authorizes spending.
Non-main skips before any history operation. First deployment requires an explicitly
authorized bootstrap baseline; updates can remain held until that recovery.

The ignored build step alone does not prevent deployment creation: Vercel counts
its canceled deployments toward quotas and concurrency. Git branch controls are
the first control. CLI deployments, deploy hooks and redeploys that bypass the
ignore command require owner control outside these repository files.

## Actions and review gates

All ten workflows were inspected. CI, Tests, Commitlint, Artifact Smoke and
Upstream Watch already use only `workflow_dispatch`. No automatic PR or feature
push build/test/E2E/matrix trigger was found. This patch keeps those events,
adds finite job timeouts to the four development validation workflows, cancels
superseded runs of each on the same ref, and removes CI's obsolete PR diff job.
An explicitly dispatched CI run still builds the website.

Release Prepare, Release Tag, npm Release and Docker tag publishing retain their
existing release controls and validation. Nightly is now manual-only; its existing jobs and failure handling remain intact.
Central disabled the former live schedule. This patch does not authorize release publication.
No separate security workflow exists in the tracked workflow inventory. Existing
security tests, lint, migration/index checks, dependency policy and local gate
requirements remain. No success status or substitute no-op check is created.

Read-only GitHub branch-rules inspection found deletion/non-fast-forward
protection, squash-only PRs, resolved review threads and Copilot review. Required
approvals were `0`; no required-status-check rule was returned. Preserve these
settings and the independent review/full-checkpoint policy in `AGENTS.md` and
[Local CI](./local-ci.md). Focused gate tests do not approve this tooling patch
for merge. Workflow dispatch checks do not satisfy required PR status checks;
the trusted owner's publication process remains necessary.

## Focused local verification

```sh
bash -n website/scripts/vercel-ignore-build.sh
node --test tests/unit/vercel-build-gate.test.mjs
git diff --check
```

The native Node test uses disposable local Git repositories, no installed
packages or network. It checks branch/environment rejection, unchanged inputs,
shared dependencies/config/assets, nested project cwd, deletion, renames into
and out of site inputs, multi-commit/merge/squash history, unavailable/shallow
and non-ancestor baselines, root-app selection and both config commands.
It is separate from the existing Vitest `**/*.test.js` inventory. Run it explicitly.
Full local CI, root lint and independently reviewed exact-head checks remain
owner requirements; they were not run by this implementation worker.

## Central owner checks before publication

1. Enumerate every Vercel project linked to `bloodf/durindoor`, record project/team
   IDs and live Root Directory, and map each to a guarded config. Verify main is
   the production branch, system Git variables are exposed, and website builds
   can read files outside Root Directory. Unknown roots remain containment gaps.
2. Confirm previews and old feature refs cannot spend before pushing the patch.
   Check deploy hooks, custom environments, CLI/redeploy bypasses and pending
   builds. Config in this patch cannot change old branch contents or existing runs.
3. Verify live Actions enabled states, particularly Nightly, and preserve branch
   rules, security scanning and independently reviewed local validation. Do not
   remove protections or publish synthetic success to unblock a merge.
4. Obtain independent review and the required externally frozen full checkpoint
   before publishing or merging through the central tooling process. Product
   stays HOLD after tooling completes.

## Official references

Read current official documentation during this audit:

- [Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration)
- [Vercel ignored build step](https://vercel.com/docs/project-configuration/project-settings#ignored-build-step)
- [Vercel system variables](https://vercel.com/docs/environment-variables/system-environment-variables#vercel_git_previous_sha)
- [Vercel project config location](https://vercel.com/docs/project-configuration/vercel-json)
- [GitHub manual workflows](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)
- [GitHub required status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks)
