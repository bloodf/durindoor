# Port report — open PR batch 12, port candidates 9–16

Scope: port candidates 9–16 of [the batch 12 dispositions](open-prs-nov25-12.md), counted over port-candidate rows in table order. These are rows 463, 466, 467, 469, 470, 472, 473 and 475. On 2026-11-25 each current head SHA matched the one in that report.

Most of these PRs had already landed, which the source rows did not record. Each was checked against the current diff and current code, not only against commit titles. Where it helped, upstream test cases were also run from temporary files, adapted to DurinDoor import paths and helper names. Not every upstream test was run, and those files are not committed.

| Row | PR | Final disposition | Evidence |
|---:|---|---|---|
| 463 | [#3713](https://github.com/decolua/9router/pull/3713) | already present | Commit `2074e271c9a`. [The Antigravity executor](../../../open-sse/executors/antigravity.js) drops blank text parts and merges adjacent same-role turns, and [the Gemini request translator](../../../open-sse/translator/request/openai-to-gemini.js) skips blank assistant text. Both upstream tests passed. [The Antigravity bug tests](../../../tests/translator/bugs-antigravity.test.js) cover reasoning-only and tool-call histories. |
| 466 | [#3693](https://github.com/decolua/9router/pull/3693) | already present | Commit `1f53670f958`. [The Claude response mapper](../../../open-sse/translator/response/openai-to-claude.js) keeps a seeded `state.model` over the provider chunk model. Both upstream tests passed. See [the model echo test](../../../tests/translator/response-model-echo.test.js). |
| 467 | [#3689](https://github.com/decolua/9router/pull/3689) | already present | Commits `9cfa19be295` (metadata-only diagnostics) and `1483d1fb6da` (server-owned request IDs). The upstream correlation tests passed. Evidence: [correlation](../../../tests/unit/request-correlation.test.js), [request log redaction](../../../tests/unit/request-logger-redaction.test.js), [request detail redaction](../../../tests/unit/usage-request-details-redaction.test.js) and [MITM redaction](../../../tests/unit/mitm-logger-redaction.test.js) tests. |
| 469 | [#3665](https://github.com/decolua/9router/pull/3665) | already present | Commit `cfc6c597597`. `normalizeOpenRouterToolSchemas` in [the tool-call concern](../../../open-sse/translator/concerns/toolCall.js) drops invalid `pattern` regexes, keeps property names and data keywords, and does not mutate the input. [Combo capability detection](../../../open-sse/services/combo.js) requires `tools` for function tools. Evidence: [stream and schema tests](../../../tests/unit/force-stream-config.test.js) and [combo auto-switch tests](../../../tests/unit/combo-autoswitch.test.js). |
| 470 | [#3664](https://github.com/decolua/9router/pull/3664) | ported in this change | Commit `a988fbbab28` had ported the [Codex request constraints](../../../open-sse/executors/codex.js). The exact Spark IDs already reported 128K, and [combo model entries](../../../src/shared/models/modelListCombos.js) already carry a context length. One gap remained: `cx/gpt-5.3-codex-spark-high` and other effort-suffixed IDs reported the 400K family window and vision support. [Capabilities](../../../open-sse/providers/capabilities.js) now has a Spark pattern ahead of the family pattern. See [the suffix capability test](../../../tests/unit/codex-spark-suffix-capabilities.test.js). |
| 472 | [#3652](https://github.com/decolua/9router/pull/3652) | already present | Commit `080ea1c524a`. [System injection](../../../open-sse/rtk/systemInject.js) treats a Responses input item with no `type` as a message. See [the system injection tests](../../../tests/unit/system-inject.test.js). |
| 473 | [#3645](https://github.com/decolua/9router/pull/3645) | ported in this change | The [tool-call ID transport](../../../open-sse/translator/concerns/signatureTransport.js), request replay and streaming path were already present. One gap remained in [the non-streaming handler](../../../open-sse/handlers/chatCore/nonStreamingHandler.js): it held a signature for the next call only from `thought: true` parts. A bare or empty-text signature part was dropped. Any signed part now carries over, as in the streaming translator. See [the standalone signature test](../../../tests/unit/gemini-nonstream-standalone-signature.test.js). |
| 475 | [#3638](https://github.com/decolua/9router/pull/3638) | already present | [Public API admission](../../../src/sse/services/admission.js) uses [client key resolution](../../../src/sse/services/auth/clientApiKeys.js), which admits a valid CLI token when a key is required. [The dashboard guard](../../../src/dashboardGuard.js) accepts the same token, and [the model probe](../../../src/app/api/models/test/ping.js) sends it without needing a stored API key. A temporary check of the resolver confirmed that, when a key is required, requests with no token or a wrong token are rejected. [The key auth tests](../../../tests/unit/api-key-auth-expiry.test.js) cover the valid operator token. |

## Differences from the upstream diffs

These upstream assertions did not match, and DurinDoor behaviour was kept:

- #3652: when no system item exists, DurinDoor prepends a `developer` item. Upstream expects `system`.
- #3665: DurinDoor does not log a count of removed patterns. A function without `parameters` gains an `undefined` `parameters` key, which JSON serialization omits.
- #3689: stored request details and MITM dumps hold more redaction metadata than upstream's shape. In the MITM test, the checks for absent payload text and sensitive headers passed before the shape check failed. The request detail test passed, including its leak check, once its four exact-shape assertions were removed.
- #3638: upstream's `internalCliToken.js` and `isApiRequestAuthorized` do not exist here, so its auth test could not run unchanged. The temporary check used the DurinDoor resolver instead.

For #3664, the new pattern keeps the values of the exact Spark entries, including no published output cap. It does not take upstream's 128000 output cap. The pattern also applies to Spark IDs under other providers that lack their own entry.

## Not verified

No live provider call was made and no credentials were used. The full suite was not run. ESLint did not start in this worktree because it could not resolve `next/dist/compiled/babel/eslint-parser`, so the changed files were not linted.

Totals: 2 ported in this change, 6 already present, 0 not applicable. None remaining.
