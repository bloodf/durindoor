# Combo runtime state and planning (#2266)

This note records how combo routing state is held and where the routing steps live after the #2266 split.

## Module layout

| Module | Owns |
| --- | --- |
| `open-sse/services/combo/runtimeState.js` | The one process-local state object (`getComboRuntimeState`). |
| `open-sse/services/combo/rotation.js` | Round-robin pointers and sticky limits, smooth weighted round-robin, the Efraimidis-Spirakis weighted permutation, the pointer move after a fallback member serves (`recordRoundRobinServed`), and `resetComboRotation`. |
| `open-sse/services/combo/affinity.js` | Conversation pins for sticky round-robin: keys, TTL, per-scope cap, lookup, eviction, reset, and the #6733 release hook (`createAffinityRelease`). |
| `open-sse/services/combo/scoring.js` | Smart Scoring health scores, `getComboModelQuotaHealth`, `getSmartScoredModels`, and `resetComboScoring`. |
| `open-sse/services/combo/planning.js` | `planComboModels`: eligibility, strategy order, context sort, capability auto-switch, required-input filter, task reorder, then the quota and lock rankers. It never dispatches. |
| `open-sse/services/combo.js` | Request-content helpers (capability detection, task classification, conversation keys), the attempt loop in `handleComboChat`, terminal handling, and fusion. |

`combo.js` re-exports every name it exported before, so importers such as `src/app/api/settings/route.js` and `src/app/api/combos/[id]/restore/route.js` are unchanged. It also exports `planComboRequest(options)`, which runs the same plan as `handleComboChat` (including its state updates) without dispatching.

Planning receives the request-content helpers from `combo.js` as an argument rather than importing them, so there is no import cycle. When no task classifier and no ranker is configured, `planComboModels` returns synchronously. `handleComboChat` awaits only a returned Promise, so the first dispatch starts in the same microtask as before the split.

## Runtime-state convention

Combo state follows the convention of `concurrencyGate.js`, `payloadAdmission.js` and `operationalMetrics.js`: one object on a `globalThis.__durindoor*` slot (`globalThis.__durindoorComboRuntime`). Next.js can load more than one copy of a server module in a process (route bundles, the instrumentation hook, dev reloads). Every copy gets the same Maps from `getComboRuntimeState()`, so a reset called from a settings or restore route clears the state the chat route reads. If a copy from an older module version created the object, missing fields are added in place and the object is never replaced.

### Single-process limit

The state is process-local. It is not synchronized between processes, cluster workers, containers or replicas, and it is not persisted. Each process keeps its own rotation pointers, sticky pins and Smart Scoring scores. A reset clears only the process that handled the reset request. Behind a load balancer with several instances, round-robin spreads per instance, a conversation keeps its pin only while it reaches the same instance, and scores start at 100 after a restart. Nothing in this module implies or attempts distributed coordination.

## Conversation affinity bounds

- A pin lives for `CONVERSATION_AFFINITY_TTL_MS` (one hour) after its last use.
- Each caller scope (API key id, or the shared local scope) holds at most `MAX_CONVERSATION_AFFINITY_ENTRIES` (1000) pins. Scopes do not evict each other.
- Each scope keeps an insertion-ordered `Set` of its keys in `affinityScopes`. Using a pin moves it to the end, so the first key is the least recently used.
- An insert walks its own scope from the front, removing expired pins, then removes the oldest live pin while the scope is full. It stops at the first live pin under the cap. The work is proportional to the pins it removes, and a sticky request never walks the whole map.
- A lookup removes an expired pin it finds and treats the conversation as new.
- Expired pins in a scope that receives no new conversations stay in memory until that scope inserts again, the pin is looked up, or a reset runs. Memory stays bounded by scopes × cap. No timer is used.
- `resetComboRotation(name)` scans keys for that combo. Only configuration changes call it, never the request path.

## Behavior kept

The split does not change routing, usage accounting or failover. Rotation and affinity still apply to the eligible pool only. Weighted orders still skip the quota ranker. A failed pinned first member still releases its pin. A served fallback member still moves the round-robin pointer. Accepted-job failures, non-fallback errors, local policy and schema errors, and client aborts still return without trying another member.

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/arch-2266-combo-runtime.test.js --maxWorkers=2
```

`tests/unit/arch-2266-combo-runtime.test.js` covers:

- module copies sharing rotation, weighted, affinity and scoring state, a reset from a copy clearing the original, and an older state object being upgraded in place
- deterministic weighted permutation with an injected random source, 3:1 smooth weighted round-robin planning (`a, a, b, a`) with the quota ranker skipped, sticky conversation planning, and eligibility errors
- expired pins dropped on lookup and trimmed on insert, constant work per insert at the cap with no full-map walk, per-scope caps, and per-combo reset
- cancellation before planning (no rotation advance), during a pending ranker, and during an attempt
- accepted-job failures returned once without replay, and the pointer move after a fallback member serves

The existing combo suites (`unit/combo-*`, `unit/arch-a2266`, `unit/port9r-combo-*` and related) pass unchanged.
