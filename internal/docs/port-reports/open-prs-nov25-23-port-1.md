# Port report — open PR batch 23, port candidates 1–8

Scope: port candidates 1–8 of [the batch 23 dispositions](open-prs-nov25-23.md), counted over port-candidate rows in table order. The source has six such rows, so this report covers all of them. On 2026-11-25 each PR was open and its current diff was fetched with `gh api`. Each head matched the SHA in its source row. `git log --grep` found no commit on this branch that names any of the six PR numbers.

| Row | PR | Final disposition | Evidence |
|---:|---|---|---|
| 882 | OmniRoute [#20396](https://github.com/cheaper-inference/OmniRoute/pull/20396) | ported in this change | The upstream truncation did not occur here: a 520-character reply followed by a finish frame with nested usage arrived whole before the change. The missing part was masking of usage strings. [Response masking](../../../open-sse/services/responseMasking.js) now masks every string inside a payload's top-level `usage`, in JSON and SSE, and redacts an unclosed private-key block to the end of that string. Not covered, as upstream: nested `response.usage` and `message.usage`, and Gemini `usageMetadata`. Test: [usage masking](../../../tests/unit/port-omni-20396-masking-usage-tail.test.js). |
| 888 | OmniRoute [#20375](https://github.com/cheaper-inference/OmniRoute/pull/20375) | ported in this change | DurinDoor called the legacy host and per-endpoint routes. [The executor](../../../open-sse/executors/chatplayground.js) and [its wire helpers](../../../open-sse/executors/chatplaygroundStream.js) now use the unified `/api/chat` body, parse its event stream for streamed and buffered replies, validate with `/api/me`, read `slug` catalog rows and use the new Clerk mint contract. The [registry](../../../open-sse/providers/registry/chatplayground.js), model discovery in `src/app/api/providers/[id]/models/modelsConfig.js`, the [cookie capture extension](../../../extensions/provider-cookie-capture/providers.js) and the [public guide](../../../docs/providers/chatplayground.mdx) moved to the web origin. Test: [unified API](../../../tests/unit/port-omni-20375-chatplayground-unified-api.test.js). See the notes below. |
| 899 | OmniRoute [#20343](https://github.com/cheaper-inference/OmniRoute/pull/20343) | ported in this change | A catalog model already got a model-only lock. A paid model outside the catalog took the account-wide `__all` lock. [A provider rule](../../../open-sse/config/providerErrorRules.js) now marks this 403 as model-only, so such an id rotates without a lock. The lock time follows the existing free-tier policy, not upstream's six hours. Not adopted: the upstream catalog sweep, which adds and removes model ids from a live catalog that was not checked here. Test: [paid-plan 403](../../../tests/unit/port-omni-20343-cloudflare-paid-model.test.js). |
| 903 | OmniRoute [#20335](https://github.com/cheaper-inference/OmniRoute/pull/20335) | ported in this change | `DURINDOOR_CLAUDE_TOOL_TYPE_REJECTING_PROVIDERS` lists provider ids. For them, [chat dispatch](../../../open-sse/handlers/chatCore.js) removes only `type: "custom"`, also when the provider declares `requireClaudeToolType`. Unset, nothing changes. It is an environment variable, as upstream, so the settings schema is unchanged. Not adopted: upstream's built-in `agentrouter` and `deepseek` entries, which are not part of this PR's diff. [Environment reference](../../../docs/reference/environment.mdx). Test: [reject list](../../../tests/unit/port-omni-20335-claude-tool-type-rejecting.test.js). |
| 918 | OmniRoute [#20266](https://github.com/cheaper-inference/OmniRoute/pull/20266) | ported in this change | Partly present: `6181e4aa158` (9router #4381) rotated and locked only the model for catalog ids. For an id outside the catalog, such as `gpt-5.6-sol-high`, the #2315 guard returned no fallback. [The classifier](../../../open-sse/services/accountFallback.js) now rotates for any id on this Codex refusal and writes no lock when the id has no bounded scope. Generic wrong-model errors stay terminal. Not adopted: upstream's persisted six-hour exact-model lock and its `model_not_supported` result. A later request can therefore try a refusing account again. Test: [account rotation](../../../tests/unit/port-omni-20266-codex-account-model-rotation.test.js). |
| 919 | OmniRoute [#20239](https://github.com/cheaper-inference/OmniRoute/pull/20239) | ported in this change | [Cloaking](../../../open-sse/utils/claudeCloaking.js) now seeds the synthetic device and account ids from the connection id, and from the token only without one. Each existing OAuth connection gets a new identity once. The PR calls this a proposal for its maintainer; the batch 23 row accepted it as a candidate. The session id was already keyed by connection or client session. Test: [identity](../../../tests/unit/port-omni-20239-claude-identity-connection.test.js). |

## ChatPlayground notes

The upstream author reported checking the new contract against the live site on 2026-11-16. Nothing here contacted ChatPlayground or Clerk. All checks use closed mocks.

- Tests that mocked the old contract now mock the new one. The test for the `CHAT_ID` marker was removed with the marker stripper.
- Not adopted: dropping identical consecutive event lines. Network chunk boundaries cannot separate a replayed line from a real repeated token. If the live site does repeat lines, text will appear twice.
- Unlike upstream, a reply without a `finish` event is an error. Upstream reports it as a normal stop.
- Not adopted: the usage quota reader and the bundled offline catalog, which DurinDoor did not have. File-id attachments and `conversationId` are not forwarded. Every request sends `noSave: true`, as the earlier DurinDoor request did for its main route; upstream's opt-in variable is not added.
- Unverified: the dashboard Validate probe and the web login ready probe still send the raw cookie, now to `/api/me`. The upstream guide says the API needs a minted bearer token. If so, these probes can reject a valid cookie. Chat and the executor's own checks mint the token.
- Saved model ids from the old `botId` catalog may not match a new `slug`.
- Only the ChatPlayground row of the provider catalog was edited. The generator also reports other, older drift.

## Checks

Each new test file was run before its fix and failed, except the ChatPlayground file, which was written with the new code. The failing old-contract fixtures confirmed that change.

- Masking: the new file and seven existing masking and stream files (8 files, 336 tests).
- Cloudflare: the new file, the provider-rule files and the request-scoped 4xx file (10 files, 137 tests).
- Tool type: the new file and one existing file (2 files, 8 tests).
- Codex rotation: the new file and the files that use the fallback classifier (50 files, 550 tests).
- Claude identity: the files that mention the cloaking, Claude preparation or identity fields (60 files, 909 tests).
- ChatPlayground: the new file and the provider, redirect, quota send, registration, cookie import and secret files (11 files, 387 tests).

The anti-slop lint gate reported no diagnostics. ESLint and the full suite were not run. No live provider was called.

Totals: 6 ported in this change, 0 already present, 0 not applicable. None remaining.
