# Liquid native System One

A Liquid AI connection supports native decisions through `POST /v1/systemone`.
Use `liquid/d1`, `liquid/d1.2`, or `liquid/d1.2-ultra` with a Liquid key eligible
for the decisions API. These models appear as `systemone`, alongside the existing
Liquid chat catalog.

```json
{
  "model": "liquid/d1.2",
  "state": "The customer says their payment failed three days ago.",
  "questions": {
    "urgent": { "type": "noul", "instructions": "Does this convey urgency?" }
  }
}
```

DurinDoor sends the native payload with wire model `d1.2` and the selected Liquid
connection's bearer key to `https://api.liquid.ai/decisions/v1/systemone`.
Answers and usage pass through the usual System One handling. Additional model
IDs may be submitted: 1–100 ASCII letters, digits, dots, underscores, colons, or
hyphens, beginning with a letter or digit and containing no consecutive dots.
Slashes, whitespace, URL escapes, queries, and fragments are rejected.

Request fields and connection base URL metadata cannot change this endpoint.
Native Liquid decisions refuse redirects and retain the existing proxy transport.
`openrouter/liquid/d1.2` remains a separate OpenRouter route using an OpenRouter
connection and endpoint. Custom System One and Laya URL guards remain in effect.

Connection validation still uses Liquid's existing chat-model listing endpoint;
a decisions-only key may fail that check. This port adds no decision probes and
makes no paid or live validation calls. Verify decisions access with Liquid when
provisioning a key; a successful model-list check does not prove decisions access.
