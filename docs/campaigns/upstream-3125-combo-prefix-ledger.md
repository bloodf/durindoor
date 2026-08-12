# Upstream PR Port — #3125 Combo Prefix Resolution (2026-08-11)

| PR | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| [decolua/9router#3125](https://github.com/decolua/9router/pull/3125) `fix: resolve combos after provider prefix` | PORTED WITH FORK PRECEDENCE | Both saved-combo resolvers rejected every slash-containing name before lookup. A configured combo such as `lordx.1`, requested as `openrouter/lordx.1`, therefore fell through as a raw provider model and upstream rejected it. | Look up the exact combo name first, then its final path segment. Tests cover exact-name, prefixed, bare, missing, and catalog-collision cases in `tests/unit/combo-prefix-resolve.test.js`. |

## Fork adaptation

DurinDoor keeps known static-catalog `provider/model` routes ahead of basename combo fallback. Exact combo names still win, but when no exact combo exists, `anthropic/claude-sonnet-5` must route to Anthropic rather than a saved `claude-sonnet-5` combo. This avoids changing valid provider requests while repairing prefixed saved-combo resolution.

## Verification

- `tests/node_modules/.bin/vitest run --root . --config tests/vitest.config.js tests/unit/combo-prefix-resolve.test.js`: 3 passed.
- `tests/node_modules/.bin/vitest run --root . --config tests/vitest.config.js tests/unit/hide-paid-models-combo-exec.test.js`: 9 passed.
