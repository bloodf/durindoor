# Local CI and manual Actions

Local validation is the ordinary PR path after this transition passes its full
checkpoint. This PR must remain draft until the integration owner validates the
exact reviewed head with a newly frozen runner and imported closure. A receipt
schema or focused unit test pass does not authorize switching off automatic CI.
The author does not run the candidate to approve it. The contract is in
[AGENTS.md](../../AGENTS.md) and [testing](./testing.mdx).

## One-command full checkpoint

The integration owner first obtains an independent review, freezes the reviewed
checkout outside the candidate, and records every imported file's SHA256 in an
external manifest. This includes the runner, baseline helpers and their recursive
imports, including `src/shared/utils/typeChecks.js`. Keep this bundle and the
manifest inaccessible to candidate subprocesses. Use Node 26.13.0, npm 11.20.0,
an ownership-correct unprivileged POSIX account, and a new private output path.

```sh
command fnm exec --using=26.13.0 node "$FROZEN/scripts/local-ci.mjs" \
  --repo "$CHECKOUT" --base "$BASE_SHA" --head "$HEAD_SHA" \
  --runner-sha "$FROZEN_RUNNER_SHA256" --website always \
  --title "$PR_TITLE" --out "$NEW_PRIVATE_OUTPUT"
```

Variables are owner-supplied absolute paths and independently verified identities,
not values sourced from candidate scripts. Full is the default. `--website always`
retains the former main-push website coverage at bootstrap and checkpoints.
PR runs may use `--website auto`, which also checks shared dashboard, runtime,
assets, dependency and build inputs. Docs, provider catalog and registry-index
checks run in every full checkpoint. Scoped mode still requires an independently
frozen selection under the existing policy; it cannot authorize this transition.

Every command has a 300-second ceiling and a silence watchdog. Four sequential
Vitest commands retain at most four forks and per-file isolation. Configured
discovery must equal the complete eligible tracked head inventory; missing,
duplicate, stale, failed and runtime-error results fail the gate. JSON/JUnit
reports are aggregated only after all batches pass. The failure baseline stays
empty. Private HOME, DATA_DIR, temp directories, caches and sanitized child
environments are mandatory. A failed prerequisite is a blocker, not a waiver.

## Workflow coverage

Audited all ten workflows at main `05614249fae91cbb8c4022e91607857e3f942e25`.

| Workflow and jobs | Local coverage | Hosted control retained |
| --- | --- | --- |
| `ci.yml`: lint-and-build, website-changes, website-build | Root lint, agent index, Postgres migration registry, app build; website build with exact base/head input selection; docs/catalog plus registry-index checks | Manual dispatch, website always built |
| `test.yml`: vitest | Complete configured/tracked inventory, four supervised batches, empty baseline, fresh JSON/JUnit and hashes | Manual dispatch with explicit base SHA; uploaded reports |
| `commitlint.yml`: commitlint | Exact base..head and supplied squash title, pinned commitlint | Manual dispatch with base SHA and title |
| `artifact-smoke.yml`: smoke | Full mode builds standalone and CLI, packs, installs the exact tarball into an isolated prefix and smokes both artifacts; hashes the tarball | Existing manual smoke fallback |
| `nightly.yml`: nightly | Lint/index/build/tests/reports covered by full mode | Schedule/manual control and prerelease creation unchanged; enabled state is owner-managed |
| `release-prepare.yml`: prepare | Release-notes unit suites in full inventory; version/changelog commands can be previewed in a disposable checkout | Manual bump, branch/PR creation and optional auto-merge remain release-owner controls |
| `release-tag.yml`: tag | Root/CLI version equality in artifact checks; release-notes suites | Existing controlled bump-push/manual tag and GitHub Release creation unchanged |
| `release.yml`: publish | Lint/index/build/tests/reports and standalone/packed CLI smoke | Release event and npm credential/OIDC publication unchanged |
| `docker-publish.yml`: prepare, build, publish | Owner-only local Docker build/smoke procedure below; artifact checks validate version agreement | Tag validation, both native Linux architectures, digest upload, manifest verification and promotion retain publication controls |
| `upstream-watch.yml`: scan | Existing local discovery/report scripts and offline unit suites | Manual only; no new schedule or issue-writing automation |

No deployment workflow exists in this inventory. External hosting integrations
are outside it. No release, tag, npm, Docker or deployment operation is part of
local PR validation. CI fallback does not replace the independent review or
external provenance requirements.

## Docker and platform exceptions

Docker requires a separately authorized, disposable local builder. Do not expose
its socket or registry configuration to Vitest or the local runner. On a host
without Docker, record Docker as not run, never passed. macOS artifact smoke
proves that host only; it does not prove Alpine/musl or Windows native behavior.
Use native Linux amd64 and arm64 owners for release parity. Keep the release
workflow's two-platform manifest checks even after local builds pass.

On an owner-controlled Docker host, export a clean exact-head source tree, use a
new private HOME and DOCKER_CONFIG without credentials, and create a uniquely
named `docker-container` buildx builder. Record the source SHA, Dockerfile hash,
platform, Docker/buildx versions, logs and resulting image identity. Run each
command under `/opt/homebrew/bin/timeout -k 5s 300s` on macOS or `timeout -k 5s
300s` on Linux, with start/finish messages. Example build arguments, using the
owner's recorded builder name and image name:

```sh
docker buildx build --builder "$BUILDER" --platform "$PLATFORM" \
  --build-arg "APP_VERSION=$VERSION" --load --tag "$LOCAL_IMAGE" "$SOURCE"
docker run --detach --name "$CONTAINER" --platform "$PLATFORM" \
  --publish 127.0.0.1:20128:20128 "$LOCAL_IMAGE"
curl --fail --retry 30 --retry-connrefused --retry-delay 2 \
  --max-time 5 http://127.0.0.1:20128/api/health
```

Do not add `--push`, registry login, secrets, real data volumes or publication
labels. Install cleanup traps before starting: remove only this container,
image and builder on success, failure, interruption or timeout. A client timeout
does not stop Docker work: remove the dedicated builder and container and verify
their absence with `docker buildx ls` and `docker ps -a`. Retain logs outside the
source tree. A timeout is a failure; do not increase the ceiling. This separate
owner evidence is required when Docker/release inputs change and for release
readiness, and must be explicitly attached rather than inferred from Vitest.

## Owner verification and publication

There is no trusted external publisher checked into this repository. Use this
manual owner procedure until a separately reviewed publisher exists. Never use
candidate code, including `validateReceipt`, as the authority for publication.
The runner's metadata validator is not a provenance verifier.

1. Obtain the independent review outside the candidate, naming the exact reviewed
   source SHA and complete import-closure hashes. Recompute those hashes before
   execution from the frozen bundle. Record base-policy hashes, toolchain/ABI,
   platform, lockfiles, selection if scoped, and expected command list outside
   the candidate. Full bootstrap and this transition require `--website always`.
2. Execute the frozen runner under the approved unprivileged identity. Keep
   credentials and frozen provenance outside the candidate execution boundary.
   Retain the supervisor's exit status, start/end times and logs independently.
   Do not accept evidence from an author-controlled run or an untrusted shared
   directory. Check ownership and reject symlinks/paths outside the run directory.
3. Independently recompute receipt, command-log, JSON/JUnit and artifact hashes.
   Compare all fields to the external manifest and expected commands, not to
   claims inside the receipt alone. Require each mandatory command exactly once
   per expected job, zero exit, no signal/spawn error, no failed/not-run marker,
   duration at most 300 seconds and fresh timestamps. Require all four batch
   results and their exact inventory union, executed passing assertions, zero
   failures/runtime errors, and the empty baseline. Validate website and artifact
   commands, tarball size/hash and report aggregation. Recompute toolchain and
   policy identities; reject drift, missing files and evidence older than one hour.
4. In the credential-bearing owner shell, reread live `main`, PR base/head and
   title via GitHub. They must match reviewed/run identities and the linted title.
   Any base/head drift requires new evidence; changed code requires new review.
   Only after every check passes, post the status to that exact head. Immediately
   before merge, reread identities and review-thread resolution. This is a human
   gate because current main rules do not require a status check. Never enable
   auto-merge as a substitute for this check.

The owner may then run this explicit publication command, substituting only the
verified head and an owner-controlled evidence URL. The implementation worker
must not run it:

```sh
GH_CONFIG_DIR="$HOME/.config/gh-bloodf" /opt/homebrew/bin/gh api \
  --method POST "repos/bloodf/durindoor/statuses/$VERIFIED_HEAD" \
  -f state=success -f context='V5 Local CI' \
  -f description='Independent exact-head local validation passed' \
  -f target_url="$OWNER_EVIDENCE_URL"
```

Preserve private logs securely; do not publish secrets or private filesystem
paths as the evidence URL. Remove disposable snapshots/build outputs after
verification while retaining the externally sealed evidence needed for audit.

## Manual fallback and rollback

Dispatch CI on the desired branch/ref for lint/build/website, Tests with the
exact base SHA, and Commitlint with base SHA and the squash title. Record each
run's exact head. Manual dispatch is an owner action; this change does not launch
runs or cancel existing ones. Artifact Smoke remains independently dispatchable.
A failing local gate blocks merges even when a hosted fallback passes until the
owner explains and resolves the discrepancy.

Rollback through a reviewed PR restoring the previous CI/test/commitlint event
triggers. Do not edit repository settings or disable release workflows. Read-only
inspection of main ruleset 18697697 found deletion/non-fast-forward protection,
squash-only PRs, required review-thread resolution and Copilot review, with no
`required_status_checks`. A branch-protection endpoint 404 is not proof that no
ruleset applies. Recheck live rules before integration.
