# Other OpenAI-Compatible Tools

Any client that supports a custom OpenAI-compatible base URL can usually use DurinDoor. The client must send requests to DurinDoor, use a DurinDoor API key, and choose a model ID, alias, or combo from the dashboard.

## Generic Settings

```text
Base URL: http://localhost:20128/v1
API key:  YOUR_DURINDOOR_API_KEY
Model:    MODEL_ID_OR_COMBO
```

Use HTTPS and a reachable host for remote deployments.

Dashboard setup for GitHub Copilot writes VS Code's
`chatLanguageModels.json`. DurinDoor creates an absent file, but refuses to
overwrite an existing file that is unreadable, malformed JSON, or not a
provider array. Fix or restore the named file and retry; other providers remain
untouched.

## Python OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    api_key="YOUR_DURINDOOR_API_KEY",
    base_url="http://localhost:20128/v1",
)

response = client.chat.completions.create(
    model="coding-default",
    messages=[{"role": "user", "content": "Say hello."}],
)

print(response.choices[0].message.content)
```

## Node.js OpenAI SDK

```javascript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "YOUR_DURINDOOR_API_KEY",
  baseURL: "http://localhost:20128/v1",
});

const response = await client.chat.completions.create({
  model: "coding-default",
  messages: [{ role: "user", content: "Say hello." }],
});

console.log(response.choices[0].message.content);
```

## cURL

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Authorization: Bearer YOUR_DURINDOOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "coding-default",
    "messages": [{"role": "user", "content": "Say hello."}]
  }'
```

## Supported Endpoint Families

DurinDoor includes compatibility routes for:

- `/v1/chat/completions`
- `/v1/responses`
- `/v1/messages`
- `/v1/models`
- `/v1/embeddings`
- `/v1/images/generations`
- `/v1/images/edits`
- `/v1/audio/speech`
- `/v1/audio/transcriptions`
- `/v1/audio/translations`
- `/v1/moderations`
- `/v1/rerank`
- `/v1/search`
- `/v1/web/fetch`
- `/v1/messages/count_tokens`

The endpoint can exist even when the selected provider does not support that modality. Choose a provider that supports the request type.

## Client Integration Checklist

1. Confirm the client supports a custom base URL.
2. Include `/v1` in the base URL unless the client adds it automatically.
3. Use a DurinDoor API key.
4. Use a model visible in `/v1/models` or a combo name.
5. Send a small test request.
6. Check usage logs to confirm traffic reached DurinDoor.
7. Test streaming, tool calls, images, or audio if your workflow needs them.
