# Compression engine stack

The compression stack reduces outbound prompt size **after translation, before
provider dispatch**. It runs **after** RTK/Headroom and **before** caveman/pxpipe
injection inside `handleChatCore`, operating on `translatedBody`. The single
execution path is `runCompressionSeam`
(`open-sse/handlers/chatCore/compressionHook.js`); there is no parallel inline loop.

## Available engines

These engines ship a real implementation in this tree:

| Engine | What it does |
|---|---|
| `session-dedup` | Cross-turn block deduplication (exact + fuzzy near-duplicate folding). |
| `caveman` | Rule-based filler/verbosity stripping (`caveman.js`). |
| `headroom` | Headroom-engine adapter (`engines/headroomAdapter.js`); runs its own enabled/config gating. |

The catalog (`engineCatalog.js`) also names other OmniRoute engines
(`ccr`, `lite`, `rtk`, `relevance`, `aggressive`, `llmlingua`, `ultra`) as
**metadata-only placeholders** with `available: false`. They appear in listings
and validation errors but are never dispatched: `isEngineAvailable(id)` is
`false` and `getEngine(id)` throws `Unknown compression engine`. Heavy engines
(`llmlingua`/`onnxruntime`, omniglyph context-as-image) are intentionally
excluded from this tree.

## Configuration

Compression is opt-in via two settings, mirrored from the existing token-saver
settings mechanism:

- `compressionEnabled` (boolean) — master toggle. When `false`,
  `runCompressionSeam` returns the body untouched and emits no header.
- `compressionEngines` (map) — per-engine config, e.g.
  `{ caveman: { enabled: true }, "session-dedup": { enabled: true } }`.

`deriveDefaultPlan(engines, compressionEnabled)` turns the toggle map into a
plan; `resolveAdaptivePlan` escalates it under context pressure (mode `"off"`
today — neutralized; the resolved plan equals the base plan). `planToEngineIds`
orders the plan for the loop.

## Preview endpoint

`POST /api/compression/preview` dry-runs every catalog engine against an
arbitrary JSON body and reports a per-id status:

```json
{
  "engines": ["session-dedup", "ccr", "headroom", "caveman", ...],
  "results": {
    "caveman":   { "status": "compressed", "compressed": true,  "savingsPercent": 45.0,
                   "fallbackReasons": [], "skippedReasons": [], "fallbackReason": null },
    "headroom":  { "status": "unchanged",  "compressed": false, "savingsPercent": 0,
                   "fallbackReasons": [], "skippedReasons": [], "fallbackReason": null },
    "llmlingua": { "status": "unavailable" }
  }
}
```

Status values:

- `compressed` / `unchanged` — engine is available and ran; `compressed` and
  `savingsPercent` describe the outcome. When the engine fell back
  (`stats.fallbackApplied`), `fallbackReasons` lists the deduped reasons
  (`validationErrors` plus `pipeline-inflation-guard:*` warnings),
  `fallbackReason` is the pipeline's canonical reason or the first entry, and
  `skippedReasons` mirrors `fallbackReasons` (OmniRoute #6461 / PR #6519).
  Non-fallback runs report `[]` / `[]` / `null` — zero change on the happy
  path, even when warnings exist.
- `unavailable` — catalog placeholder not shipped here; the engine is **not**
  dispatched.
- `error` — engine is available but `apply()` threw (kept distinct from
  `unavailable`).

Auth matches the other `/api` routes (API key when `requireApiKey` is set).

## Response header

When at least one available engine actually changes the body, the chat response
carries:

```
X-DurinDoor-Compression: <engineId>[,<engineId>...]|<overallSavingsPercent>%
```

Only engines that both reported `compressed: true` **and** changed their step's
body are listed; a no-op `compressed: true` clone is not advertised. The
percentage is overall stack input-vs-final-output (not a sum of per-engine
percentages). Disabled, no-op, and upstream-error responses emit no header.

## Fail-open contract

Compression never breaks a request:

- Planning throw → original body, no header.
- Per-engine throw / malformed result / unavailable id → that step rolls back,
  the loop continues.
- Catastrophic seam failure → chatCore restores the pre-stack snapshot and emits
  no header.

Engines never mutate the caller's body; each step works on a fresh value.
