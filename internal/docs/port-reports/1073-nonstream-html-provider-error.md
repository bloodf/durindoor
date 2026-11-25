# #1073 — Report unusable upstream HTML on the existing non-stream error path

Reviewed 2026-11-21 against DurinDoor `cd63757f5cc7666b1f235b8f5a056846571c76ef` on branch
`orq/tornf6/port-omni-nonstream-html-provider-error-a1`. Source:
[`cheaper-inference/OmniRoute`](https://github.com/cheaper-inference/OmniRoute).

This is the focused port of one residual recorded as applicable-but-not-nominated in
[`1073-april-stream-transport.md`](./1073-april-stream-transport.md) ("HTML provider error page distinguished in the 502
path", source PR #1104 part (a)). It changes the diagnostic on one already existing error path. It adds no provider, no
protocol surface, no credential handling, no retention behavior and no dashboard surface.

## Source pins

| Item | Value |
| --- | --- |
| Upstream pull request | [#1104](https://github.com/cheaper-inference/OmniRoute/pull/1104) — "fix: add row count limits to prevent DB bloat and handle HTML error responses" |
| Upstream head SHA | `d0efab8222df9e63050f6f90dae91ccd520eba66` |
| Upstream merge SHA | `f8045744b3ec0974eeb0ac3feb0ab039302592af` |
| Merge shape | squash, one parent `54d908c6247a4b405dad9718dadfe7aecaa54623` |
| Diff base used | first parent `54d908c624` → merge tree `f8045744b3` |
| Source mirror | `/var/tmp/durindoor-omniroute-source.4eUb6QtM/source.git` |

The upstream first-parent diff touches exactly six paths:

```
M  open-sse/handlers/chatCore.ts
M  src/app/(dashboard)/dashboard/settings/components/SystemStorageTab.tsx
M  src/app/api/storage/health/route.ts
M  src/lib/compliance/index.ts
M  src/lib/logEnv.ts
M  tests/unit/log-retention.test.mjs
```

The pull-request head `d0efab8222df9e63050f6f90dae91ccd520eba66` is the merge base `4cd43f9c936a09067ef592f71b54962403fc8946`
plus three branch commits (`830ef35ae6` the change itself, `493c9f69ef` the review feedback, `d0efab8222` a test
placeholder fix). The head's `open-sse/handlers/chatCore.ts` diff is byte-identical to the merged first-parent diff
for that path, so the merged result and the pull-request head carry the same HTML-detection behavior.

Only `open-sse/handlers/chatCore.ts` carries the behavior this port concerns. Its upstream hunk, in the non-streaming
branch of `handleChatCore` (`if (!stream) { … }`), replaces the `JSON.parse(rawBody)` catch:

```ts
const isHtmlResponse =
  rawBody && typeof rawBody === "string" && /^\s*(?:\s|<!|<[a-zA-Z]|<\?xml)/.test(rawBody);
…
const invalidJsonMessage = isHtmlResponse
  ? "Provider returned HTML error page instead of JSON - check credentials and endpoint"
  : "Invalid JSON response from provider";
```

The other five paths are the row-count retention cap (`src/lib/logEnv.ts`,
`src/lib/compliance/index.ts`, `src/app/api/storage/health/route.ts`, `SystemStorageTab.tsx`) and its upstream test.
That part is out of scope for this task and is not ported — see "Excluded from this port".

## The local gap, verified

The fork already owns the equivalent error path, split into its own module:
`open-sse/handlers/chatCore/nonStreamingHandler.js`. Before this change, the non-SSE branch of
`handleNonStreamingResponse` caught every unparseable provider body and returned one generic diagnostic.
Line numbers below are the post-change tree:

- `open-sse/handlers/chatCore/nonStreamingHandler.js:619` — the `else` branch that owns the plain-JSON provider body
- `open-sse/handlers/chatCore/nonStreamingHandler.js:620` — `JSON.parse(responseText)` on the raw provider body
- `open-sse/handlers/chatCore/nonStreamingHandler.js:622` — the `catch` around that parse
- `open-sse/handlers/chatCore/nonStreamingHandler.js:623` — the `parseJsonWithTrailingDone` recovery attempt
- `open-sse/handlers/chatCore/nonStreamingHandler.js:624` — the branch that returns the parse-failure 502

The generic diagnostic on that path was `Invalid JSON response from ${provider}`; the only other generic message in
the same function belongs to a different branch (`open-sse/handlers/chatCore/nonStreamingHandler.js:644`, a body that
parsed as JSON but is not a record) and is not touched by this port.

The gap was reproduced offline before any edit, by driving the production handler with a generated HTML error page.
An HTML body and a plain-text body were indistinguishable:

```
<!DOCTYPE html><html><body>502 Bad Gateway</body></html>  →  {"status":502,"error":"Invalid JSON response from galadriel"}
  not json at all                                            →  {"status":502,"error":"Invalid JSON response from galadriel"}
```

A whole-tree search of `open-sse/` and `src/` found no HTML sniffing helper on a provider response body and no
`html_error_response` reason anywhere. The `DOCTYPE` and `text/html` hits that do exist are HTML *being served* or
*being requested* — the local OAuth success/deny pages (`src/lib/oauth/utils/server.js`,
`src/app/api/mcp-gateway/oauth/[id]/[action]/route.js`) and the `text/html` `Accept` header of the ChatGPT-web HTTP
executor (`open-sse/executors/chatgpt-web-http.js:393`) — not detection of an upstream error page.

## What this port changes

One file: `open-sse/handlers/chatCore/nonStreamingHandler.js`.

1. **Detection helper** (`open-sse/handlers/chatCore/nonStreamingHandler.js:65`, `open-sse/handlers/chatCore/nonStreamingHandler.js:73`).
   `isHtmlErrorPageBody(text)` recognizes an upstream HTML/XML error page by its marker set — a doctype or comment
   (`<!`), a tag (`<` plus a letter) or an XML declaration (`<?xml`) — after leading whitespace is skipped.

2. **Differentiated diagnostic** (`open-sse/handlers/chatCore/nonStreamingHandler.js:632`).
   On the parse-failure path only, an HTML error page returns
   `Provider returned HTML error page instead of JSON - check credentials and endpoint`; every other unparseable body
   keeps the fork's existing `Invalid JSON response from ${provider}`.

3. **Request-log marker** (`open-sse/handlers/chatCore/nonStreamingHandler.js:634`).
   The HTML case records `FAILED 502 (html error page)`; the generic case keeps `FAILED 502` exactly. This is the local
   analog of upstream's `html_error_response` failure reason, and it follows the fork's existing convention of putting
   the reason in parentheses (compare `FAILED 502 (empty content)` and `FAILED 502 (fake success: …)`).

### Preserved semantics

| Aspect | Behavior before | Behavior after |
| --- | --- | --- |
| Response status code | 502 BAD_GATEWAY | 502 BAD_GATEWAY (unchanged) |
| Error envelope | `createErrorResult` → `errorResponse` → `{error:{message,type,code}}` with `server_error` / `bad_gateway` | unchanged |
| Retry / fallback | the 502 drives the caller's retry and combo fallback | unchanged (same status code) |
| Admission / quota | `finalizeBufferedResult` settles the request as `malformed_terminal` | unchanged |
| Usage | no usage row is written on this path | unchanged |
| Other parsing | `parseJsonWithTrailingDone` recovery, the `isJsonRecord` guard and the ClinePass unwrap are untouched | unchanged |
| SSE branch | `Invalid SSE response for non-streaming request` is a separate upstream path and is not touched | unchanged |

### No raw upstream content is recorded, returned or logged

Upstream's hunk also stores the first 500 raw characters of the HTML body
(`providerResponse: isHtmlResponse ? { _raw: rawBody?.slice(0, 500) } : normalizedProviderPayload`). That part is
**deliberately not ported**: this port records, returns and logs no upstream body text and no upstream request detail.
The client-facing message names only the fact and the two things an operator can check. The console line on this path
keeps its existing form (`Failed to parse JSON from ${provider}: ${err?.name}`) and still carries no body text.
The fixture `tests/unit/omni-nonstream-html-provider-error.test.js` asserts that neither the error result nor the
response body contains any part of the upstream page.

## Divergence from the merged upstream expression, and why

The merged upstream expression is `/^\s*(?:\s|<!|<[a-zA-Z]|<\?xml)/`, tested against the **untrimmed** body. Its
leading `\s` alternative is reachable after the `^\s*` prefix backtracks, so the pattern matches any body that merely
starts with whitespace. The upstream "generic non-JSON" case was therefore unreachable for an indented plain-text body.

Measured on the merged upstream expression (offline, no provider traffic):

| Body | Merged upstream regex | This port |
| --- | --- | --- |
| `<!DOCTYPE html>…` | HTML | HTML |
| `<html>…` | HTML | HTML |
| `<?xml version="1.0"?>…` | HTML | HTML |
| `  <html>…` (indented HTML) | HTML | HTML |
| `not json at all` | generic | generic |
| `  not json at all` | **HTML** (over-match) | generic |
| `   ` (whitespace only) | **HTML** (over-match) | generic |
| `{"a":1}` / `[1,2,3]` / `null` | generic | generic |
| `<3` | generic | generic |

The upstream pull-request head used `/^(\s|<!|<[a-zA-Z][a-zA-Z0-9]*|<\?xml)/` on the **trimmed** body, which keeps the
same marker set but requires one of the markers to be present; the review-feedback commit `493c9f69ef` states its
intent as "removing redundant `\s` after trim()" and "preserve `\s*` prefix for leading whitespace handling". This
port keeps that intended behavior — it tolerates leading whitespace but still requires an HTML/XML marker — because
the task requires an upstream HTML error page to stay distinguishable from generic non-JSON content. The upstream
over-match is therefore not reproduced.

Two smaller divergences are recorded here on purpose:

- The HTML message is upstream's wording verbatim. The fork's generic branch keeps its own provider-qualified wording
  (`Invalid JSON response from ${provider}`), so the HTML branch carries no provider id.
- Upstream's failure reason lives in a `persistFailureUsage` taxonomy that does not exist here. The fork's
  `appendRequestLog` is a no-op (`src/lib/db/repos/usageRepo.js:2002` — "request log is now derived from usageHistory
  table on read") and `saveRequestDetail` is called only on the success path
  (`open-sse/handlers/chatCore/nonStreamingHandler.js:819`), so the local carrier for the distinction is the
  request-log status parenthetical described above.

## Excluded from this port

- **The row-count retention caps.** `src/lib/logEnv.ts`, `src/lib/compliance/index.ts`,
  `src/app/api/storage/health/route.ts` and `SystemStorageTab.tsx` do not exist in this fork (verified absent), and
  `CALL_LOGS_TABLE_MAX_ROWS`, `PROXY_LOGS_TABLE_MAX_ROWS` and `tableMaxRows` appear nowhere in the tree. Local
  retention is age-based only (`src/lib/dataRetention/runner.js`, `src/lib/dataRetention/scheduler.js`). There is no
  row-count ceiling and no storage-health surface to extend. No retention or dashboard change is made here.
- **The upstream `persistAttemptLogs` / `persistFailureUsage` calls.** Neither helper exists locally, and their
  upstream payloads include the raw provider body, which this port does not record.
- **The upstream unit test.** `tests/unit/log-retention.test.mjs` covers the excluded retention caps.
- **The upstream generic message wording.** The fork's existing `Invalid JSON response from ${provider}` is untouched.

## Offline checks

No provider traffic, no paid API, no browser, no Docker, no e2e run and no whole-suite run. Root and `tests/`
dependencies were installed locally to execute the focused fixtures only.

```
cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-nonstream-html-provider-error.test.js
```

Result: **1 file passed, 27 tests passed.** The fixture covers a generated HTML error response (doctype page,
captive-portal page, XML error document, indented HTML page), other non-JSON content (plain text, indented plain text,
whitespace-only, empty body, a bare angle bracket), a parsed-JSON-but-not-a-record body, a valid JSON completion, the
preserved 502 status and error envelope, the preserved request-log status, the absence of upstream body text in the
error result and in the response, and the marker set of `isHtmlErrorPageBody` itself.

The same fixture was run against the pre-change source to confirm it is a real regression test: **18 of 27 cases
failed** (every HTML case and every `isHtmlErrorPageBody` case), while the 9 generic-non-JSON and valid-JSON cases
passed unchanged — evidence that the generic path was not altered by the change.

Regression run over every existing fixture that imports the changed module (60 files under `tests/unit/` and
`tests/translator/`, selected with `grep -rl "nonStreamingHandler"`):

```
cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 <the 60 selected files>
```

Result: **60 files passed, 820 tests passed** (the new fixture included), including
`tests/unit/nonstream-json-contracts-10258.test.js`, which pins the generic `Invalid JSON response from ${provider}`
contract and passes unchanged.

Repository gates run against the changed tree:

```
npx eslint open-sse/handlers/chatCore/nonStreamingHandler.js tests/unit/omni-nonstream-html-provider-error.test.js
node scripts/check-anti-slop.mjs
```

Both are clean (`anti-slop gate OK (0 diagnostics across 2735 files)`). `node scripts/check-docs.mjs` exits 1 on this
tree, but with **zero** diagnostics pointing at this report: all 164 diagnostics are pre-existing broken links in other
port reports (`1073-april-stream-transport.md`, `1073-may-streaming-boundaries.md`) whose absolute link targets point
at other worktrees. This change neither adds nor fixes any of them.

## Verification limits

This port establishes the upstream first-parent diff of PR #1104, the local behavior of the non-stream parse-failure
path before and after the change, and the focused offline fixture results quoted above. It does not observe a real
provider serving an HTML error page — that behavior is inferred from the upstream source diff and reproduced offline
with generated fixtures. The upstream diff is TypeScript and the local tree is JavaScript with a different module
layout, so the comparison was made on behavior and call sites rather than line-for-line correspondence.

No AGENTS.md, GitHub Actions, baseline, credential or unrelated change is included. Nothing was pushed, and no pull
request was opened, updated or merged.

Refs #1073
