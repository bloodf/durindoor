# Speka AI

Create an API key in the Speka dashboard, select **Speka AI** in DurinDoor's provider settings, and save the key. Use `speka/<model-id>` with a complete publisher/model identifier from Speka's public chat catalog. The connection's model list attempts discovery; if discovery is unavailable, enter the model ID manually.

This integration uses Bearer authentication, OpenAI Chat Completions at `https://speka.me/v1/chat/completions`, and attempts model discovery at `https://speka.me/v1/models`. No models or prices are seeded. Only chat is enabled; embeddings and image generation are outside this integration.

[Speka's API reference](https://speka.me/docs) documents chat, streaming, tools, and OpenAI error envelopes. These are provider claims, not account-backed verification by DurinDoor. Actual model availability, upstream provenance, quotas, billing, and reliability remain unverified. Review current provider pricing and terms before use. A model catalog or HTTP 401 does not prove inference works.

Discovery errors are surfaced instead of replaced with a fabricated catalog. For 401, check the saved key; for 429, follow the provider's retry guidance. No credentials or live inference were used to validate this port.

[Speka’s public status page](https://speka.me/status) names `GET /v1/models` as machine-readable status. Neither that page nor the API reference specifies its response envelope or guarantees that it rejects invalid API keys. Discovery parsing and key-validation semantics remain **NOT VERIFIED**. A successful model-list probe must not be treated as proof that the saved key can perform inference. The existing connection probe is retained; no authentication requirement is relaxed. The unit fixtures mock responses to check local wiring only and do not establish the live provider contract.
