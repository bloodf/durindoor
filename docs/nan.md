# NaN

Create an inference API key under **API Keys** in NaN user settings and add it to the NaN provider connection. A platform token (`nan_pat_...`) is a different credential and cannot authenticate inference. See the [NaN API reference](https://nan.builders/docs/api).

Select `nan/<model-id>` for chat. The connection's model discovery uses that connection's inference key; available models depend on the account. The built-in catalog is a starting point, not an access guarantee. NaN also provides embedding, audio, image and rerank models; use their respective endpoints and model IDs. Existing quota probes remain separate from model discovery.

Chat uses OpenAI-compatible JSON and SSE. NaN can report token usage in JSON and, when requested, in a streaming usage chunk. DurinDoor requests streaming usage by default while respecting an explicit client choice. Usage is reported when supplied by the provider; it can otherwise be estimated.

Verification for [#2034](https://github.com/bloodf/durindoor/issues/2034): the shipped identity came from [#2067](https://github.com/bloodf/durindoor/pull/2067). The repository's pinned [OmniRoute snapshot](https://github.com/diegosouzapw/OmniRoute/tree/77bca6f878180006f3a679b53400d55a344fcd83) does not contain a NaN registry entry at `open-sse/config/providers/registry/nan/index.ts`. The first-party API reference is the source for the inference contract. Closed fixtures cover key validation, per-account discovery, chat JSON/SSE and usage, errors, and translation; they make no provider calls.
