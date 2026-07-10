# Smart Routing

Smart routing is the path from a client model string to a real upstream request. DurinDoor resolves the requested model, selects credentials, translates the request when formats differ, streams the upstream response back to the client, and records usage.

## Routing Pipeline

```text
Client request
  -> API route under /v1
  -> model or combo resolution
  -> provider and credential selection
  -> request normalization
  -> format translation
  -> upstream provider call
  -> stream translation
  -> usage extraction and logging
```

The chat pipeline is implemented across `src/sse` and `open-sse`. Other API families use the same provider and credential concepts but have endpoint-specific handlers.

## Model Resolution

DurinDoor accepts several model string types:

| Model string type | Example | Resolution |
| --- | --- | --- |
| Provider model | `openai/gpt-4.1` | Provider ID plus upstream model. |
| Provider alias model | `cc/claude-sonnet` | Alias resolved through the provider registry. |
| Compatible node model | `openai-compatible-lab/model-name` | Custom provider node plus upstream model. |
| Model alias | `daily-coder` | User-defined alias mapped to another model. |
| Combo name | `coding-default` | Ordered fallback chain. |

Use `/v1/models` or the dashboard model selector to confirm the exact values available in a running instance.

## Provider Selection

After resolving the model, DurinDoor identifies the target provider and service kind. The service kind matters because not every provider supports every endpoint.

Common service kinds:

- `llm` for chat, messages, and responses.
- `embedding` for `/v1/embeddings`.
- `image` for image generation or editing.
- `tts` for speech generation.
- `stt` for transcription and translation.
- `webSearch` for `/v1/search`.
- `webFetch` for `/v1/web/fetch`.

## Credential Selection

If a provider has multiple connections, DurinDoor selects an available connection and avoids accounts that are temporarily locked, expired, or excluded by the current fallback attempt. Provider-specific code can refresh credentials when the upstream supports refresh.

## Request Translation

Client tools do not all speak the same format. DurinDoor translates between OpenAI, Anthropic Claude, Gemini, OpenAI Responses, Kiro, Cursor, CommandCode, Ollama, Vertex, and other supported shapes.

Important rules:

- OpenAI-compatible requests are the common entry point for most tools.
- Some direct translator routes preserve provider-specific fields better than a generic bridge.
- Gemini and Gemini CLI `functionResponse` history reaches the format translator before generic orphan-result cleanup, including responses co-located with another part.
- Optional PXPIPE compression is fail-open: an unsupported-model or disabled no-op retains the translated request body and continues dispatch.
- Tool calls, image blocks, reasoning fields, and audio content are the highest-risk fields during translation.
- Provider-specific unsupported parameters may be stripped or normalized before the upstream call.

## Response Translation

For streaming requests, DurinDoor reads provider chunks and emits client-compatible chunks. For non-streaming requests, it normalizes the final JSON response. Client streaming intent is tracked separately from upstream streaming capability: if a provider must be called without streaming, DurinDoor can still return client-facing SSE by converting the provider's final JSON response into chat completion chunks.

The response layer is responsible for:

- Preserving stream order.
- Mapping finish reasons.
- Normalizing usage data when available.
- Handling provider-specific stream formats.
- Returning errors in a client-compatible shape.

Terminal framing follows the client's protocol rather than the upstream transport:

- OpenAI passthrough forwards or creates exactly one `[DONE]` sentinel; Gemini-family streams do not receive that OpenAI marker.
- OpenAI `include_usage` streams remain open through the trailing usage-only chunk before request usage is finalized.
- A non-streaming upstream response synthesized for a Claude streaming client preserves native `tool_use` stop reasons and `input_tokens`/`output_tokens` usage keys.

## Failure Handling

DurinDoor distinguishes between transient and terminal failures where possible.

| Failure class | Typical response |
| --- | --- |
| Missing credentials | Return an authentication or configuration error. |
| Expired OAuth token | Attempt refresh, then retry if refresh succeeds. |
| Account quota or rate limit | Lock the connection or model temporarily and try another connection or combo member. |
| Provider outage | Try fallback when configured. |
| Unsupported parameter | Normalize or return a clear provider error. |
| Client request error | Return the error without retrying unrelated providers. |

## Smart Routing vs Combos

Smart routing applies to every request. Combos are a user-defined fallback feature inside smart routing.

```text
Smart routing: model string -> provider -> credentials -> translation -> upstream
Combo routing: combo name -> model 1 -> model 2 -> model 3
```

Use a direct provider model when you want explicit control. Use a combo when client tools should keep one stable model name while DurinDoor handles fallback.
