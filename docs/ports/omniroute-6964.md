# Port log: OmniRoute PR #6964

- **Source:** https://github.com/diegosouzapw/OmniRoute/pull/6964 (fixes upstream #6912; forward direction from #1961)
- **Port branch:** `port/omniroute-6964`

## Behavior ported

`applyParamRenames` normalizes the max-token field name before dispatch, choosing direction from the **model string alone** (provider-independent), mirroring OmniRoute's `supportsMaxTokens({ provider, model })` heuristic whose pattern list carries no provider segment:

- **Forward** — o1/o3/o4/gpt-5.x families reject the legacy `max_tokens` field: rename `max_tokens` → `max_completion_tokens` on any provider route (OpenAI direct or a compatible relay such as OpenRouter/Volcengine addressing `openai/o3`).
- **Reverse (#6912)** — every other model: rename `max_completion_tokens` → `max_tokens`, because legacy-compatible providers (Volcengine Ark / DeepSeek) silently ignore the newer field and would apply no completion cap.
- **Precedence (both directions):** an explicitly set destination field wins; the source field is still deleted so exactly one spelling reaches upstream.

## DurinDoor adaptation

Source logic lived inline in `chatCore.ts`; DurinDoor already had the equivalent seam in `open-sse/translator/concerns/paramSupport.js` (`applyParamRenames`, called from `executors/default.js`). The pre-existing forward rule was gated on `provider === "openai"` — that gate was removed because source direction is capability-driven by model id; keeping it would have reverse-stripped `max_completion_tokens` for o-series/gpt-5 models reached through non-OpenAI relays. The family regex keeps DurinDoor's existing `gpt-5|o[134]` coverage (intentionally broader than the source snapshot's `gpt-5.4/5.5, o1, o3` list) but is anchored at prefix (`^`, `/`, `:`) and version (`.`, `-`, end) boundaries so substring lookalikes (`deepseek-v3o1`) do not match.

## Files (3)

- `open-sse/translator/concerns/paramSupport.js`
- `tests/unit/param-support.test.js`
- `docs/ports/omniroute-6964.md`

## Verification

```text
cd tests && ./node_modules/.bin/vitest run --config vitest.config.js unit/param-support.test.js
Test Files  1 passed (1)
Tests       20 passed (20)
```

Acceptance table covers: o1/o3/o4/gpt-5.x forward rename; prefixed non-OpenAI routes (`openai/o3`, `azure:o1-preview`); both-field precedence in both directions; Volcengine `DeepSeek-V4-Flash` reverse path; nonmatching controls. Red-check: deleting the reverse branch fails 3 of the 20 cases.
