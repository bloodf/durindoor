# Review: OmniRoute #21441 (TTOken API-key provider)

**Status: read-only disposition. No product change, no port, no implementation claim.**

- Upstream: `diegosouzapw/OmniRoute` PR #21441, "feat(providers): add TTOken API-key provider". State OPEN, base `release/v3.8.55`, head `7ec5270551bdda0c0a692c7aea9b9ee0fd0ccc77` (verified by `gh pr view`, which matched the pinned head). Two commits: `bebd2d9c9f1a` (feature) and `7ec5270551bd` (changelog fragment). 12 files, +190/-2.
- DurinDoor main: `29490b783e83176d4d6a4162f76ee3dc79db66ea`.
- Frozen train: `32a783d76d45d90bf0517015442f43fadd96106c`. Main is an ancestor of the train; the train is 145 files ahead. Not altered.
- Method: source-only. Upstream diff read with `gh pr diff` (untrusted data, used only as evidence). DurinDoor state read with `git show` / `git grep` / `git ls-tree` against the two pinned commits. No dependencies installed, no tests run, no live provider calls, no credentials, no `~/.9router` access.

## Classification

**Absent optional feature. Not a confirmed defect.**

TTOken is not present in DurinDoor main or the train. Nothing in the fork is broken by its absence, and no DurinDoor behavior is contradicted by the PR.

## Evidence: TTOken is absent

Word-bounded, case-sensitive searches for `ttoken`, `TTOken` and `ttoken.dev` over `open-sse`, `src`, `tests`, `docs` and `cli` return no hits on main or the train.

The only hits on main are non-code mentions:

- `internal/docs/port-reports/1073-nov26-midday.md:120` records upstream 9router #5869 ("feat(providers): add TTOken gateway") as **Not applicable**, with the note "`open-sse/providers/registry/ttoken.js` is absent."
- `internal/docs/port-reports/2026-11-27-full-parity-refresh.md:317` repeats that disposition.

Both are for 9router #5869, a different PR. The path they cite is the flat DurinDoor layout, which I confirmed is absent. The disposition is still valid for a different reason than the PR's, so it is not a substitute for this review.

## Evidence: the PR's shape does not map onto DurinDoor

The PR is written against an OmniRoute TypeScript layout. DurinDoor is a JavaScript fork with a different registry schema.

| PR touches (OmniRoute) | DurinDoor main equivalent | Present? |
|---|---|---|
| `open-sse/config/providers/index.ts` (REGISTRY) | `open-sse/providers/registry/index.js` (818 lines, barrel of `pNNN` imports) | Different layout |
| `open-sse/config/providers/registry/ttoken/index.ts` | `open-sse/providers/registry/<id>.js` (e.g. `paraloncloud.js`, `empiriolabs.js`) | Layout differs; no `ttoken.js` |
| `open-sse/config/providers/shared.ts` → `buildOpenAiCompatibleRegistryEntry` | Helper not present as an importable module. The name appears only in `internal/docs/provider-parity-omni-inherited-dispatch.md:13` (describing OmniRoute) and `tests/unit/omniroute-provider-audit.test.js:103` (a test stub) | Absent |
| `open-sse/config/providerRegistry.ts`, `open-sse/services/model.ts`, `open-sse/executors/index.ts`, `src/shared/constants/models.ts` | `.js` equivalents exist for three of them (`open-sse/services/model.js`, `open-sse/executors/index.js`, `src/shared/constants/models.js`). `providerRegistry.ts` has no `.js` equivalent with that name | Partial |
| `src/shared/constants/providers/apikey/index.ts` + `ttoken.ts` | `src/shared/constants/providers.js` (single file) | Directory absent |
| `src/app/api/providers/[id]/models/discovery/providerSets.ts` (`NAMED_OPENAI_STYLE_PROVIDERS`) | `src/app/api/providers/[id]/models/modelsConfig.js` (e.g. `paraloncloud: { ...createOpenAIModelsConfig(...), apiKeyOnly: true }` at line 778) | Different mechanism |
| `open-sse/config/providers/registry/…` schema: `authHeader`, `modelsUrl`, `passthroughModels` | DurinDoor schema: `priority`, `display`, `category`, `authType`, `transport`, `transports`, `validateUrl`, `passthroughModels` (`paraloncloud.js` as example) | Field names differ |
| `AGGREGATOR_PROVIDER_IDS` (`src/shared/constants/providers.ts`) | No `AGGREGATOR_PROVIDER_IDS` symbol on main | Absent |
| `PROVIDER_ENDPOINTS` (`src/shared/constants/config.ts`) | `src/shared/constants/config.js` exists; the symbol was not checked for ttoken-adjacent entries | Different file type |
| `tests/unit/provider-node-reserved-prefix.test.ts` (`RESERVED_PREFIX_COUNT` 450 → 451) | No such count assertion on main. `RESERVED_PROVIDER_PREFIXES` is built dynamically in `src/sse/services/model.js:195–200`, with no fixed count test | Count test absent |
| `tests/unit/providers-constants-split.test.ts` (`APIKEY_PROVIDER_COUNT` 263 → 264) | No `APIKEY_PROVIDERS_EMPIRIOLABS` symbol and no matching count test on main | Absent |
| `tests/unit/provider-ttoken-registry.test.ts` (imports `.ts` modules listed above) | Would not resolve as written | Absent |
| `tests/snapshots/provider/translate-path.json` (+ttoken block) | No `tests/snapshots/provider/` path on main | Absent |
| `changelog.d/features/21441-ttoken-provider.md` | No `changelog.d/` directory. DurinDoor uses `CHANGELOG.md` (top section `4.11.0`) | Convention differs |

Upstream test counts (450, 263) are OmniRoute-only numbers. Porting the PR verbatim would not apply to DurinDoor and cannot be applied as a count bump.

## Evidence: the fork already has a precedent for this pattern

DurinDoor ports OpenAI-compatible providers as flat registry files with a provenance comment. `open-sse/providers/registry/empiriolabs.js:1` reads `// OmniRoute open-sse/config/providers/registry/empiriolabs/index.ts, 4624250231f49ed118fb4522a9d735e4894322c6.` A TTOken port would follow that shape, not the upstream one.

Live catalogue discovery for keyed providers is handled in `src/app/api/providers/[id]/models/modelsConfig.js` (`createOpenAIModelsConfig`, used in four files on main). That is the mechanism DurinDoor would use, not `NAMED_OPENAI_STYLE_PROVIDERS`.

## Upstream claims: what this review could and could not check

Verified offline from the diff:

- Single chat-completions lane: `baseUrl` and `modelsUrl` point to `https://api.ttoken.dev/v1/chat/completions` and `https://api.ttoken.dev/v1/models`.
- Five seeded models including `ttoken/auto`; the approval-gated model is excluded by design.
- Auth is bearer; `passthroughModels: true`.
- Key prefix claim `sk-ttoken-v1-` appears in `authHint`.

**Not verified (requires live calls, which were out of scope):**

- Endpoint behavior, 401/403 semantics, key scoping per product, and the claim that `/v1/messages` and `/v1/responses` reject image blocks. These are narrative claims in the PR's doc comment.
- Whether the seeded model ids exist on TTOken today.
- Pay-per-token billing in Rupiah. Commercial claim, not checked.

**Anomalies noticed, not treated as defects:**

- The PR comment says the seed was "checked 2026-11-28". The PR was created 2026-11-27T17:29Z. A check dated after the PR is worth asking the author about. It does not affect the DurinDoor disposition.
- The changelog fragment links to `cheaper-inference/OmniRoute/pull/21441`, while `gh` reports the repo as `diegosouzapw/OmniRoute`. Likely a rename or mirror. Cosmetic in this review.
- The PR targets OmniRoute `release/v3.8.55`, not OmniRoute `main`. Release-branch state was not checked beyond PR metadata.

## Recommendation (for the auth and sync lanes to decide)

- No DurinDoor product change follows from this review. The provider is a new, optional feature, and its absence is consistent with the fork's current disposition.
- If the sync lane decides to port it, the work is a re-shape to flat JS registry and `modelsConfig.js`, not a cherry-pick. The PR's count-based test edits do not transfer.
- Provider auth and credential lifecycle belong to the auth lane. This review made no auth claim and proposes none.
- The 9router #5869 "Not applicable" row (`1073-nov26-midday.md:120`) cites a path that the PR's own layout does not share. The sync lane may want to re-check that row against the actual DurinDoor layout, since both PRs add TTOken from different upstreams.

## Uncertainties

- Live TTOken behavior: unverified (no live calls).
- Upstream PR may change before merge. Pinned head `7ec5270551bd`; later pushes are out of scope.
- Dependencies not installed; no test run. The claim "PR tests would not resolve" is from file-existence checks, not an execution.
- `gh pr view` printed an event-subscription hint. Not used; no watch or subscription was created.
