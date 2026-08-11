# Upstream #3235 Hermes API-Key Port Ledger

Scope: verified port of `decolua/9router` pull request #3235 into DurinDoor's Hermes settings route.

## Workstream — Hermes configuration

| Item | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| Hermes model `api_key` YAML field | PORTED | Upstream #3235 adds `api_key: ${OPENAI_API_KEY}` to the generated `model:` block and exposes the field when parsing existing configuration. DurinDoor's `HermesToolCard` already supplied this setting, but `src/app/api/cli-tools/hermes-settings/route.js` omitted it when writing and reading `~/.hermes/config.yaml`. | Added the field to `buildModelBlock` and `parseModelBlock`; regression test verifies POST output and GET round-trip. |

## Verification

- Focused Vitest regression: `tests/node_modules/.bin/vitest run --root . --config tests/vitest.config.js tests/unit/hermes-settings-apikey.test.js` — 2 passed.
- `npm run check:docs` — planned in parent integration gate.
