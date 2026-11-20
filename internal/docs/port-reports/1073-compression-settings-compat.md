# 1073: Compression engine settings compatibility (partial writes, legacy precedence)

Checked 2026-11-20 against DurinDoor `a1b31ccf66ff62fe056f2865089c250b6d60360f`.

Sources reviewed (upstream OmniRoute, merged, read-only metadata):

- [OmniRoute #15613](https://github.com/cheaper-inference/OmniRoute/pull/15613), head `15ec6049b2cf0831e805dcb596c59adbb3a37da3`, merge `e1e92309aa37fa226f4749721049eebd190e0e0e`, merged 2026-10-06: **ported (adapted)**. Upstream stops replacing the whole `engines` JSON row on a partial write and merges the written entries over the stored row, entry by entry and field by field, so a write that carries one engine never drops the engines it did not mention.
- [OmniRoute #15607](https://github.com/cheaper-inference/OmniRoute/pull/15607), head `2b29ec744d439a994f80853d12d89a2980594569`, merge `ed9188f9cc43b2778e78172e31508e925da85a89`, merged 2026-10-06: **not applicable**. Upstream's legacy/current shadowing needs two rows for the same engine (`caveman` vs `cavemanConfig`, `headroom` vs `headroomConfig`, …) read from one unordered namespace. DurinDoor has no such pair: every compression setting lives in a single settings row, so there is no second key that can shadow the current value.
- [OmniRoute #15601](https://github.com/cheaper-inference/OmniRoute/pull/15601), head `8c3d46652f4a7cb2d0791945f8f19b48f2985141`, merge `38a266046f8eaebd82149318165ec56f4af11ea6`, merged 2026-10-06: **not applicable**. It removes an unreachable `aggressiveEnabled` fallback inside upstream's legacy-derived engines map. DurinDoor never derives the map from legacy per-engine config blocks; the map is explicit in settings (`compressionEngines`) and `aggressive` is a metadata-only catalog entry (`available: false`), so the helper has no counterpart here.
- [OmniRoute #15605](https://github.com/cheaper-inference/OmniRoute/pull/15605), head `42f0139ff6e8a7966cd725fba207113941f8e640`, merge `5a82a1c048b32e5864061dcbe19e9dfd2bb74b37`, merged 2026-10-06: **not applicable**. It removes a dead "Preserve system prompt" checkbox from upstream's per-engine configuration pages. DurinDoor ships no per-engine configuration form (no engine pages, no schema-driven engine form); its engines read `preserveSystemPrompt` from the global compression config, and per-engine options are forwarded only when the engine declares them in `getConfigSchema()` (`lite`: `truncateToolResults`, `maxToolLength`; `caveman`: `intensity`, `minMessageLength`). There is no dead checkbox to remove.
- [OmniRoute #15603](https://github.com/cheaper-inference/OmniRoute/pull/15603), head `cafe3b31afd42e868fc4189515997d876518ea4b`, merge `5e2968b8379b090cf54ab0e9982df5575edae90c`, merged 2026-10-06: **not applicable**. It stops flooring the CCR engine's `retrievalRampFactor` on read. DurinDoor has no CCR engine: `ccr` is a catalog placeholder (`available: false`), `retrievalRampFactor` appears nowhere in this tree, and no CCR configuration is stored.

## Fork state that made the port necessary

The fork's compression stack is configured by ONE per-engine map in the settings row:

- Field: `compressionEngines` — `{ [engineId]: { enabled, level?, ...engine options } }` (`src/lib/db/repos/settingsRepo.js`, default `{}`).
- Reader: `src/sse/handlers/chat.js` passes the map to the chatCore seam; `open-sse/handlers/chatCore/compressionHook.js` turns it into a plan (`deriveDefaultPlan`) and dispatches the engines, gating every step on `isEngineAvailable()`.
- Writers: `PATCH /api/settings` (`src/app/api/settings/route.js`) and the MCP control tool `update_settings` (`src/lib/mcp/control/tools.js`) both land in `updateSettings()`, which merged top-level keys with a plain spread. A write carrying one engine therefore REPLACED the whole map: every sibling engine, every sibling's `level`, and every sibling's options (for example `lite.maxToolLength`) were dropped by a write that never mentioned them. A second surface (or a client that had not loaded the map) could silently turn engines off.

That is the same loss upstream fixed in #15613, expressed in the fork's own store and its own field.

## What was ported

Adapted semantics of #15613 to the fork's settings store; no upstream file was copied verbatim.

- `src/lib/db/repos/settingsRepo.js`: new exported `mergeCompressionEngines(stored, incoming)` and the internal `applyCompressionEnginesMerge(current, updates)` helper, applied inside the transaction of both `updateSettings()` and `updateSettingsWithPasswordEpoch()`.
  - Engines the write does not mention keep their stored entry.
  - An engine the write does mention is merged field by field, so a write that only flips `enabled` keeps the stored `level` and the stored per-engine options.
  - An explicit `null` field clears that one field.
  - The map is never widened: a merge adds no engine, and an unavailable catalog entry stays unavailable (`isEngineAvailable()` still gates dispatch).
  - A write whose `compressionEngines` value is not a map carries no engine information and keeps the stored map instead of replacing it.
- `src/app/api/settings/route.js`: `PATCH /api/settings` rejects a `compressionEngines` value that is not a map of per-engine records with `400 Invalid compressionEngines`, so an unusable value is refused instead of stored. Every other setting key keeps its existing top-level replace semantics.
- `docs/features/compression.mdx` and `internal/docs/product/features/compression.mdx`: document that a `compressionEngines` write is a partial patch merged per engine id.

Preserved unchanged: the `compressionEnabled` master switch, the global compression policy (fidelity gate, adaptive context budget), the legacy dedicated savers (`cavemanEnabled`/`cavemanLevel`, `ponytailEnabled`/`ponytailLevel`, `rtkEnabled`, `headroomEnabled`, PXPIPE) and their precedence over the stack, the stored defaults, and the user overrides already on disk. No engine was enabled, no schema, surface, endpoint, provider or integration was added, and epic #1062 was not touched.

## Upstream-only compression engines that have no counterpart here

| Upstream item | Fork state |
| --- | --- |
| `aggressive`, `ultra` engine config pages and per-engine `preserveSystemPrompt` field | No per-engine config page; `aggressive`/`ultra` are catalog placeholders (`available: false`). |
| `ccr` engine with `retrievalRampFactor` | No CCR engine; `ccr` is a catalog placeholder. No `retrievalRampFactor` anywhere in the tree. |
| `llmlingua`, `relevance` engines | Catalog placeholders only (`available: false`); never dispatched. |
| Legacy per-engine config rows (`cavemanConfig`, `headroomConfig`, `aggressiveConfig`, `ultraConfig`) and the `defaultMode` derived-map fallback | Not present: the fork has a single settings row and no derived-map path. |
| `compression` key-value namespace with one row per setting (`src/lib/db/compression.ts`) | Not present: the fork stores compression settings in the shared settings row. |

## Regression coverage

`tests/unit/compression-settings-compat-1073.test.js` (new, offline: temp `DATA_DIR`, no provider, no network, no dashboard):

- a write carrying one engine keeps the stored sibling engines, levels and options;
- a toggle on one surface survives another surface writing a different engine;
- a write that only sets `enabled` keeps the stored `level` and the stored `lite` options;
- a fresh install stores exactly the written engine (the merge does not widen the map);
- a non-map value keeps the stored map;
- a write without `compressionEngines` leaves the map untouched;
- an unavailable catalog engine (`aggressive`) stays unavailable and is never dispatched by the seam.

Run from `tests/`:

```
node node_modules/vitest/vitest.mjs run --maxWorkers=2 \
  unit/compression-settings-compat-1073.test.js \
  unit/compression/registry.test.js \
  unit/compression/caveman.test.js
```

3 files, 26 tests passed (the new file contributes 7 of them). The new file fails 4 of its 7 cases when the merge is disabled, so it pins the fixed behavior rather than the previous one. Root lint (`npm run lint`) is green: eslint plus the anti-slop gate, 0 diagnostics across 2676 files. Full suite remains reserved for the integration gate.

## Residual notes

- An empty `compressionEngines` write is a no-op under merge semantics; there is no "clear the whole map" write. Disable an engine by writing `{ enabled: false }`, or drop an engine by writing `null` for that engine id.
- `updateSettings()` callers that pass a function still see the raw stored row (unchanged behavior); the merge is applied to the resolved patch.
- The MCP `update_settings` tool keeps its current contract (a partial settings object); it now benefits from the same merge, and an invalid `compressionEngines` value leaves the stored map intact rather than raising.
