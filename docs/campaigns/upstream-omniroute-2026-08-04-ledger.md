# Upstream + OmniRoute Sync Ledger — 2026-08-04

Scope: commits reviewed from 2026-07-25 through 2026-08-04. Source anchors and unmerged watches live in [`docs/UPSTREAM_SYNC.md`](../UPSTREAM_SYNC.md).

| Item | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| `31df0635a` Poolside | PORTED | Registry and Laguna capabilities were absent. | Added provider, capabilities, generated index, and test. |
| `de2da19a9` Morph slice | PORTED | Morph was the only missing provider in the multi-provider commit. | Added only Morph registry and test. |
| `e3e3e235f` Gemini empty schemas | PORTED | `cleanJSONSchemaForAntigravity` did not repair bare `{}` after `$ref` removal. | Added recursive placeholder behavior and tests. |
| `0afe94938` Antigravity `stream_options` | PORTED | Non-stream requests retained the OpenAI-only field. | Strip it before both normal and image request paths. |
| `5e5979082` Cursor agent errors | NOT APPLICABLE | Local `open-sse/executors/cursor.js` uses ChatService protobuf and has no upstream `executeAgent` / `exec_request` seam. | No port. |
| `16cb40fda` Kiro canonicalization/routing | DUPLICATE | API-key header and endpoint ordering live in `KiroExecutor.buildHeaders` / `getOrderedBaseUrls`; orphan tool results are reconciled in both Kiro request translators. | No duplicate implementation. |
| `a8313cd32` Kiro Opus 5 | PORTED | Opus 5 variants were absent. | Added four generated variants and focused test. |
| `8b0fcf4b1` Claude max context | PORTED | Setting was absent from route reset/write logic and CLI card. | Added presets, persistence, reset, manual config, and tests. |
| `9c9dd7b19` Qoder PAT/models | PORTED | PAT exchange and current models were absent. | Added PAT job-token exchange/cache, dual auth registry, refreshed models, API-key validation path, and preserved validated local SSE termination. |
| `6eaa9f836` Kimi/DeepSeek usage | PORTED | Usage handlers and dispatch entries were absent. | Added handlers, registry eligibility, dashboard support, and tests. |
| `f17a68aae` SuperGrok weekly pool | PORTED | REST-only usage lacked the gRPC-web weekly fallback. | Added fail-open protobuf decoder/fallback while preserving local per-product and monthly rows. |
| `1319dea62` free-tier count | DUPLICATE | `freeTierEntries` already passes `apikey`, and `getFreeAuthTypes` handles dual modes. | No port. |
| `baf335658`, `44c7b3483` provider-card count | PORTED | OAuth cards filtered with `OAUTH_STATUS_AUTH_TYPES` but stats/toggle used narrower `OAUTH_AUTH_TYPES`. | Aligned stats/toggle scope and added test. |
| `3b14bf4a4` Devin CLI | DUPLICATE | Exact executor content already arrived in earlier Devin ACP port; the inspected upstream diff does not contain the planned MCP bridge. | No fabricated bridge port. |
| `6fcd27337` release | NOT APPLICABLE | Upstream release metadata only. | No action. |
| `9be6588cc` attribution removal | NOT APPLICABLE | DurinDoor retains source attribution. | No action. |
| `24fd165b0`, `f8e803944` README translations | NOT APPLICABLE | DurinDoor documentation diverges. | No action. |
| `15dfd8641` scrollbar polish | NOT APPLICABLE | Dashboard CSS diverges. | No action. |
| `6d96e24bd` catalog refresh | DUPLICATE | Local catalogs were refreshed independently. | No action. |
| `65ac9b3ce` quota row overflow | DEFERRED | Local quota UI was rewritten; no reproduced overflow in the current layout. | Revisit only with a local reproduction. |
| `e01f5421` dependency/release maintenance | DEFERRED | Covered by DurinDoor's own dependency workflow. | No port. |
| `576a451cb` CI-only lineage change | NOT APPLICABLE | Does not map to DurinDoor runtime or CI policy. | No port. |
| `2cb77bbca` Claude format detection | PORTED | Kebab-case `anthropic-version` body marker was ignored. | Added detection and regression test; relative-URL portion was not applicable. |
| `d53f9bd81`, `7b2e4b483` Responses usage | PORTED | Terminal completion could omit normalized usage. | Normalize aliases and always emit zero-filled terminal usage. |
| `9ee6435f0` Modal quota | DUPLICATE | Existing explicit quota regex already classifies JSON `"error":"usage limit reached"` as exhausted. | No code change. |
| `b6bcc491b` transient refresh | PORTED | All refresh failures consumed the normal retry budget and delay. | Added three immediate network/5xx retries without spending the normal budget. |
| `c790b57af` output effort | PORTED | Claude `output_config.effort` was dropped. | Forward verbatim, including `max`. |
| `455906c18` Ollama thinking | PORTED | OpenAI reasoning deltas were omitted from Ollama NDJSON. | Emit Ollama `message.thinking`. |
| `edd9b0d66` combo IDs | DUPLICATE | Local `SELECT *` includes `id`, and `rowToCombo` explicitly returns it. | No schema/query change. |

## Verification

- Focused regression tests passed after every port.
- `cd tests && npm run test:ci`: `Raw failures: 0`, `Known failures still failing: 0`, `Stale baseline entries now passing: 0`.
- `cd tests && npm run test:json && npm run gate`: zero raw failures and no baseline regressions.
- `npm run lint`: exit 0 with pre-existing warnings only.
- `npm run build`: production standalone build completed.
- `npm run verify:static`: isolated standalone/static-asset smoke passed on an ephemeral port and temporary data directory.
- Registry-index, documentation-integrity, and commitlint checks passed.
