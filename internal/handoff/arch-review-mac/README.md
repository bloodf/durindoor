# Architecture review handoff (not for merge)

Work orders for the architecture review issues #2255 #2259 #2261 #2266 #2287 #2289 #2291 #2292 #2300 #2302 #2305 #2309 #2311 #2313 #2314, written for part 1.

- `plan.json` has the plan, decisions and evidence commands; each `a*.md` file is one slice's work order.
- In progress, on branches: `mac/arch-2289-headroom-format` (test only so far), `mac/arch-2266-combo-state`.
- Not started: every other order in this folder.
- `a2255` waits on #2627, which edits `chatCore.js`, `chatCore/*` and `utils/stream.js`.
- No slices written yet for #2291, #2292, #2305 and #2311, nor for the larger splits (handleChatCore, createSSEStream, combo.js, the token-refresh coordinator, MITM ESM, vitest projects, UI primitives).
- Several items were already fixed on main after the issues were filed: `responsesHandler.js`, `compact.js`, the antigravity shim, the lowdb benchmark and the updater default package. Each order says to check current main first.
