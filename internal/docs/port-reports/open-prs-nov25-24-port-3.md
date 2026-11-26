# Port report — open PR batch 24, port candidates 17–24

Scope: port candidates 17–24 of [the batch 24 dispositions](open-prs-nov25-24.md), counted over port-candidate rows in table order. The source has 18 such rows, so this range is candidates 17 and 18. On 2026-11-26 each PR was open and its current diff was fetched with `gh api`. Each head matched the SHA in its source row. `git log --grep` found no earlier commit on this branch that names either PR number.

| Row | PR | Final disposition | Evidence |
|---:|---|---|---|
| 955 | OmniRoute [#20103](https://github.com/cheaper-inference/OmniRoute/pull/20103) | ported in this change | The gap was real for both Azure ids. With no endpoint, `azure-openai` sent the request to the registry's example host and `azure` sent it to api.openai.com, each with the Azure key. [Connection creation](../../../src/lib/providerRouteHandlers.js) now answers 400 through [the endpoint check](../../../src/lib/providerNormalization.js). `azure-openai` needs `providerSpecificData.baseUrl`. `azure` needs `providerSpecificData.azureEndpoint` or the `AZURE_ENDPOINT` fallback its executor reads. Stored connections and updates are not checked, as upstream. Test: [Azure endpoint](../../../tests/unit/azure-endpoint-required-omni-20103.test.js). The other seven features are listed below. |
| 958 | OmniRoute [#20093](https://github.com/cheaper-inference/OmniRoute/pull/20093) | ported in this change | Partly present: a capacity 503 already skipped in-place retries. Any other transient 503 was retried up to three times on one account. In the new test, a second account waited behind three 9-second retries. [The account loop](../../../src/sse/handlers/chat/singleModel/providerHooks.js) now asks [a read-only probe](../../../src/sse/services/auth/alternateAccount.js) whether another account is usable. If so, [the executor](../../../open-sse/executors/base.js) returns the 503 unretried. Test: [503 failover](../../../tests/unit/antigravity-503-account-failover-omni-20093.test.js). |

## #20103 members other than the Azure check

| Member | Disposition | Evidence |
|---|---|---|
| Bedrock IAM static keys | already present | [Bedrock credentials](../../../open-sse/shared/awsCredentials.js) select a static key pair from `providerSpecificData.accessKeyId`. The field name differs from upstream. |
| Ollama Cloud web fetch | already present | The [Ollama registry entry](../../../open-sse/providers/registry/ollama.js) declares `fetchConfig`, and [the fetch handler](../../../open-sse/handlers/fetch/index.js) serves provider `ollama`. |
| ElevenLabs Scribe speech-to-text | not applicable | New upstream feature. The [ElevenLabs entry](../../../open-sse/providers/registry/elevenlabs.js) serves text-to-speech only. `open-sse/config/audioRegistry.ts` is absent. |
| Vertex embeddings | not applicable | New upstream feature. The [Vertex entry](../../../open-sse/providers/registry/vertex.js) declares no embedding service. `open-sse/handlers/vertexEmbeddings.ts` is absent. |
| Moonshot region probe | not applicable | New opt-in upstream feature. `src/lib/providers/validation/moonshotRegionProbe.ts` is absent. |
| Grok Build reasoning efforts | not applicable | New opt-in upstream feature. `src/shared/services/grokBuildConfig.ts` is absent. |
| Real Ollama tags list | not applicable | New opt-in upstream feature behind `OMNIROUTE_OLLAMA_REAL_TAGS`. [The tags route](../../../src/app/api/tags/route.js) returns its fixed list. |

## Notes

- The dashboard add form has no endpoint field for `azure-openai`, before or after this change. Such a connection is now refused at save instead of failing on its first request. It can be created through the API, as [the provider guide](../../../docs/providers/api-key-providers.mdx) says. A form field is a follow-up.
- The failover also covers the `agy` alias, which shares the Antigravity executor. Upstream names only `antigravity`.
- A pinned request, the last usable account, mid-stream empty-reply recovery and long-decode continuation keep their same-account retries. A 429 is unchanged.
- The probe runs [the selector's](../../../src/sse/services/auth.js) filters and stops before the pick. It does not run the live quota refresh. If that refresh later refuses the second account, the request can end with the 503 that was not retried.
- The long-decode continuation guard has no test of its own.

## Checks

Each new test file was run before its fix and failed on the gap. The mid-stream test was also run with its guard removed, and failed.

- Azure: the new file passed. Then the unit files that name Azure or use the connection creation path passed (76 files, 1293 tests).
- Antigravity: unit files selected by name (account, auth, chat, combo, executor and Antigravity) or by reference to the changed modules, 349 files in three batches. 347 passed and 2 were skipped (6339 tests passed, 11 skipped).
- Gates: the two new files with the docs, Storybook inventory, model catalog and settings checks passed (6 files, 24 tests).
- The anti-slop lint gate reported no diagnostics. ESLint and the full suite were not run.

## Network incident and limits

Two early runs of the Antigravity test, while it was being written, reached Google's Cloud Code host. It answered 401. The requests carried only made-up tokens, made-up project ids and the prompt "ping". No stored credential was read, because the test uses a temporary data directory. The run may also have tried a token refresh with a made-up refresh token; its destination was not confirmed.

Cause: loading the real `proxyFetch` module through a mock replaces the global `fetch` stub, and that module dials Google hosts over `node:https`. The committed test calls its synthetic upstream directly and fails on any socket connection.

Later Antigravity test runs and the final gate run used a preload that refused non-loopback connections. The 349-file run logged refused attempts to example.com, Cursor, Kimi, AI Horde, OpenCode, 1.1.1.1 and dns.google, and its tests passed. Which files made them was not traced. The Azure runs and the first gate run had no preload, so they are not proven offline.

Totals: 2 ported in this change, 0 already present, 0 not applicable. None remaining.
