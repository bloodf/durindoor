# OmniRoute Provider Port Audit

Source: https://github.com/diegosouzapw/OmniRoute
Source commit: `3ddcee6369c54e1c844a6e46cbbc79870d10d30b`

This audit is the Phase 1 inventory for the OmniRoute provider-port effort. It is generated with:

```sh
node scripts/audit-omniroute-providers.mjs \
  --source /path/to/OmniRoute \
  --commit 3ddcee6369c54e1c844a6e46cbbc79870d10d30b \
  --format markdown
```

The source checkout must be clean when the script runs. If the OmniRoute tree
has uncommitted or untracked files, the audit exits before rendering so a
committed baseline cannot silently include local-only source changes.

Provider discovery walks every `index.ts` below
`open-sse/config/providers/registry/` and uses the registry entry's declared
`id` when present. This keeps nested OmniRoute registry groups in the audit
instead of limiting the inventory to one top-level directory per provider.

## Summary

- DurinDoor providers: 99
- OmniRoute providers: 183
- Already present by provider id: 50
- Missing by provider id: 133
- OmniRoute provider icons missing locally: 0

## Missing Provider Classes

- oauth-session: 6
- simple-default: 95
- specialized-executor: 11
- unknown: 1
- web-session: 20

## Missing Providers

| Provider | Class | Executor | Format | Auth | Auth header | Auth prefix | Important fields | Source icon | Local icon |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `adapta-web` | web-session | adapta-web | openai | apikey | bearer | - | - | `adapta-web.png` | `adapta-web.png` |
| `agentrouter` | simple-default | default | claude | apikey | x-api-key | - | defaultContextLength, passthroughModels | `agentrouter.png` | `agentrouter.png` |
| `agy` | oauth-session | antigravity | antigravity | oauth | bearer | - | headers, baseUrls, urlBuilder, passthroughModels | no | no |
| `ai21` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `aimlapi` | simple-default | default | openai | apikey | bearer | - | passthroughModels | `aimlapi.png` | `aimlapi.png` |
| `alibaba` | simple-default | default | openai | apikey | bearer | - | modelsUrl, passthroughModels | no | no |
| `alibaba-cn` | simple-default | default | openai | apikey | bearer | - | modelsUrl, passthroughModels | no | no |
| `api-airforce` | simple-default | default | openai | apikey | bearer | - | headers, defaultContextLength, modelsUrl | no | no |
| `auggie` | specialized-executor | auggie | openai | none | none | - | defaultContextLength | no | no |
| `bai` | simple-default | default | openai | apikey | bearer | - | modelsUrl, passthroughModels | no | no |
| `baichuan` | simple-default | default | openai | apikey | bearer | - | - | `baichuan.svg` | `baichuan.svg` |
| `baidu` | simple-default | default | openai | apikey | bearer | - | - | `baidu.svg` | `baidu.svg` |
| `bailian-coding-plan` | simple-default | default | claude | apikey | x-api-key | - | headers, chatPath | no | no |
| `baseten` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `bazaarlink` | simple-default | default | openai | apikey | bearer | - | modelsUrl | `bazaarlink.svg` | `bazaarlink.svg` |
| `bedrock` | specialized-executor | bedrock | openai | apikey | bearer | - | defaultContextLength, passthroughModels | no | no |
| `blackbox-web` | web-session | blackbox-web | openai | apikey | cookie | - | - | `blackbox-web.png` | `blackbox-web.png` |
| `bluesminds` | simple-default | default | openai | apikey | bearer | - | defaultContextLength, modelsUrl | no | no |
| `bytez` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `chatgpt-web` | web-session | chatgpt-web | openai | apikey | cookie | - | - | no | no |
| `chipotle` | specialized-executor | chipotle | openai | none | none | - | baseUrls, passthroughModels | no | no |
| `claude-web` | web-session | claude-web | openai | apikey | cookie | - | - | `claude-web.svg` | `claude-web.svg` |
| `codestral` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `command-code` | specialized-executor | command-code | openai | apikey | Authorization | Bearer  | chatPath, defaultContextLength, modelsUrl | `command-code.svg` | `command-code.svg` |
| `copilot-m365-web` | web-session | copilot-m365-web | openai | apikey | cookie | - | - | no | no |
| `copilot-web` | web-session | copilot-web | openai | apikey | cookie | - | - | no | no |
| `coze` | simple-default | default | openai | apikey | bearer | - | - | `coze.svg` | `coze.svg` |
| `crof` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `databricks` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `deepinfra` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `deepseek-web` | web-session | deepseek-web | openai | apikey | bearer | - | - | no | no |
| `devin-cli` | oauth-session | devin-cli | openai | oauth | Authorization | Bearer  | defaultContextLength | no | no |
| `dgrid` | simple-default | default | openai | apikey | bearer | - | defaultContextLength, modelsUrl, passthroughModels | no | no |
| `dify` | simple-default | default | openai | apikey | bearer | - | - | `dify.svg` | `dify.svg` |
| `dit` | simple-default | default | openai | apikey | bearer | - | defaultContextLength, modelsUrl | no | no |
| `doubao` | simple-default | default | openai | apikey | bearer | - | - | `doubao.svg` | `doubao.svg` |
| `doubao-web` | web-session | doubao-web | openai | apikey | cookie | - | - | no | no |
| `duckduckgo-web` | web-session | duckduckgo-web | openai | none | none | - | - | no | no |
| `factory` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `featherless-ai` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `freeaiapikey` | simple-default | default | openai | apikey | bearer | - | defaultContextLength, modelsUrl | no | no |
| `freemodel-dev` | simple-default | default | openai | apikey | bearer | - | defaultContextLength, modelsUrl | no | no |
| `friendliai` | simple-default | default | openai | apikey | bearer | - | modelsUrl | no | no |
| `galadriel` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `gemini-web` | web-session | gemini-web | openai | apikey | cookie | - | - | no | no |
| `gigachat` | simple-default | default | openai | apikey | bearer | - | - | `gigachat.png` | `gigachat.png` |
| `github-models` | simple-default | default | openai | apikey | Authorization | Bearer | headers, defaultContextLength, modelsUrl | no | no |
| `gitlab-duo` | oauth-session | gitlab | openai | oauth | bearer | - | defaultContextLength | `gitlab-duo.svg` | `gitlab-duo.svg` |
| `gitlawb` | simple-default | default | openai | apikey | bearer | - | headers | no | no |
| `gitlawb-gmi` | simple-default | default | openai | apikey | bearer | - | headers, passthroughModels | no | no |
| `glhf` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `glmt` | specialized-executor | glm | openai | apikey | bearer | - | requestDefaults, timeoutMs, defaultContextLength | no | no |
| `grok-cli` | oauth-session | grok-cli | openai | oauth | bearer | - | passthroughModels | no | no |
| `hackclub` | simple-default | default | openai | optional | bearer | - | defaultContextLength, modelsUrl, passthroughModels | no | no |
| `haiper` | simple-default | default | openai | apikey | HAIPER_KEY | - | - | no | no |
| `heroku` | simple-default | default | openai | apikey | bearer | - | - | `heroku.png` | `heroku.png` |
| `huggingchat` | web-session | huggingchat | openai | apikey | cookie | - | - | `huggingchat.svg` | `huggingchat.svg` |
| `ideogram` | simple-default | default | openai | apikey | Api-Key | - | - | no | no |
| `iflytek` | simple-default | default | openai | apikey | bearer | - | - | `iflytek.svg` | `iflytek.svg` |
| `inclusionai` | simple-default | default | openai | apikey | bearer | - | - | `inclusionai.svg` | `inclusionai.svg` |
| `inference-net` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `inner-ai` | specialized-executor | inner-ai | openai | apikey | bearer | - | - | `inner-ai.png` | `inner-ai.png` |
| `kenari` | simple-default | default | openai | apikey | bearer | - | modelsUrl, passthroughModels | no | no |
| `kie` | simple-default | default | openai | apikey | bearer | - | defaultContextLength | `kie.png` | `kie.png` |
| `kilo-gateway` | simple-default | default | openai | apikey | bearer | - | modelsUrl, passthroughModels | `kilo-gateway.svg` | `kilo-gateway.svg` |
| `kimi-coding-apikey` | unknown | unknown | unknown | apikey | unknown | - | - | no | no |
| `kimi-web` | web-session | kimi-web | openai | apikey | cookie | - | - | no | no |
| `kluster` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `lambda-ai` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `leonardo` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `liquid` | simple-default | default | openai | apikey | bearer | - | - | `liquid.svg` | `liquid.svg` |
| `llamagate` | simple-default | default | openai | apikey | bearer | - | - | `llamagate.png` | `llamagate.png` |
| `llm7` | simple-default | default | openai | apikey | bearer | - | modelsUrl | no | no |
| `longcat` | simple-default | default | openai | apikey | Authorization | Bearer | - | no | no |
| `maritalk` | simple-default | default | openai | apikey | key | - | - | `maritalk.png` | `maritalk.png` |
| `meta-llama` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `mimocode` | specialized-executor | mimocode | openai | none | none | - | chatPath | no | no |
| `modal` | simple-default | default | openai | apikey | bearer | - | - | `modal.svg` | `modal.svg` |
| `modelscope` | simple-default | default | openai | apikey | bearer | - | modelsUrl, passthroughModels | no | no |
| `monsterapi` | simple-default | default | openai | apikey | bearer | - | - | `monsterapi.svg` | `monsterapi.svg` |
| `moonshot` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `morph` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `muse-spark-web` | web-session | muse-spark-web | openai | apikey | cookie | - | - | no | no |
| `nanogpt` | simple-default | default | openai | apikey | bearer | - | - | `nanogpt.png` | `nanogpt.png` |
| `nlpcloud` | simple-default | default | openai | apikey | bearer | - | - | `nlpcloud.svg` | `nlpcloud.svg` |
| `nous-research` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `novita` | simple-default | default | openai | apikey | bearer | - | modelsUrl | no | no |
| `nscale` | simple-default | default | openai | apikey | bearer | - | - | `nscale.png` | `nscale.png` |
| `nube` | simple-default | default | openai | apikey | bearer | - | modelsUrl, passthroughModels | no | `nube.png` |
| `ollama-cloud` | simple-default | default | openai | apikey | bearer | - | modelsUrl, passthroughModels | no | no |
| `openadapter` | simple-default | default | openai | apikey | bearer | - | defaultContextLength, modelsUrl | no | no |
| `opencode-zen` | specialized-executor | opencode | openai | apikey | Authorization | Bearer | defaultContextLength, modelsUrl, passthroughModels | no | no |
| `orcarouter` | simple-default | default | openai | apikey | bearer | - | headers, defaultContextLength | no | no |
| `ovhcloud` | simple-default | default | openai | apikey | bearer | - | - | `ovhcloud.png` | `ovhcloud.png` |
| `pioneer` | simple-default | default | openai | apikey | x-api-key | - | - | no | no |
| `pollinations` | specialized-executor | pollinations | openai | apikey | bearer | - | baseUrls | no | no |
| `predibase` | simple-default | default | openai | apikey | bearer | - | - | `predibase.png` | `predibase.png` |
| `publicai` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `puter` | specialized-executor | puter | openai | apikey | bearer | - | passthroughModels | `puter.svg` | `puter.svg` |
| `qianfan` | simple-default | default | openai | apikey | bearer | - | defaultContextLength, modelsUrl | `qianfan.svg` | `qianfan.svg` |
| `qiniu` | simple-default | default | openai | apikey | bearer | - | defaultContextLength, modelsUrl, passthroughModels | no | no |
| `qwen-web` | web-session | qwen-web | openai | apikey | bearer | - | - | no | no |
| `reka` | simple-default | default | openai | apikey | bearer | - | - | `reka.png` | `reka.png` |
| `requesty` | simple-default | default | openai | apikey | bearer | - | modelsUrl, passthroughModels | no | no |
| `sambanova` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `scaleway` | simple-default | default | openai | apikey | bearer | - | - | `scaleway.svg` | `scaleway.svg` |
| `sensenova` | simple-default | default | openai | apikey | bearer | - | - | `sensenova.svg` | `sensenova.svg` |
| `snowflake` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `sparkdesk` | simple-default | default | openai | apikey | bearer | - | - | `sparkdesk.svg` | `sparkdesk.svg` |
| `stepfun` | simple-default | default | openai | apikey | bearer | - | - | `stepfun.svg` | `stepfun.svg` |
| `sumopod` | simple-default | default | openai | apikey | bearer | - | defaultContextLength, modelsUrl, passthroughModels | no | no |
| `suno` | web-session | default | openai | cookie | cookie | - | - | no | no |
| `synthetic` | simple-default | default | openai | apikey | bearer | - | modelsUrl, passthroughModels | `synthetic.svg` | `synthetic.svg` |
| `t3-web` | web-session | t3-web | openai | apikey | cookie | - | - | no | no |
| `tencent` | simple-default | default | openai | apikey | bearer | - | - | `tencent.svg` | `tencent.svg` |
| `theoldllm` | specialized-executor | theoldllm | openai | none | none | - | baseUrls, defaultContextLength, passthroughModels | no | no |
| `tokenrouter` | simple-default | default | openai | apikey | bearer | - | defaultContextLength, modelsUrl | no | no |
| `trae` | oauth-session | trae | openai | oauth | bearer | - | defaultContextLength | no | no |
| `udio` | web-session | default | openai | apikey | cookie | - | - | no | no |
| `uncloseai` | simple-default | default | openai | optional | bearer | - | - | no | no |
| `upstage` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `v0-vercel` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `veoaifree-web` | web-session | veoaifree-web | openai | none | none | - | - | no | no |
| `volcengine` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `wafer` | simple-default | default | claude | apikey | bearer | - | headers | no | no |
| `wandb` | simple-default | default | openai | apikey | bearer | - | - | `wandb.svg` | `wandb.svg` |
| `windsurf` | oauth-session | windsurf | windsurf | oauth | Authorization | Bearer  | defaultContextLength | no | no |
| `x5lab` | simple-default | default | openai | apikey | bearer | - | defaultContextLength, modelsUrl, passthroughModels | no | no |
| `yi` | simple-default | default | openai | apikey | bearer | - | - | `yi.svg` | `yi.svg` |
| `yuanbao-web` | web-session | yuanbao-web | openai | apikey | cookie | - | - | no | no |
| `zai` | simple-default | default | claude | apikey | x-api-key | - | headers, urlSuffix | no | no |
| `zenmux` | simple-default | default | openai | apikey | bearer | - | defaultContextLength, modelsUrl | no | no |
| `zenmux-free` | web-session | zenmux-free | openai | apikey | cookie | - | - | no | no |

## Porting Rules

- `simple-default`: may be ported as a DurinDoor registry entry backed by `DefaultExecutor` after preserving base URL, format, auth header and prefix, model list or passthrough model behavior, and local icon metadata.
- `Local icon` records the concrete asset filename. Non-`.png` assets need explicit provider icon metadata if a UI path would otherwise default to `/providers/<id>.png`.
- `Important fields` is a warning list, not a complete conversion spec. Inspect the source registry module before porting each provider.
- `specialized-executor`: must port or adapt the OmniRoute executor and add executor-specific unit tests before exposing the provider.
- `web-session`: must include credential parsing/validation tests and a subscription/session risk notice.
- `oauth-session`: must include OAuth/token lifecycle tests and setup documentation.
- `unknown`: inspect manually before implementation; do not expose as supported from an audit-only pass.

## Asset Notes

- `gigachat.png` under `public/providers/` previously contained JPEG-encoded
  bytes despite the `.png` extension. Normalized to real PNG bytes (same
  filename, same 128x128 dimensions) so the advertised local icon format
  matches the file on disk.

## Specialized Executor Slice: Faraday

Source inspected at `3ddcee6369c54e1c844a6e46cbbc79870d10d30b`:

- `open-sse/executors/auggie.ts`
- `open-sse/executors/bedrock.ts`
- `open-sse/executors/chipotle.ts`
- `open-sse/executors/commandCode.ts`
- `open-sse/executors/inner-ai.ts`
- `open-sse/executors/mimocode.ts`
- `open-sse/executors/pollinations.ts`
- `open-sse/executors/puter.ts`
- `open-sse/executors/theoldllm.ts`
- Matching provider registry modules under `open-sse/config/providers/registry/<provider>/index.ts`

### Implemented

These providers are exposed in DurinDoor with executor/unit coverage:

- `command-code`: registered as a hyphenated provider id backed by DurinDoor's existing Command Code executor path. The provider keeps OmniRoute's `command-code` id, `cmd` alias, `/alpha/generate` endpoint, stream-forcing transport, and current model seed. This avoids duplicating the existing `commandcode` translator while making the OmniRoute provider id routable.
- `pollinations`: ported as a small specialized executor for `https://gen.pollinations.ai/v1/chat/completions`. The provider is exposed as no-auth/free so the documented keyless catalog can be used without an API key, and it still accepts an optional real Pollinations API-key connection (from enter.pollinations.ai) for premium models — `src/sse/services/auth.js` prefers a real saved connection over the synthetic public no-auth credential and only falls back to it when no usable connection exists. `open-sse/executors/pollinations.js` rejects every synthetic no-auth placeholder (`sk_durindoor`, the `{ accessToken: "public", id: "noauth" }` runtime shape) so none of them are ever forwarded as a real bearer token, and only enables `jsonMode` when the caller explicitly requests `response_format.type` of `json_object` or `json_schema`.
- `puter`: ported as a small specialized executor for Puter's OpenAI-compatible chat REST endpoint. It forwards bearer credentials and leaves model ids untouched because Puter accepts catalog ids directly.
- `theoldllm`: ported as a no-auth executor that maps legacy model aliases, generates the `X-Request-Token` expected by the public The Old LLM endpoint, retries once on token rejection, and uses DurinDoor's proxy-aware fetch path. Successful streaming calls pipe the upstream SSE body directly; non-streaming calls use the shared SSE-to-OpenAI JSON parser so usage, reasoning, tool calls, and finish metadata survive conversion. The provider does not advertise passthrough models because unknown inputs are intentionally mapped to known upstream ids.

### Blocked

These providers remain audit-only and are not exposed as supported:

- `auggie`: requires local Augment CLI process execution and provider test plumbing from OmniRoute's `open-sse/executors/auggie.ts`, including safe binary discovery, spawn lifecycle handling, stdin error handling, and a connection test that runs `auggie --version`. DurinDoor does not currently have this local CLI provider subsystem or UI/test path for a no-auth provider whose authentication is delegated to an external CLI login.
- `bedrock`: requires `@aws-sdk/client-bedrock-runtime`, `open-sse/config/bedrock.ts`, and the Bedrock Converse/ConverseStream translation surface from OmniRoute's `open-sse/executors/bedrock.ts`. The target package does not depend on the AWS Bedrock runtime SDK, and the region/native Converse helpers are absent.
- `chipotle`: requires the WebSocket/STOMP Amelia client from OmniRoute's `open-sse/executors/chipotle.ts` and the `ws` package. The target package does not depend on `ws`, and DurinDoor has no SockJS/STOMP session subsystem for this no-auth web endpoint.
- `inner-ai`: requires OmniRoute's `../translator/webTools.ts` helpers (`prepareToolMessages`, `buildToolAwareResult`) plus the full Inner.ai profile/model discovery and web-tool result conversion flow in `open-sse/executors/inner-ai.ts`. The target tree has no `open-sse/translator/webTools` module, so a faithful port would require adding that translator subsystem first.
- `mimocode`: requires OmniRoute's account fingerprint/JWT bootstrap subsystem from `open-sse/executors/mimocode.ts`, including per-account cooldown/rotation, SOCKS/HTTP proxy dispatch, `providerSpecificData.fingerprints`, and `accountProxies` handling. DurinDoor has `mimo-free` as a simpler no-auth Xiaomi path, but not Mimocode's multi-account state and proxy routing contract.

Generated with `node scripts/audit-omniroute-providers.mjs --source <OmniRoute checkout> --format markdown`.
