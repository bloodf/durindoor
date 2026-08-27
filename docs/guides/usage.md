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
| Timeline | Live tail and hop/SSE history for proxy calls. |
| Quota | View provider limits, cooldowns, and reset hints. |
| CLI Tools | Copy integration settings for supported coding tools. |
| Media Providers | Configure embeddings, image, TTS, STT, search, and fetch providers. |
| MCP Gateway | Register MCP servers and manage gateway keys. |
| Proxy Pools | Configure outbound proxy routing and relay workers. |
| Token Saver | Configure request compression helpers such as Headroom. |
| MITM | Configure optional IDE traffic interception. |

## Ponytail Local Commands

Ponytail provides local commands that supported chat clients can send as an
exact text-only final user turn:

- `/ponytail-help` or `/ponytail help` returns the Ponytail levels and ladder.
- `/ponytail-gain` or `/ponytail gain` returns lifetime totals for the
  authenticated DurinDoor API key.

Commands work with Chat Completions, Responses, Claude, and Gemini request
shapes. DurinDoor replies in that client's native JSON or streaming protocol
without selecting a provider account. A command mixed with an image, tool
result, or other non-text block is treated as an ordinary model request. When
no stored API-key identity is available, `gain` points to the dashboard instead
of exposing installation-wide usage.

## Token Saver prompt injection

When Caveman or Ponytail is enabled, DurinDoor injects its instruction into the
translated provider request using the actual wire shape. Repeated passes keep
each complete instruction block once, including distinct instructions with a
shared prefix. Responses function calls, reasoning, and tool outputs retain
their original order. Kiro receives the instruction in
`conversationState.currentMessage.userInputMessage.content`; DurinDoor does not
add a `systemPrompt` field that Kiro's wire schema does not provide.

## Create an API Key

Use the dashboard to create a DurinDoor API key. Save the key immediately and use it in client tools. The creation confirmation is the only response that shows the complete secret; later lists, details, the dashboard, and the CLI show a masked identifier only.

```text
Dashboard -> Endpoint or Settings -> API Keys -> Create Key
```

Use one key per tool or user so keys can be revoked independently.

Each key can use one of these expiry choices:

- Never expires
- 1, 7, 30, or 90 days from creation
- A custom local date and time

The dashboard and CLI convert custom local input to an absolute UTC timestamp before storage. They display the date in the operator's local timezone. Edit a key and choose **Never expires** to clear an existing expiry. An expiry is enforced using server time; the key is expired as soon as server time equals the stored timestamp.

Expired keys remain visible for management and backup, but cannot authenticate. Clients receive the same generic invalid-key response used for other invalid credentials. Paste the secret you saved at creation into integration and media-test forms; management APIs cannot retrieve it later.

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

## Choose OAuth routing

When connecting an OAuth provider, DurinDoor loads the available proxy pools
before starting the login. The default is **Direct Connection**, which also
suppresses proxy environment variables for that connection.

Choose an active pool in **Routing Proxy Pool** when the provider's authorize,
token, profile, and refresh traffic must use that egress. Pool-backed OAuth is
strict: if the pool is removed, disabled, or cannot connect, authentication and
later refreshes fail with a routing error instead of silently using another
path.

Changing the selection restarts the login and invalidates the previous callback.
If a browser tab from an earlier attempt completes afterward, its state is
rejected. Re-open the provider login after editing or replacing a pool.

Reassigning an existing OAuth connection from its provider detail page updates
the same durable policy. Selecting a pool makes routing strict to that pool;
clearing the selection explicitly switches the connection to direct routing.
Other provider edits that omit the proxy selection leave the routing policy
unchanged.
