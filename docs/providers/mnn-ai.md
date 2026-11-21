---
title: MNN AI
description: Connect an MNN AI API key and discover models for chat completions.
---

Production registration is pending a separate provider batch. The setup below applies once that batch is shipped.

Create an API key in the [MNN AI dashboard](https://mnnai.ru/dashboard), select **MNN AI** in DurinDoor's provider settings, and save the key. The model list is read from MNN AI for that key, so the models you see are the ones your plan can reach. Use `mnn-ai/<model-id>` with the model id exactly as MNN AI publishes it, for example `mnn-ai/gpt-5.4`.

This integration covers the documented chat API only. It uses Bearer authentication, OpenAI Chat Completions at `https://api.mnnai.ru/v1/chat/completions`, and reads the model list from `https://api.mnnai.ru/v1/models`. No models are seeded. The Anthropic-compatible `/v1/messages` route, the Responses API, and the image, video, audio, speech, transcription, embedding, moderation and web-search surfaces that MNN AI also documents are outside this integration: DurinDoor does not route them.

[MNN AI's documentation](https://mnnai.ru/docs) is the source for the endpoints, the bearer scheme, streaming, function calling and the model-list call. [The terms of service](https://mnnai.ru/terms-of-service) and [the privacy policy](https://mnnai.ru/privacy) are published by the operator and apply to your use of the service; review them before connecting a key. MNN AI states that it is an aggregator: prompts and files sent through the API are passed on to third-party model providers, which may be outside the operator's own jurisdiction. Do not send confidential data in a prompt.

Streaming, function calling, and JSON mode are provider claims from that documentation. Actual model availability, plan limits, pricing, quotas, billing, and reliability remain unverified by DurinDoor, and a model list or HTTP 200 does not prove that a saved key can perform inference. Review current MNN AI pricing and terms before use.

If discovery fails, the error is surfaced instead of an empty catalog. For HTTP 401, check the saved key; for HTTP 429, follow MNN AI's retry guidance. The unit fixtures mock every response and prove local wiring only; no MNN AI account, key, or billed request was used to validate this integration.
