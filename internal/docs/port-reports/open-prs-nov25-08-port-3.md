# Port batch 3: open upstream PR candidates

Source: [open-prs-nov25-08.md](open-prs-nov25-08.md), port candidates 17–24 in table order. The report has 21 port-candidate rows, so this batch is candidates 17–21. All are `decolua/9router` PRs. On 2026-11-25 each was still open at the head SHA in the source report, and its changed files were read with the GitHub API. No live provider was called.

Overall status: **complete**. Three rows ship changes here and two were already covered.

| Source row | PR | Final disposition | Evidence |
|---:|---:|---|---|
| 314 | [#4412](https://github.com/decolua/9router/pull/4412) | already present | The Gemini-family branch in [nonStreamingHandler.js](../../../open-sse/handlers/chatCore/nonStreamingHandler.js) builds usage with `toOpenAIUsage`. [usage.js](../../../open-sse/translator/concerns/usage.js) sums the parts when `totalTokenCount` is missing. A temporary test with 100 prompt, 40 candidate and 10 thought tokens and no total returned `total_tokens: 150` for the Gemini, Antigravity, Gemini CLI and Vertex targets. This fork counts thoughts as completion tokens; upstream counts them as prompt tokens, and that was not taken. |
| 316 | [#4396](https://github.com/decolua/9router/pull/4396) | ported in this change | See the #4396 notes below. Test: [port9r-4396-responses-tool-strict.test.js](../../../tests/unit/port9r-4396-responses-tool-strict.test.js). |
| 317 | [#4393](https://github.com/decolua/9router/pull/4393) | ported in this change | [errorConfig.js](../../../open-sse/config/errorConfig.js) now cools 500, 502, 503 and 504 for 5 seconds instead of the 30-second default. Text rules still come first, so rate-limit and overload messages keep their backoff. Test: [port9r-4393-transient-5xx-cooldown.test.js](../../../tests/unit/port9r-4393-transient-5xx-cooldown.test.js). |
| 319 | [#4389](https://github.com/decolua/9router/pull/4389) | ported in this change | See the #4389 notes below. Test: [port9r-4389-activation-model-locks.test.js](../../../tests/unit/port9r-4389-activation-model-locks.test.js). |
| 320 | [#4387](https://github.com/decolua/9router/pull/4387) | already present | Neither failure in the PR can happen here. A rule in [paramSupport.js](../../../open-sse/translator/concerns/paramSupport.js) removes `max_tokens`, `max_completion_tokens` and `max_output_tokens` from every Muse request on the `opencode` provider, and [opencode.js](../../../open-sse/executors/opencode.js) applies it before dispatch. So no small cap can leave a response empty, and no cap above 1,000,000 can be rejected. The rule came with commit `e9f0a3061ef` (the #3509 port) and is asserted by [opencode-muse-ox-alpha.test.js](../../../tests/unit/opencode-muse-ox-alpha.test.js). Upstream's clamp would send a cap again, so it was not taken. |

## #4396 notes

Ported:

- [grok-cli.js](../../../open-sse/executors/grok-cli.js): rebuilding a tool dropped `strict` in both the flat and the nested form.
- [opencode-go.js](../../../open-sse/executors/opencode-go.js): a `strict` declared only inside the nested `function` object was lost. [opencode.js](../../../open-sse/executors/opencode.js) uses the same rebuild for Muse models, so OpenCode Free is covered.
- [toolStrict.js](../../../open-sse/translator/concerns/toolStrict.js): the shared reader. It keeps `true`, `false` and `null`.

Already present: [codex.js](../../../open-sse/executors/codex.js) keeps a declared `strict`. [openai-responses.js](../../../open-sse/translator/request/openai-responses.js) sends `false` to Responses when a Chat tool declares none, and passes only booleans into Chat. [claude-to-openai.js](../../../open-sse/translator/request/claude-to-openai.js) carries only a boolean.

Not applicable: [opencode-zen.js](../../../open-sse/executors/opencode-zen.js) has no tool rebuild here and sends tool declarations unchanged. The new test asserts that.

## #4389 notes

Before this change, every write of `testStatus: "active"` cleared all `modelLock_*` fields. That included a token refresh after a request, so a lock on one model could disappear while still in force.

Now, in [connectionsRepo.js](../../../src/lib/db/repos/connectionsRepo.js):

- A passed test, a token refresh or another activation clears only expired or unreadable locks.
- A lock value in the update itself always wins. Upstream copies the stored lock over it, which would undo the explicit clears made after a Codex reset credit.
- A replaced credential still clears every lock. This covers saving a connection again, a changed API key, and updates marked `replacesCredential` by [OAuth reconnect](../../../src/lib/oauth/flowCompletion.js), [cookie import](../../../src/lib/providers/cookieImport/handlers.js) and [Cursor login](<../../../src/app/api/oauth/cursor/login/poll/route.js>). Upstream does not make this distinction.

This changes behaviour from the earlier #3830 port: testing a connection no longer lifts a cooldown that is still running. In [db-sqlite-vs-lowdb.test.js](../../../tests/unit/db-sqlite-vs-lowdb.test.js), two update-path tests now expect a future lock to stay and an expired one to clear. The two credential-resave tests are unchanged.
