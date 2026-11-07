# Gemini and xAI quota usage

Gemini API-key usage returns unknown with no snapshot rows. An inference key
has no documented account balance API. Project limits are visible in
[AI Studio](https://ai.google.dev/gemini-api/docs/rate-limits).

The xAI usage caller accepts separate top-level `managementApiKey` and
`providerSpecificData.teamId` fields. The management key uses the existing encrypted connection-column mechanism
and is omitted from provider list, detail, mutation, client and default export
responses. Nested metadata keys are not accepted or promoted. It never falls
back to the inference key. The fixed GET
endpoint is `/v1/billing/teams/{team_id}/prepaid/balance` on management-api.x.ai.
[The billing reference](https://docs.x.ai/developers/rest-api-reference/management/billing)
describes `total.val` in USD cents and shows purchases as negative ledger amounts.
The adapter converts the credit side to USD, rejects unsafe integers and
undocumented shapes, and shows prepaid credit separately from local usage.
This balance does not establish postpaid allowance or inference readiness.
OAuth xAI keeps its existing SuperGrok usage path.

Custom `quotaEndpoint` URLs are unsupported by these adapters. They cause no
credential transport. Supporting them later requires the existing SSRF and
privacy controls before transport, plus a documented payload contract.
No management or provider requests were made during implementation. Tests use
mock responses. These dashboard adapters do not alter admission snapshot policy.

Both providers are included in the API-key usage inventory through registry
usage flags. Successful prepaid credit renders alongside its disclaimer,
including zero credit, without a fabricated percentage window.
