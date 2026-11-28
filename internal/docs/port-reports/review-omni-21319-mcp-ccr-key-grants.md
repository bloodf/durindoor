# OmniRoute #21319 (mcp-ccr-key-grants): independent MCP and CCR key grants

Disposition: **intentional / inapplicable at this head — no port.** The upstream pull request is a
dashboard-only exposure of two API-key scope strings that already existed upstream before the PR.
DurinDoor has neither scope string, nor the granular `scopes[]` array that carries them, nor the
API Manager dashboard that the PR edits, nor the CCR read surface that `read:compression` would
gate. There is no missing behavior to port, and no authorization default that this PR changes
upstream either, so nothing in it is silently lost.

This review closes row `O0080` of [the full parity refresh](2026-11-27-full-parity-refresh.md),
which recorded PR #21319 as "Unrecorded at this head; review required".

## Upstream evidence

[PR #21319](https://github.com/cheaper-inference/OmniRoute/pull/21319) ("feat(dashboard): expose
independent MCP and CCR key grants", author `KiaroSama`) is **open, not merged** at the time of
review. Its metadata, read with `gh api repos/cheaper-inference/OmniRoute/pulls/21319`:

| Field | Value |
| --- | --- |
| state / merged | `open` / `false` |
| head | `fix/19803-mcp-key-controls` @ `668d9690bc488807eafa813e5366af07af674acd` |
| base | `release/v3.8.55` @ `16e2c146fb5b8e4ee6364fb679ffe412880757fb` |
| mergeable_state | `blocked` |
| size | 18 files, +786 / −61 |
| created / updated | 2026-11-26T15:56:46Z / 2026-11-26T16:56:11Z |

The head SHA matches the SHA already recorded in row `O0080` of the parity refresh, so the
reviewed content is the content that row refers to.

It closes [issue #21318](https://github.com/cheaper-inference/OmniRoute/issues/21318), a focused
split of [#19803](https://github.com/cheaper-inference/OmniRoute/issues/19803). Issue #21318 states
the requirement precisely: make the existing `mcp:connect` and `read:compression` scopes
independently manageable from API Manager and templates "without granting broad management
permissions", "both off by default for new keys", "preserve unrelated grants", and "use the
existing server authorization and ownership checks".

### What the PR actually changes

All 18 changed files are dashboard UI, one shared-constants file, one i18n file, and tests:

| Area | Files |
| --- | --- |
| New controls | `api-manager/components/McpPermissionControls.tsx` (+39), `api-manager/components/QuickKeyPermissionControls.tsx` (+45) |
| Scope builders | `api-manager/apiManagerScopes.ts` (+16/−1), `api-manager/keyTemplatePolicyUtils.ts` (+35/−35), `api-manager/useCreateKeySubmission.ts` (+12/−1) |
| Form state | `api-manager/[id]/access/useApiKeyAccessForm.ts` (+15), `api-manager/[id]/access/tabs/GeneralTab.tsx` (+6), `api-manager/[id]/access/ApiKeyAccessEditorClient.tsx` (+1) |
| Page wiring | `api-manager/ApiManagerPageClient.tsx` (+5/−19), `api-manager/components/KeyPolicyGeneralTab.tsx` (+10/−5) |
| Constants | `src/shared/constants/mcpScopes.ts` (+4/−1) |
| i18n | `src/i18n/messages/en.json` (+4) |
| Changelog | `changelog.d/fixes/api-manager-independent-mcp-ccr-permissions.md` (+1) |
| Tests | `tests/unit/api-key-access-form.test.ts` (+21), `tests/unit/api-key-mcp-permission-roundtrip.test.ts` (+220, new), `tests/unit/api-manager-scope-preservation.test.ts` (+69), `tests/unit/ui/api-key-access-editor.test.tsx` (+62), `tests/unit/ui/api-key-mcp-create.test.tsx` (+221, new) |

The single constants change extracts the already-present literal into a named export; it adds no
new scope:

```
+/** Canonical read permission shared by MCP tool policy and the API-key editor. */
+export const COMPRESSION_READ_SCOPE = "read:compression";
```

and replaces `"read:compression"` inside `MCP_SCOPE_LIST` with that constant. `MCP_SCOPE_LIST` and
the `MCP_TOOL_SCOPES` tool→scope map are otherwise unchanged.

**No route, guard, middleware, transport, or scope-enforcement file is touched.** The upstream
server-side semantics that the PR exposes are unchanged and pre-existing:

- `mcp:connect` is upstream's narrow additive scope from #7895, defined in
  `src/shared/constants/managementScopes.ts` as `MCP_CONNECT_SCOPE = "mcp:connect"`. Its own
  upstream doc comment states it "grants a non-loopback caller ONLY the `/api/mcp/` LOCAL_ONLY
  carve-out … it does NOT grant broader management API access". The carve-out is
  `LOCAL_ONLY_MANAGE_SCOPE_BYPASS_PREFIXES` in `src/server/authz/routeGuard.ts` (upstream base
  lines 175–180), whose entries include `"/api/mcp/"`.
- `read:compression` is enforced per MCP tool, not per API key row. Upstream
  `open-sse/mcp-server/httpTransport.ts` resolves the caller's per-key scopes into
  `authInfo.scopes`, and `open-sse/mcp-server/scopeEnforcement.ts` checks the required scopes from
  `MCP_TOOL_SCOPES` (`evaluateToolScopes`, upstream lines 125–156). Upstream
  `src/shared/constants/mcpScopes.ts` maps `omniroute_ccr_retrieve`, `omniroute_ccr_inspect`,
  `omniroute_ccr_list` and `omniroute_ccr_stats` to `read:compression`, and
  `omniroute_ccr_store` / `omniroute_ccr_delete` to `write:compression`.

So the PR's substance is: **two already-enforced upstream scope strings become independently
editable toggles in the API Manager UI** (quick create, full creation policy, templates, and the
existing-key access editor), default off for a new key, with unrelated scopes preserved on edit.
The upstream PR body and issue #21318 both state that "none of the server authorization defaults or
ownership checks change". The upstream tests confirm the intent: `tests/unit/ui/api-key-mcp-create.test.tsx`
asserts `bodies[0].policy.key.scopes` equals `["mcp:connect", "read:compression", "self:usage"]`
for a key created with both toggles on and `manage` absent, and
`tests/unit/api-key-mcp-permission-roundtrip.test.ts` asserts that a key holding `read:compression`
can retrieve its own CCR block while a second key cannot retrieve it.

## Local evidence

Two refs were compared using Git objects, not the working tree:

- `origin/main` = `29490b783e83176d4d6a4162f76ee3dc79db66ea`
- frozen train tree = `32a783d76d45d90bf0517015442f43fadd96106c` ("merge: include #2683 in train/2"),
  which is **not** an ancestor of `origin/main` (`git merge-base --is-ancestor` exits non-zero).

Every fact below was read from `git ls-tree` / `git cat-file` / `git show` at both refs and is
identical in them.

### 1. There is no API Manager dashboard surface

`git ls-tree -r --name-only <ref> -- 'src/app/(dashboard)/dashboard/api-manager'` returns **0
entries** at both refs. Upstream's dashboard has an `api-manager` route directory; DurinDoor's
dashboard routes are `auto-configure, cli-tools, combos, compression-studio, console-log,
endpoint, headroom, health, keys, mcp-gateway, media-providers, media-routes, mitm, monitoring,
playground, profile, providers, proxy-pools, pxpipe, quota, settings, skills, timeline,
token-saver, translator, usage`.

DurinDoor's key-management page is `src/app/(dashboard)/dashboard/keys/`. Its create and update
payloads carry `isAdmin` but no scope array:
[`KeysPageClient.jsx:449`](https://github.com/bloodf/durindoor/blob/dc624113dc5728c04a01c1dd49e37f9a1dd80c4b/src/app/%28dashboard%29/dashboard/keys/KeysPageClient.jsx#L449)
sends `{ name, allowedCombos, dailyLimitTokens, expiresAt, policy, providerConnectionIds, isAdmin }`,
and [`KeysPageClient.jsx:574`](https://github.com/bloodf/durindoor/blob/dc624113dc5728c04a01c1dd49e37f9a1dd80c4b/src/app/%28dashboard%29/dashboard/keys/KeysPageClient.jsx#L574)
sets `payload.isAdmin = isAdmin`.

### 2. There is no API-key scope array

`git show <ref>:src/lib/db/repos/apiKeysRepo.js` gives the same INSERT at line 156 in both refs:

```
INSERT INTO apiKeys(id, key, name, machineId, isActive, allowedCombos, dailyLimitTokens, policy, expiresAt, isAdmin, createdAt)
```

There is no `scopes` column. Permission is a single boolean. The upstream permission model — a
`scopes[]` array on the key row — has no local counterpart, so there is nothing for
`buildApiKeyCreateScopes` / `mergeApiKeyPermissionScopes` to build or merge.

The admin decision is a column read, not a scope-string lookup:
[`src/dashboardGuard.js:168`](../../../src/dashboardGuard.js#L168) `isAdminScopedKey` resolves a
presented key and tests `(await getApiKeyByKey(apiKey))?.isAdmin === true`.

`git grep -e 'mcp:connect' -e 'read:compression' <ref> -- src/ open-sse/` returns **no files** at
either ref, and `git cat-file -e <ref>:src/shared/constants/{mcpScopes,managementScopes,selfServiceScopes,apiKeyPolicyScopes}.ts`
fails for all four at both refs.

### 3. There is no `mcp:connect` equivalent

DurinDoor's MCP surface is not upstream's MCP server. Upstream `/api/mcp/` serves
`omniroute_*` tools behind per-tool scope checks; DurinDoor has two different surfaces:

- **`/api/mcp/control`** — a management MCP endpoint (JSON-RPC over HTTP) at
  [`src/app/api/mcp/control/route.js`](../../../src/app/api/mcp/control/route.js). Its tool set is
  `list_providers, list_connections, toggle_connection_active, toggle_provider_active,
  usage_stats, token_saver_stats, model_list, list_combos, get_combo, create_combo, update_combo,
  delete_combo, quota_snapshots, refresh_quota, list_api_keys, get_settings, update_settings`
  ([`src/lib/mcp/control/tools.js:139`](../../../src/lib/mcp/control/tools.js#L139) onward). It is
  reached by any valid API key, CLI token, or dashboard JWT
  ([`src/dashboardGuard.js:511`](../../../src/dashboardGuard.js#L511)); only write tools are
  admin-gated ([`src/app/api/mcp/control/route.js:62`](../../../src/app/api/mcp/control/route.js#L62)
  via `isNonAdminApiKeyCaller`,
  [`src/dashboardGuard.js:406`](../../../src/dashboardGuard.js#L406)). There is no per-tool scope
  check to widen, because there is no per-tool scope vocabulary locally.
- **`/api/mcp/[plugin]/{sse,message}`** — a local stdio↔SSE bridge for external MCP plugins.
  [`src/app/api/mcp/[plugin]/sse/route.js:19`](../../../src/app/api/mcp/[plugin]/sse/route.js#L19)
  re-checks `canAccessLocalOnlyRoute`, and
  [`src/dashboardGuard.js:241`](../../../src/dashboardGuard.js#L241) accepts only a valid CLI
  token, or loopback + same-origin + dashboard JWT. A plain API key is not accepted here.

Consequence: the lower-privilege, non-management path that upstream's `mcp:connect` grant provides
is already subsumed locally by the existing rule "any valid API key may call read-only MCP
control tools". A separate `mcp:connect` grant would be a second spelling of an access rule
DurinDoor already applies more broadly, and adding a scope string to a boolean-`isAdmin` key model
would change the local authorization model rather than match it.

### 4. There is no `read:compression` equivalent, and no CCR read surface at all

`open-sse/services/compression/engines/ccr/index.js` is a deliberately minimal local slice. Its
header states it at lines 5–7: "This file exposes ONLY `storeBlock` (+ `resetCcrStore` for test
isolation); it does NOT register or expose the CCR engine. Full CCR retrieve/feedback semantics
live out of F-1a scope." The module exports only `MAX_CCR_ENTRIES`
([line 18](../../../open-sse/services/compression/engines/ccr/index.js#L18)),
`storeBlock` ([line 46](../../../open-sse/services/compression/engines/ccr/index.js#L46)) and
`resetCcrStore` — there is no retrieve, inspect, list or stats entry point.

Its only importer is
[`open-sse/services/compression/engines/session-dedup/fuzzy.js:2`](../../../open-sse/services/compression/engines/session-dedup/fuzzy.js#L2),
which calls `storeBlock` at line 86 to index a deduplicated block. A repo-wide search for `ccr`
across `src/` and `open-sse/` finds no other CCR content consumer.

Correspondingly, no local surface exposes CCR content for reading:

- The MCP control tool list above contains no CCR/compression tool; `grep -rn "ccr\|CCR" src/lib/mcp/control/`
  returns nothing.
- `src/app/api/compression/` contains exactly one route, `preview/route.js`, which runs each
  catalog compression engine over a body and returns per-engine status. It is a dashboard-internal
  endpoint authenticated by dashboard JWT or CLI token (not by an LLM API key), and it never
  returns stored CCR content.
- `src/app/(dashboard)/dashboard/compression-studio/` contains only `page.js` and
  `page.stories.jsx`, and references no CCR symbol.

The ownership check the upstream PR relies on is also already present in the local store design —
the store key is principal-scoped, `${principalId ?? ANON} ${hash}` with `ANON = "__anon__"`
([`open-sse/services/compression/engines/ccr/index.js:24`](../../../open-sse/services/compression/engines/ccr/index.js#L24),
`ANON` defined at line 21),
with a bounded 5 000-entry FIFO map. That is the same IDOR-safe contract upstream documents in
`mcpScopes.ts`, so the *ownership* half of upstream's design is already in place locally; only the
read surface it would scope is deliberately absent.

## Reconciliation per grant

### Grant A — independent `mcp:connect` (MCP connection, off by default, without management access)

**Verdict: intentional / inapplicable.**

Upstream's `mcp:connect` is a runtime scope that already existed before #21319; the PR only adds
UI to grant it. Locally there is no `scopes[]` on the key row to carry it
([`src/lib/db/repos/apiKeysRepo.js:156`](../../../src/lib/db/repos/apiKeysRepo.js#L156)), no
`mcp:connect` string anywhere in `src/` or `open-sse/` at either ref, and no upstream-shaped
scope-gated MCP tool server to apply it to. The functional need it serves — a machine client
reaching an MCP surface without full management rights — is already met locally by the
read-tools-are-open-to-any-valid-key rule at
[`src/dashboardGuard.js:511`](../../../src/dashboardGuard.js#L511), with writes still admin-gated
at [`src/app/api/mcp/control/route.js:62`](../../../src/app/api/mcp/control/route.js#L62).

### Grant B — independent `read:compression` (CCR read, off by default, separate from MCP connect)

**Verdict: intentional / inapplicable.**

There is no CCR content read surface to scope. The local CCR module is store-only by explicit
design (its own header, lines 5–7), has exactly one importer
([`open-sse/services/compression/engines/session-dedup/fuzzy.js:2`](../../../open-sse/services/compression/engines/session-dedup/fuzzy.js#L2)),
and exposes no retrieve/inspect/list/stats operation. No MCP tool, HTTP route, or dashboard page
returns stored CCR content. Upstream's `read:compression` is enforced per MCP tool in
`scopeEnforcement.ts` against `MCP_TOOL_SCOPES`; DurinDoor has neither the tool list nor the
scope vocabulary, so there is no unauthorized CCR read to close and no over-broad grant to narrow.

### Cross-cutting: the PR changes no server authorization default

Upstream's PR body and issue #21318 both state that server authorization defaults and ownership
checks are unchanged, and the file list confirms it: no route, guard, middleware, transport or
scope-enforcement file is in the 18 changed files. Therefore nothing in #21319 is a security fix
that DurinDoor silently lacks. The only upstream behavior that changes is UI reachability of two
pre-existing scopes, and DurinDoor's key model has no place to record them.

## Ownership and claims check

Checked before concluding, to avoid duplicating or contradicting a lane:

- **Prior disposition in this repo.** `grep -rn "21319" internal/` matches exactly one line:
  row `O0080` of [2026-11-27-full-parity-refresh.md:1748](2026-11-27-full-parity-refresh.md),
  "Unrecorded at this head; review required". No prior report covers this PR, and
  `grep -rn "mcp:connect" internal/` and `grep -rn "read:compression" internal/` return nothing.
  No unchanged prior disposition was re-derived.
- **Auth lane** (`#2034` provider sign-in parity, `#1241` uc provider, `#1234` syntx provider,
  shared credential lifecycle, provider OAuth, `#2266` combo routing, `#2289` compression):
  `#2289` is DurinDoor issue "[medium] Compression split across three stages and config sources;
  headroom stack engine always assumes OpenAI; dead compact.js" — it concerns the compression
  *pipeline* and *config sources*, and explicitly calls out the dead `open-sse/services/compact.js`.
  It does not concern API-key grants or CCR content read authorization, so it does not overlap
  this PR. `#2266` is the combo-routing architecture review and is likewise unrelated.
- **Sync lane** (`#21435`, `#21432`, `#21426`, `#21412`, `#21425`, `#21427`, `#21349`, `#21433`, and
  9router `#5884` / `#5904` including `usage.js`): none of these target the dashboard API Manager
  key-scope surface or MCP/CCR key grants.
- **No staging exists.** Nothing in the repository stages a `scopes[]` array on the key row, an
  API Manager route, or CCR content read.

There is therefore no overlap to report as claimed or staged, and no duplicate implementation is
proposed.

## Residual note (not a defect)

Two forward-looking observations, recorded so a later port does not rediscover them:

1. If DurinDoor ever lands a CCR retrieve/inspect surface — the current module header defers it
   explicitly ("out of F-1a scope") — it will need an authorization decision for machine callers.
   The principal-scoped store key already in place
   ([`open-sse/services/compression/engines/ccr/index.js:24`](../../../open-sse/services/compression/engines/ccr/index.js#L24))
   is the ownership half of that decision; upstream's `read:compression` is the scope half. That
   work would be new local design, not a port of #21319.
2. If DurinDoor ever replaces the binary `isAdmin` column with a scope array
   ([`src/lib/db/repos/apiKeysRepo.js:156`](../../../src/lib/db/repos/apiKeysRepo.js#L156)), the
   equivalent of upstream's two narrow grants would be a candidate for that migration. Upstream
   #21319 is then a useful UI reference for how those two grants are surfaced, but it remains a
   dashboard-only upstream PR and is not a port candidate for this tree.

## Verification

Static inspection only; no service, provider, credential or gateway was started, and no test or
candidate execution was performed or required (the report's subject is the absence of surfaces).
Every claim above is reproducible from the checkout with read-only commands:

```bash
# Upstream metadata (read-only)
gh api repos/cheaper-inference/OmniRoute/pulls/21319 --jq '{state,merged,head:.head.sha,base:.base.sha,changed_files,additions,deletions}'
gh api repos/cheaper-inference/OmniRoute/pulls/21319/files --paginate --jq '.[] | "\(.status)\t+\(.additions)/-\(.deletions)\t\(.filename)"'

# Local refs, by Git object
git ls-tree -r --name-only origin/main -- 'src/app/(dashboard)/dashboard/api-manager' | wc -l        # 0
git ls-tree -r --name-only 32a783d76d45d90bf0517015442f43fadd96106c -- 'src/app/(dashboard)/dashboard/api-manager' | wc -l   # 0
git grep -l -e 'mcp:connect' -e 'read:compression' origin/main -- src/ open-sse/                      # no output
git grep -l -e 'mcp:connect' -e 'read:compression' 32a783d76d45d90bf0517015442f43fadd96106c -- src/ open-sse/   # no output
git show origin/main:src/lib/db/repos/apiKeysRepo.js | grep -n 'INSERT INTO apiKeys'                  # no scopes column
git merge-base --is-ancestor 32a783d76d45d90bf0517015442f43fadd96106c origin/main; echo $?           # non-zero

# Local surfaces
grep -rn 'ccr\|CCR' src/lib/mcp/control/                                                             # no output
find src/app/api/compression -type f                                                                 # preview/route.js only
grep -rn 'storeBlock' open-sse/services/compression/engines/                                          # ccr/index.js + session-dedup/fuzzy.js
```

No DurinDoor issue, PR, watch or list action was taken for this review, and no production file was
modified.
