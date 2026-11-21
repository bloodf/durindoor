# #1073 — Preserve Claude tool input object shape

## Upstream comparison

OmniRoute PR [#14814](https://github.com/cheaper-inference/OmniRoute/pull/14814) was inspected at head `cfa59a1d9a2886e8800ef341bd1d016ec096ade2` and enclosing merge `b085f161762ae37be4b1d6d3181a5d778e906f14`. The September protocol inventory records the PR as an actionable residual in [`1073-september-existing-translation-ledger-residuals.md`](./1073-september-existing-translation-ledger-residuals.md). Its source comparison identifies the existing OpenAI-to-Claude function-form assistant history bridge: argument JSON parsing can return a scalar, array, null, or the raw invalid string, while Claude `tool_use.input` must be an object. The upstream patch normalizes non-object values to `{}`.

## Local change

The same function-form branch now preserves parsed objects and maps scalar, array, null, and invalid JSON results to `{}`. Native typed Claude `tool_use` blocks, structured custom text, tool declarations, call IDs, calls without `type: "function"`, and thinking blocks retain their existing handling. No executor, schema, or route was added.

## Regression evidence

Added an ordinary offline translator regression for the function-form branch, including valid object JSON and scalar, number, boolean, array, null, and invalid JSON values. The fixture also checks native typed input, structured text, declared tools, call IDs, missing call type behavior, and thinking preservation.

`test -s internal/docs/port-reports/1073-claude-request-tool-input-shape-14814.md && (cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 translator/omni-claude-request-tool-input-shape-14814.test.js translator/bugs-openai-to-claude-tools-no-type.test.js unit/openai-to-claude.test.js)`

Refs #1073
