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

Full is the default. PR runs may use `--website auto`. Every command has a 300-second ceiling. Twelve sequential Vitest batches together cover the complete tracked test inventory, and the failure baseline stays empty. `cd tests && pnpm run test:ci` uses the same partition and batch arguments from `tests/__baseline__/full-batches.mjs`, with its own 300-second ceiling per command, so a developer or hosted run exercises the same commands as the checkpoint. When the full website job is selected (`--website always`, or `--website auto` with changed website inputs), an executable local Chromium browser is required; a missing or invalid browser fails `website-browser-suites` and the evidence/summary. When available, `scripts/local-ci.mjs` discovers the complete configured Playwright inventory (`website-browser-inventory`, running `node website/node_modules/@playwright/test/cli.js test --list --reporter=json`) and splits it into deterministic shards (`website-browser-shard-1` through `website-browser-shard-N`, up to 8 shards via `--shard=i/N --reporter=list,json --output=<private-dir>`). Each shard is a separate supervised command under its own 300-second ceiling with its own transient loopback Next.js server, process-group cleanup, and private output/screenshot/report paths under `--out`. Each shard server gets a free loopback port reserved just before the shard starts (never the fixed 3100), a private state file and a random owner token, all passed through the child env allowlist. Playwright runs the server in its own process group, so killing a shard does not stop it; the launcher (`website/scripts/transient-server.mjs`) watches the runner PID and stops its server when the runner is gone. After every shard, whatever ended it, `website-browser-shard-N-server-cleanup` (`scripts/lib/website-shard-server.mjs`) signals only processes that `/proc` shows carry that shard's token in their environment under the same uid with an unchanged start time, never a listener it cannot attribute, and fails the gate and stops the remaining shards when an owned process survives, a live process's ownership cannot be read, an unattributed listener still holds the port, or ownership cannot be verified at all; `verify-website-browser-reports` fails the gate on any failed shard, zero-test shard, skipped/unexpected test, or incomplete union against the discovered inventory. Together with a review from a different model family than the author, a passing run is sufficient to merge. See [AGENTS.md](../../AGENTS.md#local-gate-authority). No owner receipt, frozen bundle or hash manifest is required.

## Workflow coverage

Audited all ten workflows at main `05614249fae91cbb8c4022e91607857e3f942e25`.

| Workflow and jobs | Local coverage | Hosted control retained |
| --- | --- | --- |
| `ci.yml`: lint-and-build, website-build | Root lint, agent index, Postgres migration registry, app build; website build with exact base/head input selection plus supervised Playwright discovery (`website-browser-inventory`), deterministic browser shards (`website-browser-shard-1..N`, up to 8) and full-inventory coverage verification (`verify-website-browser-reports`); docs/catalog plus registry-index checks | Manual dispatch, website always built |
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

Website Docker verification caches a labeled dependency and Chromium base image keyed by the lockfile and Dockerfile, and prunes older labeled tags after seven days. Each run builds from a read-only checkout with writable website files and artifacts under its private run root.

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
docker run --rm --detach --name "$CONTAINER" --platform "$PLATFORM" \
  --publish 127.0.0.1:20128:20128 "$LOCAL_IMAGE"
curl --fail --retry 30 --retry-connrefused --retry-delay 2 \
  --max-time 5 http://127.0.0.1:20128/api/health
```

Keep writable workspace, `node_modules`, HOME, package caches, Playwright output
and test results on bind mounts from a fast local disk, or use `--tmpfs` for
small scratch paths. Always run containers with `--rm` and remove the per-run
directory afterwards.

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
- when the full website job is selected, an executable browser and all website Playwright shards passing with their union equal to the complete configured browser inventory; `required-website-browser-coverage` fails evidence and the summary if coverage is absent, including after a successful build. A single shard (`1/1`) has the same requirement as multiple shards. With `--website auto` and no relevant changed inputs, the website job remains a legitimate conditional skip;
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
grace. A discovery error or a failed batch fails the check. An empty
selection also fails, with one exception: when every changed file is under
`website/tests/` (Playwright specs and browser helpers), Vitest can correctly
select nothing, so the runner logs that and exits 0. The exemption fails
closed. Each entry must be a canonical repo-relative POSIX path that starts
with exactly `website/tests/`, with no backslashes, surrounding whitespace,
control characters, or empty, `.`, or `..` segments. LF and CRLF lists are
both accepted. It must also name an existing regular file whose `realpath`
stays inside the real `website/tests` directory, which must not itself be a
symlink. Absolute paths, case variants, symlink escapes, deleted files, and
resolution errors all lose the exemption. Any other changed file, including
other `website/` paths, keeps the empty-selection failure. Discovery errors,
crashes, signals, and timeouts still fail, as do failing selected tests. Those
browser files are covered by the website browser shards in exact-head local
CI, and the full inventory checkpoint remains required for merges.

### Batched runner cleanup

`tests/__baseline__/run-ci.mjs` reserves up to five seconds (a quarter of the
ceiling when that is shorter) inside each command's five-minute ceiling for
termination and verification. It signals the detached process group with
SIGKILL, then enumerates that group with POSIX `ps` and signals each live member
individually, including when group signaling fails (EPERM or any other error).
It never signals a PID that the inventory has not just reported as a member of
the command group. It repeatedly verifies that no live members remain; ESRCH and
the runner's close event alone are not exit evidence. A failed `ps` listing is
unknown, not empty: transient listing failures are retried, and part of the
cleanup budget is reserved for one final inventory after the last signal.
Zombie entries are already terminated and do not count as live workers.

An unreadable inventory or workers still live at the cleanup deadline produces
an infrastructure error, stops subsequent batches, and fails the gate. It never
extends the command ceiling or reports denied cleanup as success. When the OS
denies both group and individual termination, the runner reports that live
workers may remain; it cannot override OS permissions. No host settings or
services need changing. Deterministic injected-operation tests cover EPERM,
ESRCH, other signal errors, successful cleanup, and failure propagation. Native
process-group integration coverage runs on the host platform; Linux evidence
does not establish macOS permission behavior.

Browser checkpoint follow-ups (#2661): the shared Playwright config rejects focused
cases in discovery and execution. Before executing, local CI asks Playwright to
list each proposed shard, reduces the count if a shard is empty, and verifies the
complete exact-once union. Serial/file/project groups therefore follow Playwright's
own allocation. Execution still rejects empty, skipped, failed and flaky reports.
Owned-process enumeration errors fail cleanup even when the port is free; missing
procfs cannot establish successful cleanup. No unverified process is signalled.
Direct browser runs select and pin a fresh loopback port, while CI supplies each
shard's port. An occupied selected port remains a hard failure. Chromium scratch
uses a private short `/tmp/dd-pw-*` directory, removed on normal runner exit,
independent of long report/output paths. Each planning and execution command
retains the five-minute ceiling and private allowlisted CI environment.

Browser shard cleanup ownership (#2684): every PID in `/proc` is classified
before anything is signalled.

- **Exited**: `ENOENT`/`ESRCH` on its `/proc/<pid>` files, or state `Z`/`X`.
  This includes a PID reaped between two reads. Zombies hold no sockets.
- **Foreign**: every uid in `status` differs from the runner's euid (their
  protected `environ` is never needed), a kernel thread, or a fully readable
  environment without the exact `WEBSITE_TRANSIENT_OWNER=<token>` entry. A
  token in argv (`cmdline`) is never read and never proves ownership.
- **Owned**: all four uids equal the euid, the exact token is in `environ`,
  and `stat`/`status` parse. Only owned processes are signalled, after a
  re-read confirms the same start time.
- **Uncertain**: a same-uid (or unknown-uid) process whose `stat`, `status` or
  `environ` is unreadable (`EACCES`, `EPERM`, `EIO`), malformed or empty, a
  PID that changed hands on three consecutive reads, or the token under
  another or changed uid. Uncertain processes are never signalled. Cleanup
  waits for them like owned ones, so a process that is briefly unreadable while
  it exits does not fail the step; one that stays makes cleanup fail.

Same-uid processes with protected environments are common on developer hosts
(`ssh-agent`, `gpg-agent`, browser sandboxes mark themselves non-dumpable).
Local CI snapshots the uncertain PIDs and their start times just before each
shard starts; a process with the same PID and start time cannot have received
the token and is excluded. A recycled PID, a new unreadable process started
during the shard, or a token seen under another uid is not excluded.

After no owned or uncertain process remains, the port is probed. A listener
that still answers after a two-second grace is unattributed: it may be a
descendant that dropped the token or an unrelated program. It is never
signalled, its PID is never looked up, the state file is kept, and cleanup
fails. A probe that times out or errors other than with `ECONNREFUSED` counts
as a held port. A final scan after the probe fails cleanup if a shard
process appeared in between. Scope: Linux procfs with the default
`hidepid=0` mount; under `hidepid=1` other users' processes are unreadable
and cleanup fails closed. Tests use a synthetic procfs with injected read
errors and mocked `kill` and probe
(`tests/unit/browser-shard-cleanup-procfs.test.js`).

macOS is not a supported host for browser shard cleanup. It has no `/proc`, so
`scripts/lib/website-shard-server.mjs` signals nothing there and every shard
cleanup step fails, even when the port is free. Local CI then stops the
remaining shards. Stock macOS tools cannot supply the proof this guard needs:

- `ps -E` joins the environment to the arguments with plain spaces, and a
  process can rewrite its arguments between reads, so a token in its output is
  not proof of ownership.
- `ps` hides the environment of Apple platform binaries, and can fall back to
  showing only the command name. An absent token is not proof of absence.
- `lstart` has one-second resolution, so it cannot tell a recycled PID apart.
- A process list and a port probe are separate moments, so both can look clear
  while a late child binds the port.

Supporting macOS needs a source that separates the environment and reports
precise start times per PID, such as a native `sysctl(KERN_PROCARGS2)` or
`proc_pidinfo` reader. Until one exists, cleanup stays fail-closed. Run the
browser checkpoint on Linux.
