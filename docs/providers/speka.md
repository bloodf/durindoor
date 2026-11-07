# Speka AI

Create an API key in the Speka dashboard, select **Speka AI** in DurinDoor's provider settings, and save the key. Discover models from the connection's model list, then use `speka/<model-id>` with the complete publisher/model identifier returned by Speka.

This integration uses Bearer authentication, OpenAI Chat Completions at `https://speka.me/v1/chat/completions`, and model discovery at `https://speka.me/v1/models`. No models or prices are seeded. Only chat is enabled; embeddings and image generation are outside this integration.

[Speka's API reference](https://speka.me/docs) documents chat, streaming, tools, and OpenAI error envelopes. These are provider claims, not account-backed verification by DurinDoor. Actual model availability, upstream provenance, quotas, billing, and reliability remain unverified. Review current provider pricing and terms before use. A model catalog or HTTP 401 does not prove inference works.

Discovery errors are surfaced instead of replaced with a fabricated catalog. For 401, check the saved key; for 429, follow the provider's retry guidance. No credentials or live inference were used to validate this port.
