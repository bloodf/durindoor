# Runcrate

Create an API key in the [Runcrate dashboard](https://www.runcrate.ai/dashboard/api-keys), select **Runcrate** in DurinDoor's provider settings, and save the key. Requests use the model ID exactly as Runcrate publishes it, including the publisher prefix: `runcrate/deepseek-ai/DeepSeek-V4.1-Flash` or `runcrate/Qwen/Qwen3.8-Flash`.

This integration covers only the documented model inference API. It uses Bearer authentication, OpenAI Chat Completions at `https://api.runcrate.ai/v1/chat/completions`, and reads the live catalog from `https://api.runcrate.ai/v1/models`. The seeded catalog mirrors the upstream provider catalog; discovery refreshes it from the live endpoint, and a model ID that is not in the seeded list is still accepted and forwarded unchanged.

Runcrate also sells GPU instances, storage, and reserved clusters. Those are separate products and are outside this integration: DurinDoor never creates instances, never provisions GPUs, and never runs shell commands on a Runcrate host.

Streaming, function calling, and JSON mode are provider claims from [Runcrate's chat API page](https://www.runcrate.ai/chat-api). Actual model availability, pricing, quotas, billing, and reliability remain unverified by DurinDoor, and a model list or HTTP 200 does not prove that a saved key can perform inference. Review current Runcrate pricing and terms before use.

If discovery fails, the error is surfaced instead of an empty catalog. For HTTP 401, check the saved key; for HTTP 429, follow Runcrate's retry guidance. The unit fixtures mock every response and prove local wiring only; no Runcrate account, key, instance, or billed request was used to validate this integration.
