# Combo context-requirements target filtering (OmniRoute port)

Ported from **`diegosouzapw/OmniRoute` PR #6907** — `feat(combo): context requirements config target filtering` (merged, author @oyi77).

> **Source-mapping note.** This port is tracked under branch `port/omniroute-6905`
> (the import plan's row "6905 — combo context-requirements config target filtering").
> That plan row's *title* belongs to this feature, but the live upstream PR **#6905**
> is a different change (relay `buildOpenAISummary` tool_call delta merge — covered by
> a separate port row). The actual upstream source for the combo context-requirements
> feature is **PR #6907**. The code, config schema, and tests below all derive from
> #6907; nothing here claims live #6905 supplied the combo change.

## What it does

Adds an optional per-combo `contextRequirements` config that filters and orders a
combo's chat targets by model context-window size.

```json
{
  "comboStrategies": {
    "auto/my-combo": {
      "contextRequirements": {
        "minContextWindow": 128000,
        "preferLargeContext": true,
        "contextFilterMode": "lenient"
      }
    }
  }
}
```

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `minContextWindow` | integer `0..10_000_000` | unset | Drop models whose known context window is below this. |
| `preferLargeContext` | boolean | `false` | Sort targets by context size, descending. |
| `contextFilterMode` | `"strict" \| "lenient"` | `"lenient"` | How to treat models with **unknown** context window. |

- **lenient** (default): keep known models `>= min`, **keep** unknown-context models.
- **strict**: keep known models `>= min`, **drop** unknown-context models.
- Runtime fail-open: at dispatch time any `contextFilterMode` value other than the exact
  string `"strict"` is treated as lenient. This is a defensive guard for already-persisted
  or otherwise unvalidated data — the settings PATCH API (below) accepts **only**
  `"strict"` or `"lenient"` and rejects anything else, so a stored value outside that enum
  can only predate validation or come from a non-API writer.

## Pipeline placement

Two coordinated stages in `handleComboChat` (`open-sse/services/combo.js`):

1. **Eligibility filter** (`filterByContextRequirements`) runs **before** rotation /
   scoring, so the round-robin pointer, sticky rotation, smart-scoring, and
   conversation-affinity state are all computed over the **eligible** pool. This is a
   deliberate deviation from upstream's single late call: durindoor keeps local
   round-robin/affinity state, and a single late filter would let the pointer land on
   an excluded member and skew the survivor sequence. The empty-pool 503
   (`no models matching context requirements`) fires here.
2. **Preference sort** (`sortByContextSize`) runs at **upstream #6907's pipeline
   point** — on the rotated targets, **before** capability-aware auto-switch reordering
   and **before** task-aware reordering. This ordering keeps `preferLargeContext`
   as a dispatch preference while still letting hard-capability models (vision, PDF,
   audio, video) move to the front when the request needs them. The incoming
   (strategy) order is the stable tiebreak; unknown-context models sort to the end.

**Precedence.** Task-aware reordering (smart/task strategies) runs after the sort and
may reorder survivors; quota ranking runs last. `preferLargeContext` sets a context
preference, not a hard guarantee, when those higher-priority stages are active.

When no requirement is configured both stages return the **same array reference**, so
existing fallback order is completely untouched.

## Known-only context resolution

`getKnownContextWindow` deliberately does **not** use `getCapabilitiesForModel()`:
that resolver always merges `DEFAULT_CAPABILITIES.contextWindow` (200000) and would
make every unknown model look "known", breaking strict/lenient. Only explicit,
authoritative values are trusted, in order:

1. provider registry entry — `models[].contextLength`, then `defaultContextLength`, then
   `transport.defaultContextLength` (provider alias resolved to its canonical registry id
   first, so `ghm/openai/gpt-4.1` resolves like `github-models/openai/gpt-4.1`);
2. an exact-id or glob-pattern capability that declares `contextWindow`
   (first matching pattern stops the search — matches `getCapabilitiesForModel`
   first-match semantics, so a first pattern with no `contextWindow` means "unknown",
   not "scan further").

Anything else returns `null` (unknown).

## Configuring

Configuration is **PATCH-only** — there is no dashboard editor for `contextRequirements`
yet (the combos page has no such field). Set it via the settings API:

```
PATCH /api/settings
{ "comboStrategies": { "<comboName>": { "contextRequirements": { ... } } } }
```

> **Merge first.** `updateSettings` persists the request body's `comboStrategies`
> object as the whole map — it does **not** deep-merge with the stored
> `comboStrategies`. Build the PATCH body from the current settings (read via
> `GET /api/settings`) with your one combo edited, or every *other* combo's strategy
> config is dropped from settings.

`src/app/api/settings/route.js` validates it against the upstream schema
(`z.coerce.number().int().min(0).max(10_000_000)` for `minContextWindow`, boolean
`preferLargeContext`, enum `contextFilterMode`, unknown keys rejected). A numeric
string `minContextWindow` is coerced to a number before persistence; an explicit
`null` `contextRequirements` is rejected (only an absent key skips validation).

## Files

- `open-sse/services/combo/contextRequirements.js` — resolver + filter + sort (new).
- `open-sse/services/combo.js` — pipeline wiring in `handleComboChat`.
- `src/sse/handlers/chat.js` — passes `perCombo.contextRequirements` into chat combo calls.
- `src/app/api/settings/route.js` — settings PATCH validation.

## Tests

- `tests/unit/combo-context-requirements.test.js` — match/mismatch/absent controls,
  alias resolution, first-match-pattern lock-in, preferLargeContext dispatch order,
  exact survivor round-robin sequence, 503 empty pool, order preserved when unset.
- `tests/unit/settings-context-requirements.test.js` — settings PATCH validation
  (accept valid / coerce numeric string / reject invalid, unknown key, null, out-of-range).
