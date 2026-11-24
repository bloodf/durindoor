# Local CI and manual Actions

The gate-selection and approval contract is maintained in
[AGENTS.md](../../AGENTS.md#local-gate-authority). This guide records the
operational commands and workflow coverage for that contract.

## One-command full checkpoint

The orchestrator or a review worker runs the full gate on the exact PR head from a clean checkout of `main`, never from the candidate's own runner. Use Node 24.22.2 and pnpm 12.18.0 in a private output path.

```sh
fnm exec --using=24.22.2 node scripts/local-ci.mjs \
  --repo "$CHECKOUT" --base "$BASE_SHA" --head "$HEAD_SHA" \
  --website always --title "$PR_TITLE" --out "$NEW_PRIVATE_OUTPUT"
```

Full is the default. PR runs may use `--website auto`. Every command has a 300-second ceiling. Twelve sequential Vitest batches together cover the complete tracked test inventory, and the failure baseline stays empty. `cd tests && pnpm run test:ci` uses the same partition and batch arguments from `tests/__baseline__/full-batches.mjs`, with its own 300-second ceiling per command, so a developer or hosted run exercises the same commands as the checkpoint. Together with a review from a different model family than the author, a passing run is sufficient to merge. See [AGENTS.md](../../AGENTS.md#local-gate-authority). No owner receipt, frozen bundle or hash manifest is required.

## Workflow coverage

Audited all ten workflows at main `05614249fae91cbb8c4022e91607857e3f942e25`.

| Workflow and jobs | Local coverage | Hosted control retained |
| --- | --- | --- |
| `ci.yml`: lint-and-build, website-build | Root lint, agent index, Postgres migration registry, app build; website build with exact base/head input selection; docs/catalog plus registry-index checks | Manual dispatch, website always built |
| `test.yml`: vitest | Complete configured/tracked inventory, twelve supervised batches, empty baseline, fresh JSON/JUnit and hashes | Manual dispatch with explicit base SHA; uploaded reports |
| `commitlint.yml`: commitlint | Exact base..head and supplied squash title, pinned commitlint | Manual dispatch with base SHA and title |
| `artifact-smoke.yml`: smoke | Full mode builds standalone and CLI, packs, installs the exact tarball into an isolated prefix and smokes both artifacts; hashes the tarball | Existing manual smoke fallback |
| `nightly.yml`: nightly | Lint/index/build/tests/reports covered by full mode | Schedule/manual control and prerelease creation unchanged; enabled state is owner-managed |
| `release-prepare.yml`: prepare | Release-notes unit suites in full inventory; version/changelog commands can be previewed in a disposable checkout | Manual bump and draft PR creation; owner validation required before ready/merge, including retries |
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

## PostgreSQL fencing evidence

The ordinary batches supply no `DURINDOOR_TEST_PG_URL`, so the live cases in
`tests/unit/antigravity-lease-postgres.test.js` skip there; skipped cases are
not evidence. The batches do run `tests/unit/postgres-live-runner.test.js`
offline: it proves the runner fails without a URL, fails rather than skips in
required mode or against an unreachable cluster, and hands Vitest only an
allowlisted environment.

For live evidence, the supervising process starts a disposable cluster with
synthetic credentials on `127.0.0.1` and runs
`node scripts/test-postgres-fencing.mjs` with `DURINDOOR_TEST_PG_URL` set.
The script never controls a container runtime. Run it without the Docker
socket, for example
`bwrap --dev-bind / / --bind /dev/null /run/docker.sock env -i PATH="$PATH" DURINDOOR_TEST_PG_URL="$URL" node scripts/test-postgres-fencing.mjs`,
then remove the container. It fails unless all five fencing tests pass,
including the multi-process acquire and fence/dispatch races.

## Verification and merge

The orchestrator or a review worker that ran the gate verifies its own run before merging. The run must have:

- covered the exact PR base and head;
- every mandatory command exit 0 within its 300-second ceiling;
- all twelve test batches passing, with their union equal to the tracked test inventory;
- an empty failure baseline.

A review from a different model family than the author must be recorded on the PR. Reread the PR head right before merging; if it changed, run the gate again. Attaching the run summary to the PR is enough evidence. Posting a commit status is optional, and no owner-held receipt is required. Never publish secrets or private filesystem paths in PR comments.

## Manual fallback and rollback

Dispatch CI on the desired branch/ref for lint/build/website, Tests with the
exact base SHA, and Commitlint with base SHA and the squash title. Record each
run's exact head. Manual dispatch is an owner action; this change does not launch
runs or cancel existing ones. Artifact Smoke remains independently dispatchable.
A failing local gate blocks merges even when a hosted fallback passes until the
owner explains and resolves the discrepancy.

GitHub documents that `workflow_dispatch` job checks do not satisfy PR required
status checks. Treat manual runs as evidence for the trusted owner publication
procedure above, not as a replacement for required checks. The
[deployment gate audit](./deploy-gates.md) records Vercel containment and the
remaining live-setting checks before publication.

Rollback through a reviewed PR restoring the previous CI/test/commitlint event
triggers. Do not edit repository settings or disable release workflows. Read-only
inspection of main ruleset 18697697 found deletion/non-fast-forward protection,
squash-only PRs, required review-thread resolution and Copilot review, with no
`required_status_checks`. A branch-protection endpoint 404 is not proof that no
ruleset applies. Recheck live rules before integration.

### Orchestrator related-file checks

For the orchestrator's per-change checks, pass the changed-file list to
`node scripts/run-related-tests.mjs "$ORQ_CHANGED_FILES"` from the candidate
checkout. Use a private, disk-backed `TMPDIR` and run lint separately. The
runner resolves Vitest's transitive test dependencies once, then runs all
selected files in batches of 50 with four isolated fork workers. Discovery
and each batch have an independent five-minute ceiling, including termination
grace. An empty selection or a failed batch fails the check. The full
inventory checkpoint remains required for merges.
