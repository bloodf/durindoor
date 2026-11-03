# Calibrated Visant detector adapter

Pinned upstream: `pedrojaques99/visant-skills-public@fe555cfdeb405799db51ca52468079512c9adc1a`.

The executable remains local at `/Users/heitor/Documents/Codex/durindoor-visant-audit-2026-10-29/detector-adapter.mjs`. Run it with Node20 from that external audit folder. It was not added as a product dependency or repository gate. It writes only to this external audit folder. It copies pinned scanner scripts into `tooling/pinned-visant`, patches those copies, builds an import-reachable target list, runs calibration tests, then runs Killer `--roots --all` and Refine. Product source is read-only.

## Necessary calibrations

1. **JSX in `.js`:** Killer interface/copy/noise and token filters, Noise scan's extension-sensitive exceptions, and Refine's walker accept `.js`. DurinDoor's current active target contains 458 `.js`, 74 `.jsx`, and 7 CSS files. Babel confirms JSX in 182 of those `.js` files plus all 74 `.jsx` files: these 256 are the interface-copy/chrome target. Other active `.js` modules retain only explicit user-facing property copy extraction; SQL schema strings and ordinary implementation code are not treated as JSX text. Silently skipping `.js` would skip most product UI.
2. **Pinned Copy:** Killer invokes the copied pinned `visant-copy/scripts/copy-lint.mjs`; it does not use the mutable `~/.claude/skills/visant-copy` symlink.
3. **Unavailable Impeccable:** Impeccable is explicitly SKIPPED/UNAVAILABLE. Its earlier npm installer failure is a tooling failure, not ten design defects. This adapter neither installs it nor reports it clean.
4. **Durin DS token layer:** The token detector recognizes actual `--dd-*` semantic colors in `src/shared/ui/tokens.css`. Fallback palette checks therefore remain enabled instead of claiming there is no token system.
5. **Complete colors, not HSL channel tuples:** DurinDoor `--dd-text` and `--dd-accent` contain complete CSS colors (tokens.css:43,48,105,110). Refine's blanket assertion that naked `var(--x)` is invalid does not apply to these tokens. Only `var(--dd-*)` bypasses that one naked-HSL-variable check; literal raw colors and fixed Tailwind palette checks remain active.
6. **No blanket `/ui/` exemption:** Original Refine skips some motion checks for every file under `/ui/`, which incorrectly exempts whole v5 dashboards. The adapter retains those candidates for manual review even in shared primitives. Legitimate sidebar width animations can be waived with evidence in the audit report; they are not silently removed.
7. **Active-target fan-out:** Roots ranking limits importers to the active import closure rather than counting rejected prototypes and story/test callers. This changes only rank/fan-out, not candidate suppression in active source.
8. **Installed icon library:** Noise's icon-library allowlist recognizes the existing `@animateicons/react` dependency. The installed library's absence from its short hardcoded list must not produce a false claim that the project has no icon library.
9. **Output completeness:** Scanners end in `process.exit`, which can truncate pipe output to 8192 bytes. Subprocess output goes directly to file descriptors, then is read after completion. Complete logs are the evidence, not a cut console header.

## Active scope

Seeds are actual Next `page/layout/error/loading/not-found` entry points, current generated v5 source-backed story imports, the Start here review story/frame, and explicit Vite replacement edges (combos, provider auto-sync, login, Token Saver, and review icon/button adapters). Static import/export and literal dynamic-import dependencies are parsed with the repository's existing Babel parser; CSS imports are followed. Stories are traversal entry points but not scanned. Known rejected v5 prototypes and `src/shared/ui/pages` are excluded; generated builds, node_modules, API handlers, and open-sse are not UI targets.

`tooling/active-files.json` is the exact target inventory. `tooling/reachability.json` records seeds, unresolved imports (zero), and limitations. The import closure is conservative: a barrel import can include all exports, rather than pretending to perform bundler tree-shaking. Production and Storybook replacement implementations are both included when reachable, so totals are candidate counts, not deduplicated user-visible defects.

## Calibration proof

- Original pinned Killer, Refine, and Copy self-tests all pass.
- Positive `.js` fixture: raw chart/class color, transition-all, and em-dash/hype copy are detected.
- Negative `.js` fixture: token-based ordinary button yields no detector FAIL (Killer Gate 0 remains incomplete because a fixture is not a reviewed product).
- Chart with a real empty branch and complete `var(--dd-accent)` color passes Refine; literal chart color remains detected.
- Assertions fail loudly if a patch is no longer applied or a detector changes behavior.

These calibration results validate the adapter's coverage fixes, not the product's design quality. Logs and candidates still require source review, actual browser layout/interaction checks, and business-surface judgment.

## Final calibrated scan results

| Detector | Result | Meaning |
|---|---:|---|
| Impeccable | Unavailable | npm execution failure is excluded from design counts; no pass claimed |
| Killer token fallback | 52 candidates | Complete scan of539 active files; semantic Durin DS layer recognized |
| Killer extracted Copy | 105 candidates |256 JSX interface modules plus explicit user-facing string properties in reachable helper modules |
| Killer Noise |153 candidates |256 interface modules; no rejected prototypes or stories |
| Refine |26 candidates |532 JS/JSX modules:7 chart-state,7 static defs-ID,3 layout-animation,9 easing/property candidates |

Killer remains **GATE CLOSED** (3 detectors with candidates). Refine remains **BLOCKED**. These are scanner candidates, not336 confirmed UI bugs. The final counts supersede earlier broad scans and intermediate adapter runs. Original pinned self-tests and adapter positive/negative calibration tests pass.

### Candidate locations worth checking

- `src/app/(dashboard)/dashboard/endpoint/components/MonitoringStrip.js:49,121,168,197,216-218`: fixed red/green/amber classes despite semantic token layer.
- `src/app/(dashboard)/dashboard/monitoring/page.js:76,97-103`: same fixed palette pattern.
- `src/shared/constants/models.js:47,49-50`: capability metadata still specifies blue/amber/purple; determine each actual consumer's review adaptation before declaring a visible v5 defect.
- `src/shared/components/Sidebar.js:40,42-43,223`: transition-all and sidebar width animation candidates; fixed width animation can be a justified sidebar interaction, so this is not an automatic defect verdict.
- `src/shared/ui/v5/usage/ReviewUsageChart.jsx:95,99` and `src/shared/ui/v5/dashboards/PxpipeWidgets.jsx:203`: literal gradient IDs; need multi-instance browser reproduction, especially custom dashboard widgets.
- `src/shared/ui/v5/dashboards/SaverWidgets.jsx:56` and `ReviewUsageChart.jsx:92`: chart-state candidates need tracing to their parent; scanner cannot prove the parent lacks loading/empty/error handling.
- `src/app/(dashboard)/dashboard/cli-tools/components/OpenCodeToolCard.js:346,382`: repeated usage instructions and near-duplicate text; good density review target rather than punctuation-only cleanup.
- `src/shared/ui/components/Toggle.jsx:57`: transition-all candidate in a real shared primitive. Limit animated properties intentionally; no claim of measured jank.

### Roots ranking, and why it is not a repair order by itself

Active-import fan-out ranks `src/shared/constants/cliTools.js` first (5 importers,28 candidates) and `src/shared/constants/models.js` next (16 importers,3 candidates). Of cliTools'28,26 are raw `color` metadata entries describing third-party tool identities (e.g. Antigravity at line7, Kiro at34), not raw card backgrounds. Preserve recognizable brand colors and verify consumers; do not recolor brands just to open a gate. Copy's other2 are house-voice review candidates. Root ranking measures code import fan-out, not runtime simultaneous visibility, user frequency, or confirmed impact.

Exact evidence: `tooling/killer-active.log`, `tooling/refine-active.log`, `tooling/calibrated-summary.json`, `tooling/calibration-selftest.json`, and `tooling/active-files.json`. No product source was changed.
