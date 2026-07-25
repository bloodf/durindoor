# Upstream Port Ledger — 2026-07-25

Scope: user-selected `decolua/9router` PRs #2824, #2818, #2829, #2823, #2822, and #2801.

| PR | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| #2824 `feat(ollama): add embedding provider adapter and endpoint support for Ollama Local` | DUPLICATE | DurinDoor already has `open-sse/handlers/embeddingProviders/ollama-local.js`, registry wiring, live Ollama embedding discovery, media provider UI coverage, and focused embedding adapter tests. | No port. |
| #2818 `fix(models): sync discovered catalogs with configured models` | GAP (partial) | `buildModelsList.js` fetched the full upstream `/models` catalog before merging persisted custom models, so a compatible node with configured custom models leaked upstream entries beside the intended whitelist. The dashboard live-catalog merge portion is separate and broader. | Ported only the compatible-node whitelist guard and regression test. Deferred dashboard catalog merge. |
| #2829 `feat(docker): comprehensive Docker Compose overhaul with monitoring and CI/CD` | DEFER | Broad Docker/Caddy/Prometheus/Grafana/CI overhaul with unstable upstream state and deployment-shape conflicts. | No port in this batch. |
| #2823 `feat(zed): add Zed Hosted AI provider support` | DEFER | New provider subsystem with unresolved upstream review concerns: hardcoded routing regex, duplicated refresh logic, missing tool-call handling, and hand-edited generated registry index. | No port in this batch. |
| #2822 `fix(logs): stop writing provider tokens to disk in request logs` | DUPLICATE | DurinDoor's `open-sse/utils/requestLogger.js` already masks sensitive headers and recursively redacts credential fields in bodies, URLs, provider responses, and stream chunks, with `tests/unit/request-logger-redaction.test.js`. | No port. |
| #2801 `fix(ollama): preserve terminal stream message content` | GAP | DurinDoor dropped Ollama `done:true` chunks before translation in the stream loop and returned terminal chunks before extracting `message.content`, `message.thinking`, and terminal tool calls. Empty `tool_calls: []` could also force a tool-call finish. | Ported and adapted translator + stream handling with focused regression tests. |

## Implemented changes

- `open-sse/translator/response/ollama-to-openai.js`
  - Extract terminal message fields before building the finish chunk.
  - Preserve content, reasoning, and non-empty terminal tool calls with usage and `finish_reason`.
  - Ignore empty `tool_calls: []`.
- `open-sse/utils/stream.js`
  - Accumulate native Ollama `message.content` and `message.thinking` for request details.
  - Allow Ollama terminal chunks through the buffered flush translation path.
- `src/app/api/v1/models/buildModelsList.js`
  - Treat persisted custom models on compatible nodes as an explicit whitelist and skip full upstream catalog discovery.
- Tests:
  - `tests/unit/ollama-terminal-stream.test.js`
  - `tests/unit/buildModelsList-compatible-discovery.test.js`

## Verification

- Focused tests: 3 files, 12 tests passed.
- Full repository gate and CI results are recorded in the pull request.
