# Usage Guide

This guide shows how to use DurinDoor after it is installed and running.

## Basic Workflow

1. Start DurinDoor.
2. Open the dashboard.
3. Add provider connections.
4. Create a DurinDoor API key.
5. Pick a model or create a combo.
6. Configure your tool with the DurinDoor base URL and API key.
7. Monitor usage and fallback behavior in the dashboard.

## Dashboard Areas

| Area | Purpose |
| --- | --- |
| Endpoint | Shows local, tunnel, and API-key setup information. |
| Providers | Add OAuth, API key, cookie, and provider-node credentials. |
| Combos | Create fallback chains exposed as one model name. |
| Usage | Inspect tokens, costs, request history, and provider topology. |
| Quota | View provider limits, cooldowns, and reset hints. |
| CLI Tools | Copy integration settings for supported coding tools. |
| Media Providers | Configure embeddings, image, TTS, STT, search, and fetch providers. |
| MCP Gateway | Register MCP servers and manage gateway keys. |
| Proxy Pools | Configure outbound proxy routing and relay workers. |
| Token Saver | Configure request compression helpers such as Headroom. |
| MITM | Configure optional IDE traffic interception. |

## Create an API Key

Use the dashboard to create a DurinDoor API key. Save the key immediately and use it in client tools.

```text
Dashboard -> Endpoint or Settings -> API Keys -> Create Key
```

Use one key per tool or user so keys can be revoked independently.

## Choose a Model

Use the model selector or `/v1/models`:

```bash
curl http://localhost:20128/v1/models \
  -H "Authorization: Bearer YOUR_DURINDOOR_API_KEY"
```

Model strings can be:

- provider model IDs
- provider aliases
- compatible node models
- custom aliases
- combo names

## Create a Combo

Create a combo when you want a stable model name with automatic fallback.

Example:

```text
Name: coding-default
Models:
  1. primary coding model
  2. lower-cost coding model
  3. local fallback model
```

Then configure clients with:

```text
Model: coding-default
```

## Use with OpenAI SDKs

Python:

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

Node.js:

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

## Monitor Requests

After sending traffic, open:

```text
Dashboard -> Usage
```

Check:

- resolved provider
- resolved model
- connection/account used
- token usage
- latency
- error text
- fallback behavior

## Operational Tips

- Use combos for user-facing model names.
- Keep raw provider model IDs for debugging.
- Use dedicated API keys per tool.
- Test tool calls before using a model in coding-agent workflows.
- Keep detailed request logging disabled unless debugging.
- Back up `DATA_DIR` before major upgrades.
