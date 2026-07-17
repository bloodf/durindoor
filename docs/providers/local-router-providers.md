# Local, Self-Hosted, and Router Providers

DurinDoor includes dedicated registry entries for the OmniRoute local-provider parity batch:
`9router`, `lm-studio`, `vllm`, `lemonade`, `llamafile`, `llama-cpp`, `triton`,
`docker-model-runner`, `xinference`, `oobabooga`, and `opencode-zen`.

The self-hosted providers use the default OpenAI-compatible executor. Their API key is optional
when the upstream service does not enforce one; DurinDoor omits the `Authorization` header when
no API key or access token is saved. Saving a connection with a placeholder key keeps them
configurable in the normal provider-connection flow. If a connection does not set
`providerSpecificData.baseUrl`, DurinDoor uses the provider's local default:

| Provider | Default base URL |
| --- | --- |
| `9router` | `http://127.0.0.1:20130/v1` |
| `lm-studio` | `http://localhost:1234/v1` |
| `vllm` | `http://localhost:8000/v1` |
| `lemonade` | `http://localhost:13305/api/v1` |
| `llamafile` | `http://127.0.0.1:8080/v1` |
| `llama-cpp` | `http://127.0.0.1:8080/v1` |
| `triton` | `http://localhost:8000/v1` |
| `docker-model-runner` | `http://localhost:12434/v1` |
| `xinference` | `http://localhost:9997/v1` |
| `oobabooga` | `http://localhost:5000/v1` |

`auto`, `codex-cloud`, and `zed` are registered as metadata-only entries. They preserve OmniRoute
provider IDs and display metadata, but they do not add a fake chat transport: auto-routing still
uses DurinDoor combos, Codex Cloud task execution belongs to the cloud-agent subsystem, and Zed
credentials are imported into their real upstream providers.

OpenCode Zen uses a provider-specific executor because its catalog spans multiple API families:
GPT-5 models use `/v1/responses`, Claude and Qwen Claude-format models use Anthropic-compatible
`/v1/messages`, and other OpenAI-compatible models use `/v1/chat/completions`. Gemini-family Zen
models are intentionally omitted from the static catalog until DurinDoor has a tested
Google-compatible Zen executor path. Passthrough Zen model IDs with `claude-`, `gpt-5`, or
`gemini-` prefixes are still classified by API family so they do not fall back to the default
Chat Completions translator.
