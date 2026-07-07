# OmniRoute API-key cloud review fixes

Batch 5 review follow-ups keep legacy Azure semantics intact while preserving the new Azure OpenAI provider as `azure-openai/*`.

- `azure/*` continues to resolve to the existing `azure` executor and its `providerSpecificData.azureEndpoint` fields.
- `azure-openai/*` collects an endpoint, deployment, and API version in the dashboard and stores them as `providerSpecificData.baseUrl`, `deployment`, and `apiVersion`.
- Azure OpenAI bulk-added dashboard keys reuse the shared endpoint, deployment, and API version fields instead of falling back to the placeholder endpoint.
- Azure AI Foundry and OCI connections that opt into `providerSpecificData.apiType = "responses"` now use the OpenAI Responses request body format as well as the `/responses` URL.
- GitHub Models and Nomic embedding models are not advertised until matching embedding adapters exist.
- Nube and Kenari remain exported from the registry array.
- Kimi Coding fallback probes now append `transport.urlSuffix` (`?beta=true`) to the chat endpoint, matching the real executor path.
- The per-connection test (`testApiKeyConnection`) falls back to `cfg.baseUrl` when `cfg.validateUrl` is absent, so baseUrl-only API-key providers such as `gitlawb-gmi` can be tested.
