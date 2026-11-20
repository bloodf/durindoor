# #1072: qualification of the remaining large core and registry proposals

Reviewed 2026-11-20 against DurinDoor `c5e1d234408feef1dee6a6748999b4e50a52f34d` (integration branch
`orq/tornf6/integration`, worktree `orq-tornf6-port9r-quali-96c3d0486e1c2dc5`) and upstream
`decolua/9router` default branch `master` at `1855aa44473e88feac9d3f131b9c0c5fc9706b68` (`# v0.5.119`,
2026-11-11) — the same upstream head the [#800 reconciliation](./800-scan-reconciliation.md) pinned.

This is a source, diff, and local-behavior review of seven upstream PRs. It records a disposition per
source. One source produced a port commit; the rest are recorded as already in, deferred, or outside this
work order's scope. No product behavior was changed by this review.

## Method

Each source was inspected as of 2026-11-20 through the GitHub API: current state, draft flag, merge/close
timestamps, changed-path list, and the final diff taken against the PR's own merge base (not against current
`master`, because five of the seven heads predate the current upstream head and a raw `master` diff would
show unrelated upstream work as if the PR had reverted it). Merge bases: `#5580` `1339107e62`; `#5464`,
`#5467`, `#5496`, `#5425`, `#5393`, `#5298` all `1fe586bb1c` (the `# v0.5.112` base pinned by the #800
reconciliation).

Upstream `master` has not moved since `1855aa44`, so no source was merged upstream after the intake
snapshot. That makes the "already incorporated on the default branch" check exact: for `#5580` the content
is on `master` as commit `7abc190d5`, and for the other six the default branch carries no equivalent.

The dated [#1072 issue](https://github.com/bloodf/durindoor/issues/1072) and the refreshed
[#800 report](./800-scan-reconciliation.md) were used as the incoming queue. The #800 rows for `#5580`
(closed), `#5464`, `#5467`, `#5496`, `#5425`, `#5393`, and `#5298` all recorded "still unqualified"; this
report supplies the qualification those rows were waiting for.

## Dispositions

### [#5580](https://github.com/decolua/9router/pull/5580) — expose `thinking_levels` in `/v1/models` and write effort variants for opencode

**State:** closed unmerged 2026-11-11; 4 files, +116/−1. Head `aa2ed3063`, merge base `1339107e62`.

**Disposition: already in — upstream incorporated the same change on its default branch, and the fork already
carries both behaviors.**

Upstream closed the PR without merging, but its content reached `master` as `7abc190d5`
("feat(models): expose thinking_levels and generate opencode effort variants"), which is an ancestor of the
current upstream head. Both halves of that commit are present in the fork:

- `/v1/models` publishes `thinking_levels` — `src/app/api/v1/models/buildModelsList.js:805` (catalog entry)
  and `src/app/api/v1/models/buildModelsList.js:1293` (live catalog), both sourced from
  `open-sse/providers/thinkingLevels.js`.
- The opencode CLI settings route writes effort variants derived from the same levels —
  `src/app/api/cli-tools/opencode-settings/route.js:139-145`, which keeps user-tuned variants and generates
  the rest through `getThinkingLevels`.

The fork's route layout differs from upstream's (the fork's `/v1/models` route delegates to
`buildModelsList.js`), so the upstream patch does not apply, but the behavior does. Both upstream test files
already exist in the fork, adapted to the fork's module layout:
`tests/unit/v1-models-thinking-levels.test.js` and `tests/unit/opencode-settings-effort-variants.test.js`.

**Acceptance (already passing, re-run for this review):**

```sh
cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 \
  unit/v1-models-thinking-levels.test.js unit/opencode-settings-effort-variants.test.js
```

No port commit: the behavior and its coverage were already present.

### [#5464](https://github.com/decolua/9router/pull/5464) — registry-driven model listing

**State:** open; 3 files, +861/−677. Head `1be901d2a`, merge base `1fe586bb1c`. Merge status against
current `master` is `DIRTY` — the PR predates upstream's later `commandcode`, `synthetic`, and Anthropic
OAuth-beta catalogue changes, so its final diff would revert those if applied wholesale.

**Disposition: already in, in a stronger fork-native form; ported as focused offline coverage.**

The PR has two parts. Its stated goal — one shared model-fetching implementation so the provider route and
the bulk sync route cannot drift — is already satisfied by the fork: `fetchConnectionModels` lives in
`src/app/api/providers/[id]/models/fetchConnectionModels.js` and is called by both
`src/app/api/providers/[id]/models/route.js` and `src/lib/modelAutoSync/runner.js`. Its actual feature —
taking the catalogue URL from the provider registry instead of a hand-written table — is also already
present, and broader than upstream's: the fork consults `AI_PROVIDERS[provider].modelsFetcher`, which 101
registry entries declare.

The three consumers that must agree on "can this provider list models?" already read the same declaration:
`canDiscoverModels` (`src/lib/providerRouteHandlers.js:76`), `isModelAutoSyncEligible`
(`src/lib/modelAutoSync/runner.js:38`), and the fetch path itself
(`src/app/api/providers/[id]/models/fetchConnectionModels.js:108`).

One upstream delta is **not** adopted: upstream derives `{baseUrl}/models` from the registry transport for
any provider that has neither a config entry nor a `modelsFetcher`. Measured against this fork's registry,
that rule matches 199 providers before upstream's own LLM-service-kind filter, and 60 after it. Many of
those 60 derived URLs are not catalogue hosts — `chatgpt-web` would become
`https://chatgpt.com/backend-api/conversation/models`, `copilot-web` would become
`wss://copilot.microsoft.com/c/api/chat?api-version=2/models`, `huggingchat` would become
`https://huggingface.co/chat/conversation/models`, `muse-spark-web` would become
`https://www.meta.ai/api/graphql/models`, and `perplexity` would become `https://api.perplexity.ai/models`.
The fork instead requires an explicitly declared catalogue, which is why 101 providers carry an explicit
`modelsFetcher` and the rest are simply not listable. That is a deliberate divergence, now documented in
[Provider registry → Model listing](../provider-registry.mdx).

**Ported in this work order:** `tests/unit/provider-model-listing.test.js` pins the contract that the fork
previously left untested — a registry-only provider is listable for the route, the playground probe, and the
auto-sync service; a provider with no declared catalogue is listable in none of them; and no consumer guesses
a catalogue URL from the provider's chat base URL. The upstream PR shipped the equivalent assertion file
(`tests/unit/provider-model-listing.test.js`) against upstream's own API; the fork had no equivalent case
for the registry `modelsFetcher` branch.

**Acceptance:**

```sh
cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 \
  unit/provider-model-listing.test.js unit/provider-can-discover-models.test.js unit/model-auto-sync-runner.test.js
```

### [#5467](https://github.com/decolua/9router/pull/5467) — bulk model sync with leaderboard filter and library cleanup

**State:** open; 51 files, +7615/−703. Head `5de5a0785`, merge base `1fe586bb1c`. The PR stacks on
[#5464](https://github.com/decolua/9router/pull/5464) and modifies the same two paths
(`src/app/api/providers/[id]/models/route.js`, `src/lib/providerModels/fetchModels.js`).

**Disposition: deferred — owner decision required, and out of scope for a compile-ready slice here.**

The PR is not one feature. It contains a leaderboard ingest stack (`src/lib/aihot/leaderboardScraper.js`,
`src/lib/aihot/modelMatcher.js`, `src/lib/aa/*`), five ranking engines (`src/lib/rankings/bradleyTerry.js`,
`composite.js`, `eqbench.js`, `identity.js`, `livebench.js`, `lmarena.js`, `budget.js`), a bulk sync API
with per-provider filter decisions (`src/app/api/providers/sync-models/*`), three new database repositories
(`aliasRepo`, `rankingBindingsRepo`, `syncFilterDecisionsRepo`), and a dashboard cleanup (`CleanModelsModal`,
`SyncModelsModal`, `ComboRankingBar`, `RankingBindRow`). The fork has no leaderboard, ranking, or
`aihot`/`aa`/`rankings` source tree.

Two blockers are not resolvable from the diff:

1. **External data source.** The scraper reads `https://aihot.news/leaderboard` and, when the host answers
   with an EdgeOne WAF challenge, executes the returned JavaScript in a sandboxed `vm` to solve it
   (`solveChallenge` in `src/lib/aihot/leaderboardScraper.js`) and replays the cookie. That is a live
   third-party scrape plus challenge-solving, not an offline capability.
2. **Owner decision on the ranking source.** The #5466 review in
   [1072-large-deferrals.md](./1072-large-deferrals.md) already recorded, for the sibling
   leaderboard-ordering PR, that an approved snapshot/source and a freshness and license policy must be
   chosen by the owner before a leaderboard can be ingested. #5467 depends on the same decision and
   additionally writes ranking bindings, filter decisions, and model aliases to the database.

**Minimum acceptance once an owner-approved offline snapshot contract exists** (a versioned snapshot
supplied by the owner, not fetched): a pure ranking function over the snapshot, exact or owner-confirmed
model bindings, stable tie handling, and a bulk sync that re-uses the fork's existing
`fetchConnectionModels` rather than upstream's new module. Offline command, then:

```sh
cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 \
  unit/provider-model-listing.test.js unit/model-auto-sync-runner.test.js unit/model-auto-sync-catalog.test.js
```

The dashboard surface this PR adds (`SyncModelsModal`, `ComboRankingBar`, provider-library cleanup) means a
landed port must also regenerate the Storybook inventory with `npm run storybook:build` and
`node scripts/sync-storybook-inventory.mjs` before the dashboard checks run. That step was not performed
here because no dashboard change was made.

### [#5496](https://github.com/decolua/9router/pull/5496) — support Claude Code web search through Codex

**State:** open; 15 files, +728/−20. Head `f5b26e176`, merge base `1fe586bb1c`. The PR ships no test files.

**Disposition: applicable gap — not ported in this work order; it needs a translator route the fork does not
have.**

The behavior is genuinely missing. A Claude Code client that declares Anthropic's native search tool
(`web_search_20250305`) gets it silently dropped when the route is Codex: `claude-to-openai.js` moves native
tools into the `CLAUDE_NATIVE_TOOLS` symbol (`open-sse/translator/request/claude-to-openai.js:100`) and drops
them from `result.tools`, and no translator on the OpenAI → Responses hop reads that symbol back. The
Responses → OpenAI response converter has no `web_search_call` or `url_citation` handling, so Codex-side
search results and their source URLs are discarded before the client sees them.

The upstream implementation cannot be applied as a small patch:

- Upstream adds a **direct** `OPENAI_RESPONSES → CLAUDE` response route
  (`open-sse/translator/response/responses-to-claude.js`, 341 new lines) plus its own Claude block
  sequencer, because its search blocks cannot survive the OpenAI hop. The fork's Responses path pivots
  through OpenAI (`register(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, …)` in
  `open-sse/translator/response/openai-responses.js` followed by
  `register(FORMATS.OPENAI, FORMATS.CLAUDE, …)` in `open-sse/translator/response/openai-to-claude.js`).
  Registering a direct Responses → Claude route would take over *all* Claude-on-Codex traffic, not just
  search traffic, and would replace a translator path this fork protects with its own tests.
- Upstream also rewrites `open-sse/transformer/streamToJsonConverter.js` to preserve `error` and
  `incomplete_details` on a terminal response, changes `open-sse/executors/codex.js` so `body.include` is
  merged instead of overwritten, adds `server_tool_use` to the Claude usage filter, and adds
  `validateSearchRoute` / `validateForcedFunction` request guards.
- The fork's `open-sse/executors/codex.js:1040` does overwrite `body.include` with
  `["reasoning.encrypted_content"]`, so upstream's merge fix would be needed too — but it only matters
  once a request actually sets `include`, which the fork currently never does
  (`open-sse/translator/request/openai-responses.js:644` deletes a client-supplied `include`).

**Minimum acceptance for a future port**, all offline:

1. A Claude request declaring `web_search_20250305` routed to Codex reaches the provider as a Responses
   hosted `web_search` tool, with `include: ["web_search_call.action.sources"]` preserved through
   `open-sse/executors/codex.js`.
2. A Codex response carrying `web_search_call` items and `url_citation` annotations reaches the Claude client
   as `server_tool_use` + `web_search_tool_result` blocks, with `server_tool_use.web_search_requests` in the
   Claude usage — in **both** the streaming and the forced non-streaming path, since Claude Code streams by
   default.
3. A Claude request declaring `web_search_20250305` on a route that cannot execute it fails with an explicit
   400 instead of dropping the tool silently. Note the fork's existing allow-list: native Anthropic routes
   (`claude`, `anthropic`, `anthropic-compatible-*`) pass the tool through
   (`open-sse/translator/formats/claude.js:864`), and `deepseek` declares
   `claudeSupportedToolTypes: ["web_search_20250305", "web_search_20260209"]`
   (`open-sse/providers/registry/deepseek.js:37`); both must keep working unchanged.
4. No existing translator test changes meaning. The focused command for such a port:

```sh
cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 \
  unit/provider-model-listing.test.js translator/ --testNamePattern "search"
```

Note for that future port: the fork's own `/v1/search` route
(`open-sse/handlers/search/chatSearch.js`) already offers hosted search for `gemini`, `openai`, `xai`,
`kimi`, `minimax`, and `perplexity` through the chat API. It is a separate product surface and is not a
substitute for Claude Code's native search block, so the two should not be conflated.

### [#5425](https://github.com/decolua/9router/pull/5425) — raw filesystem block compression and full response caches

**State:** open; 14 files, +1612/−205. Head `b00efd955`, merge base `1fe586bb1c`.

**Disposition: deferred — new disk-persistence subsystem; needs an owner decision, and it changes RTK core
semantics this repository documents as load-bearing.**

The PR adds two independent caches under the application data directory
(`open-sse/rtk/fsCache.js`, 627 new lines): a block cache that stores compressed `tool_result` and context
blocks by SHA-256 so repeated turns reuse compressed blocks, and a **full response cache** that stores whole
LLM responses — JSON and SSE payloads — by canonical request hash so an identical request is served from
disk with no upstream call. Defaults are a 24-hour TTL and a 500 MB ceiling; the module fails open on any
filesystem error. It also adds `GET`/`POST`/`DELETE /api/token-cache`, a settings entry, a `dashboardGuard`
protected-path entry, and a Token Saver dashboard panel.

Three things block a port here:

1. **Disk persistence of provider payloads is a product decision.** The full response cache writes provider
   responses — which can contain tool output, source code, and client secrets — to disk outside the
   request-detail retention policy the fork already governs
   (`src/lib/dataRetention/runner.js`, `src/lib/db/repos/requestDetailsRepo.js`). The owner has to decide
   the retention, the exclusion list, and whether the response cache is opt-in.
2. **RTK core semantics.** The PR changes `compressMessages(body, enabled)` to
   `compressMessages(body, enabled, cacheOpts)` and threads cache options through every branch
   (`open-sse/rtk/index.js`, `open-sse/rtk/headroom.js`). `AGENTS.md` and the RTK conventions document the
   current fail-open, shape-by-shape, in-place contract; the fork's Cursor exception (RTK runs on the
   source-format body and is skipped post-translate) is exactly the kind of detail this change disturbs.
3. **The upstream PR has no test for the response-cache path.** It ships
   `tests/unit/fs-token-cache.test.js` (313 lines) covering the block cache only.

**Minimum acceptance once the owner decides the persistence policy**, all offline: a disk-backed cache
written to a private scratch directory, a bounded TTL and size ceiling, a fail-open path where any filesystem
error leaves the request body untouched, an explicit purge endpoint, and proof that an existing RTK request
body is byte-identical when the cache is disabled. The fork's existing RTK suites must keep passing
unchanged.

### [#5393](https://github.com/decolua/9router/pull/5393) — passkey (WebAuthn) dashboard sign-in with toggleable passkey-only mode

**State:** open; 36 files, +2908/−37. Head `ad2f7f131`, merge base `1fe586bb1c`.

**Disposition: out of scope for this work order — authentication and database change, new dependencies, and
no passkey support exists in the fork today.**

The fork has no passkey code at all: `src/app/api/auth/` holds `change-password`, `login`, `logout`, `mfa`,
`oidc`, `reset-password`, and `status`, and no file under `src/` or `open-sse/` mentions passkeys or
WebAuthn. The PR adds the whole feature: five WebAuthn routes (register options/verify, login
options/verify, credential list and delete), `src/lib/auth/passkey.js`, `passkeyMode.js`,
`passkeyResponses.js`, a `passkeysRepo`, a schema migration, a `PasskeysCard` dashboard panel, a login
page rework, and a `PASSKEY_MODE_OVERRIDE` environment switch.

It is excluded here for three independent reasons, any one of which is sufficient:

1. **Dependency change.** The PR adds `@simplewebauthn/browser` `^14.0.0` and `@simplewebauthn/server`
   `^14.0.3` to the root `package.json`. The work order forbids changing dependencies in this unit, so this
   is reported as **NEEDS_CONTEXT** for the dependency change itself.
2. **Authentication and session semantics.** `verifyDashboardAuthToken` changes from a pure JWT check to a
   lookup that revokes every session issued by a credential that is no longer enrolled
   (`src/lib/auth/dashboardSession.js`), and the PR adds an install-id derivation, a passkey-only login mode,
   a reset-password path change, an SSO policy change, and a `tunnelAccess` change. The repository's gate
   treats auth, crypto, and admission changes as full-mode with frontier security review; a qualification
   unit is not that review.
3. **Database migration.** `src/lib/db/schema.js`, `src/lib/db/index.js`, `src/lib/localDb.js`, and a new
   `passkeysRepo` add a credential table, which the local gate also treats as a full-mode, owner-run
   schema check.

**Minimum acceptance for a future dedicated work order**, offline where possible: a credential table with
unique constraints and a migration on both DB engines; enrollment that binds to a verified session; a login
challenge/verify pair that rejects replayed challenges and rejects an unverifiable assertion; session
revocation when a credential is deleted; and proof that the password and MFA paths are unchanged when
passkey mode is off. The upstream PR's own suite
(`tests/unit/passkey-routes.test.js`, 793 lines; `passkey-lib.test.js`, 232 lines; `passkey-session.test.js`;
`passkeys-repo.test.js`; `auth-status.test.js`; `dashboard-guard.test.js`) is the natural basis.

### [#5298](https://github.com/decolua/9router/pull/5298) — native client-MCP service bridge with PATH-aware UI toggle

**State:** open; 12 files, +3043/−8. Head `7db4acfeb`, merge base `1fe586bb1c`.

**Disposition: separate integration — explicitly outside this port, per the work order. Source boundaries
recorded below.**

The PR adds `open-sse/services/opencodeServiceBridge.js` (2529 new lines). The fork has no counterpart:
`open-sse/services/` holds `opencodeReasoningSanitizer.js` and `opencodeTlsClient.js`, and no
`opencodeServiceBridge` exists anywhere in the tree.

**Where the integration boundary sits.** The new module is not a gateway translator; it is a client-side
process supervisor. It `spawn`s a daemon per proxy URL from `child_process`, keeps a pool with a 10-minute
idle reaper, writes daemon state to
`~/.local/state/opencode/service.json` (or `%LOCALAPPDATA%\opencode\service.json` on Windows), and
intercepts upstream 429 quota exhaustion to end the pooled sessions
(`createOpencodeRateLimitError`, `notifyDaemonRateLimit`). The dashboard half is a PATH-aware toggle in
`src/shared/components/NoAuthProxyCard.js` that reads the installed-CLI state from
`/api/cli-tools/opencode-settings` and persists `useServiceDaemon` in the per-provider strategy override.
`src/sse/services/auth.js` changes by two lines to admit the new provider path.

That means the PR's substance is: **the gateway spawns and supervises a native MCP client bridge on the
operator's machine.** It is a new outbound process boundary, a new on-disk state file, and a new dashboard
control — not a translation, registry, or core-routing change. The work order directs that this stays
separate from the port whenever it adds an integration, and it does.

**Source boundaries to carry into any future work order:** `open-sse/services/opencodeServiceBridge.js`
(process pool, daemon lifecycle, state file, 429 interception), `open-sse/executors/opencode.js` (executor
side of the bridge), `src/shared/components/NoAuthProxyCard.js` (dashboard toggle), `src/sse/services/auth.js`
(provider path admission), and six new test files under `tests/unit/`. The upstream PR's own tests
(`opencode-agentic-continuation`, `opencode-bridge-resilience-trio`, `opencode-executor`,
`opencode-multiplatform`, `opencode-rate-limit-interception`, `opencode-session-recycling`,
`opencode-tool-resolution`, `opencode-working-dir-resolution`) are the natural basis, and the fork's
existing OpenCode suites (`tests/unit/opencode-*.test.js`) are the regression floor.

## Portfolio summary

| Source | State | Disposition | Landed here |
| --- | --- | --- | --- |
| [#5580](https://github.com/decolua/9router/pull/5580) | closed unmerged | already in (`master` commit `7abc190d5`; fork carries both behaviors and both upstream test files) | — |
| [#5464](https://github.com/decolua/9router/pull/5464) | open | already in, fork-native and broader; base-URL derivation deliberately not adopted | `tests/unit/provider-model-listing.test.js`, [registry doc](../provider-registry.mdx) |
| [#5467](https://github.com/decolua/9router/pull/5467) | open | deferred — owner decision on leaderboard source; live scrape plus WAF-challenge solving; stacks on #5464 | — |
| [#5496](https://github.com/decolua/9router/pull/5496) | open | applicable gap — needs a Responses → Claude search route; exact acceptance recorded | — |
| [#5425](https://github.com/decolua/9router/pull/5425) | open | deferred — disk persistence of provider payloads; changes documented RTK core semantics | — |
| [#5393](https://github.com/decolua/9router/pull/5393) | open | out of scope — auth and database change with new dependencies (**NEEDS_CONTEXT** for the dependency change) | — |
| [#5298](https://github.com/decolua/9router/pull/5298) | open | separate integration — spawns and supervises a native MCP client bridge; boundaries recorded | — |

## Verification performed in this unit

```sh
cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 \
  unit/provider-model-listing.test.js \
  unit/provider-can-discover-models.test.js \
  unit/model-auto-sync-runner.test.js \
  unit/v1-models-thinking-levels.test.js \
  unit/opencode-settings-effort-variants.test.js
```

Result: 5 files, 49 tests, all passing. Root lint (`npm run lint`) passed.

No dashboard surface changed, so the Storybook inventory regeneration required by a dashboard source change
did not apply. No workflow, Docker, browser, e2e, paid API, credential, or live provider call was used, and
the full suite was not run in this unit.

## Review limits

- This is a source, diff, and local-behavior review. It does not claim upstream acceptance, runtime
  behavior against a live provider, or that the deferred sources are unwanted — only that they are not
  compile-ready slices under this work order's constraints.
- Upstream metadata and diffs were read on 2026-11-20 against `master` at `1855aa44`. GitHub state can
  change after that; re-check the open/closed state before acting on a deferred row.
- The #800 rows for these seven sources recorded "still unqualified" against the same pinned upstream head.
  This report supersedes those rows for the seven sources named here.
- `tests/__baseline__/known-fails.txt` was not modified, no test was skipped or weakened, and no existing
  assertion was relaxed.
