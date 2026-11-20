# EmpirioLabs AI

Create an API key in the EmpirioLabs dashboard and add it as an EmpirioLabs AI connection. The connection test uses `GET /v1/account/usage?limit=1`, so the key needs the **account** scope; an inference-only key cannot pass this check. The public model catalog cannot validate a key. Discovery lists available models that support Chat Completions; other catalog modalities are excluded. Model IDs can also be supplied directly as `empiriolabs/<model-id>`.

Chat requests use the OpenAI-compatible API. Streaming requests ask for a usage trailer so reported token usage can be accounted for. See the [EmpirioLabs integration guide](https://docs.empiriolabs.ai/integrations) and [account usage documentation](https://docs.empiriolabs.ai/account-usage-api).
