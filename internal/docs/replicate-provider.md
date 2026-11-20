# Replicate provider source notes

The registry and executor adapt OmniRoute `open-sse/config/providers/registry/replicate/index.ts` and `open-sse/executors/replicate.ts` at `bd9b1324abb82f0e00066f631b6dd7744e5d975a` (release/v3.8.55 candidate). DurinDoor main had no Replicate provider implementation. The first-party contract is the [HTTP API reference](https://replicate.com/docs/reference/http) and the [predictions streaming guide](https://replicate.com/docs/topics/predictions/streaming/); the published Replicate contract takes precedence where the OmniRoute source differs.

## Scope

- `open-sse/providers/registry/replicate.js` — API-key provider, `transport.format: "openai"`, one documented official text model, `passthroughModels: true` for other official `owner/name` models.
- `open-sse/executors/replicate.js` — the prediction path: create a prediction, then poll or follow the prediction stream.
- `src/app/api/providers/[id]/models/modelsConfig.js` — model discovery for the documented official model.
- `open-sse/utils/stream.js` — the `provider !== "replicate"` guard keeps token usage absent instead of estimated, because Replicate predictions do not report token counts.

Text messages are flattened into `prompt`; system and developer messages become `system_prompt`. Tool calls, function calls, and non-text content are rejected before any dispatch. The provider accepts only the documented text inputs; no other modality, price, or usage figure is invented.

## Prediction links and redirects

Prediction URLs are provider-controlled, so every follow target is constrained before a credential is attached:

- `urls.stream` must match `https://streaming.api.replicate.com` or `https://stream.replicate.com` exactly, with no embedded credentials.
- `urls.get` must match `https://api.replicate.com` exactly.

An unexpected destination is refused with `502` and no second request is sent. Every send uses `redirect: "manual"`, so a `3xx` is never followed and a redirect target never receives the API token. The transport layer additionally forces `redirect: "error"` for quota-bearing sends, so a redirect cannot turn one reservation into two dispatches.

## Quota lifecycle

One Replicate request is one billable dispatch, and prediction creation is the only billable send:

1. **Creation** — the `POST` to `/v1/models/{owner}/{name}/predictions` runs inside `runQuotaBearingProviderRequest`. The gateway acquires a quota reservation before the transport call, so a local capacity denial fails before any request reaches Replicate.
2. **Retrieval** — the polling `GET` on `urls.get` and the stream `GET` on `urls.stream` read the same prediction. They stay outside the quota charge and never acquire a second reservation.
3. **Denial** — a refused reservation keeps its `QUOTA_DISPATCH_UNAVAILABLE` type. `chatCore` reports it as local quota capacity unavailable (`503`) instead of an upstream `502`, and the request is never sent.
4. **Settlement** — the physical creation response owns the dispatch ticket. Every response the executor returns replaces that response, so the ticket is transferred to the shaped completion, the shaped stream, or the provider failure. The ticket then settles exactly once through `settleProviderAttemptDispatch`, and a second settlement is a no-op.

JSON and locally synthesized SSE completions require a `succeeded` prediction with nonempty text output. Native SSE needs a text `output` event followed by a complete `done` event with the documented empty JSON object. Errors, cancellation, and premature EOF release the reservation.

The regression evidence lives in `tests/unit/replicate-provider.test.js` under "Replicate quota lifecycle".

## Verification limits

The closed suite uses local HTTP mocks and synthetic keys only. It proves request shape, origin constraints, redirect refusal, stream decoding, absence of fabricated usage, and the quota lifecycle. It does not prove that a Replicate account, token, or any specific `owner/name` model works, and no paid provider call is made.
