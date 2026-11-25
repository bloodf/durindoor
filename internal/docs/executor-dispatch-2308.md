# Executor dispatch audit (#2308)

Scope: every module under `open-sse/executors/` that defines `execute()`, 80 including `base.js`.
Method: AST scan of call sites, then a source read of the non-`fetch` transports and direct sends that the scan flagged.
No live provider calls were made. All behaviour below comes from source and offline tests.
Rows marked "yes" or "guarded" through the shared sender rest on the sender's contract and its existing tests,
not on a new test per executor.

#2364, #2504, #2507, #2510, #2511 and #2512 moved most overrides onto `open-sse/executors/sendRequest.js`
and made the redirect guard default-on for `fetch` sends. This audit covers what remained.
**fixed** marks a change made with this audit.

## Columns

- **Quota**: the billable send reserves a quota ticket, and the result or the discarded attempt carries it.
- **Proxy**: the send honours the connection's proxy options.
- **Redirect**: "guarded" refuses redirects by default on a credentialed send. "manual" returns the 3xx without following it.
  Quota-bearing and proxied `fetch` sends can tighten "manual" to a refusal.
  "same origin only" follows redirects on the request origin. "browser" means the browser owns redirects; this audit did not change them.

## Table

| Executor | Send path | Quota | Proxy | Redirect | Notes |
| --- | --- | --- | --- | --- | --- |
| `adapta-web.js` | sender | yes | yes | guarded |  |
| `antigravity.js` | `super.execute` | yes | yes | guarded |  |
| `auggie.js` | sender; subprocess | yes | **fixed**: refuses | n/a | returns 400 for a connection with a proxy, pool or relay |
| `azure.js` | `super.execute` | yes | yes | guarded |  |
| `base.js` | sender | yes | yes | guarded on credentialed sends | `quirks.allowRedirects` opts out; no registry entry does |
| `bedrock.js` | sender | yes | yes | guarded |  |
| `cerebrium.js` | `super.execute` | yes | yes | guarded |  |
| `chatgpt-web-codex.js` | `super.execute` | yes | yes | guarded |  |
| `chatgpt-web-http.js` | sender; TLS client | yes | yes | **fixed**: same origin only | credentialed TLS sends now default to the guard in `tlsClientBase.js` |
| `chatgpt-web.js` | sender; browser | yes | yes | browser | delegates HTTP turns to `chatgpt-web-http.js` |
| `chatplayground.js` | sender | yes | yes | guarded |  |
| `chipotle.js` | sender; WebSocket | yes | yes | manual | WebSocket uses the connection proxy agent |
| `claude-web.js` | sender | yes | yes | manual |  |
| `cliproxyapi.js` | sender | yes | yes | guarded |  |
| `cloudflare-playground.js` | sender; browser | yes | **fixed** | browser | Chromium ignored the connection proxy |
| `codebuddy-cn.js` | `super.execute` | yes | yes | guarded |  |
| `codebuddy-intl.js` | `super.execute` | yes | yes | guarded |  |
| `codex-app-server.js` | sender; app-server RPC | yes | n/a | n/a | connects to the operator's configured app server, without a proxy |
| `codex.js` | `super.execute` | yes | yes | guarded |  |
| `commandcode.js` | `super.execute` | yes | yes | guarded |  |
| `copilot-m365-web.js` | sender; WebSocket | yes | yes | guarded | WebSocket uses the connection proxy agent |
| `copilot-web.js` | sender | yes | yes | guarded |  |
| `cursor-api.js` | `super.execute` | yes | yes | guarded | key exchange uses `credentialFetch` (same origin only) |
| `cursor.js` | sender; HTTP/2 | yes | yes | guarded; HTTP/2 does not follow | direct HTTP/2 only when no proxy applies; AgentService tunnels it |
| `deepseek-web.js` | sender | yes | yes | guarded |  |
| `default.js` | `super.execute` | yes | yes | guarded |  |
| `devin-cli-agentic.js` | sender; subprocess | yes | refuses | n/a | existing behaviour, now the shared `bindsConnectionRoute` rule |
| `devin-cli.js` | sender; subprocess | yes | **fixed**: refuses | n/a | same 400 |
| `devin-desktop.js` | sender | yes | yes | same origin only |  |
| `dify.js` | sender | yes | yes | guarded |  |
| `duckduckgo-web.js` | sender | yes | yes | guarded |  |
| `freebuff.js` | sender | yes | yes | same origin only |  |
| `gemini-interactions.js` | `super.execute` | yes | yes | guarded |  |
| `gemini-web.js` | sender; browser | yes | yes | browser |  |
| `gigachat.js` | `super.execute` | yes | yes | **fixed** | API key exchange; the module is staged (`staged.json`) |
| `github.js` | direct and `super.execute` | yes | yes | **fixed** | Messages, Responses and token preflight sends |
| `gitlab.js` | sender | yes | yes | guarded |  |
| `grok-cli.js` | `super.execute` | yes | yes | guarded |  |
| `grok-web.js` | sender | yes | yes | guarded |  |
| `huggingchat.js` | sender | yes | yes | guarded |  |
| `hyperagent.js` | sender | yes | yes | same origin only |  |
| `inner-ai.js` | sender | yes | yes | guarded |  |
| `kimi-web.js` | sender | yes | yes | guarded |  |
| `kiro.js` | direct and `super.execute` | yes | yes | **fixed** | CreateResponse send |
| `lmarena.js` | sender; TLS client | yes | **fixed** | same origin only | the TLS client did not receive the connection proxy |
| `maxai.js` | sender | yes | yes | guarded |  |
| `mimo-free.js` | sender | yes | yes | guarded |  |
| `mimocode.js` | sender | yes | yes | guarded | a configured per-account proxy takes precedence over the connection proxy |
| `minimax-code.js` | `super.execute` | yes | yes | guarded |  |
| `muse-spark-web.js` | sender | yes | yes | guarded |  |
| `nlpcloud.js` | sender | yes | yes | guarded |  |
| `notion-web.js` | sender | yes | yes | guarded |  |
| `ollama-local.js` | `super.execute` | yes | yes | guarded |  |
| `oneminai.js` | sender | yes | yes | guarded |  |
| `opencode-go.js` | `super.execute` | yes | yes | guarded |  |
| `opencode-server.js` | `super.execute` | yes | yes | guarded |  |
| `opencode.js` | `super.execute` | yes | yes | guarded |  |
| `perplexity-web.js` | sender | yes | yes | guarded |  |
| `poe.js` | sender or `super.execute` | **fixed** (Claude models) | yes | **fixed** | the `super.execute` branch hid the direct Messages send from the contract test |
| `promptql.js` | sender | **fixed** | yes | **fixed**: message send refuses; others manual | a refused redirect on the message send reports an expired session |
| `qoder.js` | sender | yes | yes | guarded |  |
| `replicate.js` | sender | yes | yes | guarded |  |
| `session-dispatch-gate.js` | `super.execute` | yes | yes | guarded |  |
| `t3-chat-web.js` | sender | yes | yes | guarded |  |
| `theoldllm.js` | sender | yes | yes | guarded |  |
| `tinycms-web.js` | sender | yes | yes | guarded |  |
| `trae.js` | sender | yes | yes | guarded |  |
| `twinmind.js` | sender | yes | yes | guarded |  |
| `unsupported-websession.js` | none | n/a | n/a | n/a | local 501, or delegates to another executor |
| `veoaifree-web.js` | sender | yes | yes | guarded |  |
| `vertex.js` | sender | yes | yes | guarded |  |
| `web-session-executor.js` | sender | yes | yes | manual | covers the `runSession()` subclasses: blackbox-web, conol-web, doubao-web, notrack-web, tencent-aistudio-web |
| `windsurf.js` | sender | yes | yes | guarded |  |
| `workbuddy.js` | `super.execute` | yes | yes | guarded |  |
| `xiaomi-mimo.js` | `super.execute` | yes | yes | guarded |  |
| `yuanbao-web.js` | sender | yes | yes | guarded |  |
| `zai-web.js` | sender | yes | yes | guarded |  |
| `zcode.js` | sender; subprocess | yes | **fixed**: refuses | n/a | same 400 |
| `zed-hosted.js` | sender | yes | yes | same origin only |  |
| `zenmux-free.js` | sender | yes | yes | guarded |  |

## Tests

- `tests/unit/review-x-executor-dispatch-gaps.test.js` covers each fix above.
- `tests/unit/review-x-executor-send.test.js` requires every override to call the shared sender or `super.execute`.
  `promptql.js` left its allowlist. The check is per method, not per send: a method with a `super.execute` branch
  can still hide a direct send, as `poe.js` did.
- `tests/unit/review-s-exec-fetch.test.js` rejects new bare `fetch(` calls.
- `tests/unit/review-x-redirect-default.test.js` covers the `BaseExecutor` redirect default.
- `tests/unit/web-session-shared-transport-redirects.test.js` now expects the TLS guard on ordinary ChatGPT Web.
  #2333 had limited it to ChatGPT Web Codex and LMArena.

## Remaining

These are outside `execute()` dispatch or need a separate change.

- Native token counting ignores the connection proxy. `countInputTokens` in `open-sse/handlers/countTokensCore.js`
  receives no proxy options, and neither does `antigravity-count-tokens.js`. Both send credentials.
- Token refresh sends in `default.js`, `github.js` and `kimi-web.js` pass proxy options but set no redirect
  guard, so a direct connection follows redirects. Refresh work belongs with #2313.
- `github.js` (Messages, Responses) and `kiro.js` (CreateResponse) keep their own quota-bearing send.
  The Responses and CreateResponse sends have no header deadline.
- `promptql.js` returns GraphQL errors from an HTTP 200 reply with status 200. This predates the audit; the
  quota ticket now travels with that response.
- The ChatGPT Web browser transport intercepts redirects only for ChatGPT Web Codex (`sameOriginRedirects`).
- The per-method limit of the override contract test, described above.
