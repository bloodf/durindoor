# Vertex AI service-account and ADC compatibility (#2034)

Vertex AI (`vertex`, alias `vx`) and Vertex Partner (`vertex-partner`, alias `vxp`) are
separate registry identities that share one executor. A connection on either identity
carries exactly one of three Google credential shapes:

| Credential | Stored as | How it is used | Request route |
| --- | --- | --- | --- |
| Service Account JSON key | connection API key | RS256 JWT assertion exchanged at `https://oauth2.googleapis.com/token` for a bearer token, cached per `client_email` | project-scoped `…/v1/projects/{project}/locations/{location}/publishers/google/models/{model}` |
| ADC `authorized_user` file | connection API key | OAuth2 refresh-token grant at the same Google token endpoint | project-scoped, project taken from `quota_project_id` or `providerSpecificData.projectId` |
| Express-mode API key | connection API key | sent as-is | project-less `…/v1/publishers/google/models/{model}` with `?key=` |

The operator's project and location stay aligned with the account: a Service Account
JSON supplies its own `project_id`, an ADC file supplies `quota_project_id`, and a
`providerSpecificData.location` only chooses the Vertex location within that project.
Model aliases, the EU/US representative hosts, the `locations/global` partner route and
the existing bearer/query-key auth modes are unchanged by this work.

## Pinned upstream contracts

- CLIProxyAPI [`internal/cmd/vertex_import.go`](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/internal/cmd/vertex_import.go)
  L23–L115 imports a Service Account JSON through `--vertex-import`: it normalizes the
  private key with [`internal/auth/vertex/keyutil.go`](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/internal/auth/vertex/keyutil.go)
  L38–L56, requires `project_id`, defaults the location, and may namespace models with a
  single-segment prefix. The management route
  [`internal/api/handlers/management/vertex_import.go`](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/internal/api/handlers/management/vertex_import.go)
  L18–L118 applies the same normalization and rejects a credential without `project_id`.
  Its executor reads the project and location back from the stored metadata
  ([`gemini_vertex_executor.go`](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/internal/runtime/executor/gemini_vertex_executor.go)
  L1732–L1767), mints the access token with the `cloud-platform` scope (L1846–L1867), and
  keeps the API-key path on a project-less URL (L613–L672). The service-account and
  API-key groups stay separate there.
- EasyCLIProxyAPI
  [`src/pages/EasyModePage.tsx`](https://github.com/router-for-me/EasyCLIProxyAPI/blob/e4223d5eefa22a3301ca7e2a28d05897432b07f9/src/pages/EasyModePage.tsx)
  offers Vertex as one guided API-key connection and delegates runtime to the embedded
  CLIProxyAPI core; the desktop source does not define service-account or cloud OAuth
  semantics, so it does not establish a separate credential contract.
- OmniRoute [`open-sse/executors/vertex.ts`](https://github.com/cheaper-inference/OmniRoute/blob/ab180e32fcdf1f78c96f98a617e17c86e34bf5aa/open-sse/executors/vertex.ts)
  separates the shapes explicitly: `parseSAFromApiKey` (L33–L46) rejects an OAuth client
  JSON, `looksLikeServiceAccountJson`/`isExpressApiKey` (L55–L70) distinguish a
  Service Account JSON from an opaque Express key, `getAccessToken` (L72–L130) mints the
  bearer with the `cloud-platform` and `generative-language.retriever` scopes, and
  `buildUrl` (L512–L531) keeps the project-less publisher route for an Express key.
  Its registry entries are [`registry/vertex`](https://github.com/cheaper-inference/OmniRoute/blob/ab180e32fcdf1f78c96f98a617e17c86e34bf5aa/open-sse/config/providers/registry/vertex/index.ts)
  L4–L71 and [`registry/vertex/partner`](https://github.com/cheaper-inference/OmniRoute/blob/ab180e32fcdf1f78c96f98a617e17c86e34bf5aa/open-sse/config/providers/registry/vertex/partner/index.ts)
  L4–L40.

DurinDoor's Service Account, ADC and raw-key routes, the token cache key and the
project/alignment rules already matched the pinned contracts. The upstream OAuth scope
set is wider than DurinDoor's, but DurinDoor's Vertex model list is static, so the
extra `generative-language.retriever` scope has no consumer here and was not adopted.

## Delta found and fixed

A Google credential JSON that is neither a Service Account key nor an ADC file was
silently demoted to a raw API key. `parseVertexSaJson` only accepted a
`service_account` document with `client_email`, `private_key` and `project_id`, and the
ADC parser only accepted `authorized_user`; every other JSON document fell through to
the raw-key branch, which appends the credential to the URL query string. A Service
Account JSON missing `project_id`, or an OAuth client JSON, therefore put the service
account private key or the OAuth client secret into the outbound URL and in front of
the connection's egress proxy. The operator-facing validation route had the same
fallback, so an ADC file was probed with `?key={…refresh_token…}`.

`classifyVertexCredential`
([`open-sse/services/tokenRefresh.js`](../../open-sse/services/tokenRefresh.js) L113)
now classifies a connection credential once, and both the executor
([`open-sse/executors/vertex.js`](../../open-sse/executors/vertex.js) L21) and the
validation route
([`src/app/api/providers/validate/route.js`](../../src/app/api/providers/validate/route.js)
L807) reject an unusable Google credential JSON before any outbound request. A Service
Account JSON missing a required field, an ADC file missing a required field, and an
OAuth client JSON each report an actionable error; none of them is sent as a raw key.
The Service Account, ADC and raw-key routes themselves are unchanged.

## Evidence

`tests/unit/vertex-service-account-import.test.js` uses freshly generated RSA-2048 test
keys and closed route mocks. It creates two synthetic Service Account connections
through `POST /api/providers`, dispatches them through the protected
`POST /v1/chat/completions` route, and covers the signed project-scoped mint, JSON and
stream dispatch, per-account token-cache isolation, the imported ADC refresh, the raw
key route, and upstream authorization failures that carry no token material into the
response or the logs.

```sh
cd tests && node node_modules/vitest/vitest.mjs run \
  unit/vertex-service-account-import.test.js unit/vertex-sa-key.test.js \
  unit/vertex-eu-endpoint.test.js --maxWorkers=2
```

No live Google account, metadata service, local Google auth file, paid API, browser,
e2e or Docker run was used. The offline mocks cannot establish that a particular
project, quota or service account is authorized for a model, that Google's token
endpoint issues a token for a given key, or that the Express-mode key endpoint still
accepts a given key.
