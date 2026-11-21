# #1072 — 9router #5793 existing refresh-retry response behavior

Audit date: 2026-11-21. Each source row below is pinned to the exact audited open-PR head in the isolated public scratch repository. Dispositions compare that patch with the installed DurinDoor tree and its offline fixtures; no provider credentials, live traffic, paid calls, or new integrations were used.

## Dispositions

| 9router row and exact source head | Disposition | Current DurinDoor evidence |
|---|---|---|
| [#5793](https://github.com/decolua/9router/pull/5793) — [`628aaddea320a9f7329983099a307ae019c367d2`](https://github.com/decolua/9router/commit/628aaddea320a9f7329983099a307ae019c367d2) | **Refresh-retry response retained even on non-2xx.** The source's only runtime hunk retains any returned refresh-retry response body even when the status is non-2xx (e.g., 403). DurinDoor lines ~1618 in `afe8d691d18cbfc72072161b90806d1a392943aa` already adopt and reparse that response, extracting the refresh metadata for downstream use. Thrown/absent paths retain original parsed evidence and handle local cancellation/accounting without swallowing the retry state. | `src/sse/handlers/chat.js` (~line 1618): response reparse after refresh; `open-sse/handlers/chatCore.js`: refresh metadata extraction; fixtures: `tests/unit/refresh-retry-response.test.js` (403 retention, no replacement token, pre-response throw). |

## Follow-up assessment

The PR #5793's core behavior — preserving the refresh-retry response body across non-2xx statuses — is already represented in DurinDoor's runtime at `src/sse/handlers/chat.js` lines around 1618. The reparse path extracts refresh metadata (token, deadline, project ID) for downstream use, while thrown/absent paths preserve the original parsed evidence and perform local cancellation/accounting. No gap is established; the existing offline fixtures cover the 403-retain-no-replacement-token and pre-response throw cases referenced in the authored tests.

Refs #1072 and #800.
