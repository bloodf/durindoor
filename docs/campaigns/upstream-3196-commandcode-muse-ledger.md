# Upstream PR Port — #3196 CommandCode Muse Reasoning (2026-08-11)

| PR | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| [#3196](https://github.com/decolua/9router/pull/3196) `feat(commandcode): support Muse reasoning effort` | PARTIAL PORT — request translation and provider metadata | CommandCode's Muse Spark 1.2 Contributor model needs `reasoning_effort` inside the alpha `params` envelope and rejects output limits above 32,768 tokens. Request-only `model(level)` suffixes must not reach the provider. | Add Muse registry/capability metadata, clamp its output limit, strip recognized suffixes, and write only supported reasoning levels to `params.reasoning_effort`. Focused tests: `tests/unit/openai-to-commandcode.test.js`. |

## Deliberate divergence

The upstream executor's initial-response inspection and in-band 503 retry rewrite is excluded from this port. It changes streaming/retry behavior beyond Muse request shaping and remains separate scope. Existing `wrapNdjsonAsOpenAISse` behavior is unchanged.

## Verification

- Focused Vitest regression coverage proves supported and unsupported reasoning levels, suffix stripping, and the 32,768-token cap.
