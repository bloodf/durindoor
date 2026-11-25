# Ports from open upstream PR rows 241–280, part 4

Source: [rows 241–280 dispositions](open-prs-nov25-07.md), port candidates 25–32 in table order. The source report has 29 port-candidate rows, so this part covers candidates 25–29 (source rows 273–275, 277 and 278). Each PR's changed-file patch was fetched on 2026-11-25; all five heads matched the SHAs in the source report, and all five PRs were still open.

| Row | PR | Head SHA | Disposition | Evidence |
|---:|---:|---|---|---|
| 273 | [decolua/9router #4551](https://github.com/decolua/9router/pull/4551) | `dfd74f0b366a75302d618cccd70893b7c6b5c803` | **ported in this change** | Most of the gap had landed: the [stream converter](../../../open-sse/transformer/streamToJsonConverter.js) keeps both detail objects through `toResponsesUsage`, and `canonicalizeUsage` in [usageTracking.js](../../../open-sse/utils/usageTracking.js) reads nested cached and reasoning counts. The remaining gap was the Chat projection in [completionProjector.js](../../../open-sse/translator/response/completionProjector.js), which dropped reasoning tokens. It now reports `completion_tokens_details.reasoning_tokens` without changing totals. [Test](../../../tests/unit/port9r-responses-usage-details-4551.test.js). |
| 274 | [decolua/9router #4550](https://github.com/decolua/9router/pull/4550) | `b069cd4b4061503cafaedda734d835f78a36f324` | **ported in this change** | The [Cursor executor](../../../open-sse/executors/cursor.js) now maps the missing and renumbered exec variants and answers `shell_stream_args` and unknown variants with the empty diagnostics success. An MCP request with no tool name still fails the turn, as before and as upstream. [Test](../../../tests/unit/cursor-agent-exec-request.test.js). |
| 275 | [decolua/9router #4547](https://github.com/decolua/9router/pull/4547) | `813ec0dc074ae7d139ff927796c300ae2f1a4c30` | **already present** | Commit `2dbe101641f` (upstream #4667) maps `json_schema` and `json_object` to `text.format` in the [request translator](../../../open-sse/translator/request/openai-responses.js), and the [Codex executor](../../../open-sse/executors/codex.js) allowlists keep `text`. [Existing test](../../../tests/unit/port9r-structured-output-4667.test.js) passed. One difference stays: upstream fills in a missing schema name and makes a missing `strict` true; DurinDoor forwards only what the caller sent. |
| 277 | [decolua/9router #4545](https://github.com/decolua/9router/pull/4545) | `d12242f30bf56da9903bd9bc004f306cd872941b` | **ported in this change** | See the note below. [Name aliasing](../../../open-sse/utils/responsesToolNames.js) runs in the [OpenCode](../../../open-sse/executors/opencode.js), [OpenCode Go](../../../open-sse/executors/opencode-go.js) and [OpenCode Zen](../../../open-sse/executors/opencode-zen.js) Responses paths, with the limit in [appConstants.js](../../../open-sse/config/appConstants.js). [Test](../../../tests/unit/port9r-responses-tool-name-limit-4545.test.js). |
| 278 | [decolua/9router #4543](https://github.com/decolua/9router/pull/4543) | `16156aabbabfbcfd5d9f6f8205247058158de9f4` | **already present** | The [Codex executor](../../../open-sse/executors/codex.js) keeps an explicit flat or nested `strict` and leaves it unset otherwise (commit `079468fd0e3`, upstream #4110; extended by `9a142211f14`). [Existing test](../../../tests/unit/codex-tool-normalization.test.js) covers true, false and unspecified, and passed. |

## Tool-name limit note (#4545)

Upstream truncates each name to 64 characters. DurinDoor does not copy that:

- Two long names with the same first 64 characters would become one duplicated declaration. A long name now gets a prefix plus a hash of the full name, using the aliaser the translators already use. Names of 64 characters or fewer are unchanged.
- A shortened name must come back as the caller declared it, or the client cannot run the tool. The executors publish the alias map through `_toolNameMap`, which `chatCore` already reads.
- A probe before the change showed that only some response paths restored that map. Native Responses streams and bodies, and Chat streams translated from Responses, now restore it too. The same paths had also leaked the OpenCode free-tier fingerprint aliases.
- OpenCode Zen had no name clamp locally. Its Responses models get the same aliasing; its other formats are unchanged.

The Codex executor and the shared Chat-to-Responses translator still clamp at 128 characters. Upstream #4545 changes only the OpenCode executors, so neither changed here.

## Verification

Offline tests only; no live provider calls or credentials. New assertions for #4551, #4550 and #4545 failed before their fixes. After them, the related Cursor files passed. Of the 258 test files that reference the paths changed for #4545, 257 passed and one was skipped. The anti-slop lint gate passed. The full suite was not run.
