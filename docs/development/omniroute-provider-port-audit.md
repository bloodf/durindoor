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

## Summary

- DurinDoor providers: 101
- OmniRoute providers: 164
- Already present by provider id: 46
- Missing by provider id: 118
- OmniRoute provider icons missing locally: 0

## Missing Provider Classes

- oauth-session: 6
- simple-default: 90
- specialized-executor: 9
- web-session: 13

## Missing Providers

| Provider | Class | Executor | Format | Auth | Auth header | Important fields | Source icon | Local icon |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `adapta-web` | web-session | adapta-web | openai | apikey | bearer | - | yes | yes |
| `agentrouter` | simple-default | default | claude | apikey | x-api-key | defaultContextLength, passthroughModels | yes | yes |
| `agy` | oauth-session | antigravity | antigravity | oauth | bearer | headers, baseUrls, urlBuilder, passthroughModels | no | no |
| `ai21` | simple-default | default | openai | apikey | bearer | - | no | no |
| `aimlapi` | simple-default | default | openai | apikey | bearer | passthroughModels | yes | yes |
| `alibaba` | simple-default | default | openai | apikey | bearer | modelsUrl, passthroughModels | no | no |
| `api-airforce` | simple-default | default | openai | apikey | bearer | headers, defaultContextLength, modelsUrl | no | no |
| `auggie` | specialized-executor | auggie | openai | none | none | defaultContextLength | no | no |
| `bai` | simple-default | default | openai | apikey | bearer | modelsUrl, passthroughModels | no | no |
| `baichuan` | simple-default | default | openai | apikey | bearer | - | yes | yes |
| `baidu` | simple-default | default | openai | apikey | bearer | - | yes | yes |
| `bailian-coding-plan` | simple-default | default | claude | apikey | x-api-key | headers, chatPath | no | no |
| `baseten` | simple-default | default | openai | apikey | bearer | - | no | no |
| `bazaarlink` | simple-default | default | openai | apikey | bearer | modelsUrl | yes | yes |
| `bedrock` | specialized-executor | bedrock | openai | apikey | bearer | defaultContextLength, passthroughModels | no | no |
| `bluesminds` | simple-default | default | openai | apikey | bearer | defaultContextLength, modelsUrl | no | no |
| `bytez` | simple-default | default | openai | apikey | bearer | - | no | no |
| `chatgpt-web` | web-session | chatgpt-web | openai | apikey | cookie | - | no | no |
| `chipotle` | specialized-executor | chipotle | openai | none | none | baseUrls, passthroughModels | no | no |
| `codestral` | simple-default | default | openai | apikey | bearer | - | no | no |
| `command-code` | specialized-executor | command-code | openai | apikey | Authorization | chatPath, defaultContextLength, modelsUrl | yes | yes |
| `copilot-m365-web` | web-session | copilot-m365-web | openai | apikey | cookie | - | no | no |
| `copilot-web` | web-session | copilot-web | openai | apikey | cookie | - | no | no |
| `coze` | simple-default | default | openai | apikey | bearer | - | yes | yes |
| `crof` | simple-default | default | openai | apikey | bearer | - | no | no |
| `databricks` | simple-default | default | openai | apikey | bearer | - | no | no |
| `deepinfra` | simple-default | default | openai | apikey | bearer | - | no | no |
| `devin-cli` | oauth-session | devin-cli | openai | oauth | Authorization | defaultContextLength | no | no |
| `dgrid` | simple-default | default | openai | apikey | bearer | defaultContextLength, modelsUrl, passthroughModels | no | no |
| `dify` | simple-default | default | openai | apikey | bearer | - | yes | yes |
| `dit` | simple-default | default | openai | apikey | bearer | defaultContextLength, modelsUrl | no | no |
| `doubao` | simple-default | default | openai | apikey | bearer | - | yes | yes |
| `duckduckgo-web` | web-session | duckduckgo-web | openai | none | none | - | no | no |
| `factory` | simple-default | default | openai | apikey | bearer | - | no | no |
| `featherless-ai` | simple-default | default | openai | apikey | bearer | - | no | no |
| `freeaiapikey` | simple-default | default | openai | apikey | bearer | defaultContextLength, modelsUrl | no | no |
| `freemodel-dev` | simple-default | default | openai | apikey | bearer | defaultContextLength, modelsUrl | no | no |
| `friendliai` | simple-default | default | openai | apikey | bearer | modelsUrl | no | no |
| `galadriel` | simple-default | default | openai | apikey | bearer | - | no | no |
| `gigachat` | simple-default | default | openai | apikey | bearer | - | yes | yes |
| `gitlab-duo` | oauth-session | gitlab | openai | oauth | bearer | defaultContextLength | yes | yes |
| `gitlawb` | simple-default | default | openai | apikey | bearer | headers | no | no |
| `glhf` | simple-default | default | openai | apikey | bearer | - | no | no |
| `grok-cli` | oauth-session | grok-cli | openai | oauth | bearer | passthroughModels | no | no |
| `hackclub` | simple-default | default | openai | optional | bearer | defaultContextLength, modelsUrl, passthroughModels | no | no |
| `haiper` | simple-default | default | openai | apikey | HAIPER_KEY | - | no | no |
| `heroku` | simple-default | default | openai | apikey | bearer | - | yes | yes |
| `huggingchat` | web-session | huggingchat | openai | apikey | cookie | - | yes | yes |
| `ideogram` | simple-default | default | openai | apikey | Api-Key | - | no | no |
| `iflytek` | simple-default | default | openai | apikey | bearer | - | yes | yes |
| `inclusionai` | simple-default | default | openai | apikey | bearer | - | yes | yes |
| `inference-net` | simple-default | default | openai | apikey | bearer | - | no | no |
| `inner-ai` | specialized-executor | inner-ai | openai | apikey | bearer | - | yes | yes |
| `kie` | simple-default | default | openai | apikey | bearer | defaultContextLength | yes | yes |
| `kilo-gateway` | simple-default | default | openai | apikey | bearer | modelsUrl, passthroughModels | yes | yes |
| `kluster` | simple-default | default | openai | apikey | bearer | - | no | no |
| `lambda-ai` | simple-default | default | openai | apikey | bearer | - | no | no |
| `leonardo` | simple-default | default | openai | apikey | bearer | - | no | no |
| `liquid` | simple-default | default | openai | apikey | bearer | - | yes | yes |
| `llamagate` | simple-default | default | openai | apikey | bearer | - | yes | yes |
| `llm7` | simple-default | default | openai | apikey | bearer | modelsUrl | no | no |
| `longcat` | simple-default | default | openai | apikey | Authorization | - | no | no |
| `maritalk` | simple-default | default | openai | apikey | key | - | yes | yes |
| `meta-llama` | simple-default | default | openai | apikey | bearer | - | no | no |
| `mimocode` | specialized-executor | mimocode | openai | none | none | chatPath | no | no |
| `modal` | simple-default | default | openai | apikey | bearer | - | yes | yes |
| `modelscope` | simple-default | default | openai | apikey | bearer | modelsUrl, passthroughModels | no | no |
| `monsterapi` | simple-default | default | openai | apikey | bearer | - | yes | yes |
| `moonshot` | simple-default | default | openai | apikey | bearer | - | no | no |
| `morph` | simple-default | default | openai | apikey | bearer | - | no | no |
| `muse-spark-web` | web-session | muse-spark-web | openai | apikey | cookie | - | no | no |
| `nanogpt` | simple-default | default | openai | apikey | bearer | - | yes | yes |
| `nlpcloud` | simple-default | default | openai | apikey | bearer | - | yes | yes |
| `nous-research` | simple-default | default | openai | apikey | bearer | - | no | no |
| `novita` | simple-default | default | openai | apikey | bearer | modelsUrl | no | no |
| `nscale` | simple-default | default | openai | apikey | bearer | - | yes | yes |
| `ollama-cloud` | simple-default | default | openai | apikey | bearer | modelsUrl, passthroughModels | no | no |
| `openadapter` | simple-default | default | openai | apikey | bearer | defaultContextLength, modelsUrl | no | no |
| `orcarouter` | simple-default | default | openai | apikey | bearer | headers, defaultContextLength | no | no |
| `ovhcloud` | simple-default | default | openai | apikey | bearer | - | yes | yes |
| `pioneer` | simple-default | default | openai | apikey | x-api-key | - | no | no |
| `pollinations` | specialized-executor | pollinations | openai | apikey | bearer | baseUrls | no | no |
| `predibase` | simple-default | default | openai | apikey | bearer | - | yes | yes |
| `publicai` | simple-default | default | openai | apikey | bearer | - | no | no |
| `puter` | specialized-executor | puter | openai | apikey | bearer | passthroughModels | yes | yes |
| `qianfan` | simple-default | default | openai | apikey | bearer | defaultContextLength, modelsUrl | yes | yes |
| `qiniu` | simple-default | default | openai | apikey | bearer | defaultContextLength, modelsUrl, passthroughModels | no | no |
| `reka` | simple-default | default | openai | apikey | bearer | - | yes | yes |
| `requesty` | simple-default | default | openai | apikey | bearer | modelsUrl, passthroughModels | no | no |
| `sambanova` | simple-default | default | openai | apikey | bearer | - | no | no |
| `scaleway` | simple-default | default | openai | apikey | bearer | - | yes | yes |
| `sensenova` | simple-default | default | openai | apikey | bearer | - | yes | yes |
| `snowflake` | simple-default | default | openai | apikey | bearer | - | no | no |
| `sparkdesk` | simple-default | default | openai | apikey | bearer | - | yes | yes |
| `stepfun` | simple-default | default | openai | apikey | bearer | - | yes | yes |
| `sumopod` | simple-default | default | openai | apikey | bearer | defaultContextLength, modelsUrl, passthroughModels | no | no |
| `suno` | web-session | default | openai | cookie | cookie | - | no | no |
| `synthetic` | simple-default | default | openai | apikey | bearer | modelsUrl, passthroughModels | yes | yes |
| `t3-web` | web-session | t3-web | openai | apikey | cookie | - | no | no |
| `tencent` | simple-default | default | openai | apikey | bearer | - | yes | yes |
| `theoldllm` | specialized-executor | theoldllm | openai | none | none | baseUrls, defaultContextLength, passthroughModels | no | no |
| `tokenrouter` | simple-default | default | openai | apikey | bearer | defaultContextLength, modelsUrl | no | no |
| `trae` | oauth-session | trae | openai | oauth | bearer | defaultContextLength | no | no |
| `udio` | web-session | default | openai | apikey | cookie | - | no | no |
| `uncloseai` | simple-default | default | openai | optional | bearer | - | no | no |
| `upstage` | simple-default | default | openai | apikey | bearer | - | no | no |
| `v0-vercel` | simple-default | default | openai | apikey | bearer | - | no | no |
| `veoaifree-web` | web-session | veoaifree-web | openai | none | none | - | no | no |
| `volcengine` | simple-default | default | openai | apikey | bearer | - | no | no |
| `wafer` | simple-default | default | claude | apikey | bearer | headers | no | no |
| `wandb` | simple-default | default | openai | apikey | bearer | - | yes | yes |
| `windsurf` | oauth-session | windsurf | windsurf | oauth | Authorization | defaultContextLength | no | no |
| `x5lab` | simple-default | default | openai | apikey | bearer | defaultContextLength, modelsUrl, passthroughModels | no | no |
| `yi` | simple-default | default | openai | apikey | bearer | - | yes | yes |
| `yuanbao-web` | web-session | yuanbao-web | openai | apikey | cookie | - | no | no |
| `zai` | simple-default | default | claude | apikey | x-api-key | headers, urlSuffix | no | no |
| `zenmux` | simple-default | default | openai | apikey | bearer | defaultContextLength, modelsUrl | no | no |
| `zenmux-free` | web-session | zenmux-free | openai | apikey | cookie | - | no | no |

## Porting Rules

- `simple-default`: may be ported as a DurinDoor registry entry backed by `DefaultExecutor` after preserving base URL, format, auth header, model list or passthrough model behavior, and local icon metadata.
- `Important fields` is a warning list, not a complete conversion spec. Inspect the source registry module before porting each provider.
- `specialized-executor`: must port or adapt the OmniRoute executor and add executor-specific unit tests before exposing the provider.
- `web-session`: must include credential parsing/validation tests and a subscription/session risk notice.
- `oauth-session`: must include OAuth/token lifecycle tests and setup documentation.
- `unknown`: inspect manually before implementation; do not expose as supported from an audit-only pass.

Generated with `node scripts/audit-omniroute-providers.mjs --source <OmniRoute checkout> --format markdown`.
