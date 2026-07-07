# Agent Index

Auto-generated index of executors and providers.
Run `node scripts/gen-agent-index.mjs` to regenerate.

## Executors

| id | executor | source file |
|---|---|---|
| `antigravity` | AntigravityExecutor | `./antigravity.js` |
| `azure` | AzureExecutor | `./azure.js` |
| `codebuddy-cn` | CodeBuddyExecutor | `./codebuddy-cn.js` |
| `codex` | CodexExecutor | `./codex.js` |
| `commandcode` | CommandCodeExecutor | `./commandcode.js` |
| `cu` | CursorExecutor | `./cursor.js` |
| `cursor` | CursorExecutor | `./cursor.js` |
| `gemini-cli` | GeminiCLIExecutor | `./gemini-cli.js` |
| `github` | GithubExecutor | `./github.js` |
| `grok-web` | GrokWebExecutor | `./grok-web.js` |
| `iflow` | IFlowExecutor | `./iflow.js` |
| `kimchi` | KimchiExecutor | `./kimchi.js` |
| `kiro` | KiroExecutor | `./kiro.js` |
| `mimo-free` | MimoFreeExecutor | `./mimo-free.js` |
| `mmf` | MimoFreeExecutor | `./mimo-free.js` |
| `ollama-local` | OllamaLocalExecutor | `./ollama-local.js` |
| `opencode` | OpenCodeExecutor | `./opencode.js` |
| `opencode-go` | OpenCodeGoExecutor | `./opencode-go.js` |
| `perplexity-web` | PerplexityWebExecutor | `./perplexity-web.js` |
| `qoder` | QoderExecutor | `./qoder.js` |
| `qwen` | QwenExecutor | `./qwen.js` |
| `vertex` | VertexExecutor | `./vertex.js` |
| `vertex-partner` | VertexExecutor | `./vertex.js` |
| `xai` | XaiExecutor | `./xai.js` |
| `xiaomi-tokenplan` | XiaomiTokenplanExecutor | `./xiaomi-tokenplan.js` |

## Providers

| id | format | category | baseUrl |
|---|---|---|---|
| `agentrouter` | claude | apikey | `https://agentrouter.org/v1/messages` |
| `alicode` |  | apikey | `https://coding.dashscope.aliyuncs.com/v1/chat/completions` |
| `alicode-intl` |  | apikey | `https://coding-intl.dashscope.aliyuncs.com/v1/chat/completions` |
| `anthropic` | claude | apikey | `https://api.anthropic.com/v1/messages` |
| `antigravity` | antigravity | oauth | `` |
| `assemblyai` |  | apikey | `https://api.assemblyai.com/v1/audio/transcriptions` |
| `aws-polly` |  | apikey | `` |
| `azure` |  | apikey | `` |
| `black-forest-labs` |  | apikey | `` |
| `blackbox` |  | apikey | `https://api.blackbox.ai/v1/chat/completions` |
| `brave-search` |  | apikey | `` |
| `byteplus` |  | freeTier | `https://ark.ap-southeast.bytepluses.com/api/coding/v3/chat/completions` |
| `cartesia` |  | apikey | `` |
| `cerebras` |  | apikey | `https://api.cerebras.ai/v1/chat/completions` |
| `charm-hyper` |  | apikey | `https://hyper.charm.land/v1/chat/completions` |
| `chutes` |  | apikey | `https://llm.chutes.ai/v1/chat/completions` |
| `claude` | claude | oauth | `https://api.anthropic.com/v1/messages` |
| `cline` |  | oauth | `https://api.cline.bot/api/v1/chat/completions` |
| `clinepass` |  | oauth | `https://api.cline.bot/api/v1/chat/completions` |
| `cloudflare-ai` |  | freeTier | `https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1/chat/completions` |
| `codebuddy-cn` |  | oauth | `https://copilot.tencent.com/v2/chat/completions` |
| `codex` | openai-responses | oauth | `https://chatgpt.com/backend-api/codex/responses` |
| `cohere` |  | apikey | `https://api.cohere.ai/v1/chat/completions` |
| `comfyui` |  | apikey | `` |
| `commandcode` | commandcode | apikey | `https://api.commandcode.ai/alpha/generate` |
| `coqui` |  | freeTier | `` |
| `cursor` | cursor | oauth | `https://api2.cursor.sh` |
| `deepgram` |  | apikey | `https://api.deepgram.com/v1/listen` |
| `deepseek` |  | apikey | `https://api.deepseek.com/chat/completions` |
| `edge-tts` |  | freeTier | `` |
| `elevenlabs` |  | apikey | `` |
| `exa` |  | apikey | `` |
| `fal-ai` |  | apikey | `` |
| `firecrawl` |  | apikey | `` |
| `firecrawl_custom` |  | apikey | `` |
| `fireworks` |  | apikey | `https://api.fireworks.ai/inference/v1/chat/completions` |
| `gemini` | gemini | freeTier | `https://generativelanguage.googleapis.com/v1beta/models` |
| `gemini-cli` | gemini-cli | free | `https://cloudcode-pa.googleapis.com/v1internal` |
| `github` |  | oauth | `https://api.githubcopilot.com/chat/completions` |
| `gitlab` |  | oauth | `https://gitlab.com/api/v4/chat/completions` |
| `glm` | claude | apikey | `https://api.z.ai/api/anthropic/v1/messages` |
| `glm-cn` |  | apikey | `https://open.bigmodel.cn/api/coding/paas/v4/chat/completions` |
| `google-pse` |  | apikey | `` |
| `google-tts` |  | freeTier | `` |
| `grok-web` | grok-web | webCookie | `https://grok.com/rest/app-chat/conversations/new` |
| `groq` |  | apikey | `https://api.groq.com/openai/v1/chat/completions` |
| `huggingface` |  | apikey | `` |
| `hyperbolic` |  | apikey | `https://api.hyperbolic.xyz/v1/chat/completions` |
| `iflow` |  | oauth | `https://apis.iflow.cn/v1/chat/completions` |
| `inworld` |  | apikey | `` |
| `jina-ai` |  | apikey | `` |
| `jina-reader` |  | apikey | `` |
| `kenari` |  | apikey | `https://kenari.id/v1/chat/completions` |
| `kilocode` |  | oauth | `https://api.kilo.ai/api/openrouter/chat/completions` |
| `kimchi` | openai | oauth | `https://llm.kimchi.dev/openai/v1/chat/completions` |
| `kimi` | claude | apikey | `https://api.kimi.com/coding/v1/messages` |
| `kimi-coding` | claude | oauth | `https://api.kimi.com/coding/v1/messages` |
| `kiro` | kiro | free | `https://runtime.us-east-1.kiro.dev/generateAssistantResponse` |
| `linkup` |  | apikey | `` |
| `local-device` |  | freeTier | `` |
| `mimo-free` |  | free | `https://api.xiaomimimo.com/api/free-ai/openai/chat` |
| `minimax` | claude | apikey | `https://api.minimax.io/anthropic/v1/messages` |
| `minimax-cn` | claude | apikey | `https://api.minimaxi.com/anthropic/v1/messages` |
| `mistral` |  | apikey | `https://api.mistral.ai/v1/chat/completions` |
| `mmf` |  | apikey | `https://api.xiaomimimo.com/api/free-ai/openai/chat` |
| `nanobanana` |  | apikey | `https://api.nanobananaapi.ai/v1/chat/completions` |
| `nebius` |  | apikey | `https://api.studio.nebius.ai/v1/chat/completions` |
| `nube` |  | apikey | `https://ai.nube.sh/api/v1/chat/completions` |
| `nvidia` |  | freeTier | `https://integrate.api.nvidia.com/v1/chat/completions` |
| `ollama` | ollama | freeTier | `https://ollama.com/api/chat` |
| `ollama-local` | ollama | apikey | `http://localhost:11434/api/chat` |
| `openai` |  | apikey | `https://api.openai.com/v1/chat/completions` |
| `opencode` |  | free | `https://opencode.ai` |
| `opencode-go` |  | apikey | `https://opencode.ai/zen/go/v1/chat/completions` |
| `openrouter` |  | freeTier | `https://openrouter.ai/api/v1/chat/completions` |
| `perplexity` |  | apikey | `https://api.perplexity.ai/chat/completions` |
| `perplexity-web` | perplexity-web | webCookie | `https://www.perplexity.ai/rest/sse/perplexity_ask` |
| `playht` |  | apikey | `` |
| `qoder` |  | free | `https://api3.qoder.sh/algo/api/v2/service/pro/sse/agent_chat_generation` |
| `qwen` |  | oauth | `https://portal.qwen.ai/v1/chat/completions` |
| `recraft` |  | apikey | `` |
| `runwayml` |  | apikey | `` |
| `sdwebui` |  | apikey | `` |
| `searchapi` |  | apikey | `` |
| `searxng` |  | freeTier | `` |
| `serper` |  | apikey | `` |
| `siliconflow` |  | apikey | `https://api.siliconflow.com/v1/chat/completions` |
| `stability-ai` |  | apikey | `` |
| `tavily` |  | apikey | `` |
| `together` |  | apikey | `https://api.together.xyz/v1/chat/completions` |
| `topaz` |  | apikey | `` |
| `tortoise` |  | freeTier | `` |
| `venice` |  | apikey | `https://api.venice.ai/api/v1/chat/completions` |
| `vercel-ai-gateway` |  | apikey | `https://ai-gateway.vercel.sh/v1/chat/completions` |
| `vertex` | vertex | freeTier | `https://aiplatform.googleapis.com` |
| `vertex-partner` |  | apikey | `https://aiplatform.googleapis.com` |
| `volcengine-ark` |  | apikey | `https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions` |
| `voyage-ai` |  | apikey | `` |
| `xai` |  | oauth | `https://api.x.ai/v1/chat/completions` |
| `xiaomi-mimo` |  | apikey | `https://api.xiaomimimo.com/v1/chat/completions` |
| `xiaomi-tokenplan` |  | apikey | `https://token-plan-sgp.xiaomimimo.com/v1/chat/completions` |
| `youcom` |  | apikey | `` |
