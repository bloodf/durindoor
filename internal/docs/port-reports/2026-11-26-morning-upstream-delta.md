# Morning upstream delta, 2026-11-26

GitHub REST snapshot completion: 2026-11-26T05:46:44Z. Sources: [9router comparison](https://api.github.com/repos/decolua/9router/compare/5ae63d22847e07042e235b40e1d926b65e509013...master?per_page=100), [OmniRoute comparison](https://api.github.com/repos/cheaper-inference/OmniRoute/compare/176919ddb80754ad24922790dde53a85f21249d5...release%2Fv3.8.55?per_page=100), [9router open PRs](https://api.github.com/repos/decolua/9router/pulls?state=open&per_page=100), [OmniRoute open PRs](https://api.github.com/repos/cheaper-inference/OmniRoute/pulls?state=open&per_page=100). All four inventories used `gh api --paginate` with `per_page=100`. Pagination errors: none. Snapshots were sequential, not atomic.

Compared exact repository, PR number and full head SHA with tracked dispositions and inventories, including the [night delta](2026-11-26-night-upstream-delta.md), [pending list](2026-11-25-pending-open-prs.md), November 25 triage and port reports, and [night dispositions](1073-nov26-night.md). Exact heads already recorded are excluded from the PR tables. Changed heads are pending. Titles identify rows and do not determine applicability. [#1072](https://github.com/bloodf/durindoor/issues/1072) and [#1073](https://github.com/bloodf/durindoor/issues/1073) are source indexes.

## decolua/9router default-branch commits

Baseline `5ae63d22847e07042e235b40e1d926b65e509013`; branch `master`; comparison head `5ae63d22847e07042e235b40e1d926b65e509013`; status `identical`; 0 commits.

| # | Exact SHA | Subject | Disposition |
|---:|---|---|---|

## cheaper-inference/OmniRoute default-branch commits

Baseline `176919ddb80754ad24922790dde53a85f21249d5`; branch `release/v3.8.55`; comparison head `8b19a44c124b5814f6313306152ffddbac44dbe7`; status `ahead`; 45 commits.

| # | Exact SHA | Subject | Disposition |
|---:|---|---|---|
| 1 | [90a8b436afc58ad0ca3dabe6db16ac2740b21143](https://github.com/cheaper-inference/OmniRoute/commit/90a8b436afc58ad0ca3dabe6db16ac2740b21143) | docs(readme): rebuild README from the approved round-2 section designs | pending |
| 2 | [3a33ed27b01299a65fdb608c59d58736b21a7ec3](https://github.com/cheaper-inference/OmniRoute/commit/3a33ed27b01299a65fdb608c59d58736b21a7ec3) | docs(readme): mark v3.8.54 as the latest release | pending |
| 3 | [2fc96ca107e403d6282516008b2078a0d1a3fcf0](https://github.com/cheaper-inference/OmniRoute/commit/2fc96ca107e403d6282516008b2078a0d1a3fcf0) | fix(readme): keep the i18n language marker and give text tiles their own names | pending |
| 4 | [d8ea7072cf6adec332b79ae0887e2d901bddbee6](https://github.com/cheaper-inference/OmniRoute/commit/d8ea7072cf6adec332b79ae0887e2d901bddbee6) | Merge remote-tracking branch 'origin/release/v3.8.55' into chore/derived-readme-round2-20261117 | pending |
| 5 | [ed1ed3e7877e9aa008703b41fe60c444a7f83671](https://github.com/cheaper-inference/OmniRoute/commit/ed1ed3e7877e9aa008703b41fe60c444a7f83671) | Merge remote-tracking branch 'origin/release/v3.8.55' into chore/derived-readme-round2-20261117 | pending |
| 6 | [9c4dfe2f2797e43183fae78e58d35524b4170fb9](https://github.com/cheaper-inference/OmniRoute/commit/9c4dfe2f2797e43183fae78e58d35524b4170fb9) | docs(readme): drop links to removed docs and point guides at cheaper-inference | pending |
| 7 | [510a4c67a27f7376a049f30fa0ef61a1d3935a5a](https://github.com/cheaper-inference/OmniRoute/commit/510a4c67a27f7376a049f30fa0ef61a1d3935a5a) | Merge remote-tracking branch 'origin/release/v3.8.55' into chore/derived-readme-round2-20261117 | pending |
| 8 | [907ff26e7186918c616e48824b45039dda179c45](https://github.com/cheaper-inference/OmniRoute/commit/907ff26e7186918c616e48824b45039dda179c45) | test(ci): pin free-token figures by kind, precision and placement | pending |
| 9 | [b4cb80d5bbe1396eb14292986ee3b2f2d104fb9d](https://github.com/cheaper-inference/OmniRoute/commit/b4cb80d5bbe1396eb14292986ee3b2f2d104fb9d) | fix(ci): read free-token figures in M and B with typed anchors | pending |
| 10 | [f66408ac8d57f4fe7a5b5d9687df045371b36c93](https://github.com/cheaper-inference/OmniRoute/commit/f66408ac8d57f4fe7a5b5d9687df045371b36c93) | fix(ci): judge free-token claims by kind and printed precision | pending |
| 11 | [b64227f1183d4145992d1dc6cd04ab5f0eb98984](https://github.com/cheaper-inference/OmniRoute/commit/b64227f1183d4145992d1dc6cd04ab5f0eb98984) | fix(ci): keep the row-sum figure paired with its label and the real one | pending |
| 12 | [5e924685046bbdca942e9c67128ee7b6be6a6123](https://github.com/cheaper-inference/OmniRoute/commit/5e924685046bbdca942e9c67128ee7b6be6a6123) | docs(changelog): add the fragment for #21095 | pending |
| 13 | [d37e2d2dc7b40753bb8c22c1e298c1309a4bfd0a](https://github.com/cheaper-inference/OmniRoute/commit/d37e2d2dc7b40753bb8c22c1e298c1309a4bfd0a) | Merge remote-tracking branch 'origin/release/v3.8.55' into chore/derived-readme-round2-20261117 | pending |
| 14 | [e2f1ced5957c8f550abbeea740b039eaea89c64d](https://github.com/cheaper-inference/OmniRoute/commit/e2f1ced5957c8f550abbeea740b039eaea89c64d) | Merge remote-tracking branch 'origin/release/v3.8.55' into chore/derived-readme-round2-20261117 | pending |
| 15 | [ed0b535299f0e4ae3d5198d9685f2726d9900480](https://github.com/cheaper-inference/OmniRoute/commit/ed0b535299f0e4ae3d5198d9685f2726d9900480) | docs(readme): stop hard-coding the number of linked docs | pending |
| 16 | [a52a6f501e6694a7fa33966374c9ad455fc07cb3](https://github.com/cheaper-inference/OmniRoute/commit/a52a6f501e6694a7fa33966374c9ad455fc07cb3) | Merge remote-tracking branch 'origin/release/v3.8.55' into chore/derived-readme-round2-20261117 | pending |
| 17 | [e8ddc6dd9286d4522de2c1b60a4398d8530028ae](https://github.com/cheaper-inference/OmniRoute/commit/e8ddc6dd9286d4522de2c1b60a4398d8530028ae) | Merge remote-tracking branch 'origin/release/v3.8.55' into fix/docs-counts-token-headline-gate | pending |
| 18 | [c96659904e42f158e2bd1940b3fa01f1ef0cdf20](https://github.com/cheaper-inference/OmniRoute/commit/c96659904e42f158e2bd1940b3fa01f1ef0cdf20) | fix(ci): isolate DATA_DIR before the docs-counts gate loads the catalog module | pending |
| 19 | [45e74522547f1328abe0685c885e3d34eb6acbc4](https://github.com/cheaper-inference/OmniRoute/commit/45e74522547f1328abe0685c885e3d34eb6acbc4) | Merge remote-tracking branch 'origin/release/v3.8.55' into chore/derived-readme-round2-20261117 | pending |
| 20 | [b1c914c467debeeaadf1e7433dccad69d8e1e453](https://github.com/cheaper-inference/OmniRoute/commit/b1c914c467debeeaadf1e7433dccad69d8e1e453) | fix(ci): keep the docs-counts gate off application modules | not applicable for this exact PR head ([prior disposition](1073-nov25-open-prs-and-tail.md)) |
| 21 | [ee35f49fb1529b2ddd887c461bdb14dc444a437d](https://github.com/cheaper-inference/OmniRoute/commit/ee35f49fb1529b2ddd887c461bdb14dc444a437d) | docs(readme): owner's round-3 edits and three regenerated diagrams | pending |
| 22 | [7ffde38579e36ac460c69a47c0f06f8bbcd1039b](https://github.com/cheaper-inference/OmniRoute/commit/7ffde38579e36ac460c69a47c0f06f8bbcd1039b) | docs(readme): provider and Quick Start cards as SVG, shorter What's New, left-aligned headings | pending |
| 23 | [1b7aac58720e39f7915eaf09a0f3ffc1a5a33b95](https://github.com/cheaper-inference/OmniRoute/commit/1b7aac58720e39f7915eaf09a0f3ffc1a5a33b95) | Merge remote-tracking branch 'origin/release/v3.8.55' into fix/docs-counts-token-headline-gate | not applicable for this exact PR head ([prior disposition](1073-nov25-am-prs.md)) |
| 24 | [6fd8d805df2b5dde15998055b379a0f6e1351a75](https://github.com/cheaper-inference/OmniRoute/commit/6fd8d805df2b5dde15998055b379a0f6e1351a75) | docs(readme): combos section as quick start plus reference by name (option C) | pending |
| 25 | [bcdc345477e6cf9464bb332c2a82ec4114c8d04c](https://github.com/cheaper-inference/OmniRoute/commit/bcdc345477e6cf9464bb332c2a82ec4114c8d04c) | Merge remote-tracking branch 'origin/release/v3.8.55' into chore/derived-readme-round2-20261117 | pending |
| 26 | [fa4903ab7f031b71fb4647da1786e0026373a4e0](https://github.com/cheaper-inference/OmniRoute/commit/fa4903ab7f031b71fb4647da1786e0026373a4e0) | docs(vscode-copilot): OmniCopilot 1.5.1, current store figures, blocked-key troubleshooting row | pending |
| 27 | [a593c73947a9917fbdc4c8adb13817f5985645c6](https://github.com/cheaper-inference/OmniRoute/commit/a593c73947a9917fbdc4c8adb13817f5985645c6) | Merge remote-tracking branch 'origin/release/v3.8.55' into chore/derived-readme-round2-20261117 | pending |
| 28 | [e883735f27b710890b8f125405379e806496a397](https://github.com/cheaper-inference/OmniRoute/commit/e883735f27b710890b8f125405379e806496a397) | fix(docs): wrap the README diagram builders passed to map (Sonar S7727) | not applicable for this exact PR head ([prior disposition](1073-nov25-am-prs.md)) |
| 29 | [d357a46f8de9cc7dd787ad2072e68bace3291d40](https://github.com/cheaper-inference/OmniRoute/commit/d357a46f8de9cc7dd787ad2072e68bace3291d40) | feat(api): bind a server-resolved API key to a request context (KEA-9523) | not applicable for this exact PR head ([prior disposition](1073-nov25-port-amprs-b.md)) |
| 30 | [951f4799fe238feca9eb460ae8bfd1d8a68e42ed](https://github.com/cheaper-inference/OmniRoute/commit/951f4799fe238feca9eb460ae8bfd1d8a68e42ed) | chore(quality): sync the skill templates with the installed maintainer skills | not applicable for this exact PR head ([prior disposition](1073-nov25-am-prs.md)) |
| 31 | [0c9f3866cbdf3b0636f158bec1f558b64ce98590](https://github.com/cheaper-inference/OmniRoute/commit/0c9f3866cbdf3b0636f158bec1f558b64ce98590) | docs(readme): point StarMapper back at the scanned diegosouzapw/omniroute map | pending |
| 32 | [2f3fa84a367d73ff45dd37f5a085f34fde56639a](https://github.com/cheaper-inference/OmniRoute/commit/2f3fa84a367d73ff45dd37f5a085f34fde56639a) | Merge remote-tracking branch 'origin/release/v3.8.55' into chore/derived-readme-round2-20261117 | pending |
| 33 | [6a320f0720394ead2ba1562efa7bb6444ae25a92](https://github.com/cheaper-inference/OmniRoute/commit/6a320f0720394ead2ba1562efa7bb6444ae25a92) | Merge release/v3.8.55 into chore/skill-templates-sync-20261125 | not applicable for this exact PR head ([prior disposition](1073-nov25-pm.md)) |
| 34 | [26d576676d1f343cd6817785268ca2aac07524f6](https://github.com/cheaper-inference/OmniRoute/commit/26d576676d1f343cd6817785268ca2aac07524f6) | Merge remote-tracking branch 'origin/release/v3.8.55' into fix/docs-counts-token-headline-gate | not applicable for this exact PR head ([prior disposition](1073-nov25-pm.md)) |
| 35 | [f37ddf5691d194aa077ad9d46bbf611ccefa5600](https://github.com/cheaper-inference/OmniRoute/commit/f37ddf5691d194aa077ad9d46bbf611ccefa5600) | Merge remote-tracking branch 'origin/release/v3.8.55' into chore/derived-readme-round2-20261117 | not applicable for this exact PR head ([prior disposition](1073-nov25-pm.md)) |
| 36 | [d74db9ceb7875e3fb583c4cc8e397d73e7a91f0b](https://github.com/cheaper-inference/OmniRoute/commit/d74db9ceb7875e3fb583c4cc8e397d73e7a91f0b) | Merge remote-tracking branch 'origin/release/v3.8.55' into fix/docs-counts-token-headline-gate | pending |
| 37 | [b9a106948defc7a2d2455a2d6b097fbf7a92bf6e](https://github.com/cheaper-inference/OmniRoute/commit/b9a106948defc7a2d2455a2d6b097fbf7a92bf6e) | Merge remote-tracking branch 'origin/release/v3.8.55' into chore/derived-readme-round2-20261117 | not applicable for this exact PR head ([prior disposition](1073-nov26-night.md)) |
| 38 | [ea8a8f7f50ead0b123e21a1f787fd58b4c396a37](https://github.com/cheaper-inference/OmniRoute/commit/ea8a8f7f50ead0b123e21a1f787fd58b4c396a37) | fix(ci): sort the row-sum forbidden sources with an explicit comparator | pending |
| 39 | [a90561b6274494ddff88c622b46cd71f437e97c0](https://github.com/cheaper-inference/OmniRoute/commit/a90561b6274494ddff88c622b46cd71f437e97c0) | Merge remote-tracking branch 'origin/release/v3.8.55' into fix/docs-counts-token-headline-gate | not applicable for this exact PR head ([prior disposition](1073-nov26-night.md)) |
| 40 | [41e28d8fd428217ee530f36bf4cb6f41c893febc](https://github.com/cheaper-inference/OmniRoute/commit/41e28d8fd428217ee530f36bf4cb6f41c893febc) | Merge remote-tracking branch 'origin/release/v3.8.55' into feat/kea-9523-required-api-key-context | pending |
| 41 | [6cd7c23e0049742da3cd5402573b259577559657](https://github.com/cheaper-inference/OmniRoute/commit/6cd7c23e0049742da3cd5402573b259577559657) | refactor(api): run the limit validators of the key policy in one helper | not applicable for this exact PR head ([prior disposition](1073-nov26-night.md)) |
| 42 | [bc0183bed45fda2ec6121669e374bce0f3f49102](https://github.com/cheaper-inference/OmniRoute/commit/bc0183bed45fda2ec6121669e374bce0f3f49102) | Merge PR #20421: docs(readme): rebuild README from the approved round-2 section designs (@diegosouzapw) | pending |
| 43 | [712f5e67bdd75d32a22717cfd32840408fbfe50a](https://github.com/cheaper-inference/OmniRoute/commit/712f5e67bdd75d32a22717cfd32840408fbfe50a) | Merge PR #21198: feat(api): bind a server-resolved API key to a request context (KEA-9523) (@diegosouzapw) | pending |
| 44 | [a3431d12716ea72a54ec34a22512377f67ea6786](https://github.com/cheaper-inference/OmniRoute/commit/a3431d12716ea72a54ec34a22512377f67ea6786) | Merge PR #21095: fix(ci): read free-token figures by kind and keep the row-sum figure paired with the real one (@diegosouzapw) | pending |
| 45 | [8b19a44c124b5814f6313306152ffddbac44dbe7](https://github.com/cheaper-inference/OmniRoute/commit/8b19a44c124b5814f6313306152ffddbac44dbe7) | Merge PR #21194: chore(quality): sync the skill templates with the installed maintainer skills (@diegosouzapw) | pending |

## decolua/9router open PRs with new or changed heads

1348 open PRs retrieved; 1348 exact heads already recorded; 0 rows below.

| # | PR | Exact head SHA | Title | Disposition |
|---:|---|---|---|---|

## cheaper-inference/OmniRoute open PRs with new or changed heads

571 open PRs retrieved; 556 exact heads already recorded; 15 rows below.

| # | PR | Exact head SHA | Title | Disposition |
|---:|---|---|---|---|
| 1 | [#21268](https://github.com/cheaper-inference/OmniRoute/pull/21268) | [a5a6b3f9ff9bdd4cce4f8f3238950a33e9fe9f8f](https://github.com/cheaper-inference/OmniRoute/commit/a5a6b3f9ff9bdd4cce4f8f3238950a33e9fe9f8f) | fix(usage): account refused and failed non-streaming replies correctly (salvaged from #20233/#20232) | pending |
| 2 | [#21267](https://github.com/cheaper-inference/OmniRoute/pull/21267) | [55c7fc289f1aa598efb57030d3e8cac7e385ef67](https://github.com/cheaper-inference/OmniRoute/commit/55c7fc289f1aa598efb57030d3e8cac7e385ef67) | fix(agentbridge): route Codex Responses and support explicit ports | pending |
| 3 | [#21266](https://github.com/cheaper-inference/OmniRoute/pull/21266) | [ebda03320ae9511803e2bd752b02bd2425a171db](https://github.com/cheaper-inference/OmniRoute/commit/ebda03320ae9511803e2bd752b02bd2425a171db) | fix: translate PT/DE text in run-next.mjs and chatgpt-web-codex-mcp.mjs to English | pending |
| 4 | [#21265](https://github.com/cheaper-inference/OmniRoute/pull/21265) | [5bf5b154fde5a57868a4d1e690b4a2dde26af323](https://github.com/cheaper-inference/OmniRoute/commit/5bf5b154fde5a57868a4d1e690b4a2dde26af323) | feat(cli): manage local resources across coding clients | pending |
| 5 | [#21264](https://github.com/cheaper-inference/OmniRoute/pull/21264) | [9ccd6bce91b3f35b556d4f6a1c818f10d59b7442](https://github.com/cheaper-inference/OmniRoute/commit/9ccd6bce91b3f35b556d4f6a1c818f10d59b7442) | docs(readme): dark-theme polish to match the site's use of the kit palette | pending |
| 6 | [#21263](https://github.com/cheaper-inference/OmniRoute/pull/21263) | [cd242af5227bccc5611eb911a37a40d6857f5b5e](https://github.com/cheaper-inference/OmniRoute/commit/cd242af5227bccc5611eb911a37a40d6857f5b5e) | fix(cli): preserve Codex picker and environment settings | pending |
| 7 | [#21262](https://github.com/cheaper-inference/OmniRoute/pull/21262) | [0b39f717b1c99d3c5b3fa463b00fa7641ba319af](https://github.com/cheaper-inference/OmniRoute/commit/0b39f717b1c99d3c5b3fa463b00fa7641ba319af) | fix(providers): route Cheaper Inference Claude models to native /v1/messages so prompt caching works (KEA-9430) | pending |
| 8 | [#21261](https://github.com/cheaper-inference/OmniRoute/pull/21261) | [01b963e635f120470941c0b44b5536dfd2aa9fe7](https://github.com/cheaper-inference/OmniRoute/commit/01b963e635f120470941c0b44b5536dfd2aa9fe7) | docs: point repository links at cheaper-inference/OmniRoute | pending |
| 9 | [#21247](https://github.com/cheaper-inference/OmniRoute/pull/21247) | [fe05f1ee5f636f15d04770e8043674ef3711d10a](https://github.com/cheaper-inference/OmniRoute/commit/fe05f1ee5f636f15d04770e8043674ef3711d10a) | fix(sse): require readiness for keyless auto routing (#19385) | pending |
| 10 | [#21246](https://github.com/cheaper-inference/OmniRoute/pull/21246) | [2b20b3a8dc0b17753439d7934c98cace11ed3a8b](https://github.com/cheaper-inference/OmniRoute/commit/2b20b3a8dc0b17753439d7934c98cace11ed3a8b) | fix(translator): end mixed Gemini tool-result turns on a functionResponse | pending |
| 11 | [#21221](https://github.com/cheaper-inference/OmniRoute/pull/21221) | [547e684a20fff6d6e60256450124becc4e09c43a](https://github.com/cheaper-inference/OmniRoute/commit/547e684a20fff6d6e60256450124becc4e09c43a) | fix(providers): enable live model discovery for zai | pending |
| 12 | [#21187](https://github.com/cheaper-inference/OmniRoute/pull/21187) | [75af38a1f0459b25ede2cdec386a94e5fe505df5](https://github.com/cheaper-inference/OmniRoute/commit/75af38a1f0459b25ede2cdec386a94e5fe505df5) | fix(guardrails): load sharp on use so boot survives without it | pending |
| 13 | [#21161](https://github.com/cheaper-inference/OmniRoute/pull/21161) | [e840face1b3fadfcfff0a175e291d43c4a9ec3a4](https://github.com/cheaper-inference/OmniRoute/commit/e840face1b3fadfcfff0a175e291d43c4a9ec3a4) | docs(readme): print the free-token figures in pairs, from the facts | pending |
| 14 | [#21096](https://github.com/cheaper-inference/OmniRoute/pull/21096) | [6a747cf8fc994217614d6a07674d21db90ed6cb4](https://github.com/cheaper-inference/OmniRoute/commit/6a747cf8fc994217614d6a07674d21db90ed6cb4) | fix(sse): re-audit the free catalog against the providers' pages and keep ended offers in a ledger | pending |
| 15 | [#20391](https://github.com/cheaper-inference/OmniRoute/pull/20391) | [8b19a44c124b5814f6313306152ffddbac44dbe7](https://github.com/cheaper-inference/OmniRoute/commit/8b19a44c124b5814f6313306152ffddbac44dbe7) | Release v3.8.55 | pending |
