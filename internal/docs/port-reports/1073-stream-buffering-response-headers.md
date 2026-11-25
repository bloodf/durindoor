# Unbuffered delivery on self-built SSE wrappers (#1073, OmniRoute #18446)

Reviewed 2026-11-20 against local base `272b90168`.

## Upstream

`cheaper-inference/OmniRoute#18446` ("fix(sse): set X-Accel-Buffering no on self-built SSE responses that bypass the central header path"), merged 2026-11-02, merge commit `497e14fa9b57e07c1f5143931afba611e90eca65`; the work order pins source head `8a1976d7b2decbc3489a39abfff72da332e2ca07`. The final diff adds one `X-Accel-Buffering: no` literal to four wrappers and a test. No logic, ordering, payload or schema changed.

## Disposition per upstream site

| Upstream site | Local counterpart | Disposition |
| --- | --- | --- |
| `earlyStreamKeepalive.ts` slow-path response | `open-sse/utils/earlyStreamKeepalive.js` (`withEarlyStreamKeepalive`) | Header was missing. **Added.** |
| `bypassResponse.ts` synthetic stream | `open-sse/utils/bypassResponse.js` (`SSE_HEADERS`, used by `createSyntheticResponse`) | Header was missing. **Added.** |
| `protectMcpSseResponse` in `mcp-server/httpTransport.ts` | none; the local MCP SSE routes `src/app/api/mcp-gateway/sse/route.js` and `src/app/api/mcp/[plugin]/sse/route.js` | Already send `X-Accel-Buffering: no`. MCP transport is out of scope for this unit. **Unchanged.** |
| `chatCore/semanticCache.ts` SSE cache hit | none | Semantic cache is not part of this unit. **Not ported.** |

## Change

Header literals only:

- `bypassResponse.js`: `"X-Accel-Buffering": "no"` added to the SSE header object. Content type, `Cache-Control: no-cache`, `Connection: keep-alive`, CORS, status and body are unchanged. The JSON bypass response does not get the header.
- `earlyStreamKeepalive.js`: `"X-Accel-Buffering": "no"` added to the slow-path response headers. `text/event-stream; charset=utf-8`, `no-cache, no-transform`, `keep-alive`, status 200, the keepalive frame and its interval, and upstream forwarding are unchanged. The fast path (handler settles before the threshold) and `intervalMs: 0` still return the handler response verbatim, with no header added.

Heartbeat framing, `SSE_KEEPALIVE_MS` handling and the error frame are not touched.

## Other direct SSE wrappers, reviewed and left alone

The upstream diff names four sites, and the local counterparts of the two applicable ones are fixed above. The remaining local direct SSE constructors were enumerated for comparison and not changed, because the upstream diff does not touch their counterparts and this unit is limited to those:

- Already carry the header: `perplexity-web`, `grok-web` (via `SSE_HEADERS_NO_BUFFER`), `huggingchat`, `muse-spark-web`, `yuanbao-web`, `chatgpt-web-http`, `chatgptWebTools`, `imageProviders/codex`, the MCP routes, and the MITM handler for `text/event-stream`.
- Do not carry it: the shared `SSE_HEADERS` and `SSE_HEADERS_CORS` constants (used by the main streaming/non-streaming chat path, `responsesHandler`, `kiro`, `cursor`, `gemini-interactions`, `v1beta/interactions`), `codex-app-server`, and several single-provider executors that build their own `Response`.

Difference from the upstream premise: upstream states its central response-header path already sends the header. Locally, `open-sse/handlers/chatCore/streamingHandler.js` uses `SSE_HEADERS_CORS`, which does not. Adding the header to that shared constant would change every client-facing SSE response and many executors at once, which is beyond "existing self-built wrappers that miss the central header". It is recorded here as a possible follow-up, not changed.

## Verification

`tests/unit/omni-stream-buffering-response-headers.test.js` is offline (no network, provider, browser or credentials):

- bypass stream: header present; content type, cache, connection, CORS, status, body and `[DONE]` terminator preserved; JSON bypass carries no header;
- early keepalive slow path: header present; other headers preserved; the keepalive frame is read first, then the upstream bytes, then end of stream; the fast path and the disabled wrapper return the handler response by identity without the header;
- local MCP routes keep their existing literal.

Against the unmodified product files, the bypass and keepalive-slow-path tests fail and the rest pass; with the change all 8 pass. Existing `bypass-response`, `bypass-handler` and `messages-early-stream-keepalive` suites still pass (30 tests across the four files). Dependencies were installed with `pnpm install --frozen-lockfile --ignore-scripts` in the checkout and `tests/`. The gate's full run found one pinned expectation: `tests/unit/operational-metrics-admission.test.js` asserts the exact header set of the early-keepalive slow-path response for `/v1/messages` and `/v1/responses`. Its expected set now includes `x-accel-buffering: no`; nothing else in that assertion changed. The suite passes (285 tests) with the new test file (293 together).

No e2e, browser or Docker run was done locally.

No public documentation changes: the header is an infrastructure hint and no endpoint contract changes.
