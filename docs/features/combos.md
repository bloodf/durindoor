# Combos and Fallback

A combo is an ordered list of models exposed as one model name. Clients send the combo name in the `model` field, and DurinDoor tries each configured member until one returns a usable response or the combo is exhausted.

## When to Use a Combo

Use a combo when you want:

- One stable model name for multiple tools.
- Automatic fallback from a preferred provider to a backup provider.
- Account and provider resilience without changing client settings.
- A different chain for coding, writing, search, low-cost work, or experiments.

## Basic Shape

```text
Combo name: coding-default
Models:
  1. primary coding model
  2. backup coding model
  3. local or low-cost fallback model
```

Client request:

```json
{
  "model": "coding-default",
  "messages": [
    {"role": "user", "content": "Review this function."}
  ]
}
```

## Fallback Order

DurinDoor respects the order you configure. Put the most desirable model first and the broadest fallback last.

Common strategies:

| Strategy | Order |
| --- | --- |
| Reliability first | Most reliable paid provider, then secondary provider, then local fallback. |
| Cost control | Included subscription or local model, then low-cost API, then premium model. |
| Latency first | Fast local or small model, then balanced model, then larger model. |
| Capability first | Strongest model, then compatible backup, then simpler fallback. |

## What Triggers Fallback

Fallback can occur when a model attempt fails because of provider errors, account cooldowns, rate limits, quota exhaustion, missing active credentials, selected upstream failures, or configured model locks.

Fallback should not hide invalid client requests. If the request body is malformed or incompatible with the endpoint itself, fixing the request is better than trying unrelated providers.

## Attachment Capability Routing

With capability-aware routing enabled, DurinDoor chooses a compatible combo member from media on the current user turn. Hermes/Ollama `messages[].images`, Vercel AI SDK `messages[].experimental_attachments` (or `attachments`), direct message image fields, and `data:` image, audio, or PDF URLs are recognized. Attachment MIME comes from `contentType`, `mediaType`, or the data URL.

If the selected model has no vision support, DurinDoor removes image fields and image attachments before translation. Audio, PDF, and non-image attachments remain when their corresponding capabilities are supported.

## Account Fallback Inside a Combo

A combo member can still use multiple accounts for the same provider.

```text
Combo member 1: openai/gpt-4.1
  -> OpenAI Account A fails with rate limit
  -> OpenAI Account B succeeds
  -> Combo does not move to member 2
```

Only when the provider/model attempt cannot succeed does DurinDoor move to the next combo member.

## Designing Good Combos

A good combo uses models that can satisfy the same client task. Avoid mixing incompatible capabilities unless the last model is only an emergency fallback.

Checklist:

1. All models support the endpoint the client will call.
2. All models can handle required tool calls or multimodal content.
3. The fallback model has enough context window for typical requests.
4. Costs and quotas match the expected traffic pattern.
5. The combo name is stable and human-readable.
6. Usage logs identify which model actually served each request.

## Examples

### General Coding

```text
Name: coding-default
1. preferred coding model
2. lower-cost coding model
3. local coding model
```

### Low-Cost Background Work

```text
Name: batch-low-cost
1. local model
2. low-cost API model
3. standard API model
```

### High-Reliability Interactive Work

```text
Name: interactive-safe
1. primary subscription model
2. second account on a different provider
3. paid API model with stable uptime
```

## Testing a Combo

1. Create the combo.
2. Send a small request through `/v1/chat/completions`.
3. Temporarily disable the first member or use a model known to fail.
4. Confirm the next member is used.
5. Check usage logs for selected provider, model, latency, and errors.

## Operating Notes

- Keep combo names stable because users copy them into external tools.
- Prefer editing combo membership over changing every client configuration.
- Do not rely on free or cookie-backed providers as the only fallback for critical workflows.
- Review logs after provider incidents; repeated fallback can hide cost or quality changes.
