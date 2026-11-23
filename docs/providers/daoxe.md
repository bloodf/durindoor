# DaoXE

Create a DaoXE API key for the appropriate group, add it under **DaoXE** in the provider dashboard, and discover models for that connection. Use `daoxe/<model-id>` with the exact ID returned by discovery. The small built-in list is a starting point, not a guarantee that a model is available to your key.

This integration uses Bearer authentication and the OpenAI-compatible Chat Completions endpoint at `https://api.daoxe.com/v1/chat/completions`. Discovery uses the key-gated `https://api.daoxe.com/v1/models` endpoint. A model outside the key's permissions can return 403; a group without an available channel can return 503. Check the key's model permissions and group with DaoXE. See the [quick start](https://daoxe.com/docs/en/start/quickstart) and [protocol checklist](https://daoxe.com/docs/en/guide/multi-protocol). Native Messages, Responses and media endpoints are not part of this provider integration. Local tests use synthetic keys and mocked responses; they do not verify a live account.

The seed IDs provide a fallback catalog. Its shared builder selects the default OpenAI executor and Bearer API-key authentication. The list may change independently of the account-scoped catalog.
