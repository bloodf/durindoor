# OmniRoute provider parity delta (2026-11-21)

OmniRoute registry trees compared: `a78e2a87ccb8ad81cc10429af780a3d55e6f1c80` → `4265bb2ad5477450a07d3a43ea33a62c6c874878` (`release/v3.8.55`). CLIProxyAPI pin: `f5c5681a8361c9da53e93c60b6507816eee7468b`; EasyCLIProxyAPI pin: `e4223d5eefa22a3301ca7e2a28d05897432b07f9` (unchanged; this inventory covers OmniRoute). Both OmniRoute trees contain 303 registry `index.ts` modules.

| upstream id | DurinDoor file or "missing" | auth type | changed since a78e2a87 | issue # |
|---|---|---|---|---|
| adapta-web<br>agentrouter | open-sse/providers/registry/adapta-web.js<br>open-sse/providers/registry/agentrouter.js | cookie<br>api-key/token | no<br>no | —<br>— |
| agnes/cn<br>agnes | open-sse/providers/registry/agnes-cn.js<br>open-sse/providers/registry/agnes.js | apikey<br>apikey | no<br>no | #1152<br>#1151, #1152 |
| agy<br>ai21 | open-sse/providers/registry/agy.js<br>open-sse/providers/registry/ai21.js | none/session<br>api-key/token | no<br>no | —<br>— |
| aihorde<br>aimlapi | open-sse/providers/registry/aihorde.js<br>open-sse/providers/registry/aimlapi.js | apikey<br>api-key/token | no<br>no | —<br>— |
| ainative<br>ainetcafe | open-sse/providers/registry/ainative.js<br>open-sse/providers/registry/ainetcafe.js | apikey<br>apikey | no<br>no | #1153<br>— |
| aion<br>alibaba/cn | open-sse/providers/registry/aion.js<br>open-sse/providers/registry/alibaba-cn.js | apikey<br>api-key/token | no<br>no | #1154<br>— |
| alibaba<br>ant-ling | open-sse/providers/registry/alibaba.js<br>open-sse/providers/registry/ant-ling.js | api-key/token<br>apikey | no<br>no | #762<br>— |
| anthropic<br>antigravity | open-sse/providers/registry/anthropic.js<br>open-sse/providers/registry/antigravity.js | api-key/token<br>none/session | no<br>no | #1363, #1382, #1350<br>#1398, #1552, #748, #759, #688, #595, #608 |
| anyapi<br>api-airforce | open-sse/providers/registry/anyapi.js<br>open-sse/providers/registry/api-airforce.js | apikey<br>api-key/token | no<br>no | #1155<br>— |
| apmix<br>arcee-ai | open-sse/providers/registry/apmix.js<br>missing | apikey<br>— | no<br>no | #1156<br>— |
| auggie<br>auriko | open-sse/providers/registry/auggie.js<br>open-sse/providers/registry/auriko.js | none/session<br>apikey | no<br>no | —<br>#1157 |
| bai<br>baichuan | open-sse/providers/registry/bai.js<br>open-sse/providers/registry/baichuan.js | api-key/token<br>api-key/token | no<br>no | —<br>— |
| baidu<br>bailian-coding-plan | open-sse/providers/registry/baidu.js<br>open-sse/providers/registry/bailian-coding-plan.js | api-key/token<br>api-key/token | no<br>no | —<br>— |
| baseten<br>bazaarlink | open-sse/providers/registry/baseten.js<br>open-sse/providers/registry/bazaarlink.js | api-key/token<br>api-key/token | no<br>no | —<br>— |
| beatapi<br>bedrock | open-sse/providers/registry/beatapi.js<br>open-sse/providers/registry/bedrock.js | apikey<br>api-key/token | no<br>no | #1158<br>— |
| bigmodel<br>blackbox | open-sse/providers/registry/bigmodel.js<br>open-sse/providers/registry/blackbox.js | api-key/token<br>api-key/token | no<br>no | —<br>#1159 |
| blackbox/web<br>bluesminds | missing<br>open-sse/providers/registry/bluesminds.js | —<br>api-key/token | no<br>no | #1159<br>— |
| byteplus<br>bytez | open-sse/providers/registry/byteplus.js<br>open-sse/providers/registry/bytez.js | api-key/token<br>api-key/token | no<br>no | —<br>— |
| cerebras<br>cerebrium | open-sse/providers/registry/cerebras.js<br>open-sse/providers/registry/cerebrium.js | api-key/token<br>apikey | no<br>no | —<br>— |
| charm-hyper<br>chat-oripe | open-sse/providers/registry/charm-hyper.js<br>missing | api-key/token<br>— | no<br>no | —<br>#1160 |
| chatanywhere<br>chatgpt-web-codex | open-sse/providers/registry/chatanywhere.js<br>open-sse/providers/private/chatgpt-web-codex.js | apikey<br>cookie | no<br>no | #1161<br>#1162 |
| chatgpt-web<br>chatgpt | open-sse/providers/registry/chatgpt-web.js<br>missing | cookie<br>— | no<br>no | #1162<br>#1162 |
| chatplayground<br>cheaperinference | missing<br>open-sse/providers/registry/cheaperinference.js | —<br>apikey | no<br>no | #1163<br>#1164 |
| chenzk<br>chutes | open-sse/providers/registry/chenzk.js<br>open-sse/providers/registry/chutes.js | api-key/token<br>api-key/token | no<br>no | —<br>— |
| claude<br>claude/web | open-sse/providers/registry/claude.js<br>open-sse/providers/private/claude-web.js | api-key/token<br>cookie | no<br>no | #1165, #1363, #1330, #1354, #1383, #1343, #1353, #1367, #1382, #1356, #1352, #1350, #1557, #1075, #1349, #1077, #757, #754, #756, #687, #669, #580, #575, #572<br>#1165 |
| cline<br>clinepass | open-sse/providers/registry/cline.js<br>open-sse/providers/registry/clinepass.js | api-key/token<br>api-key/token | no<br>no | #671<br>— |
| cloudcode-one<br>cloudflare-ai | open-sse/providers/registry/cloudcode-one.js<br>open-sse/providers/registry/cloudflare-ai.js | apikey<br>apikey | no<br>no | #1166<br>— |
| cloudflare-playground<br>clova-studio | missing<br>open-sse/providers/registry/clova-studio.js | —<br>apikey | no<br>no | #1167<br>— |
| codebuddy-cn<br>codebuddy-intl | open-sse/providers/registry/codebuddy-cn.js<br>open-sse/providers/registry/codebuddy-intl.js | api-key/token<br>apikey | yes<br>no | —<br>— |
| codestral<br>codex-app-server | open-sse/providers/registry/codestral.js<br>open-sse/providers/registry/codex-app-server.js | api-key/token<br>none/session | no<br>no | —<br>#1168 |
| codex<br>cohere | open-sse/providers/registry/codex.js<br>open-sse/providers/registry/cohere.js | none/session<br>apikey | yes<br>no | #1162, #1563, #1168, #1554, #679, #742, #684, #672, #593<br>— |
| command-code<br>conol-web | open-sse/providers/registry/command-code.js<br>missing | api-key/token<br>— | no<br>no | —<br>#1169 |
| copilot-m365-web<br>copilot-web | open-sse/providers/registry/copilot-m365-web.js<br>open-sse/providers/registry/copilot-web.js | cookie<br>cookie | no<br>no | —<br>— |
| coze<br>crof | open-sse/providers/registry/coze.js<br>open-sse/providers/registry/crof.js | apikey<br>apikey | no<br>no | —<br>— |
| cursor<br>dahl | open-sse/providers/registry/cursor.js<br>open-sse/providers/registry/dahl.js | none/session<br>apikey | no<br>no | #1170, #1418, #1084, #1083<br>#1171 |
| daoxe<br>databricks | open-sse/providers/registry/daoxe.js<br>open-sse/providers/registry/databricks.js | apikey<br>apikey | no<br>no | —<br>— |
| deepai<br>deepinfra | open-sse/providers/registry/deepai.js<br>open-sse/providers/registry/deepinfra.js | apikey<br>apikey | no<br>no | #1172<br>— |
| deepseek<br>deepseek/web | open-sse/providers/registry/deepseek.js<br>open-sse/providers/private/deepseek-web.js | api-key/token<br>apikey | no<br>no | #1173, #585<br>#1173 |
| demonroute<br>devin-cli-agentic | open-sse/providers/registry/demonroute.js<br>open-sse/providers/registry/devin-cli-agentic.js | apikey<br>none | no<br>no | —<br>#1174 |
| devin-cli<br>devin-desktop | open-sse/providers/registry/devin-cli.js<br>missing | api-key/token<br>— | no<br>no | #1174<br>#1175 |
| dgrid<br>dify | open-sse/providers/registry/dgrid.js<br>open-sse/providers/registry/dify.js | apikey<br>apikey | no<br>no | —<br>— |
| digitalocean<br>dit | open-sse/providers/registry/digitalocean.js<br>open-sse/providers/registry/dit.js | api-key/token<br>apikey | no<br>no | —<br>— |
| doubao<br>doubao/web | open-sse/providers/registry/doubao.js<br>open-sse/providers/private/doubao-web.js | apikey<br>cookie | no<br>no | #1176<br>#1176 |
| duckduckgo-web<br>dxnt | open-sse/providers/registry/duckduckgo-web.js<br>open-sse/providers/registry/dxnt.js | none<br>apikey | no<br>no | —<br>#1177 |
| electronhub<br>empiriolabs | open-sse/providers/registry/electronhub.js<br>open-sse/providers/registry/empiriolabs.js | apikey<br>apikey | no<br>no | #1178<br>— |
| eurouter<br>factory | open-sse/providers/registry/eurouter.js<br>open-sse/providers/registry/factory.js | apikey<br>apikey | no<br>no | #1179<br>— |
| fastrouter<br>featherless-ai | open-sse/providers/registry/fastrouter.js<br>open-sse/providers/registry/featherless-ai.js | apikey<br>apikey | no<br>no | #1180<br>— |
| fireworks<br>free-ai | open-sse/providers/registry/fireworks.js<br>open-sse/providers/registry/free-ai.js | apikey<br>apikey | no<br>no | —<br>#1181 |
| freeaiapikey<br>freebuff | open-sse/providers/registry/freeaiapikey.js<br>missing | apikey<br>— | no<br>no | —<br>#1182 |
| freeinference<br>freemodel-dev | open-sse/providers/registry/freeinference.js<br>open-sse/providers/registry/freemodel-dev.js | apikey<br>apikey | no<br>no | #1183<br>— |
| freetheai<br>friendliai | open-sse/providers/registry/freetheai.js<br>open-sse/providers/registry/friendliai.js | apikey<br>apikey | no<br>no | #1184<br>— |
| g4f-gemini<br>g4f-groq | missing<br>missing | —<br>— | no<br>no | #1185<br>#1186 |
| g4f-nvidia<br>g4f-ollama | missing<br>missing | —<br>— | no<br>no | #1187<br>#1188 |
| g4f-pollinations<br>galadriel | missing<br>open-sse/providers/registry/galadriel.js | —<br>apikey | no<br>no | #1189<br>— |
| gemini<br>gemini/web | open-sse/providers/registry/gemini.js<br>missing | apikey<br>— | yes<br>no | #1185, #1190, #1328, #1330, #1369, #1389, #1339, #1340, #1342, #1357, #1346, #1381, #1552, #1349, #1082, #676, #675, #608<br>#1190 |
| ghe-copilot<br>gigachat | open-sse/providers/registry/ghe-copilot.js<br>open-sse/providers/registry/gigachat.js | none/session<br>apikey | no<br>no | —<br>— |
| gisoo<br>github | open-sse/providers/registry/gisoo.js<br>open-sse/providers/registry/github.js | apikey<br>none/session | no<br>no | —<br>— |
| gitlab-duo<br>gitlawb/gmi | open-sse/providers/registry/gitlab-duo.js<br>open-sse/providers/registry/gitlawb-gmi.js | api-key/token<br>api-key/token | no<br>no | —<br>— |
| gitlawb<br>glm/cn | open-sse/providers/registry/gitlawb.js<br>open-sse/providers/registry/glm-cn.js | apikey<br>api-key/token | no<br>no | —<br>— |
| glm<br>glm/t | open-sse/providers/registry/glm.js<br>open-sse/providers/registry/glmt.js | apikey<br>api-key/token | no<br>no | #1553, #666<br>— |
| greenpt<br>grok-cli | open-sse/providers/registry/greenpt.js<br>open-sse/providers/registry/grok-cli.js | apikey<br>none/session | no<br>no | #1191<br>#600 |
| grok-web<br>grokified | open-sse/providers/registry/grok-web.js<br>open-sse/providers/registry/grokified.js | cookie<br>apikey | no<br>no | —<br>— |
| groq<br>haiper | open-sse/providers/registry/groq.js<br>open-sse/providers/registry/haiper.js | apikey<br>apikey | no<br>no | #1186, #582<br>— |
| hcnsec<br>helixmind | open-sse/providers/registry/hcnsec.js<br>open-sse/providers/registry/helixmind.js | apikey<br>apikey | no<br>no | —<br>#1192 |
| helyxai<br>heroku | missing<br>open-sse/providers/registry/heroku.js | —<br>apikey | no<br>no | #1193<br>— |
| hetzner<br>huggingchat | open-sse/providers/registry/hetzner.js<br>open-sse/providers/registry/huggingchat.js | api-key/token<br>cookie | no<br>no | —<br>— |
| huggingface<br>hyperagent | open-sse/providers/registry/huggingface.js<br>missing | apikey<br>— | no<br>no | —<br>#1194 |
| hyperbolic<br>ideogram | open-sse/providers/registry/hyperbolic.js<br>open-sse/providers/registry/ideogram.js | apikey<br>apikey | no<br>no | —<br>— |
| iflytek<br>inception | open-sse/providers/registry/iflytek.js<br>open-sse/providers/registry/inception.js | apikey<br>apikey | no<br>no | —<br>— |
| inference-net<br>inner-ai | open-sse/providers/registry/inference-net.js<br>open-sse/providers/registry/inner-ai.js | apikey<br>api-key/token | no<br>no | —<br>— |
| internlm<br>kenari | open-sse/providers/registry/internlm.js<br>open-sse/providers/registry/kenari.js | apikey<br>api-key/token | no<br>no | —<br>— |
| kie<br>kilo-gateway | open-sse/providers/registry/kie.js<br>open-sse/providers/registry/kilo-gateway.js | apikey<br>optional | no<br>no | —<br>— |
| kilocode<br>kimi/coding-apikey | open-sse/providers/registry/kilocode.js<br>open-sse/providers/registry/kimi-coding-apikey.js | api-key/token<br>api-key/token | no<br>no | —<br>— |
| kimi/coding<br>kimi | open-sse/providers/registry/kimi-coding.js<br>open-sse/providers/registry/kimi.js | api-key/token<br>api-key/token | no<br>no | #612<br>#1359, #1556, #1368, #612 |
| kimi/web<br>kiro | open-sse/providers/registry/kimi-web.js<br>open-sse/providers/registry/kiro.js | cookie<br>api-key/token | no<br>no | —<br>#1333, #1079, #1078, #755, #664, #737 |
| lambda-ai<br>leonardo | open-sse/providers/registry/lambda-ai.js<br>open-sse/providers/registry/leonardo.js | apikey<br>apikey | no<br>no | —<br>— |
| liquid<br>literouter | open-sse/providers/registry/liquid.js<br>open-sse/providers/registry/literouter.js | apikey<br>apikey | no<br>no | —<br>#1195 |
| llamagate<br>llm-kiwi | open-sse/providers/registry/llamagate.js<br>open-sse/providers/registry/llm-kiwi.js | apikey<br>apikey | no<br>no | —<br>#1196 |
| llm7<br>llmgateway | open-sse/providers/registry/llm7.js<br>open-sse/providers/registry/llmgateway.js | apikey<br>apikey | no<br>no | —<br>#1197 |
| lmarena<br>logfare | missing<br>open-sse/providers/registry/logfare.js | —<br>apikey | no<br>no | #1198<br>#1199 |
| longcat<br>lyceum | open-sse/providers/registry/longcat.js<br>open-sse/providers/registry/lyceum.js | apikey<br>apikey | no<br>no | —<br>#1200 |
| magnific<br>maritalk | open-sse/providers/registry/magnific.js<br>open-sse/providers/registry/maritalk.js | apikey<br>apikey | no<br>no | #1201<br>— |
| maxai<br>megabrain | missing<br>open-sse/providers/registry/megabrain.js | —<br>apikey | no<br>no | #1202<br>— |
| meganova-ai<br>meta-llama | open-sse/providers/registry/meganova-ai.js<br>open-sse/providers/registry/meta-llama.js | apikey<br>apikey | no<br>no | #1203<br>— |
| minimax-code<br>minimax/cn | missing<br>open-sse/providers/registry/minimax-cn.js | —<br>apikey | no<br>no | —<br>— |
| minimax<br>mistral | open-sse/providers/registry/minimax.js<br>open-sse/providers/registry/mistral.js | api-key/token<br>apikey | no<br>no | #1361<br>— |
| mixlayer<br>mlx | open-sse/providers/registry/mixlayer.js<br>open-sse/providers/registry/mlx.js | apikey<br>apikey | no<br>no | #1204<br>#1206, #1205 |
| mnn-ai<br>modal | open-sse/providers/registry/mnn-ai.js<br>open-sse/providers/registry/modal.js | apikey<br>apikey | no<br>no | #1207<br>#1134 |
| modelscope<br>monsterapi | open-sse/providers/registry/modelscope.js<br>missing | apikey<br>— | no<br>no | —<br>#1208 |
| moonshot<br>morph | missing<br>open-sse/providers/registry/morph.js | —<br>apikey | no<br>no | #1359<br>— |
| muse-code<br>muse-spark-web | open-sse/providers/registry/muse-code.js<br>open-sse/providers/registry/muse-spark-web.js | api-key/token<br>cookie | no<br>no | —<br>— |
| naga-ac<br>naga-ai | open-sse/providers/registry/naga-ac.js<br>missing | optional<br>— | no<br>no | #1209<br>#1210 |
| nan<br>nanogpt | open-sse/providers/registry/nan.js<br>open-sse/providers/registry/nanogpt.js | apikey<br>apikey | no<br>no | —<br>— |
| nara<br>navy | open-sse/providers/registry/nara.js<br>open-sse/providers/registry/navy.js | apikey<br>apikey | no<br>no | #1211<br>#1212 |
| nebius<br>nlpcloud | open-sse/providers/registry/nebius.js<br>open-sse/providers/registry/nlpcloud.js | apikey<br>apikey | no<br>no | —<br>#1213 |
| notion-web<br>notrack-web | missing<br>missing | —<br>— | no<br>no | #1214<br>#1215 |
| nous-research<br>novita | open-sse/providers/registry/nous-research.js<br>open-sse/providers/registry/novita.js | apikey<br>apikey | no<br>no | —<br>— |
| nscale<br>nube | open-sse/providers/registry/nscale.js<br>open-sse/providers/registry/nube.js | apikey<br>api-key/token | no<br>no | —<br>— |
| nvidia<br>ofoxai | open-sse/providers/registry/nvidia.js<br>open-sse/providers/registry/ofoxai.js | api-key/token<br>apikey | no<br>no | #1187, #1401<br>#1216 |
| ollama-cloud<br>oneminai | missing<br>open-sse/providers/registry/oneminai.js | —<br>apikey | no<br>no | #665<br>#1217 |
| onomeo<br>openadapter | open-sse/providers/registry/onomeo.js<br>open-sse/providers/registry/openadapter.js | apikey<br>apikey | no<br>no | #1218<br>#1219 |
| openai<br>opencode-server | open-sse/providers/registry/openai.js<br>open-sse/providers/registry/opencode-server.js | api-key/token<br>apikey | yes<br>no | #2027, #2021, #2025, #2023, #1343, #1366, #1362, #1381, #1077, #1076, #1082, #667, #592, #597, #572<br>— |
| opencode/go<br>opencode/zen | open-sse/providers/registry/opencode-go.js<br>open-sse/providers/registry/opencode-zen.js | api-key/token<br>apikey | no<br>no | #1556, #1561, #1557, #763<br>#1559 |
| openference-api<br>openference | open-sse/providers/registry/openference-api.js<br>open-sse/providers/registry/openference.js | apikey<br>none/session | no<br>no | #1221<br>#1220, #1221 |
| openrouter<br>openvecta | open-sse/providers/registry/openrouter.js<br>open-sse/providers/registry/openvecta.js | apikey<br>apikey | no<br>no | #683<br>#1222 |
| opper<br>orcarouter | open-sse/providers/registry/opper.js<br>open-sse/providers/registry/orcarouter.js | apikey<br>apikey | no<br>no | #1223<br>#1224 |
| ovhcloud<br>paraloncloud | open-sse/providers/registry/ovhcloud.js<br>open-sse/providers/registry/paraloncloud.js | optional<br>apikey | no<br>no | —<br>— |
| perplexity/agent<br>perplexity | open-sse/providers/registry/perplexity-agent.js<br>open-sse/providers/registry/perplexity.js | apikey<br>apikey | no<br>no | —<br>— |
| perplexity/web<br>pioneer | open-sse/providers/registry/perplexity-web.js<br>open-sse/providers/registry/pioneer.js | cookie<br>apikey | no<br>no | —<br>#1225 |
| plamo<br>poe | open-sse/providers/registry/plamo.js<br>missing | apikey<br>— | no<br>no | —<br>— |
| poixe-ai<br>pollinations | open-sse/providers/registry/poixe-ai.js<br>open-sse/providers/registry/pollinations.js | apikey<br>apikey | no<br>no | #1226<br>#1189 |
| poolside<br>predibase | open-sse/providers/registry/poolside.js<br>missing | apikey<br>— | no<br>no | —<br>#1227 |
| promptql<br>publicai | missing<br>open-sse/providers/registry/publicai.js | —<br>apikey | no<br>no | #1228<br>#1229 |
| qianfan<br>qiniu | open-sse/providers/registry/qianfan.js<br>open-sse/providers/registry/qiniu.js | api-key/token<br>api-key/token | no<br>no | —<br>— |
| qoder<br>qwen-cloud-token-plan | open-sse/providers/registry/qoder.js<br>open-sse/providers/registry/qwen-cloud-token-plan.js | api-key/token<br>apikey | yes<br>no | #1558, #583<br>— |
| qwen-cloud<br>regolo | open-sse/providers/registry/qwen-cloud.js<br>open-sse/providers/registry/regolo.js | apikey<br>apikey | no<br>no | —<br>#1230 |
| reka<br>replicate | open-sse/providers/registry/reka.js<br>open-sse/providers/registry/replicate.js | api-key/token<br>apikey | no<br>no | —<br>— |
| requesty<br>routeway | open-sse/providers/registry/requesty.js<br>open-sse/providers/registry/routeway.js | api-key/token<br>apikey | no<br>no | —<br>#1231 |
| runcrate<br>sambanova | open-sse/providers/registry/runcrate.js<br>open-sse/providers/registry/sambanova.js | apikey<br>none/session | no<br>no | —<br>— |
| sarvam<br>scaleway | open-sse/providers/registry/sarvam.js<br>open-sse/providers/registry/scaleway.js | apikey<br>none/session | no<br>no | #768<br>— |
| sealion<br>seekai | open-sse/providers/registry/sealion.js<br>missing | apikey<br>— | no<br>no | —<br>#1232 |
| sensenova<br>siliconflow | open-sse/providers/registry/sensenova.js<br>open-sse/providers/registry/siliconflow.js | api-key/token<br>api-key/token | no<br>no | —<br>— |
| snowflake<br>sparkdesk | open-sse/providers/registry/snowflake.js<br>open-sse/providers/registry/sparkdesk.js | api-key/token<br>none/session | no<br>no | —<br>— |
| speka<br>stepfun | open-sse/providers/registry/speka.js<br>open-sse/providers/registry/stepfun.js | apikey<br>none/session | no<br>no | #1233<br>— |
| sumopod<br>synthetic | open-sse/providers/registry/sumopod.js<br>open-sse/providers/registry/synthetic.js | api-key/token<br>apikey | no<br>no | —<br>#572 |
| syntx<br>t3-web | missing<br>open-sse/providers/registry/t3-web.js | —<br>cookie | no<br>no | #1234<br>— |
| tabitoken<br>tencent-aistudio-web | missing<br>missing | —<br>— | no<br>no | #1235<br>#1236 |
| tencent<br>tinycms | open-sse/providers/registry/tencent.js<br>missing | none/session<br>— | no<br>no | #1236<br>#1237 |
| together<br>token-kiosk | open-sse/providers/registry/together.js<br>open-sse/providers/registry/token-kiosk.js | apikey<br>apikey | no<br>no | —<br>#1238 |
| tokenharbor<br>tokenmarket | open-sse/providers/registry/tokenharbor.js<br>open-sse/providers/registry/tokenmarket.js | apikey<br>apikey | no<br>no | —<br>— |
| tokenreply<br>tokenrouter | open-sse/providers/registry/tokenreply.js<br>open-sse/providers/registry/tokenrouter.js | apikey<br>api-key/token | no<br>no | #1239<br>— |
| trae<br>twinmind | open-sse/providers/registry/trae.js<br>missing | api-key/token<br>— | no<br>no | —<br>#1240 |
| typhoon<br>uc-direct | open-sse/providers/registry/typhoon.js<br>open-sse/providers/registry/uc-direct.js | apikey<br>apikey | no<br>no | —<br>#1242 |
| uc<br>udio | open-sse/providers/registry/uc-direct.js<br>open-sse/providers/registry/udio.js | apikey<br>cookie | no<br>no | #1241, #1242<br>— |
| uncloseai<br>unifically | open-sse/providers/registry/uncloseai.js<br>open-sse/providers/registry/unifically.js | api-key/token<br>apikey | no<br>no | —<br>#1243 |
| unorouter<br>upstage | open-sse/providers/registry/unorouter.js<br>open-sse/providers/registry/upstage.js | apikey<br>api-key/token | no<br>no | #1244<br>— |
| v0-vercel<br>venice | open-sse/providers/registry/v0-vercel.js<br>open-sse/providers/registry/venice.js | api-key/token<br>apikey | no<br>no | —<br>— |
| veoaifree-web<br>vercel-ai-gateway | open-sse/providers/registry/veoaifree-web.js<br>open-sse/providers/registry/vercel-ai-gateway.js | none<br>api-key/token | no<br>no | —<br>— |
| vertex<br>vertex/partner | open-sse/providers/registry/vertex.js<br>open-sse/providers/registry/vertex-partner.js | api-key/token<br>api-key/token | no<br>no | —<br>— |
| void-ai<br>volcengine/agent-plan | open-sse/providers/registry/void-ai.js<br>open-sse/providers/registry/volcengine-agent-plan.js | apikey<br>apikey | no<br>no | #1245<br>— |
| volcengine/coding-plan<br>volcengine | open-sse/providers/registry/volcengine-coding-plan.js<br>open-sse/providers/registry/volcengine.js | apikey<br>api-key/token | no<br>no | —<br>— |
| wafer<br>wandb | open-sse/providers/registry/wafer.js<br>open-sse/providers/registry/wandb.js | api-key/token<br>api-key/token | no<br>no | —<br>— |
| workbuddy<br>writer | missing<br>open-sse/providers/registry/writer.js | —<br>apikey | no<br>no | #1246<br>#1311, #603 |
| x5lab<br>xai | open-sse/providers/registry/x5lab.js<br>open-sse/providers/registry/xai.js | api-key/token<br>api-key/token | no<br>no | —<br>#1247 |
| xiaomi-mimo-token-plan<br>xiaomi-mimo | open-sse/providers/registry/xiaomi-mimo-token-plan.js<br>open-sse/providers/registry/xiaomi-mimo.js | apikey<br>api-key/token | no<br>no | —<br>— |
| xkiro<br>y-api | open-sse/providers/registry/xkiro.js<br>open-sse/providers/registry/y-api.js | apikey<br>apikey | no<br>no | #1248<br>#1249 |
| yi<br>yolo-auto | open-sse/providers/registry/yi.js<br>open-sse/providers/registry/yolo-auto.js | api-key/token<br>apikey | no<br>no | —<br>#1250 |
| yuanbao-web<br>zai-web | open-sse/providers/registry/yuanbao-web.js<br>open-sse/providers/private/zai-web.js | cookie<br>cookie | no<br>no | —<br>#1251 |
| zai<br>zcode | open-sse/providers/registry/zai.js<br>missing | api-key/token<br>— | no<br>no | #1251<br>#1252 |
| zed-hosted<br>zenmux-free | missing<br>open-sse/providers/registry/zenmux-free.js | —<br>cookie | no<br>no | —<br>— |
| zenmux<br>zerolimitai | open-sse/providers/registry/zenmux.js<br>open-sse/providers/registry/zerolimitai.js | api-key/token<br>apikey | no<br>no | —<br>#1253 |
| zylo-api | open-sse/providers/registry/zylo-api.js | apikey | no | #1254 |
## Changed provider details

- `codebuddy-cn`: auth remains OAuth bearer; adds naive reset-time timezone `+08:00`; no endpoint or header change.
- `codex`: auth, endpoint, and headers unchanged; adds seven GPT-6.1 Terra model variants, including 20-minute timeouts on xhigh/high.
- `gemini`: auth, endpoint, and headers unchanged; adds `gemini-4-carbon` with tool calling and vision.
- `openai`: auth, endpoint, and headers unchanged; adds GPT-6.1 Terra and declares thinking effort support including `none` through `max`.
- `qoder`: auth, endpoint, and headers unchanged; adds static `smodel` (Sonus) and `cmodel` (Cantus) fallback catalog rows.
