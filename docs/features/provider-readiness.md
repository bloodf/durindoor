# Provider readiness evidence

`GET /api/providers/{provider-id}/readiness` reports local configuration, without contacting the provider or changing credentials. `LISTED` means catalog metadata exists. `CONFIGURED` chat dispatch means an executor or transport is configured, not that a request will succeed. `UNSUPPORTED` chat dispatch is limited to locally known unsupported routes; `UNKNOWN` means the endpoint cannot establish dispatch. Other gateway routes may exist.

`nativeKinds` lists configured dedicated native operation kinds, including websocket operations. A missing kind means no dedicated native operation of that kind is configured here; it does not rule out other gateway routes or establish model support. Configuration is not proof of modality support at the upstream provider.

Authentication and inference remain `UNKNOWN`: saved validation status has no reliable validation timestamp, and this endpoint has no fresh evidence bound to the account, model and operation. Missing, stale or unbound evidence cannot establish current readiness. A validation success alone is not inference evidence. Transient failures do not disable credentials through this endpoint.

The Providers dashboard points to each provider's readiness details. The detail page fetches this local endpoint when opened; a loading or unavailable response is shown explicitly. It separates catalog listing and configured chat dispatch from authentication and inference, which remain unknown without fresh, bound evidence. The native operation list does not prove model, modality or tool support. The dashboard does not probe providers or alter credentials to obtain this evidence.
