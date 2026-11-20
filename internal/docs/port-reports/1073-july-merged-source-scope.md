# #1073 — July OmniRoute merged-source scope

Reviewed 2026-11-20 against DurinDoor `41975cce6` on `orq/tornf6/audit-omni-july-merged-metadata-a1-l2`.

This report qualifies the July 2026 merged-PR source window requested in [DurinDoor #1073](https://github.com/bloodf/durindoor/issues/1073). The issue archive is a navigation index collected on 2026-10-08, with source labels such as `diegosouzapw/OmniRoute`; it is not the July count authority or a behavior verdict. The source of truth for this window is the renamed upstream repository, `cheaper-inference/OmniRoute`, and its merged timestamps, merge commits, and changed paths.

This is a static metadata and code comparison. No source code was changed, no live provider or credential was used, no vulnerability was reproduced, and no source or owner contact was made. The private scratch inventory is not committed. The counts below are not an exhaustive adjudication of every PR.

## July count and boundaries

The requested query is `repo:cheaper-inference/OmniRoute is:pr is:merged merged:2026-07-01..2026-07-31`. GitHub reports **1,526** matching merged PRs. Since GitHub issue search caps a query at 1,000 results, I independently verified the total with non-overlapping inclusive weekly slices:

| Upstream merged-date slice | Matching PRs |
| --- | ---: |
| 2026-07-01..2026-07-07 | 422 |
| 2026-07-08..2026-07-14 | 233 |
| 2026-07-15..2026-07-21 | 453 |
| 2026-07-22..2026-07-28 | 405 |
| 2026-07-29..2026-07-31 | 13 |
| **Total** | **1,526** |

Each slice is below the search limit, uses the same repository, merged-state and date predicates, and shares no boundary date with the next slice. The total is therefore not a count of DurinDoor fork merges.

## Source metadata method

The five search slices supplied the upstream PR numbers, titles and exact `merged_at` timestamps. I queried upstream GraphQL in batches of 20 PR aliases for each PR's number, title, merge timestamp, `mergeCommit.oid`, and changed paths. Nineteen PRs reported more than the first 100 changed files; their `files` connections were cursor-paginated until complete. All 1,526 rows have a complete path list matching GraphQL `totalCount`, totaling 19,833 changed-file path entries across 5,538 distinct paths.

GraphQL returned no merge commit oid for PR #6013. Its read-only pull-request metadata supplied `merge_commit_sha` `42503e58767fee27e3164c8a25ad14a9c8e23e99`; its merged timestamp and changed paths still matched the search result. The other 1,525 rows have GraphQL merge commit oids. The merge commit—not a PR-number range or a later branch head—is the source-tree anchor for each row.

The archive remains useful for locating records and historical context. Its suggested area and intake labels are not proof of applicability. Source paths only route review: they do not establish behavior, local equivalence, or a gap. For example, the July metadata contains 729 PRs touching `open-sse/`, 264 touching `src/app/api/`, 335 touching `src/lib/`, and 78 touching `.github/workflows/`; these sets overlap and are not scope totals.

## Confirmed already present in DurinDoor

These examples were confirmed against source changes and existing DurinDoor code/tests. They are not inferred from similar titles.

- **OmniRoute #6597**, merge `d76153c7bb5872bd621321040e5aa19bdd6abe57`: refusing Cloudflare AI non-text content parts avoids silently deleting image input while flattening text-only arrays. DurinDoor [PR #167](https://github.com/bloodf/durindoor/pull/167) ports that behavior through the shared `stripUnsupportedParams` path. `tests/unit/param-support.test.js` asserts that an `image_url` part throws and remains in the input object (lines 31–50); `open-sse/executors/default.js` invokes the helper at the executor boundary (line 456).
- **OmniRoute #6208**, merge `286fdf8794ce96290753a2dec4cbc9d09a5cb1a9`: distinguishes a generated ChatGPT Web image whose asset cannot be resolved from a response that produced no image. DurinDoor [PR #972](https://github.com/bloodf/durindoor/pull/972) already carries the equivalent `detectImageResolutionFailure` classification in `open-sse/executors/chatgpt-web-http.js` (lines 1238–1247) and passes the marker to the existing image-generation response path. `tests/unit/chatgpt-web-http-async-image-ws-shapes-7357.test.js` checks the marker and error mapping (lines 214 and 431).
- **OmniRoute #5832**, merge `4d7f36015ab2fd1f1014e159723896d31713dc7c`: retains reasoning summary snapshots when no matching summary delta was streamed and avoids replaying a summary already seen under a rotated item id. DurinDoor [PR #2067](https://github.com/bloodf/durindoor/pull/2067) has the equivalent, wider id-and-output-index tracking in `open-sse/translator/response/openai-responses.js` (lines 1001–1023). `tests/unit/omni-responses-mixed-reasoning.test.js` covers rotated ids and a separate unseen output item; `tests/unit/responses-snapshot-source-order.test.js` covers terminal snapshots and repeated completion events.
- **OmniRoute #6510**, merge `fd4133df82f2cdfe4a55c516d8f5a6e924c3b550`: uses a Windows-only shell option so the Auggie `.cmd` shim can spawn under supported Node versions. DurinDoor [PR #1004](https://github.com/bloodf/durindoor/pull/1004) already includes this behavior: `open-sse/executors/auggie.js` builds the spawn option with `shell: isWin` (lines 42–53), and `tests/unit/14215-auggie-win32-spawn.test.js` asserts Windows-on, non-Windows-off, and stdio preservation.

## Out-of-scope examples confirmed from changed files

These examples are excluded by the stated lane because their diffs implement new providers/integrations or workflow maintenance. The source path was a triage signal; the changed files establish the disposition.

- **OmniRoute #6373**, merge `c6a80071f1617daec7a5d815bc9422c084befb88`, adds a DigitalOcean registry entry, provider constants and registration tests. This is a new provider.
- **OmniRoute #6118**, merge `04335944ead8f858bcb3ba07d736a0c05dca90d0`, adds Zed Hosted registry/executor and OAuth sign-in files. This is a new provider integration and sign-in flow.
- **OmniRoute #6218**, merge `059dbe9f13d8c2df0eb91fb4f16d0d01a7e72c84`, changes `.github/workflows/quality.yml`, quality baselines, lint configuration and CI collection scripts. This is workflow/quality maintenance.

These examples do not classify every similarly labeled row. A mixed PR needs its changed behavior read individually; a `fix` prefix or a path under `open-sse/` does not make a change in scope by itself.

## Concrete existing-module gap

### #5770 — avoid direct fallback for a non-replayable proxy request body

**Upstream source:** [OmniRoute PR #5770](https://github.com/cheaper-inference/OmniRoute/pull/5770), merged 2026-07-01; merge commit [`7581b752af720c43eb60bee9923bfc87a62f4c49`](https://github.com/cheaper-inference/OmniRoute/commit/7581b752af720c43eb60bee9923bfc87a62f4c49). It changes `open-sse/utils/proxyFetch.ts` and its offline retry test. The change detects stream-like bodies and body-bearing/used `Request` objects, avoids replaying them through retry or native fallback, and keeps the original dispatcher error.

**DurinDoor surface:** `open-sse/utils/proxyFetch.js`, `proxyAwareFetch` (lines 781–788, 886–916). In the ordinary non-strict `ProxyAgent` branch, a failed proxied `originalFetch` reaches the catch at lines 902–910 and calls `sendDirect()` with the same `options`. No stream-like body, `Request.body`, or `Request.bodyUsed` replay guard appears in this path. The caller can therefore hand a consumed or locked body to the direct fallback. The specialized `directTransport.withProxy` branch already fails instead of direct-fallback; `strictProxy` also fails closed. The candidate gap is limited to the ordinary non-strict dispatcher path.

This is a verified static control-flow gap in an existing proxy module. I did not run a request or attempt to reproduce provider traffic. Acceptance evidence for a follow-up fix:

1. A synthetic stream-like `options.body` that is consumed/locked before a mocked proxy transport error causes one proxy attempt, zero direct attempts, and propagation of the original proxy error (with only a safe local diagnostic if one is needed).
2. A body-bearing `Request` and an already-used `Request` also skip retry/direct fallback. The guard must not read or clone the body to decide this.
3. Replayable string, buffer, and URL-encoded bodies retain the existing non-strict direct-fallback behavior.
4. `strictProxy`, the `directTransport.withProxy` error path, abort propagation, and quota-dispatch failures keep their current behavior.
5. Coverage uses injected fetch/dispatcher dependencies from `proxyFetch.js`; it makes no network request and does not exercise a live provider.

## Reviewed but not promoted to a gap

- **OmniRoute #5893**, merge `8d2c06f5683f00e17b80081aa32e4e5996a9951c`, strips Next.js `x-middleware-*` response-control headers before forwarding successful non-stream responses. DurinDoor's normal output paths do not forward those upstream headers: `open-sse/handlers/chatCore/nonStreamingHandler.js` constructs a new response with fixed JSON or CORS headers (lines 787–823), and `streamingHandler.js` returns its fixed `SSE_HEADERS` (line 259). That mechanism makes the documented successful-response failure absent on these paths; this comparison does not settle whether any separate error path should filter such headers.
- **OmniRoute #6451**, merge `62a74faa4b94dd2b757ace9281f40cf923934d7a`, redacts `Set-Cookie` in its MITM inspector hook before storing response headers. DurinDoor's general `sanitizeHeaders` includes `set-cookie`, but the upstream inspector hook/path is not present under the same module shape here. I did not treat the similar header name alone as proof of equivalent inspector behavior or a verified gap.

## Limits

- The count and path inventory are complete for the specified July query; behavior adjudication is deliberately selective.
- No title, suggested archive area, or path-only match is a behavior verdict.
- The unresolved item is one concrete code comparison, not a claim that it is the only July gap.
- No source patch was applied, and the acceptance conditions above are not executed test results.
- Bulk search and GraphQL payloads remain in private mode-0700 scratch at `/tmp/durindoor-omni-july-mg7fnibh`; they are not part of this commit.

Refs #1073
