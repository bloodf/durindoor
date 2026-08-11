# Upstream PR Port — #3231 (2026-08-11)

[`decolua/9router#3231`](https://github.com/decolua/9router/pull/3231) was still
OPEN when ported. Verified against the live fork before implementing, matching
the D1 batch's bar rather than waiting for the merged diff. Anchors live in
[`docs/UPSTREAM_SYNC.md`](../UPSTREAM_SYNC.md).

| PR | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| [#3231](https://github.com/decolua/9router/pull/3231) `fix(qoder): force-add cmodel (Cantus) when missing` | PORTED | `open-sse/services/qoderModels.js` only reads `body.chat`; when upstream omits the `cmodel` entry, `getQoderModelConfig(..., "cmodel")` returns `null` and chat fails with `'model_config for cmodel not yet known'`. | After the catalog loop, if `rawConfigs` lacks `cmodel`, synthesize it from the first valid sibling in `body.chat` (clone with `key: "cmodel"`, `display_name: "Cantus"`) or fall back to the upstream defaults (`131072`/`64000`, `is_vl`/`is_reasoning` false, `description: "Qoder Cantus (C-model)"`); push the same shape into `models` and `rawConfigs`. Tests in `tests/unit/qoder-cmodel-3231.test.js`. |

## Adaptations

- **Sibling lookup shortcut.** Upstream scans `body.chat` and checks
  `rawConfigs.has(entry.key)` to pick a fallback config. The first valid
  match is the same here; the local `Map` already filters out non-object
  entries during the catalog loop, so the synthesized clone only needs to
  override `key` and `display_name` — every other field is inherited
  verbatim, including `enable`, `is_vl`, and `is_reasoning`. The fork's
  loop already sets `rawConfigs.set(key, entry)` before the
  `enable === false` early return, so the lookup is safe even when the
  sibling is UI-hidden.

## Verification

- `tests/node_modules/.bin/vitest run --root . --config tests/vitest.config.js tests/unit/qoder-cmodel-3231.test.js`:
  3/3 pass.
- Revert proof, each confirmed red then green:
  - removing the post-loop `if (!rawConfigs.has("cmodel"))` block fails the
    sibling-synthesis and upstream-defaults cases.
  - replacing the post-loop block with an unconditional `rawConfigs.set("cmodel", ...)`
    fails the never-overwrite case (upstream `enable: false` cmodel would be
    clobbered by the synthesized entry).
