# #2034 Bedrock discovery standalone candidate assembly

Status: local, unpublished candidate. This is preparation only. It does not grant permission to merge. The orchestrator or review lane still has to run full exact-head clean-main CI.

## Candidate identity

| Field | Value |
| --- | --- |
| Branch | `auth/2034-bedrock-discovery-candidate` (new, local only) |
| Base (`origin/main`, fetched 2026-11-28T01:21Z) | `dc624113dc5728c04a01c1dd49e37f9a1dd80c4b` |
| Head | `db7457b262acda451b6ce4887bf1058474079b24` |
| Head tree | `64d0c0e151c76419f4de9a9c511f6ff67a5ebf56` |
| Worktree used | `/var/tmp/durindoor-auth-bedrock-prep.DIP90e/repo` (removed after evidence copy; branch and objects kept) |
| Source unit | `stage-bedrock-sigv4-discovery` |
| `git diff base..head \| sha256sum` | `7152ddf70343540bd3df3143e0ad294ee02d7907c3a7e4b2e2050e5e7c62f6c4` |

The candidate is exactly three commits on top of the base. No integration-branch ancestry is included: the source parent `d742d28270c8` is not an ancestor of the candidate.

| Source commit | Candidate commit | Stable patch-id |
| --- | --- | --- |
| `f88ec3b8549dda6a946ffbd71f73a5d63386eff6` | `43981b30d01f1ca937ef991e19cedb2ca126aa11` | `662e86b2ffb9203207dce7af53f69f0778c84b73` |
| `dbd045a1a1918a1405761c2cb0110762e5139bcf` | `7365dd71314c1c110ea3e138468d93c4e6e765d8` | `77451c27ac17f3c91f17d55ab78ca86ab20b4ca2` |
| `551f8586c8b6e8788d0daafd71e3f95d0791c138` | `db7457b262acda451b6ce4887bf1058474079b24` | `3330e443951f59bb81df59ef3b9f4c040850af4d` |

## How the candidate was built

Each commit was applied with a plain `git cherry-pick` (no `-x`), in order. There were no conflicts and no manual resolutions. No commit was empty or skipped. For each pair, the patch-id, the full message (including `Refs #2034`) and the author name, email and date are the same. Only the committer timestamp changed. Every one of the eight changed files has the same blob in the candidate head as in source `551f8586`.

Nothing in the candidate was newly written during assembly. This report is the only new content, and it lives on the native worktree branch, not on the candidate.

## Diff stat (base..head)

```
internal/docs/port-reports/2034-bedrock-discovery-handoff.json       |  87 +++
internal/docs/port-reports/2034-bedrock-sigv4-discovery.md           | 151 +++++
open-sse/services/providerParity/native-bedrock-discovery/index.js   | 374 ++++++++
open-sse/services/providerParity/native-bedrock-discovery/manifest.json |  32 +
open-sse/services/providerParity/native-bedrock-discovery/normalize.js  | 140 ++++
package.json                                                         |   1 +
pnpm-lock.yaml                                                       |  19 +
tests/unit/bedrock-sigv4-discovery-2034.test.js                      | 540 +++++++++++
8 files changed, 1344 insertions(+)
```

`git diff --check base..head` is clean. There are only additions, and no file outside the feature and its dependency closure is touched.

## Dependencies and lockfile

- The `package.json` and `pnpm-lock.yaml` in the source parent `d742d28270c8` are identical to the ones on `origin/main` `dc624113`. The dependency hunks therefore applied unchanged, so there was nothing to resolve and no reason to regenerate the lockfile.
- The candidate adds only `@aws-sdk/client-bedrock` `3.1132.0` (pinned): one importer entry, one package entry and one snapshot entry. Every transitive dependency (`@aws-sdk/core`, `credential-provider-node`, `token-providers`, `types`, `@smithy/*`, `tslib`) was already locked on main at the versions referenced. Every other main version stays the same.
- `pnpm install --frozen-lockfile --ignore-scripts` succeeds against the candidate lock, both at the root and in `tests/`.

## Prerequisite helpers on main

Every import resolves on `origin/main` with the expected export:

- `open-sse/config/bedrock.js`: `BEDROCK_CREDENTIAL_MODE`, `resolveBedrockRegion` (re-exported from `providers/registry/bedrock.js`)
- `open-sse/shared/awsCredentials.js`: `buildBedrockClientAuth`, `detectBedrockCredentialMode`
- `open-sse/utils/error.js`: `readBoundedResponseText`
- `open-sse/utils/proxyFetch.js`: `proxyAwareFetch`
- `open-sse/services/oauthCredentialManager.js`: `resolveCredentialProxyOptions`
- `src/shared/utils/typeChecks.js`: `isString`, `isBoolean`, `isObject`

I compared these helper files, the manifests and the AWS credential tests between the source parent and main. The only difference is in `open-sse/utils/error.js`: the integration branch has a codex billing-envelope change (`287f64e2629`) that main lacks. That change does not touch `readBoundedResponseText`, and the discovery tests pass without it. No real prerequisite is missing.

## Wiring

No public wiring was added. Nothing outside the feature directory, its test and its reports refers to `native-bedrock-discovery` or `discoverBedrockModels`. The manifest stays `staged-unregistered`, with empty `publicImports` and `registryEntries`.

## Scoped checks on the candidate head (manual, private env)

The native report-unit gate does **not** validate the candidate head. These manual results are separate from it.

Environment: `env -i` with HOME, DATA_DIR, TMPDIR, XDG cache and the pnpm store all under `/var/tmp/durindoor-auth-bedrock-prep.DIP90e/env`, `timeout 300` per command, Node 24.22.3, pnpm 12.18.0.

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` (root) | exit 0 |
| `pnpm install --frozen-lockfile --ignore-scripts` (`tests/`) | exit 0 |
| `pnpm run lint` (root: eslint src + anti-slop) | exit 0, anti-slop 0 diagnostics across 3407 files |
| `pnpm exec vitest run --maxWorkers=2 unit/bedrock-sigv4-discovery-2034.test.js unit/bedrock-aws-credentials.test.js unit/bedrock-credential-boundaries.test.js` (`tests/`) | exit 0, 3 files, 81 passed |

Per-file results: discovery 35/35 (all original cases kept), AWS credentials 26/26, credential boundaries 20/20. The two credential test files and `awsCredentials.js` are byte-identical to main.

The lint step rewrote one line of the tracked `tools/oxlint/anti-slop/index.bundle.js`. That is the existing behaviour of the bundle build step, not part of the candidate. I restored the file, and the worktree was clean before removal.

Not run: `test:ci`, `run-ci.mjs`, the full inventory, build, browser and Docker.

## Remaining risks

- The candidate has not been through full CI. The scoped checks above are not a qualification.
- The tests mock `proxyAwareFetch` and `fromIni`. They do not prove that a live AWS account has IAM list permissions or that the endpoint accepts these requests. The AWS API-key reference documents keys for both Bedrock and Bedrock Runtime actions, so the candidate keeps that position and adds no runtime-only restriction.
- The included handoff and port reports describe follow-up public registration ("auth native14") that this candidate does not contain.
- The unrelated `error.js` codex difference between integration and main is out of scope and left as is.

Provenance details are recorded outside the repository for the parent orchestrator.
