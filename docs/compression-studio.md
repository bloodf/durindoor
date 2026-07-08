# Compression Studio V2

> Ported from `diegosouzapw/OmniRoute` (PRs #3848, #5702, #5727, #5080, #5286,
> #5285, #5289, #5288, #5243, #4645, #4716, #5702, #5739, #5537, #5532,
> #5653, #5527, #5727, and the studio UI surface from PR #3860/#5080/etc.).

The Studio ships a `lite → caveman → ... → hard-budget` stack that the user can
edit from `/dashboard/compression`. It runs **after** the legacy RTK /
Headroom / Caveman / Ponytail dispatchers already in `chatCore.js`. When
`compressionV2.enabled` is true, the new stacked pipeline takes priority and
its per-step breakdown ends up on `engineBreakdown`.

## Layout

| File | Purpose |
| --- | --- |
| `open-sse/services/compression/types.js` | Defaults + JSDoc types. The single source of truth for engines, configs, and CompressionConfig shape. |
| `open-sse/services/compression/stats.js` | Bytes/tokens helpers + `createCompressionStats`. |
| `open-sse/services/compression/lite.js` | Whitespace, system-prompt dedup, tool truncation, image→placeholder. Pure-logic. |
| `open-sse/services/compression/caveman.js` | Rule-based prose replacement. Loaded by the legacy injector AND the V2 engine. |
| `open-sse/services/compression/aggressive.js` | Tool-result truncation + progressive aging + summarizer fallback chain. |
| `open-sse/services/compression/ultra.js` | Tier-A heuristic token pruner (Tier-B LLMLingua left as future work — requires ~+1 GB of model assets). |
| `open-sse/services/compression/ultraHeuristic.js` | `pruneByScore` + STOPWORDS + FORCE_PRESERVE patterns. |
| `open-sse/services/compression/relevance.js` | Jaccard-overlap sentence ranking against the last user query. |
| `open-sse/services/compression/sessionDedup.js` | Cross-turn block dedup with `minBlockChars` / `scope` config. |
| `open-sse/services/compression/hardBudget.js` | Post-pass clamp to a target token / ratio budget. |
| `open-sse/services/compression/engines/types.js` | Per-engine config schema + validation. |
| `open-sse/services/compression/engines/registry.js` | Process-wide engine Map (id → `{engine, enabled, config}`). |
| `open-sse/services/compression/engines/_defaults.js` | Per-engine config schemas used by the Studio UI. |
| `open-sse/services/compression/engines/builtins.js` | Concrete engine objects (`rtkEngine`, `cavemanEngine`, `liteEngine`, `ultraEngine`, `aggressiveEngine`, `relevanceEngine`, `sessionDedupEngine`, `hardBudgetEngine`, `headroomEngine`). |
| `open-sse/services/compression/engines/index.js` | `registerBuiltinCompressionEngines()` — the install-once idempotent entrypoint. |
| `open-sse/services/compression/engineCatalog.js` | Static metadata (stack priority, level selector, description) for the UI. |
| `open-sse/services/compression/stackedPipeline.js` | The orchestrator. Runs each engine in `stackPriority` order, tracks `breakdown`, applies hard-budget post-pass, returns aggregated `stats`. |
| `open-sse/services/compression/telemetry.js` | Fire-and-forget fetch helper. chatCore calls it on every V2 dispatch. |

### Engine registry contract

```js
// engines/_defaults.js
export function liteSchema() { return [ /* EngineConfigField[] */ ]; }
export function validateLiteConfig(config) { /* EngineValidationResult */; }
```

Each engine in `engines/builtins.js` implements:

```js
export const liteEngine = {
  id: "lite",
  name: "Lite",
  description: "...",
  icon: "tune",
  targets: ["messages", "tool_results"],
  stackable: true,
  stackPriority: 5,
  metadata: { /* CompressionEngineMetadata */ },
  apply(body, options) { return { body, changed, stats, warnings }; },
  compress(body, config = {}) { return this.apply(body, { stepConfig: config }); },
  getConfigSchema() { return liteSchema(); },
  validateConfig: validateLiteConfig,
};
```

Engines that throw inside `apply()` are logged as `engine-error:<id>:<msg>` and
skipped; the pipeline keeps going. `stackable: false` engines (Headroom) are
not dispatched by `stackedPipeline` because their proxy call already runs in
the surrounding chatCore block.

### Settings store

`compressionV2*` fields live in the standard `settings` row. Defaults:

```
compressionV2Enabled: false
compressionV2Mode: "stacked"
compressionV2Stack: [{ engine: "rtk", intensity: "standard" }, { engine: "caveman", intensity: "full" }]
compressionV2Engines: { lite: { enabled: false }, ...each engine has its own toggle }
compressionV2HardBudget: { enabled: false, targetTokens: 0, targetRatio: 0, dropOrder: [...] }
compressionV2AutoTriggerTokens: 0
compressionV2PreserveSystemPrompt: true
```

The legacy `rtkEnabled` / `cavemanEnabled` / `headroomEnabled` / `ponytailEnabled`
flags are kept verbatim — installs that don't enable V2 see zero behaviour
change.

### Endpoints

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/compression/settings` | GET / PATCH | Read & patch the V2 surface. PATCH whitelist: `compressionV2*` keys. |
| `/api/compression/engines` | GET | Catalog with per-engine config schemas. Powers the Studio dropdowns. |
| `/api/compression/preview` | POST | Dry-run the pipeline against an arbitrary payload. Accepts `mode: "caveman"` as alias for stacked+caveman (OmniRoute PR #6425). Returns per-engine breakdown and surface substitutions (`PR #6461 / #6463`). |
| `/api/compression/telemetry` | GET | Aggregates over the in-memory ring. |
| `/api/compression/telemetry/record` | POST | Fire-and-forget deposit used by chatCore. |

### Studio UI

`/dashboard/compression` page renders the pipeline editor. Modes: off / lite /
standard / aggressive / ultra / rtk / stacked / caveman (the last two are
alias-only — selecting "stacked" runs the configured stack; selecting
"caveman" runs `{caveman-intensity=full}` only).

`/dashboard/compression/live` shows real-time per-engine savings, total bytes
saved and recent runs (10-second auto-refresh). Reads from
`/api/compression/telemetry` (in-memory ring buffer populated by
chatCore → recordV2Telemetry → POST /telemetry/record).

### Wire-up

```js
// src/sse/handlers/chat.js
const result = await handleChatCore({
  // ...
  compressionV2: chatSettings.compressionV2Enabled
    ? {
        enabled: true,
        mode: chatSettings.compressionV2Mode,
        stack: chatSettings.compressionV2Stack,
        preserveSystemPrompt: chatSettings.compressionV2PreserveSystemPrompt,
        config: {
          stackedPipeline: chatSettings.compressionV2Stack,
          engines: chatSettings.compressionV2Engines,
          hardBudget: chatSettings.compressionV2HardBudget,
        },
      }
    : { enabled: false },
});
```

### Tests

- `tests/unit/compression-v2.test.js` — 18 unit tests across lite, caveman,
  relevance, session-dedup, hard-budget, aggressive, ultra heuristic, engine
  registry, stacked pipeline orchestrator.
- Existing `tests/unit/rtk.test.js`, `tests/unit/caveman-prompts.test.js`,
  `tests/unit/rtkKiro.test.js`, `tests/unit/headroom-chat-core.test.js` all
  unchanged — V2's chatCore patch only adds a new dispatch path that doesn't
  fire when `compressionV2.enabled` is false.
