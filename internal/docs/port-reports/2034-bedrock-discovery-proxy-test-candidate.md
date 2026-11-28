# #2034 Bedrock discovery proxy test candidate update

Status: local candidate update and scoped checks only. This report does not qualify the candidate, authorize merge, claim live AWS acceptance, or mark the candidate ready. The parent owns qualification and promotion.

## Candidate identity

| Field | Value |
| --- | --- |
| Branch | `auth/2034-bedrock-discovery-candidate` (local only) |
| Base | `dc624113dc5728c04a01c1dd49e37f9a1dd80c4b` |
| Published draft checkpoint retained as ancestor | `db7457b262acda451b6ce4887bf1058474079b24` |
| Previous candidate head | `94a1135a8358303ed835a50b43db1c5287e6eff2` |
| Updated head | `bf9b826e3ec31f301c582b39ef83b8ae47eedbd3` |
| Updated tree | `a874a5fc6565edfe52310c5c686eaea420e2194c` |
| Worktree | `/var/tmp/durindoor-bedrock-proxy-candidate-20261128-r2/repo` (removed after evidence archive verification) |
| New source commit | `b6fca4b075c6dcfe1f0d410aa00b7fca7959f54b` |
| Candidate diff SHA-256 (`git diff base..head`) | `589ccdb4e6cd97e6606323caa4bf1a52e8b6402c41f56a9f7041458c5285828c` |
| Added patch SHA-256 (`git diff 94a1135..head`) | `4afc6cbbac671cc287c541bfe632e84576b2508262868191ff6341438826dbe0` |

The published checkpoint `db7457b` and prior correction head `94a1135` remain unchanged ancestors. The update was a clean, plain cherry-pick of the one authored feature commit `b6fca4b` from `fix-bedrock-discovery-test-proxy-env`; no merge ancestry or integration commits were selected. There were no conflicts, empty commits, skips, manual resolutions, or unrelated edits.

## Source patch mapping

Stable patch IDs were recomputed for every original feature patch, the profile-boundary correction, and this update. All source and candidate patch IDs match.

| Source commit | Candidate commit | Stable patch-id |
| --- | --- | --- |
| `f88ec3b8549dda6a946ffbd71f73a5d63386eff6` | `43981b30d01f1ca937ef991e19cedb2ca126aa11` | `77451c27ac17f3c91f17d55ab78ca86ab20b4ca2` |
| `dbd045a1a1918a1405761c2cb0110762e5139bcf` | `7365dd71314c1c110ea3e138468d93c4e6e765d8` | `3330e443951f59bb81df59ef3b9f4c040850af4d` |
| `551f8586c8b6e8788d0daafd71e3f95d0791c138` | `db7457b262acda451b6ce4887bf1058474079b24` | `662e86b2ffb9203207dce7af53f69f0778c84b73` |
| `bb515eb630f24731b1a0893781372dbebdb18e64` | `94a1135a8358303ed835a50b43db1c5287e6eff2` | `8fe4515a7cd9b3586b165d108977f300ea4927e3` |
| `b6fca4b075c6dcfe1f0d410aa00b7fca7959f54b` | `bf9b826e3ec31f301c582b39ef83b8ae47eedbd3` | `111810ebfadd2ef59a2a72301e80089b17281ad0` |

The new patch changes exactly these files:

```
internal/docs/port-reports/2034-bedrock-review-proxy-env-followup.md
internal/docs/port-reports/2034-bedrock-sigv4-discovery.md
open-sse/services/providerParity/native-bedrock-discovery/manifest.json
tests/unit/bedrock-sigv4-discovery-2034.test.js
```

The four-file candidate diff is byte-for-byte equivalent to the source commit diff (same SHA-256). The original three candidate patches and the added profile-boundary patch remain in history unchanged, as confirmed by the matching patch IDs. `git diff --check base..head` is clean.

The source commit preserves its recorded Git author metadata. Repository metadata cannot independently establish the actual actor, so no stronger human attribution is claimed. Private provenance and run evidence are archived at `/home/stormtrooper/checkpoint-evidence/bedrock-proxy-candidate-20261128-r2/`. No model or model-family names are recorded here.

## Scoped checks

Dependencies were installed only in the private worktree using frozen lockfiles with install scripts disabled. Each command ran under `env -i`, with explicit `PATH`, `LANG`, and `CI`, and run-local `HOME`, `DATA_DIR`, `TMPDIR`, cache, and pnpm store. Every command had a 300-second timeout. No shared or borrowed dependencies were used.

| Check | Result |
| --- | --- |
| Root direct ESLint: `node node_modules/eslint/bin/eslint.js src` | exit 0; 0 errors, 349 warnings in `src/` |
| Direct anti-slop bundle build | exit 0; generated bundle restored |
| Direct anti-slop check | exit 0; 0 diagnostics across 3407 files |
| Four requested Bedrock Vitest files, `--maxWorkers=2` | exit 0; 4 files, 100 tests passed |
| Same four tests with synthetic upper- and lowercase HTTP, HTTPS, ALL, and NO proxy variables | exit 0; 4 files, 100 tests passed |

The discovery suite retains all 35 cases, the profile-boundary suite all 19, AWS credentials all 26, and credential boundaries all 20. No protected case was removed or weakened; no baseline changes or skips were introduced. Transport and profile resolution remain mocked. These checks do not establish live AWS permissions or acceptance.

No full inventory, `test:ci`, `local-ci`, build, browser, e2e, Docker, real-provider, or live AWS checks were run. The exact-head clean-main qualification and independent review remain with the parent.
