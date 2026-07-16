# Port log: OmniRoute PR #6938 (plan row OmniRoute#6937)

- **Source:** https://github.com/diegosouzapw/OmniRoute/pull/6938
  ("fix(grok): strip reasoningEffort for grok cli models")
- **Port branch:** `port/omniroute-6937`
- **Note on numbering:** the plan row "OmniRoute#6937 — grok-cli strip
  reasoningEffort" describes upstream PR #6938. Upstream PR #6937 is the
  unrelated "align responses tool-call shape" change (ported separately on
  `port/omniroute-6938`). This branch ports the reasoningEffort strip named
  in the plan, under the plan's unit number 6937.

## Behavior ported

xAI's cli-chat-proxy 400s on reasoning parameters for non-reasoning Grok CLI
models (`grok-build`, `grok-composer-2.5-fast`). Upstream marks
`reasoningEffort` unsupported in the grok-cli provider registry so the
parameter is never forwarded for those models.

## Preflight finding: behavior already present on dev

Phase-0 preflight found the semantic equivalent already implemented in
`GrokCliExecutor.transformRequest()` (`open-sse/executors/grok-cli.js`,
reasoning resolution block ~lines 341-355):

- `getCapabilitiesForModel("grok-cli", model)` returns `reasoning: false` for
  `grok-build` / `grok-composer-2.5-fast`
  (`open-sse/providers/capabilities.js`), and for those models the outbound
  body drops `reasoning` entirely.
- `reasoning_effort` (the source-side hint, snake_case form of upstream's
  `reasoningEffort`) is always deleted from the outbound body; for
  reasoning-capable grok-cli models it is first converted into the
  Responses-native `reasoning: { effort, summary: "concise" }` shape.

So no duplicate strip was added. The port delivers the missing focused
regression + control coverage instead:

- **Matching:** `reasoning_effort` and nested `reasoning` are both absent
  from the transformed outbound body for `grok-build` and `grok-composer-2.5-fast`,
  while unrelated allowed fields (`temperature`, `top_p`, `input`, `model`)
  survive untouched.
- **Conversion:** for reasoning-capable `grok-code-fast-1`,
  `reasoning_effort: "low"` becomes `reasoning: { effort: "low" }` and
  `include` gains `reasoning.encrypted_content`.
- **Control (other executors preserved):** `XaiExecutor.transformRequest`
  keeps `reasoning_effort: "high"` for reasoning-capable `grok-4` — the strip
  is scoped to the grok-cli request path only.

## Files (2)

- `tests/unit/grok-cli-reasoning-strip.test.js`
- `docs/ports/omniroute-6937.md`

## Verification

Node 20.20.2 (`~/.local/node20/bin`), worktree `.omc/wt-port-om-6937`:

```text
cd tests && node node_modules/vitest/vitest.mjs run unit/grok-cli-reasoning-strip.test.js
Test Files  1 passed (1)
Tests       4 passed (4)
```

Red-check (not committed): neutralizing the `delete body.reasoning` /
`delete body.reasoning_effort` block in `open-sse/executors/grok-cli.js`
makes the matching test fail (1 failed, 3 passed); file restored afterwards.
