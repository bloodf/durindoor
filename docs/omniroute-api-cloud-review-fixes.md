# OmniRoute API-key cloud review fixes

Batch 5 review follow-ups keep legacy Azure semantics intact while preserving the new Azure OpenAI provider as `azure-openai/*`.

- `azure/*` continues to resolve to the existing `azure` executor and its `providerSpecificData.azureEndpoint` fields.
- `azure-openai/*` collects an endpoint, deployment, and API version in the dashboard and stores them as `providerSpecificData.baseUrl`, `deployment`, and `apiVersion`.
- Azure OpenAI bulk-added dashboard keys reuse the shared endpoint, deployment, and API version fields instead of falling back to the placeholder endpoint.
- Azure AI Foundry and OCI connections that opt into `providerSpecificData.apiType = "responses"` now use the OpenAI Responses request body format as well as the `/responses` URL.
- GitHub Models and Nomic embedding models are not advertised until matching embedding adapters exist.
- Nube and Kenari remain exported from the registry array.
- Kimi Coding fallback probes now append `transport.urlSuffix` (`?beta=true`) to the chat endpoint, matching the real executor path.
- The per-connection test (`testApiKeyConnection`) can POST a real configured
  model to `cfg.baseUrl` when `probeUsesBaseUrl` is set. Gitlawb GMI keeps the
  source `/v1/gmi-cloud` prefix for both `/chat/completions` validation/runtime
  traffic and `/models` discovery; 400/422/429 prove that auth reached the chat
  API, 401/403 identify rejected credentials, 404 identifies a wrong endpoint,
  and 5xx/network errors report provider unavailability without leaking keys.
- OmniRoute later made Gitlawb API keys optional in PR #2476. DurinDoor still
  requires a key through its API-key connection UI and validation route; this
  focused probe correction intentionally defers optional-key parity until the
  UI, API, no-auth runtime path, and migration/import behavior can be covered
  together end to end.
