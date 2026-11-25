# Open upstream PR ports, rows 441–480, batch 3

Scope: port candidates 17–24 of [the rows 441–480 dispositions](open-prs-nov25-12.md), counted among port-candidate rows in table order.
That report has 17 port candidates, so this batch holds one source row. No production code or tests changed.

The head of the source PR was fetched with `gh api repos/decolua/9router/pulls/3629` and `/files` on 2026-11-25.
It is still `710d67f51ddd2ae8d80cb0751a328710d2d2a86a`.

| Row | Repo | PR | Final disposition | Evidence |
|---:|---|---:|---|---|
| 479 | decolua/9router | [#3629](https://github.com/decolua/9router/pull/3629) | already present | Commit `8fa32456cf7` (`port(upstream): #3629`, DurinDoor #727) is an ancestor of this branch. The hunk results are below. The remaining cache and index additions are not applicable. |

## Row 479 hunk by hunk

| Upstream hunk | Result | Evidence |
|---|---|---|
| Per-provider account selection lock | already present | [auth.js](../../../src/sse/services/auth.js) keys `selectionMutexes` by provider ID, removes the entry after release, and keeps queue order when a waiting request aborts. |
| Release sockets of a proxy pool evicted at the size cap | already present | `getDispatcher` in [proxyFetch.js](../../../open-sse/utils/proxyFetch.js) calls `close()` on the evicted pool without awaiting it. |
| `destroy()` instead of `close()` on eviction | not applicable | `destroy()` aborts requests that are in flight. The local `close()` lets long SSE responses drain, so the upstream call would be a regression. |
| Proxy keep-alive timeouts | already present | [proxyFetch.js](../../../open-sse/utils/proxyFetch.js) passes both timeouts from `PROXY_FETCH_POOL_CONFIG` in [runtimeConfig.js](../../../open-sse/config/runtimeConfig.js). The operator can change them with `FETCH_KEEPALIVE_TIMEOUT_MS`. The local default stays at 4 seconds; upstream hardcodes longer values as tuning. |
| Chunk arrays for streamed content and thinking | already present | Ported by `8fa32456cf7`. [stream.js](../../../open-sse/utils/stream.js) joins `contentChunks` and `thinkingChunks`; [stream-completion-chunks.test.js](../../../tests/unit/stream-completion-chunks.test.js) covers it. |
| Index-based SSE line extraction | already present | [stream.js](../../../open-sse/utils/stream.js) searches only the newly decoded text for a line end and splits only the completed part of the buffer. It also handles CR line endings, which the upstream loop does not. |
| Usage dedup query using `IS ?`, plus `idx_uh_dedup` | not applicable | [usageRepo.js](../../../src/lib/db/repos/usageRepo.js) has no field-equality dedup query. It dedups only on an explicit `usageEventId`, which [schema.js](../../../src/lib/db/schema.js) backs with the unique `idx_uh_usage_event` index. The upstream index would have no query to serve. |
| In-memory API key validity cache | not applicable | New cache, not a fix. A stored boolean would keep an expired key valid, because `validateApiKey` in [apiKeysRepo.js](../../../src/lib/db/repos/apiKeysRepo.js) checks expiry on each call. The upstream patch also has no invalidation for the local `rotateApiKey` path. No `apiKeyCache` exists locally. |
| In-memory settings and provider connection caches | not applicable | New caches, not fixes. [settingsRepo.js](../../../src/lib/db/repos/settingsRepo.js) has writers that the upstream invalidation does not cover, such as `consumeBackupCodeAtomic`. No `connectionCache` exists in [connectionsRepo.js](../../../src/lib/db/repos/connectionsRepo.js). |
| 30-second `/v1/models` cache with `Cache-Control: public` | not applicable | New response cache. The local [models route](../../../src/app/api/v1/models/route.js) filters the list by each key's model access rules. A shared or public cache could serve one key's list to another. |

The upstream test file targets the caches and the other hunks together, so it was not copied. No new behaviour was ported, so this batch adds no test and no port commit.
