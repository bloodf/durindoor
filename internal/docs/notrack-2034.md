# NoTrack developer API provider

Tracking issue: [#2034](https://github.com/bloodf/durindoor/issues/2034). Related: [#1215](https://github.com/bloodf/durindoor/issues/1215), closed earlier as consumer-session work.

## What was implemented

A registry provider `notrack` for the documented NoTrack **developer** API: base URL `https://api.notrack.ai/v1`, `Authorization: Bearer sk-notrack-…` with an operator-issued key from <https://notrack.ai/api-keys>, OpenAI Chat Completions only. Category `apikey`, transport format `openai`, one seeded model `notrack-uncensored` (100,000-token prompt-plus-completion window).

The public setup guide is [`docs/providers/notrack.mdx`](../../docs/providers/notrack.mdx).

## First-party source

[notrack.ai/api/docs](https://notrack.ai/api/docs), retrieved 2026-11-20. It documents:

- `GET /v1/models` returning `notrack-uncensored`, `POST /v1/chat/completions`, and SSE with a final `usage` chunk followed by `data: [DONE]`.
- Text-only messages. Image parts are rejected upstream.
- `tools`/`tool_choice` supported; `response_format` `json_object` supported; `json_schema` and the legacy `functions` field are not.
- Limits: 8 concurrent and 300 requests per minute per key (2 and 60 before the first top-up), 100,000-token context window, an optional per-key daily spend cap, and prepaid credit billed on the reported token usage.
- Error types by status: 400 `body`/`context_limit`, 401 `auth`/`invalid_key`/`key_revoked`/`key_expired`, 402 `no_credit`/`key_daily_cap`, 403 `content_policy`, 429 `rate_limit`/`concurrency`, 502 `upstream`, 503 `billing`/`safety`.

These are provider claims. Nothing here was checked against a live account.

## Why this is not the upstream `notrack-web` identity

OmniRoute `open-sse/config/providers/registry/notrack-web/index.ts` is byte-identical at the work-order revision `575c3d49c15b2ff444e39c83a6ee648f19a2923e` and at the newer `e3c1531afd07d5e06f7ffab658584a7ae2e3627e` checked during this work. That entry is the **consumer** route:

| | Upstream `notrack-web` | Local `notrack` |
| --- | --- | --- |
| Endpoint | `https://notrack.ai/api/dispatch` | `https://api.notrack.ai/v1/chat/completions` |
| Auth | cookie header (`uid`, `si_usr_id`, `si_ses_id`) | `Authorization: Bearer` developer key |
| Model | `notrack-c` (aliases `C`, `notrack`, `ntw`) | `notrack-uncensored` |
| Upstream alias | `ntw` | none claimed |

The consumer route is out of scope and stays unimplemented, which is the concrete reason [#1215](https://github.com/bloodf/durindoor/issues/1215) recorded. #1215 asked for the first-party endpoint/auth/model contract to be verified before anything was added; that contract now exists for the developer API, so a new, separately named identity was added instead of reviving the closed web entry.

Local composition checks: no registry entry uses the ids or aliases `notrack-web` or `ntw`, and no registry transport points at `notrack.ai/api/dispatch`. The local alias space had no `notrack`/`ntw` collision before this change.

## Reused machinery

No custom executor, translator, OAuth flow or session handling was added.

- Registry transport plus the default OpenAI executor build the request, apply the bearer key, and pass SSE and JSON through.
- `transport.validateUrl` (`/v1/models`) drives the connection test through the generic registry probe in `src/app/api/providers/providerProbe.js`. That endpoint answers 401 for a bad key, so the check does not fail open. The chat probe remains as a fallback.
- The top-level `modelsFetcher` is read by the generic branch of `fetchConnectionModels`, so the connection models route and the model auto-sync service share one authenticated discovery path.
- `extractUsageFromResponse` in `open-sse/handlers/chatCore/requestDetail.js` reads the provider-reported counts, and `saveUsageStats` accounts them. The client-facing count keeps the gateway's standard input buffer; the ledger row keeps the provider's numbers.
- Connection isolation, encrypted key storage, the SSRF-guarded probe and the credential redaction in `parseUpstreamError` / `createErrorResult` are the existing shared paths. No egress or redaction policy was relaxed.

## Deliberate scope limits

- Persona is a per-key setting on the provider's keys page. The provider's per-request `notrack` field and its `:persona` model suffix are **not** translated, because the local model catalog resolves `notrack-uncensored` only and the suffix is not part of the documented model id set.
- Image input, the Responses API, embeddings, image, speech and search routes are not exposed.
- No provider artwork was added. The dashboard uses a neutral Material symbol and the letter tile fallback, per [provider brand assets](./provider-brand-assets.mdx).

## Verification limits

`tests/unit/notrack-provider.test.js` mocks the upstream. It covers registry publication and the dashboard picker entry, the separation from the consumer web identity, the base URL, the bearer header and the absence of any cookie, per-connection key isolation, catalog discovery and discovery failure, JSON and streamed responses, provider-reported usage in the ledger, the key probe, and the documented 401/402/403/429/400 failure statuses.

No credentials were used, no live provider call was made, and no browser, end-to-end or Docker run happened. The fixtures prove local wiring only. Live catalog contents, account entitlement, quota behaviour and tool support remain unverified and need separately authorized account-backed verification.

## Files

- `open-sse/providers/registry/notrack.js` (new)
- `open-sse/providers/registry/index.js` (generated)
- `open-sse/AGENT-INDEX.md` (generated)
- `docs/providers/catalog.mdx` (generated)
- `docs/providers/notrack.mdx` (new), `docs/providers/meta.json`, `docs/providers/index.mdx`
- `tests/unit/notrack-provider.test.js` (new)
