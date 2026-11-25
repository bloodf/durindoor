# Open upstream PR ports, rows 81–120, batch 3

Source: [open-prs-nov25-03.md](open-prs-nov25-03.md), port candidates 17–24, counted among port-candidate rows in table order. The report has 17 port-candidate rows, so this batch holds one: candidate 17, source row 119.

The diff was fetched on 2026-11-25. The PR was open and unmerged, and its head matched the source report (`c0c23a1c722da59e6c4c99ee76cf8e2add89f3fe`). `git log --grep` found no earlier port of `#5135` on the starting commit.

| Row | PR | Final disposition | Evidence |
|---:|---|---|---|
| 119 | 9router #5135 | Ported in this change (suffix gap only) | Explicit effort needed no change: [grok-cli.js](../../../open-sse/executors/grok-cli.js) gates reasoning on model capabilities, not on upstream's `supportsGrokCliReasoningEffort` regex, which is absent from [grokCli.js](../../../open-sse/config/grokCli.js). Catalog rows such as `grok-4.6-low` and `grok-4.7-medium` still sent `high`, because [chatCore.js](../../../open-sse/handlers/chatCore.js) resolves the upstream id before dispatch. `grok-4.5-low` had the same defect. The executor now reads the suffix from the requested catalog id; an explicit effort still wins. `grok-build` and Composer still send no effort. The uncatalogued `grok-4.7-build-fast-low` already kept its suffix. Test: [grok-cli-chatcore-5135.test.js](../../../tests/unit/grok-cli-chatcore-5135.test.js). |

## Local defect fixed on the way

This fix is not part of #5135, but the ported behaviour could not run without it. It has its own commit, `fix(executors): give grok-cli dispatch a writable request context`.

`chatCore` freezes the request context it passes to `executor.execute`. `GrokCliExecutor.transformRequest` writes the session, request and turn ids onto that object. An offline run through `handleChatCore` returned 502 `Cannot add property grokCliSessionId, object is not extensible` for every `grok-cli` model tried, with nothing sent upstream. The local `origin/main` ref has the same freeze and the same writes. The earlier executor tests passed because they call `transformRequest` with no context or an unfrozen one. The executor now copies the context for each dispatch. The first `describe` block in the test above covers the dispatch and its three `x-grok-*` headers.

No live provider call was made, and no running deployment was checked.
