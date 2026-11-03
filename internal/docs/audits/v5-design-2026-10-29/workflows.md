# Visant workflow audit — source review

Date: 2026-10-29. Target: DurinDoor branch `codex/v5-admin-storybook`. Skill source: `visant-skills-public` pinned `fe555cf`, using `visant-frontend`, its work/trust surface guidance, and Killer's slop catalog/devil's advocate. Read-only product review; no product changes. Browser layout/behavior not verified by this reviewer. Findings below are confirmed implementation paths, with runtime consequences to reproduce in Storybook; they are not claims that live providers were contacted.

## Surface classification and inventory

User role: gateway operator administering connections, routing, and access. Persuasion is noise in B and irrelevant in C. Preserve every existing capability; hide advanced controls progressively, never delete them to improve density.

| Route or region | Class | Business variable / operator decision | Persuasion |
|---|---|---|---|
| `/dashboard/combos` inventory, member picker | B | Time to select a usable routing chain; model/capability decision accuracy | None needed |
| Combo create/edit, weights, limits, strategy, timeout, allow-list | C | Routing correctness; saved configuration matches the operator's intent | None |
| `/dashboard/providers` and provider detail inventory | B | Find failing connections and restore usable capacity | None |
| Provider connection enable/disable, auto-sync, error rules, available-model controls | C | Requests route only through intended accounts and catalogs | None |
| `/dashboard/keys` list | B | Locate the key consuming or granting access | None |
| Key create/reveal, pause, revoke, model grants, limits, groups | C | Access control correctness and recovery from mistakes | None |
| `/dashboard/endpoint` endpoint list, local/cloud/tailnet status | B | Choose a reachable endpoint | None |
| Endpoint exposure and authentication controls | C | Exposure matches security intent | None |
| `/dashboard/proxy-pools` list and health check | B | Identify usable egress and failed pools | None |
| Proxy edit/import/deploy/disable/delete | C | Egress configuration accuracy and reversibility | None |
| `/dashboard/mcp-gateway` instance list/testing | B | Discover usable tools and failed upstreams | None |
| MCP instance configuration and `/dashboard/mcp-gateway/keys` grants/revocation | C | Tool-access scope and credential correctness | None |
| `/dashboard/cli-tools`, `/dashboard/cli-tools/[toolId]` | B/C | Configure the intended endpoint/model/key without losing working tool settings | None |
| `/dashboard/media-providers/[kind]`, `/[kind]/[id]`, `/web`, `/combo/[id]` | B/C | Select functioning media services, then save correct account/routing settings | None |

## Confirmed defects

### W1 — P1: Provider enable/disable can report success after every write fails

**Evidence:** `src/app/(dashboard)/dashboard/providers/page.js:231-247` updates every matching connection locally, awaits `Promise.allSettled`, and never inspects an HTTP response or rejection. Same path in `src/app/(dashboard)/dashboard/media-providers/[kind]/page.js:120-134`; its card switch reads that optimistic state at `src/app/(dashboard)/dashboard/media-providers/components/MediaProviderCard.jsx:57-63`.

**Impact:** A rejected disable leaves the UI visibly disabled while the server can keep routing through the accounts. Partial failures are also painted as complete success. This is a trust defect, not a taste preference. Source-backed in v5: these pages are not replaced by the preview plugin.

**Fix:** Check every `Response.ok`, retain per-connection outcomes, reconcile from server, restore failed rows and show an inline failed/partial state with Retry. Lock one provider's toggle during its operation. Story: 500 for every write; mixed 200/500; rejected network; late response after another toggle.

### W2 — P2: Service outages appear as missing configuration across several integrations

**Evidence:**
- Providers: `src/app/(dashboard)/dashboard/providers/page.js:155-180` logs failures and clears loading with the initial empty connections/node lists.
- Proxy pools: `src/app/(dashboard)/dashboard/proxy-pools/page.js:81-93` ignores non-OK responses, only logs network failure, then clears loading.
- Media kind: `src/app/(dashboard)/dashboard/media-providers/[kind]/page.js:73-102` swallows provider/node/embedding fetch errors; initial empty lists supply card states.
- Web providers: `src/app/(dashboard)/dashboard/media-providers/web/page.js:112-120` silently retains initial empty connections/combos.
- CLI detail: `src/app/(dashboard)/dashboard/cli-tools/[toolId]/ToolDetailClient.js:34-59` treats failed settings/keys/provider loads as initial empty/default data and renders configuration cards (`:101-114`, `:158`).

All paths above have absolute prefix ``.

**Impact:** The operator is told there are no connections/pools/keys or sees local/default endpoint settings when the product does not know. They can waste time recreating configuration or configuring a tool with the wrong endpoint. Existing CLI index load error (`CLIToolsPageClient.js:56-60`) is an exemplar worth reusing, not a universal fix already applied.

**Fix:** Distinct persistent load-error regions and Retry, separate required from optional dependencies, preserve last-known records with an explicit stale label, block edits whose required data is unknown. Stories for HTTP 500, malformed JSON, rejected network, and successful retry, on each affected page family.

### W3 — P2: MCP Keys discards an error state its shared hook already supplies

**Evidence:** `src/app/(dashboard)/dashboard/mcp-gateway/shared.js:64-76` records error and clears items. `src/app/(dashboard)/dashboard/mcp-gateway/keys/McpGatewayKeysPage.jsx:27` does not consume `error`; `:72` always passes only keys/loading to `KeysPanel`. `src/app/(dashboard)/dashboard/mcp-gateway/McpGatewayComponents.jsx:71-72` paints “No gateway keys yet” when keys are empty.

**Impact:** Even when an error toast fires, the persistent page contradicts it and offers a creation action instead of a recovery path. Error-boundary stories do not exercise a handled fetch failure.

**Fix:** Consume the hook error; render load failure and Retry in the collection region. Use the existing grants modal's distinct loading/error/empty treatment (`McpGatewayComponents.jsx:117-126`) as the behavioral reference.

### W4 — P2: Combo allow-list rejects a save silently

**Evidence:** `src/shared/ui/v5/combos/ReviewCombosPage.jsx:223-229` returns `{ok:false,error}` on rejected updates. The allow-list callback at `:544-546` awaits and discards that result. `src/app/(dashboard)/dashboard/combos/ComboAllowListEditor.jsx:59-65` clears its saving state without displaying errors.

**Impact:** Adding/removing a routing restriction can simply do nothing, with no explanation near the action. A user cannot distinguish pending, rejected, and accepted state. Group quick-add and remove chips are not disabled while saving (`:118`, `:123-131`), enabling overlapping writes from the same old list.

**Fix:** Return a successful result or throw; render the failure adjacent to the chips with Retry and preserve intended draft. Serialize list mutation. Stories: rejected Add connection, rejected Clear, partial/rapid edits, successful retry/read-back.

### W5 — P2: API-key revocation closes the dialog before the outcome and ignores failed responses

**Evidence:** `src/app/(dashboard)/dashboard/keys/KeysPageClient.jsx:458-471` closes confirmation at the start, removes a row only on OK, ignores non-OK, and only logs a network failure. Toggle failures similarly lack feedback at `:476-488`.

**Impact:** A failed revocation returns the user to the list without explaining that access remains active. This is especially costly on a credentials trust surface.

**Fix:** Pending confirmation; prevent dismissal/repeated mutation; keep it open with an actionable error on failure, reconcile only after accepted deletion. The row should announce success or failure. Story: non-OK delete, dropped network, pending delete, recovery.

### W6 — P2: Gateway key minting has no pending state or submission guard

**Evidence:** `src/app/(dashboard)/dashboard/mcp-gateway/McpGatewayComponents.jsx:48-55` calls `onCreate` without awaiting it; footer keeps Create and Cancel enabled. `src/app/(dashboard)/dashboard/mcp-gateway/keys/McpGatewayKeysPage.jsx:40-44` has no guard and calls POST each time. The request has no local catch for a network rejection.

**Impact:** Double-click or repeated Enter can mint multiple credentials; the last response wins the “created key” dialog. Cancel can close the name dialog while a new credential is still being minted.

**Fix:** One guarded async submission, disabled/pending action, modal pending lifecycle, in-dialog error and retry. Extend the keyboard story with delayed response, double-submit, rejected network, and read-back of exactly one created key.

### W7 — P2: Combo timeout is a remote write on every keystroke with no ordering protection

**Evidence:** `src/shared/ui/v5/combos/ReviewCombosPage.jsx:696-700` sends updates for each onChange (clearing also sends zero). Handler `:319-335` builds the whole settings map from a closure; `:239-249` independently PATCHes it and commits each response. No pending/sequence/serialization guard exists for timeout or strategy changes.

**Impact:** Delayed requests can overwrite later timeout/strategy changes. Typing a multidigit value can render old acknowledged values while the operator is still entering the new one. This threatens the value the visual control promises, independently of input width.

**Fix:** Local field draft, validate and commit on explicit save/blur with a serialized update; display saving/saved/error for that row. Ensure updates to two combos merge rather than overwrite. Story: deliberately reverse response completion order, type 12 after 9, then verify final persisted timeout is 12000.

### W8 — P2: Endpoint authentication controls render defaults when their settings could not load

**Evidence:** `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.jsx:88-91` initializes plausible Boolean settings. `:255-290` silently skips failed settings/status responses and logs rejected network; `:145` clears loading anyway. Security writes `:294-317` likewise ignore non-OK and only log network failure.

**Impact:** UI cannot tell an unknown authentication/exposure state from the initial default, and rejected security changes have no actionable feedback. This report does not claim a server authorization bypass; the confirmed issue is misleading administrative state.

**Fix:** Represent unknown/loading/error separately, show persistent retry, make dependent exposure controls unavailable until settings are known, display write rejection at the control. Story: settings500/status200, settings200/status500, rejected settings PATCH.

## Design proposals — not defects

1. **Hide:** Collapse the ten optional capability overrides and two blank limits in combo create/edit behind a “Capabilities & limits” disclosure, auto-open when existing overrides exist. Current always-open block is `ReviewComboFormModal.jsx:376-398`. Benefit is a shorter path from selecting members to saving; all capability features remain available. Exact pixel savings require browser measurement.
2. **Compact:** Model picker has a border under every row (`combos.css:30`) and repeated context/output metadata under each model (`CapabilityIcons.jsx:8-10`). Keep capabilities that actually differentiate candidates, group by provider, promote selection state, and expose full details on demand. User explicitly requires explanatory icon tooltips; preserve those. Do not turn obscure routing strategies into unexplained icons.
3. **Hide:** Move destructive row actions into a labeled overflow menu, retaining copy/edit visible. Current combo Delete sits adjacent to Copy/Edit (`ReviewCombosPage.jsx:709-730`); confirmation mitigates accidental execution, so this is a misclick-risk proposal rather than a current deletion bug.
4. **Compact:** Auto-sync adds zero-valued Added/Removed columns even before any changes (`ReviewAutoSyncCard.jsx:79-84`). Suppress empty change breakdowns, keep actual model count and last-sync status, show change list only when meaningful. Avoid removing the card the user requested.
5. **Do not hide:** Active routing restrictions, pending and failed writes, actual credential scope, unavailable provider models, and currently applied strategy. These govern the operator's next decision.

## Feature preservation and review gaps

- Confirmed preserved in source: combo reorder (drag, keyboard sensor, explicit arrows), per-member weights, all six strategy values, fusion judge, model capabilities/limits, group/connection allow-list, clone/copy/delete; picker supports active providers, no-auth providers, custom models, aliases, auto-synced catalogs, OrcaRouter, typed media kinds, hide-paid filtering; auto-sync has toggle/manual sync, catalog-change list, errors, unsupported/no-connection cases. No confirmed feature deletion found in this source sample.
- The preview replaces combo page/form/model picker and provider sync card (`.storybook/main.js:61-86`); many other pages remain source-backed with global review adaptations. A complete design review must include those legacy flows, not only the custom redesign stories.
- Existing v5 combo stories cover success/error/pending and read-back, but do not cover delayed or overlapping persistence, rejected allow-list mutation, failed provider bulk toggle, or network outage for every catalog dependency. Proxy stories include mutation errors but no initial list fetch-error story (`proxy-pools/page.stories.jsx:49-154`). Media kind page has only Default and OpenAddCustomEmbeddingModal. These are concrete coverage gaps, not a claim that all existing stories fail.
- Source styles demonstrate responsive breakpoints and shared controls, but this reviewer did not measure 390px document overflow, screenshot both themes, test forced colors/zoom, or operate dropdowns/modal focus. Browser evidence is required before declaring those gates passed.
- No backend/real-account/network runtime or production behavior was exercised. Source findings can be covered with synthetic Storybook fixtures without touching accounts.

## Devil's advocate / delivery decisions

- **Who needs this?** Gateway operators need these work and trust surfaces; removing features to eliminate visual complexity would violate the brief. Reduce incidental chrome instead.
- **What lies?** W1–W8 show state/intent mismatches. Correctness has greater leverage than a fresh palette.
- **Reinvention (F1):** Reviews reuse Button/Input/Select/Modal/Toggle/Checkbox and provider logos. Large replacement page/catalog copies create drift risk; preserve contracts and add parity assertions before promoting to production.
- **Consistency (F2):** Shared `dd-*` tokens are present. This reviewer did not run detector or visual side-by-side token checks; root audit owns them.
- **Responsive/performance (F3):** Not verified here. Do not infer performance or mobile readiness from breakpoints.
- **Flow (F4):** Inventory → find/choose resource → edit/select members → save → acknowledge/read back. Failure at the last two steps is the largest current drop-off risk.
- **Compact/icon (F5):** Above proposal table preserves important restrictions; no invented numeric pixel saving without measurement.
- **Highest leverage (F6):** (1) truthful loading and error states across integrations, medium effort/high leverage; (2) confirmed/serialized mutations with in-place failure recovery, medium effort/high leverage; (3) optional advanced-form disclosure, small effort/medium leverage. Keyboard, focus, motion, and mobile status remain unverified rather than marked complete.
- **Three-month regret:** Polishing an attractive false “disabled” or “empty” state while leaving persistence failures invisible would repeat the user's central concern. Gate rollout on state truth and feature parity before cosmetic convergence.
