# Upstream port campaign closeout — 2026-08-21

This records the 33 DurinDoor PRs opened from
[`upstream-9router-2026-08-21-reverification.md`](upstream-9router-2026-08-21-reverification.md)
(docs PR #508). That ledger was a verified shortlist, not a port queue; the
maintainer asked to port the remaining GAP/PARTIAL rows anyway.

## Result

33 isolated `port(upstream)` PRs against `bloodf/durindoor` are now squash-merged into `main`.
Local Node-20 SHA-pinned gates were green before merge. GitHub required checks were SUCCESS at merge time.

Upstream rows classified DUPLICATE or N-A in #508 were not ported.

## Stacked bases

- #2688 stacked on `port/upstream-2681-kiro-toolcall-validate` → https://github.com/bloodf/durindoor/pull/511
- #2699 stacked on `port/upstream-3368-cli-heap-flags` → https://github.com/bloodf/durindoor/pull/512
- #2895 stacked on `port/upstream-3352-backoff-config` → https://github.com/bloodf/durindoor/pull/513
- #3203 stacked on `port/upstream-2895-provider-retry-delay` → https://github.com/bloodf/durindoor/pull/519
- #3310 stacked on `port/upstream-3055-gemini-turn-normalization` → https://github.com/bloodf/durindoor/pull/522
- #3369 stacked on `port/upstream-3310-tool-arguments-normalize` → https://github.com/bloodf/durindoor/pull/532
- #3421 stacked on `port/upstream-3420-stream-body-sync` → https://github.com/bloodf/durindoor/pull/541
- #3426 stacked on `port/upstream-3388-usage-sse-period` → https://github.com/bloodf/durindoor/pull/542

## PR map

| Upstream | DurinDoor PR | Merge SHA | Status |
| --- | --- | --- | --- |
| 2681 | [port(upstream): #2681 - validate completed nested tool_call payloads](https://github.com/bloodf/durindoor/pull/510) | `e8fa0c86e6c24b0247f594f6e34a9e2b02775190` | MERGED |
| 2688 | [port(upstream): #2688 - retry malformed tool_call wrappers once](https://github.com/bloodf/durindoor/pull/511) | `e5a5cb7b92f91d860113f927d774087874c1ee6d` | MERGED |
| 2699 | [port(upstream): #2699 - default to IPv4-first DNS resolution to avoid undici IPv6 connect timeouts](https://github.com/bloodf/durindoor/pull/512) | `8ac6283c16ad154178e16827765a36c75cb0a293` | MERGED |
| 2895 | [port(upstream): #2895 - per-provider retry-delay control](https://github.com/bloodf/durindoor/pull/513) | `a97fcd2ae77dcae442ef8d64ba52dbeae09c210d` | MERGED |
| 2959 | [port(upstream): #2959 - test count_tokens route edge cases](https://github.com/bloodf/durindoor/pull/514) | `716550975de0e69a62fde90ea02a7ac353a3298d` | MERGED |
| 3055 | [port(upstream): #3055 - normalize Gemini tool-result turns](https://github.com/bloodf/durindoor/pull/515) | `6ef896d48e168f3619e41f62f430db6a56395a3a` | MERGED |
| 3058 | [port(upstream): #3058 - correct AssemblyAI STT auth header](https://github.com/bloodf/durindoor/pull/516) | `07c58e0940f1ea6f73854aade945a6493d2c4eda` | MERGED |
| 3111 | [port(upstream): #3111 - add model, kiro credits, and session id to the done line](https://github.com/bloodf/durindoor/pull/517) | `2d72e44151e0cb98720c89e58f70143d1c30abf8` | MERGED |
| 3186 | [port(upstream): #3186 - support regex provider param rules](https://github.com/bloodf/durindoor/pull/518) | `a572386ccbc469de69db54d19f93430d93b8e436` | MERGED |
| 3203 | [port(upstream): #3203 - per-account RPM cap, default 40 for NVIDIA](https://github.com/bloodf/durindoor/pull/519) | `950869b4f4a945b5998d39caf38bd41e1b3fb5e1` | MERGED |
| 3250 | [port(upstream): #3250 - add OpenCode Go usage and spent-key validation](https://github.com/bloodf/durindoor/pull/520) | `62ea942d546f9275ec6ba6715102d37d3d3ae58a` | MERGED |
| 3280 | [port(upstream): #3280 - include free-tier no-auth providers in combo picker](https://github.com/bloodf/durindoor/pull/521) | `f4a689e23560442fe7629e0265ca7388a851db1c` | MERGED |
| 3310 | [port(upstream): #3310 - fix tool arguments and Xiaomi Token Plan capabilities](https://github.com/bloodf/durindoor/pull/522) | `586c54aab650caecc7ac634f89c4d31160f411f1` | MERGED |
| 3313 | [port(upstream): #3313 - pin DNS-validated provider probe addresses](https://github.com/bloodf/durindoor/pull/523) | `9dd3fcf18a1ab67a16d8b17cb62d29cf7b27c60e` | MERGED |
| 3331 | [port(upstream): #3331 - disable Qoder accounts on quota code 112](https://github.com/bloodf/durindoor/pull/524) | `f4e67913a73d128c7c927c097b51fd2a182876f7` | MERGED |
| 3332 | [port(upstream): #3332 - normalize OpenCode Go thinking suffix lookup](https://github.com/bloodf/durindoor/pull/525) | `8f3293c1306330688231c2657b655a58baa5f422` | MERGED |
| 3333 | [port(upstream): #3333 - dedupe DeepSeek tool names](https://github.com/bloodf/durindoor/pull/526) | `6131113b938ba255038ef00caf89862966420992` | MERGED |
| 3342 | [port(upstream): #3342 - make CodeBuddy system-prompt filter tunable](https://github.com/bloodf/durindoor/pull/527) | `1a4aaac662709fb9fef4c3e6e233d3c565fd55fd` | MERGED |
| 3350 | [port(upstream): #3350 - add text to Kiro reasoning events](https://github.com/bloodf/durindoor/pull/528) | `4ba4dcfade3a225c36e7447fb493472c9dfa1548` | MERGED |
| 3352 | [port(upstream): #3352 - make 429 cooldown schedule configurable](https://github.com/bloodf/durindoor/pull/529) | `db1517961acc1a5bc8c346340ce79e97cadf9364` | MERGED |
| 3366 | [port(upstream): #3366 - drop messages emptied by thought filtering](https://github.com/bloodf/durindoor/pull/530) | `747a1eef3c672afcf2913be7c8f1c4d7b967af1d` | MERGED |
| 3368 | [port(upstream): #3368 - honor operator heap settings](https://github.com/bloodf/durindoor/pull/531) | `2570f9dca6c9de4c8febaf934a6ac95797ce5590` | MERGED |
| 3369 | [port(upstream): #3369 - recover a tool result that arrived without an id](https://github.com/bloodf/durindoor/pull/532) | `8a261ffff8e1f44c278b2e5e259f75ea95c4fe6f` | MERGED |
| 3373 | [port(upstream): #3373 - normalize custom tools in buffered Responses](https://github.com/bloodf/durindoor/pull/533) | `dbdc3e2ef6f7e86fb8dea854442815ce771369ae` | MERGED |
| 3381 | [port(upstream): #3381 - create credential store with owner-only permissions](https://github.com/bloodf/durindoor/pull/534) | `31ff5dc48b1c19f2fc1d341a7ce5cbb1f3f66017` | MERGED |
| 3386 | [port(upstream): #3386 - surface Codex SSE context overflow as 413](https://github.com/bloodf/durindoor/pull/535) | `691437ba16152748f0b71fb4c7fd58a3ea502a83` | MERGED |
| 3388 | [port(upstream): #3388 - refresh usage snapshots by period](https://github.com/bloodf/durindoor/pull/536) | `83e7800b3426057b76e1ec79bac803373efe6da7` | MERGED |
| 3397 | [port(upstream): #3397 - drop EOL models, repoint DeepSeek V4 Flash at its live id](https://github.com/bloodf/durindoor/pull/537) | `abb3b4cec4c4dd2ad4f63c24914278ab09aabf3f` | MERGED |
| 3405 | [port(upstream): #3405 - handle CommandCode in-stream errors](https://github.com/bloodf/durindoor/pull/538) | `1f76bd416443232c8531222d633a81f19930679c` | MERGED |
| 3411 | [port(upstream): #3411 - sanitize Gemini function response keys](https://github.com/bloodf/durindoor/pull/539) | `f5769695eb9704a0040c9ceebbd7a01be31473a3` | MERGED |
| 3420 | [port(upstream): #3420 - synchronize negotiated stream in outbound body](https://github.com/bloodf/durindoor/pull/540) | `36a62ef16bb3843a53d01ce618cf36d1b07ecfa3` | MERGED |
| 3421 | [port(upstream): #3421 - force streaming for Kimi Code endpoint](https://github.com/bloodf/durindoor/pull/541) | `b7acfd442f9ab02da6d2c3943c3bff930fc3e85b` | MERGED |
| 3426 | [port(upstream): #3426 - show model and provider for single-item groups](https://github.com/bloodf/durindoor/pull/542) | `dd710aee18492bc82b4177f5126b8e21e1750526` | MERGED |

## Verdict divergences from #508

- Opened then merged port PRs despite WATCH-list policy in `docs/UPSTREAM_SYNC.md:16` (explicit
  maintainer request; originally opened unmerged, now landed on main).
- #3373 first full gate failed a sibling `#3247` projector assertion after
  `customToolNames` was added to `projectCompletionToClientFormat` options.
  The sibling test now expects `{ customToolNames: new Set() }`.
- #2895 was initially stacked on stale parent `3c5205b17` after #3352 was
  amended. Rebased onto `70d59e4e` (`a2cf99753`); #3203 restacked onto that
  (`07f00ef55`).
- #3310 Xiaomi Claude-alias capability table already resolved
  `source:"provider"` at current SHA `c8a44719a`; the earlier REJECT used a
  stale probe.

## Local gates

Node 20 (`modules=115`) in `/tmp/durindoor-gate`. Per branch:
`lint`, `check:docs`, `check:registry-index`, `test:ci`, `build`,
`commitlint --from=origin/main --to=<sha>`. Known-fails untouched.
