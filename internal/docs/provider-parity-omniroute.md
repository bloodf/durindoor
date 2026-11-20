# OmniRoute provider contract inventory

## Snapshot and method

Comparison recorded 2026-11-20. Upstream is `cheaper-inference/OmniRoute` branch `release/v3.8.55` at **`ab180e32fcdf1f78c96f98a617e17c86e34bf5aa`**. DurinDoor comparison `HEAD` is **`fd3a0f959a5eca082d8f042634d38b7005228e5c`**. The upstream ref is a moving branch; the SHA pins this inventory. Public source entry points: [upstream provider registry](https://github.com/cheaper-inference/OmniRoute/blob/ab180e32fcdf1f78c96f98a617e17c86e34bf5aa/open-sse/config/providers/index.ts), [upstream registry contract and legacy adapter](https://github.com/cheaper-inference/OmniRoute/blob/ab180e32fcdf1f78c96f98a617e17c86f98a617e17c86e34bf5aa/open-sse/config/providerRegistry.ts), [DurinDoor registry](https://github.com/bloodf/durindoor/blob/fd3a0f959a5eca082d8f042634d38b7005228e5c/open-sse/providers/registry/index.js).

Scope is outbound inference/media providers registered in the runtime provider registry. Inbound `/v1` API compatibility and client setup are listed separately; neither is an outbound upstream provider. Model availability is a combination of static provider registry entries, provider-specific model files, and (where configured) live discovery/passthrough. Catalog presence alone does not prove successful live service. No live provider APIs or credentials were used.

## How upstream contracts are wired

Upstream `open-sse/config/providers/index.ts` composes the provider registry. Each contract typically has a stable `id`, optional `alias`, wire `format`/`executor`, endpoint, auth type and model list. The registry adapter exposes legacy `PROVIDERS`, alias-to-model maps and local-provider detection; dispatch is selected by executor/format and shared request machinery. The exhaustive upstream identities and source files are in [`open-sse/config/providers/registry/`](https://github.com/cheaper-inference/OmniRoute/tree/ab180e32fcdf1f78c96f98a617e17c86e34bf5aa/open-sse/config/providers/registry) and composed by `providers/index.ts`.

Sign-in method is contract-specific: `apikey` means user-supplied API key; `oauth` means provider OAuth/token flow; `optional` means an anonymous route can operate without a key but accepts configured credentials; `none` means no credential in that contract; omitted/inherited means inspect shared executor/auth defaults before treating the route as anonymous. OAuth does not imply the same login client: provider-specific executors and token flows matter. Common OAuth/delegated examples are ChatGPT, Claude, Cursor, Codex, Kiro, Trae, GitHub, GitLab Duo, Antigravity and Zed Hosted. Most hosted inference contracts are API-key based. Optional/anonymous routes include Kilo Gateway, AI Horde, Pollinations, the g4f gateways and several free routes. Local/self-hosted endpoints include Ollama Cloud/Local variants, MLX, llama.cpp, llamafile, vLLM, Docker Model Runner and other configurable OpenAI-compatible endpoints. Local endpoint configuration is a network target, not a hosted provider sign-in.

### Upstream provider identities, aliases and auth modes

The rows below identify all 282 registry module contracts (module names are the source path under `open-sse/config/providers/registry/`; `*` denotes nested module). Alias and auth are from each `RegistryEntry` when literal; `—` means default/inherited alias/auth, not proof that no credential is needed. The registry and shared auth policy are authoritative for computed values. Source files follow each identity as `registry/<module>/index.ts`.

| Identity | Alias | Sign-in | Identity | Alias | Sign-in |
|---|---|---|---|---|---|
| adapta-web | adp-web | API key | agentrouter | agentrouter | API key |
| agnes | — | API key | agy | agy | OAuth |
| ai21 | ai21 | API key | aihorde | — | inherited |
| aimlapi | aiml | API key | ainative | — | inherited |
| ainetcafe | ainetcafe | inherited | aion | — | inherited |
| alibaba | ali | API key | ant-ling | ling | API key |
| anthropic | anthropic | API key | antigravity | — | OAuth |
| anyapi | anyapi | inherited | api-airforce | af | API key |
| apmix | apmix | API key | arcee-ai | arcee | inherited |
| auggie | aug | none | auriko | auriko | inherited |
| bai | bai | API key | baichuan | baichuan | API key |
| baidu | baidu | API key | bailian-coding-plan | bcp | API key |
| baseten | baseten | API key | bazaarlink | bzl | API key |
| beatapi | beatapi | inherited | bedrock | bedrock | API key/Cloud auth |
| bigmodel | bigmodel | API key | blackbox | bb | API key |
| blackbox-web | bb-web | API key | bluesminds | bm | API key |
| byteplus | bpm | API key | bytez | bytez | API key |
| cerebras | cerebras | API key | cerebrium | cerebrium | API key |
| charm-hyper | charm-hyper | API key | chat-oripe | chat-oripe | inherited |
| chatanywhere | chatanywhere | inherited | chatgpt | chatgpt | OAuth |
| chatgpt-web | — | API key | chatgpt-web-codex | cgpt-codex | API key |
| chatplayground | cpl | API key | cheaperinference | cinf | API key |
| chenzk | chenzk | API key | chutes | chutes | API key |
| claude | cc | OAuth | claude-web | cw | API key/session |
| cline | cl | API key | clinepass | cp | OAuth |
| cloudcode-one | cloudcode-one | inherited | cloudflare-ai | cf | API key |
| cloudflare-playground | cfp | none | clova-studio | clova | API key |
| codebuddy-cn | cbcn | OAuth | codebuddy-intl | cbai | OAuth |
| codestral | codestral | API key | codex | cx | OAuth |
| codex-app-server | cxa | OAuth | cohere | cohere | API key |
| command-code | cmd | API key | conol-web | cnl | API key |
| copilot-m365-web | m365copilot | API key/session | copilot-web | copilot-web | API key/session |
| coze | coze | API key | crof | crof | API key |
| cursor | cu | OAuth | dahl | dahl | API key |
| daoxe | daoxe | inherited | databricks | databricks | API key |
| deepai | deepai | API key | deepinfra | deepinfra | API key |
| deepseek | ds | API key | deepseek-web | ds-web | API key/session |
| demonroute | demonroute | inherited | devin-cli | dv | OAuth |
| devin-cli-agentic | dva | none | devin-desktop | — | OAuth |
| dgrid | dgrid | API key | dify | dify | API key |
| digitalocean | digitalocean | inherited | dit | dai | API key |
| doubao | doubao | API key | doubao-web | db | API key/session |
| duckduckgo-web | ddgw | none | dxnt | dxnt | inherited |
| electronhub | electronhub | inherited | empiriolabs | empiriolabs | inherited |
| eurouter | eurouter | inherited | factory | factory | API key |
| fastrouter | fastrouter | inherited | featherless-ai | featherless | API key |
| fireworks | fireworks | API key | free-ai | free-ai | inherited |
| freeaiapikey | faik | API key | freebuff | fb | API key |
| freeinference | freeinference | inherited | freemodel-dev | fmd | API key |
| freetheai | fta | API key | friendliai | friendli | API key |
| g4f-gemini | g4fgem | optional | g4f-groq | g4fgroq | optional |
| g4f-nvidia | g4fnv | optional | g4f-ollama | g4foll | optional |
| g4f-pollinations | g4fpol | optional | galadriel | galadriel | API key |
| gemini | gemini | API key | gemini-web | gweb | API key/session |
| ghe-copilot | ghe-copilot | OAuth | gigachat | gigachat | API key |
| gisoo | gisoo | inherited | github | gh | OAuth |
| gitlab-duo | gld | OAuth | gitlawb | glb | API key |
| gitlawb-gmi | glb-gmi | API key | glm | glm | API key |
| glm-cn | glmcn | API key | glmt | glmt | API key |
| greenpt | greenpt | inherited | grok-cli | gc | OAuth |
| grok-web | gw | API key/session | grokified | grokified | API key |
| groq | groq | API key | haiper | hp | API key |
| hcnsec | hcnsec | inherited | helixmind | helixmind | inherited |
| helyxai | helyxai | inherited | heroku | heroku | API key |
| hetzner | hetzner | API key | huggingchat | huggingchat | API key/session |
| huggingface | hf | API key | hyperagent | ha | API key |
| hyperbolic | hyp | API key | ideogram | ideo | API key |
| iflytek | iflytek | API key | inception | inception | API key |
| inference-net | inet | API key | inner-ai | in-ai | API key |
| internlm | internlm | API key | kenari | kenari | API key |
| kie | kie | API key | kilo-gateway | kg | optional |
| kilocode | kc | API key | kimi | kimi | API key |
| kimi-coding | kmc | OAuth | kimi-coding-apikey | kmca | API key |
| kimi-web | kimi-web | API key/session | kiro | kr | OAuth |
| lambda-ai | lambda | API key | leonardo | leo | API key |
| liquid | liquid | API key | literouter | literouter | inherited |
| llamagate | llamagate | API key | llm-kiwi | llmkiwi | inherited |
| llm7 | llm7 | API key | llmgateway | llmgateway | inherited |
| lmarena | lma | API key/session | logfare | logfare | inherited |
| longcat | lc | API key | lyceum | lyceum | inherited |
| magnific | freepik | API key | maritalk | maritalk | API key |
| maxai | mx | API key | megabrain | mb | OAuth |
| meganova-ai | meganova-ai | inherited | meta-llama | meta | API key |
| minimax | minimax | API key | minimax-cn | minimax-cn | API key |
| minimax-code | mmcode | none | mistral | mistral | API key |
| mixlayer | mixlayer | inherited | mlx | mlx-gemma | inherited/local |
| mnn-ai | mnn-ai | inherited | modal | modal | API key |
| modelscope | ms | API key | monsterapi | monster | API key |
| moonshot | moonshot | API key | morph | morph | API key |
| muse-code | mc | inherited | muse-spark-web | ms-web | API key/session |
| naga-ac | naga | optional | naga-ai | naga-ai | inherited |
| nan | nan | inherited | nanogpt | nanogpt | API key |
| nara | — | inherited | navy | — | inherited |
| nebius | nebius | inherited | nlpcloud | nlpc | API key |
| notion-web | nw | API key/session | notrack-web | ntw | API key/session |
| nous-research | nous | API key | novita | novita | API key |
| nscale | nscale | API key | nube | nube | API key |
| nvidia | nvidia | API key | ofoxai | ofoxai | inherited |
| ollama-cloud | ollamacloud | API key | oneminai | 1min | API key |
| onomeo | onomeo | inherited | openadapter | oad | API key |
| openai | openai | API key | opencode-go | opencode-go | API key |
| opencode-zen | opencode-zen | API key | opencode-server | ocs | API key |
| openference | of | OAuth | openference-api | ofa | inherited |
| openrouter | openrouter | API key | openvecta | openvecta | inherited |
| opper | opper | inherited | ovhcloud | ovh | optional |
| paraloncloud | paralon | inherited | perplexity | pplx | API key |
| perplexity-agent | pplx-agent | API key | perplexity-web | pplx-web | API key/session |
| pioneer | pn | API key | plamo | plamo | API key |
| poe | poe | API key/session | poixe-ai | poixe-ai | inherited |
| pollinations | pol | optional | poolside | poolside | inherited |
| predibase | predibase | API key | promptql | pql | API key |
| publicai | publicai | API key | qianfan | qianfan | API key |
| qiniu | qiniu | API key | qoder | if | API key |
| qwen-cloud | qwc | API key | qwen-cloud-token-plan | qct | API key |
| regolo | regolo | inherited | reka | reka | API key |
| replicate | replicate | API key | requesty | requesty | inherited |
| routeway | — | inherited | runcrate | runcrate | API key |
| sambanova | samba | API key | sarvam | sarvam | API key |
| scaleway | scw | API key | sealion | — | inherited |
| seekai | ska | inherited | sensenova | sensenova | API key |
| siliconflow | siliconflow | inherited | snowflake | snowflake | API key |
| sparkdesk | sparkdesk | API key | speka | speka | inherited |
| stepfun | stepfun | API key | sumopod | sumopod | API key |
| synthetic | synthetic | API key | syntx | stx | API key |
| t3-web | t3chat | API key/session | tabitoken | tabitoken | API key |
| tencent | tencent | API key | tencent-aistudio-web | tasw | API key/session |
| tinycms | tcw | API key/session | token-kiosk | tk | API key |
| tokenharbor | tokenharbor | inherited | tokenmarket | tokenmarket | inherited |
| tokenreply | tokenreply | inherited | tokenrouter | trk | API key |
| trae | tr | OAuth | twinmind | tm | API key |
| typhoon | typhoon | API key | uc | ucn | none |
| uc-direct | ucd | API key | udio | udio | API key |
| uncloseai | unc | optional | unifically | unifically | inherited |
| unorouter | unorouter | inherited | upstage | upstage | API key |
| v0-vercel | v0 | API key | venice | venice | API key |
| veoaifree-web | veo-free | none | vercel-ai-gateway | vag | API key |
| vertex | vertex | API key/Cloud auth | vertex-partner | vp | API key |
| void-ai | void-ai | inherited | volcengine | volcengine | API key |
| volcengine-agent-plan | veap | API key | volcengine-coding-plan | vecp | API key |
| wafer | wafer | API key | wandb | wandb | API key |
| workbuddy | wb | OAuth | writer | writer | API key |
| x5lab | x5lab | API key | xai | xai | API key |
| xiaomi-mimo | mimo | API key | xiaomi-mimo-token-plan | mimotp | API key |
| xkiro | — | inherited | y-api | y-api | inherited |
| yi | yi | API key | yolo-auto | yolo-auto | inherited |
| yuanbao-web | ybw | API key/session | zai | zai | API key |
| zai-web | zw | API key/session | zcode | zc | none |
| zed-hosted | — | OAuth | zenmux | zm | API key |
| zenmux-free | zmf | API key | zerolimitai | zerolimitai | inherited |
| zylo-api | zylo | inherited | | | |

Some upstream module exports represent multiple contracts (for example media providers, an API key variant, or a provider-specific plan); the table is the registered identity surface, not a count of modules. Aliases and auth markers are abbreviated from static source. Dynamic/shared auth, cookies and cloud identity can add requirements; verify the individual source before implementation.

## DurinDoor runtime comparison

DurinDoor has 326 provider registry modules and generated registration wiring. Its active runtime contract is spread across `open-sse/providers/registry/`, `open-sse/providers/schema.js`, auth executors in `open-sse/auth/`, provider-specific executors in `open-sse/executors/`, and dispatch/model discovery in `open-sse/handlers/` and `open-sse/services/`. There are more registry files than upstream contracts, in part because DurinDoor has dedicated aliases and families (local inference, media, search, speech, image/video, OmniRoute-compatible and provider-specific plans). Provider IDs that overlap are not proof of parity: endpoint, credential acquisition, headers, request translation, model discovery and capabilities can differ.

### Existing provider deltas (not missing providers)

| Contract area | DurinDoor state / delta | Suggested mock acceptance test |
|---|---|---|
| OAuth and account-backed routes | DurinDoor has dedicated executor/auth paths for ChatGPT/Codex, Claude, Cursor, Kiro, GitHub/Copilot, Trae and Antigravity. Upstream may share a registry shape while using different token/session acquisition. Compare each provider's executor and refresh flow before claiming equivalence. | Inject a fake token endpoint and mock upstream; assert sign-in callback/refresh, correct credential header, and one dispatched request without external network. |
| Catalog and alias behavior | DurinDoor registry is split into generated per-provider modules and includes plan/region/model aliases; upstream composes TypeScript registry entries and derives legacy provider/model maps. Model IDs need not be identical. | Fixture registry entries with alias collision, static model, passthrough model and provider discovery; assert the public model list and dispatch resolve to the correct upstream ID. |
| Local/network providers | DurinDoor has explicit local provider entries and LAN discovery; upstream supports configurable/private local base URLs and local-host detection. Host reachability and SSRF protections are implementation-specific. | Mock local server and private-host resolution; assert local discovery/model listing and rejected unsafe target cases without making external calls. |
| Non-chat/service contracts | DurinDoor has image, audio, video, embedding and search registries/executors beyond chat. Compare endpoint service kind and auth independently; a chat contract does not implement these APIs. | Fake each protocol endpoint and assert request shape, response normalization, and API-key/header behavior. |
| Inbound API compatibility | DurinDoor's `/v1` is an inbound compatibility surface that dispatches to selected provider contracts. Upstream's OpenAI/Anthropic-compatible routes are likewise server APIs. These are not provider catalog entries and do not imply upstream access to OpenAI/Anthropic. | Send a local mock inbound request to `/v1`; verify normalized provider dispatch and protocol-shaped response using a fake executor. |
| Client setup | OmniRoute setup commands/configuration for clients (OpenCode, Cursor, Claude Code, Codex, Cline, etc.) write or describe client-side endpoint/model settings. DurinDoor's CLI/dashboard configuration is a separate client setup surface. | Unit-test setup output/config serialization against a temporary fixture; assert local gateway URL, API key placeholder and selected model, with no actual client file writes. |

### Missing upstream contracts

These upstream IDs are absent as exact IDs from DurinDoor registry files at the comparison SHA. Some may be conceptually covered by a similar route or renamed implementation; absence is not a recommendation to add them. All tests below are mock-only. Source module URLs use the pinned upstream SHA.

| Missing identity | Upstream sign-in/source | Suggested mock acceptance test | Issues / uncertainty |
|---|---|---|---|
| `arcee-ai`, `cerebrium`, `chat-oripe`, `chatgpt`, `chatgpt-web-codex`, `chatplayground`, `cloudflare-playground`, `codebuddy-intl`, `conol-web`, `daoxe` | Registry modules under [upstream registry](https://github.com/cheaper-inference/OmniRoute/tree/ab180e32fcdf1f78d8f042634d38b7005228e5c/open-sse/config/providers/registry); auth markers range inherited, API key, OAuth and none. | Per-ID fixture: register identity, provide fake credentials where required, capture URL/headers/body and validate normalized response. | `chatgpt` is distinct OAuth contract; DurinDoor OpenAI API-key support is not equivalent. |
| `demonroute`, `devin-cli-agentic`, `devin-desktop`, `empiriolabs`, `freebuff`, `g4f-gemini`, `g4f-groq`, `g4f-nvidia`, `g4f-ollama`, `g4f-pollinations` | Same pinned provider registry; mixed inherited, OAuth, none and optional auth. | For optional/anonymous routes test both absent and configured key; for OAuth test fake refresh; assert proper executor selection. | Agentic/desktop route behavior may depend on installed client or delegated service. |
| `gisoo`, `grokified`, `helyxai`, `hetzner`, `hyperagent`, `lmarena`, `maxai`, `megabrain`, `minimax-code`, `mnn-ai` | Same pinned provider registry; mix API key, OAuth, no-key and inherited contracts. | Fake each provider protocol with success/error fixtures; assert auth, retry and error mapping. | `minimax-code` is an agent/client-style path and should not be equated with MiniMax API-key chat. |
| `monsterapi`, `moonshot`, `naga-ai`, `nan`, `nlpcloud`, `notion-web`, `notrack-web`, `ollama-cloud`, `opencode-server`, `openference` | Same pinned provider registry; mixed API key, OAuth, inherited or session auth. | Assert server-vs-web endpoint path and model translation against a local fake endpoint; reject missing required auth. | `moonshot` overlaps conceptually with Kimi but is a separate identity/endpoint. `openference` OAuth differs from `openference-api`. |
| `paraloncloud`, `poe`, `predibase`, `promptql`, `replicate`, `runcrate`, `seekai`, `syntx`, `tabitoken`, `tencent-aistudio-web` | Same pinned provider registry; inherited, API key or web/session contracts. | Test configured credential insertion, URL/path, stream parsing and provider error conversion with recorded fixtures. | `poe` and Tencent web use web/session-like behavior, not generic hosted inference. |
| `tinycms`, `tokenharbor`, `twinmind`, `uc`, `workbuddy`, `xkiro`, `y-api`, `zai-web`, `zcode`, `zed-hosted` | Same pinned provider registry; API-key/inherited/none or OAuth. | Fake endpoint plus missing/valid credential cases; for OAuth assert callback exchange and refresh; for no-key routes assert no auth header. | `zed-hosted` is OAuth; `uc`/`zcode` are marked none; inherited auth requires source-level confirmation. |

There are 60 upstream IDs with no exact DurinDoor ID. Before treating this table as complete gap analysis, resolve renamed/aliased equivalents against endpoint, auth and executor behavior. Issue markers found in source are provider-specific context rather than proof of a reported defect; no source:omniroute issue is attributed to these deltas unless linked in the cited source. Search issue tracker at review time for active reports.

## Antigravity observations (report only)

Both repositories register Antigravity as a distinct provider with OAuth and a dedicated executor/transport. Upstream uses Cloud Code generation endpoints, shared Antigravity headers, public model constants and a live-catalog-authoritative flag. DurinDoor uses the IDE endpoint, a Google-like User-Agent, quota/model discovery RPCs, explicit retry rules, local model aliases/fallbacks and a deprecation/risk notice. Those differences affect endpoint routing, quotas, discovery and advertised model IDs; matching the provider name is not contract parity. No implementation was edited. Suggested mock acceptance coverage: fake token exchange, generation endpoint, quota/model-discovery RPCs and retry response; assert token/header, transformed model IDs, quota/model filtering and safe handling of retired/unknown models. Uncertainty remains around live upstream contract changes; validate against pinned source and recorded fixtures, never a live account for this inventory.

## Primary source locations

- Upstream registry composition and shared contract: [`open-sse/config/providers/index.ts`](https://github.com/cheaper-inference/OmniRoute/blob/ab180e32fcdf1f78d8f042634d38b7005228e5c/open-sse/config/providers/index.ts), [`open-sse/config/providers/shared.ts`](https://github.com/cheaper-inference/OmniRoute/blob/ab180e32fcdf1f78d8f042634d38b7005228e5c/open-sse/config/providers/shared.ts), and [`open-sse/config/providerRegistry.ts`](https://github.com/cheaper-inference/OmniRoute/blob/ab180e32fcdf1f78d8f042634d38b7005228e5c/open-sse/config/providerRegistry.ts).
- Upstream routing/auth/model contracts: [`open-sse/config/providers/registry/`](https://github.com/cheaper-inference/OmniRoute/tree/ab180e32fcdf1f78d8f042634d38b7005228e5c/open-sse/config/providers/registry), `open-sse/auth/`, `open-sse/executors/`, and `open-sse/handlers/` at the same pinned commit.
- DurinDoor registration: [`open-sse/providers/registry/index.js`](https://github.com/bloodf/durindoor/blob/fd3a0f959a5eca082d8f042634d38b7005228e5c/open-sse/providers/registry/index.js), generated [provider registry index](https://github.com/bloodf/durindoor/blob/fd3a0f959a5eca082d8f042634d38b7005228e5c/open-sse/providers/registry/index.js), [`open-sse/providers/schema.js`](https://github.com/bloodf/durindoor/blob/fd3a0f959a5eca082d8f042634d38b7005228e5c/open-sse/providers/schema.js), `open-sse/auth/`, `open-sse/executors/`, `open-sse/handlers/`, and `open-sse/services/` at the comparison SHA.
- Upstream client setup: [`bin/cli/api-commands/setup.mjs`](https://github.com/cheaper-inference/OmniRoute/tree/ab180e32fcdf1f78d8f042634d38b7005228e5c/bin/cli) and setup guides under `docs/guides/`.
- Public issues: [OmniRoute issue tracker](https://github.com/cheaper-inference/OmniRoute/issues). Issue association is intentionally not guessed from keyword similarity.
