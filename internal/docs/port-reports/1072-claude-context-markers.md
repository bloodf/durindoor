# #1072 Claude Code context markers (#4762)

Compared 2026-11-20 against base `4f4455c9ce89a51563f2413f0592037763977d41` (branch `orq/tornf6/port9r-claude-context-markers-a1`), upstream 9router [#4762](https://github.com/decolua/9router/pull/4762) head `2551589adfab26a8ff9806f5a7e7414972c251e2`, and the qualified review commit `389e7d8714e175e805dd71eaefa20ba3ad604342` ("docs(upstream): record remaining 9router dispositions"), whose report `internal/docs/port-reports/1072-composite-open-residuals.md` (Residual 4762-A) is the reviewed source of this port.

No provider, browser, media, credential, paid API, Docker, e2e or full-suite run was used. All evidence below is source-diff reading, local code and offline tests.

## Source disposition

Upstream [#4762](https://github.com/decolua/9router/pull/4762) ("fix(claude): resolve auto-mode classifier non-streaming projection and context model aliases") is **open and unmerged** against upstream `master`. Its diff is 7 551 lines across 73 files and contains several unrelated behaviors. The reviewed disposition (qualified review commit `389e7d871`) splits it per behavior rather than by size: the earlier "too large" deferral is superseded, because #4762 carries behavior this fork already ships, one behavior it genuinely lacks, and one behavior that conflicts with a pinned local contract.

| Upstream behavior in #4762 | Disposition |
| --- | --- |
| Context marker widened from `[1m]` to any trailing `[<digits><m\|k>]` | **Ported here** (Residual 4762-A) |
| Auto-mode classifier non-streaming projection | Already shipped, and stronger locally: the fork short-circuits the classifier without dispatching upstream (`open-sse/handlers/chatCore.js:1907-1961`) |
| Gemini synthetic-turn mimicry removal | Not applicable — the fork never injects `Processing tool output...` placeholders |
| Antigravity schema-map traversal fix | Not applicable — the fork's visitor descends only into `properties` values and `items` (`open-sse/translator/formats/gemini.js:767-801`) |
| Synthetic `reason` parameter injection removal | **Deliberately not ported** — conflicts with a pinned local contract (`tests/unit/gemini-empty-schemas.test.js`, `tests/unit/gemini-schema-walkers-name-map-2884.test.js`); it is a separate decision, not part of this port |
| Antigravity web-search grounding bridge | Not applicable — the fork declares native Anthropic server tools for one provider only and owns no id/usage namespace contract for the bridge |

### Exact upstream shape and where it lands here

Upstream adds a new module `open-sse/utils/modelMarkers.js` with `stripModelContextMarker(modelStr)` and widens its marker constant from `/\[1m\]$/i` to `/\[([0-9]+[mk])\]$/i`, stripping the suffix before alias and combo resolution. This fork has no `modelMarkers.js`; its equivalent single owner is `src/app/api/v1/models/_claudeCompat.js`, which holds both the advertisement marker and the request-side decoder.

Upstream's module does not exist here, so the upstream file was **not** added. The behavior was re-derived at the fork's owning module, which is the only place in this fork that strips a context suffix. The fork's other bracket contract — the documented `glm-5.3[1m]` registry case (`src/sse/services/model.js:215`, `DOCUMENTED_BRACKET_MODEL`) — is a separate, provider-specific contract and was left untouched.

## Behavior contract

The port changes the **decoder only**, and splits the one previously shared constant in two:

- `src/app/api/v1/models/_claudeCompat.js:7` — `CONTEXT_MARKER = /\[1m\]$/i` stays the **advertisement** marker. It is unchanged in meaning and in value.
- `src/app/api/v1/models/_claudeCompat.js:13` — `DECODE_CONTEXT_MARKER = /\[([0-9]+[mk])\]$/i` is the new **decoder** marker, the widened upstream shape.

What the port guarantees:

1. **Trailing context suffixes decode.** A Claude-format request whose model id ends in `[1m]`, `[200k]`, `[128k]` or `[2m]` is decoded to the underlying routable model instead of failing model resolution with HTTP 400 "Invalid model format" (`src/sse/handlers/chat.js:900-901`). This is the upstream win: before the port, `claude-sonnet-5[200k]` survived to resolution and was rejected.
2. **The suffix must be the final token.** The marker is anchored at the end of the id, so an embedded suffix (`claude-openai/gpt-5.5[1m]extra`) is not decoded.
3. **Malformed suffixes are not decoded.** `[abc]`, `[1x]`, `[m]`, `[1mm]`, `[]` and an unclosed `[200k` are not marker shapes and are left exactly as they were.
4. **A discovered model whose literal name includes brackets is preserved.** The exact routability check runs first (`src/app/api/v1/models/_claudeCompat.js:40`), so a literal id such as `literal/model[200k]` is returned unchanged, and its projected spelling `claude-literal/model[200k]` resolves back to that same literal id.
5. **Advertisement is unchanged.** Only `[1m]` is advertised, and only for a catalog row whose resolved limits are `known` and at least `1_048_576` tokens (`src/app/api/v1/models/_claudeCompat.js:29-33`). No new context size is advertised, and no other suffix is ever advertised.
6. **Generic API input is untouched.** The decoder is reached only from the Claude-format branch (`src/sse/handlers/chat.js:489-490`, guarded by `sourceFormat === FORMATS.CLAUDE`). The OpenAI Chat Completions and Responses paths, the auto-classifier and tool behavior, and the `glm-5.3[1m]` registry case are unchanged.
7. **Explicit model and account authorization are unchanged.** The decoder runs after API key resolution and before the `allowedCombos` gate (`src/sse/handlers/chat.js:494-500`) and before `enforceApiKeyModelPolicy` (`src/sse/handlers/chat.js:928`), which is evaluated against the resolved provider/model derived from the decoded id. The authorization gate therefore still sees the real target, and a key scoped to a narrow lane cannot reach a wider one through the marker.

## Change

- `src/app/api/v1/models/_claudeCompat.js` — split the shared marker constant into an unchanged `[1m]` advertisement marker and a widened decoder marker; `decodeClaudeCodeModelId` now uses the widened marker for both the marker test and the strip. The projection path (`projectClaudeCodeModel`) is byte-for-byte unchanged in behavior, and the decoder's ordering — exact route first, then the projected spelling, then the unmarked id — is unchanged.

## Tests

`tests/unit/claude-context-markers-4762.test.js` (new, 14 cases) pins the contract above: positive `[200k]`, `[128k]` and `[2m]` decoding, a suffixed provider route without the `claude-` prefix, case-insensitive matching (`[200K]`, `[1M]`), embedded suffixes left untouched, malformed and unknown suffixes left untouched, an unknown model with a suffix left untouched, a discovered model whose literal name includes brackets preserved (both the literal and its projected spelling), the unchanged `[1m]` decode results, a projected route whose literal id ends in a suffix, input without a suffix, and the unchanged `[1m]` advertisement rules including preservation of literal bracket names.

Offline verification, from `tests/`:

```
node node_modules/vitest/vitest.mjs run --maxWorkers=2 \
  unit/claude-context-markers-4762.test.js \
  unit/claude-code-compat.test.js \
  unit/claude-max-context.test.js
```

25 tests pass in 3 files. The two pre-existing files are unmodified and still pass, so the `[1m]` projection and decode cases (`claude-openai/gpt-5.5[1m]`, `kimi/k3[1m]`, `openai/gpt[1m]extra`) keep their current results.

The new file was also verified to fail without the port: with the decoder marker reverted to `/\[1m\]$/i`, the 4 new-behavior cases fail and the 10 unchanged-behavior cases still pass, confirming the file guards the new behavior rather than merely re-asserting the old.

Root lint (`eslint src` plus the anti-slop check) passes. `AGENTS.md`, workflows, the test baseline, Docker files, e2e and browser surfaces were not touched, and no dashboard source changed, so no Storybook inventory regeneration is needed.

## Not done

The full test suite and the integration gate remain the integration owner's, as do the other #4762 behaviors listed as not applicable or conflicting above. No dependency was added, changed or removed.
