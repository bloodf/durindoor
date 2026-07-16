# Port log: OmniRoute PR #6964

- **Source:** https://github.com/diegosouzapw/OmniRoute/pull/6964 (fixes upstream #6912; forward direction from #1961)
- **Port branch:** `port/omniroute-6964`

## Behavior ported

`applyParamRenames` normalizes the max-token field name before dispatch, choosing direction from the **model string alone** (provider-independent), mirroring OmniRoute's `supportsMaxTokens({ provider, model })` heuristic whose pattern list carries no provider segment:

- **Forward** — the reasoning-model families reject the legacy `max_tokens` field. DurinDoor keeps its dev-parity set: `o1*`/`o3*`/`o4*` plus the whole `gpt-5.x` family, matching the pre-port GitHub rule `/gpt-5|o[134]-/i` (broader than the source's exact seven-token list, which dropped `o4-mini` and `gpt-5.6` — a regression flagged in Codex review thread P1). Rename `max_tokens` → `max_completion_tokens` on any provider route (OpenAI direct or a compatible relay such as OpenRouter/Volcengine addressing `openai/o3`).
- **Reverse (#6912)** — every other model: rename `max_completion_tokens` → `max_tokens`, because legacy-compatible providers (Volcengine Ark / DeepSeek) silently ignore the newer field and would apply no completion cap.
- **Precedence (both directions):** an explicitly set destination field wins; the source field is still deleted so exactly one spelling reaches upstream.

## DurinDoor adaptation

Source logic lived inline in `chatCore.ts`; DurinDoor already had the equivalent seam in `open-sse/translator/concerns/paramSupport.js` (`applyParamRenames`, called from `executors/default.js`). The pre-existing forward rule was gated on `provider === "openai"` — that gate was removed because source direction is capability-driven by model id; keeping it would have reverse-stripped `max_completion_tokens` for the o1/o3/gpt-5.4/5.5 families reached through non-OpenAI relays. The family regex keeps DurinDoor's dev-parity reasoning set (`o[134]` + the whole `gpt-5.x` family) rather than narrowing to the source's exact seven-token list — narrowing regressed `o4-mini`/`gpt-5.6`, which the pre-port `/gpt-5|o[134]-/i` rule already forward-renamed (Codex P1). Source matches by raw substring; DurinDoor anchors at a prefix boundary (`^`, `/`, `:`) and a version boundary (`.`, `-`, end) so `openai/o3-mini`, `azure:o1`, `gpt-5.4-pro`, and `gpt-5.40` match while `o3mini`, `deepseek-v3o1`, and `o2` do not.

### Specialized OpenAI-compatible executors

`GithubExecutor` (extends `BaseExecutor`, not `DefaultExecutor`) and `AzureExecutor` (overrides `transformRequest`) both bypass `DefaultExecutor.transformRequest`, so the shared helper would never fire on their Chat Completions dispatch paths. Both now invoke `applyParamRenames` from their own `transformRequest`:

- `open-sse/executors/github.js` — replaces the previous broad in-executor rename (`requiresMaxCompletionTokens`, `/gpt-5|o[134]-/i`, forward-only) with the shared helper (both directions, dev-parity family set `o[134]` + `gpt-5.x`).
- `open-sse/executors/azure.js` — clones the body (avoiding caller side effects) then applies the shared helper, both directions.

## Files (6)

- `open-sse/translator/concerns/paramSupport.js`
- `open-sse/executors/github.js`
- `open-sse/executors/azure.js`
- `tests/unit/param-support.test.js`
- `tests/unit/omniroute-sensenova-token-clamp.test.js` (assertion updated for cutover)
- `docs/ports/omniroute-6964.md`

## Interaction: SenseNova clamp

`DefaultExecutor.transformRequest` runs the provider `clampRequestBody` hook (SenseNova 65536 ceiling) BEFORE `applyParamRenames`. For a non-family model like `sensenova-6.7-flash-lite`, an explicit over-ceiling `max_completion_tokens: 100000` is therefore clamped to `65536` and then reverse-normalized to `max_tokens: 65536` (the newer spelling is removed), matching this port's one-spelling guarantee. The pre-existing SenseNova test that asserted `max_completion_tokens` survives was stale under the cutover and now asserts `max_tokens: 65536` + `max_completion_tokens` absent.

## Verification

```text
cd tests && ./node_modules/.bin/vitest run --config vitest.config.js unit/param-support.test.js
Test Files  1 passed (1)
Tests       35 passed (35)  # 31 applyParamRenames cases + 4 stripUnsupportedParams

# GithubExecutor regression (transformRequest/execute paths):
cd tests && ./node_modules/.bin/vitest run --config vitest.config.js \
  unit/github-prefill-sanitize.test.js unit/github-responses-routing.test.js unit/github-responses-streaming.test.js
Test Files  3 passed (3)
Tests       21 passed (21)
```

Acceptance table covers: the o1/o3 families forward rename; `o4-mini` + the whole `gpt-5.x` family (incl. `gpt-5.3`/`gpt-5.6`/`gpt-5.40`) forward rename per dev parity; prefixed non-OpenAI routes (`openai/o3`, `azure:o1-preview`); both-field precedence in both directions; Volcengine `DeepSeek-V4-Flash` reverse path; suffix-boundary rejection (`o3mini`) + non-reasoning `o2` reverse; substring lookalike control (`deepseek-v3o1`). Executor-level tests prove the rename fires on `GithubExecutor.transformRequest` and `AzureExecutor.transformRequest` dispatch paths (helper-only tests cannot), including Azure's clone-before-mutate contract. Red-check: reverting the helper call in either executor fails its dispatch test; deleting the reverse branch fails the legacy-model cases.
