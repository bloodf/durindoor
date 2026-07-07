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
- OmniRoute providers: 164
- Already present by provider id: 44
- Missing by provider id: 120
- OmniRoute provider icons missing locally: 0

## Missing Provider Classes

- oauth-session: 6
- simple-default: 92
- specialized-executor: 9
- web-session: 13

## Missing Providers

| Provider | Class | Executor | Format | Auth | Auth header | Auth prefix | Important fields | Source icon | Local icon |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `adapta-web` | web-session | adapta-web | openai | apikey | bearer | - | - | `adapta-web.png` | `adapta-web.png` |
| `agentrouter` | simple-default | default | claude | apikey | x-api-key | - | defaultContextLength, passthroughModels | `agentrouter.png` | `agentrouter.png` |
| `agy` | oauth-session | antigravity | antigravity | oauth | bearer | - | headers, baseUrls, urlBuilder, passthroughModels | no | no |
| `ai21` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `aimlapi` | simple-default | default | openai | apikey | bearer | - | passthroughModels | `aimlapi.png` | `aimlapi.png` |
| `alibaba` | simple-default | default | openai | apikey | bearer | - | modelsUrl, passthroughModels | no | no |
| `api-airforce` | simple-default | default | openai | apikey | bearer | - | headers, defaultContextLength, modelsUrl | no | no |
| `auggie` | specialized-executor | auggie | openai | none | none | - | defaultContextLength | no | no |
| `bai` | simple-default | default | openai | apikey | bearer | - | modelsUrl, passthroughModels | no | no |
| `baichuan` | simple-default | default | openai | apikey | bearer | - | - | `baichuan.svg` | `baichuan.svg` |
| `baidu` | simple-default | default | openai | apikey | bearer | - | - | `baidu.svg` | `baidu.svg` |
| `bailian-coding-plan` | simple-default | default | claude | apikey | x-api-key | - | headers, chatPath | no | no |
| `baseten` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `bazaarlink` | simple-default | default | openai | apikey | bearer | - | modelsUrl | `bazaarlink.svg` | `bazaarlink.svg` |
| `bedrock` | specialized-executor | bedrock | openai | apikey | bearer | - | defaultContextLength, passthroughModels | no | no |
| `bluesminds` | simple-default | default | openai | apikey | bearer | - | defaultContextLength, modelsUrl | no | no |
| `bytez` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `chatgpt-web` | web-session | chatgpt-web | openai | apikey | cookie | - | - | no | no |
| `chipotle` | specialized-executor | chipotle | openai | none | none | - | baseUrls, passthroughModels | no | no |
| `codestral` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `command-code` | specialized-executor | command-code | openai | apikey | Authorization | Bearer  | chatPath, defaultContextLength, modelsUrl | `command-code.svg` | `command-code.svg` |
| `copilot-m365-web` | web-session | copilot-m365-web | openai | apikey | cookie | - | - | no | no |
| `copilot-web` | web-session | copilot-web | openai | apikey | cookie | - | - | no | no |
| `coze` | simple-default | default | openai | apikey | bearer | - | - | `coze.svg` | `coze.svg` |
| `crof` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `databricks` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `deepinfra` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `devin-cli` | oauth-session | devin-cli | openai | oauth | Authorization | Bearer  | defaultContextLength | no | no |
| `dgrid` | simple-default | default | openai | apikey | bearer | - | defaultContextLength, modelsUrl, passthroughModels | no | no |
| `dify` | simple-default | default | openai | apikey | bearer | - | - | `dify.svg` | `dify.svg` |
| `dit` | simple-default | default | openai | apikey | bearer | - | defaultContextLength, modelsUrl | no | no |
| `doubao` | simple-default | default | openai | apikey | bearer | - | - | `doubao.svg` | `doubao.svg` |
| `duckduckgo-web` | web-session | duckduckgo-web | openai | none | none | - | - | no | no |
| `factory` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `featherless-ai` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `freeaiapikey` | simple-default | default | openai | apikey | bearer | - | defaultContextLength, modelsUrl | no | no |
| `freemodel-dev` | simple-default | default | openai | apikey | bearer | - | defaultContextLength, modelsUrl | no | no |
| `friendliai` | simple-default | default | openai | apikey | bearer | - | modelsUrl | no | no |
| `galadriel` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `gigachat` | simple-default | default | openai | apikey | bearer | - | - | `gigachat.png` | `gigachat.png` |
| `gitlab-duo` | oauth-session | gitlab | openai | oauth | bearer | - | defaultContextLength | `gitlab-duo.svg` | `gitlab-duo.svg` |
| `gitlawb` | simple-default | default | openai | apikey | bearer | - | headers | no | no |
| `glhf` | simple-default | default | openai | apikey | bearer | - | - | no | no |
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
| `orcarouter` | simple-default | default | openai | apikey | bearer | - | headers, defaultContextLength | no | no |
| `ovhcloud` | simple-default | default | openai | apikey | bearer | - | - | `ovhcloud.png` | `ovhcloud.png` |
| `pioneer` | simple-default | default | openai | apikey | x-api-key | - | - | no | no |
| `pollinations` | specialized-executor | pollinations | openai | apikey | bearer | - | baseUrls | no | no |
| `predibase` | simple-default | default | openai | apikey | bearer | - | - | `predibase.png` | `predibase.png` |
| `publicai` | simple-default | default | openai | apikey | bearer | - | - | no | no |
| `puter` | specialized-executor | puter | openai | apikey | bearer | - | passthroughModels | `puter.svg` | `puter.svg` |
| `qianfan` | simple-default | default | openai | apikey | bearer | - | defaultContextLength, modelsUrl | `qianfan.svg` | `qianfan.svg` |
| `qiniu` | simple-default | default | openai | apikey | bearer | - | defaultContextLength, modelsUrl, passthroughModels | no | no |
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

Generated with `node scripts/audit-omniroute-providers.mjs --source <OmniRoute checkout> --format markdown`.
