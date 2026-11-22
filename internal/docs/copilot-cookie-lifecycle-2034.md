# Copilot Web and Microsoft 365 Copilot Web cookie lifecycle (#2034)

Scope: `copilot-web` and `copilot-m365-web` saved credentials, from creation to recovery. GitHub Copilot and GHE Copilot are out of scope. The earlier request-shape comparison is in [copilot-web-parity-2034.md](copilot-web-parity-2034.md). Everything below used synthetic credentials, a closed fake `fetch` and a fake WebSocket; no provider was contacted.

## Sources compared

| Source | Reference | Result |
| --- | --- | --- |
| OmniRoute | `cheaper-inference/OmniRoute` at [`07a790f5c158c1358eb55aa5e31463bb5f22f769`](https://github.com/cheaper-inference/OmniRoute/tree/07a790f5c158c1358eb55aa5e31463bb5f22f769) (previously reviewed at `fbd339668384803bc3a9d42370fc413a55e013d5`) | No change to `open-sse/executors/copilot-web.ts`, `copilot-m365-connection.ts`, `copilot-m365-web.ts` or the M365 OAuth provider between the two commits. New since: native M365 turn/protocol modules (`open-sse/executors/m365*.ts`), image generation, `open-sse/services/tokenRefresh/providers/m365.ts`, and `docs/providers/COPILOT-M365.md` (credential capture, HAR import, ~75 minute token lifetime). |
| CLIProxyAPI | `router-for-me/CLIProxyAPI` at [`f5c5681a8361c9da53e93c60b6507816eee7468b`](https://github.com/router-for-me/CLIProxyAPI/tree/f5c5681a8361c9da53e93c60b6507816eee7468b) (previously `6faa8d20b2673404cff70a2f2d9537ae0d0e684d`) | No Copilot Web or M365 file in the tree or in the diff between the two commits. |
| EasyCLIProxyAPI | `router-for-me/EasyCLIProxyAPI` at [`e4223d5eefa22a3301ca7e2a28d05897432b07f9`](https://github.com/router-for-me/EasyCLIProxyAPI/tree/e4223d5eefa22a3301ca7e2a28d05897432b07f9) | Unchanged since the earlier review. Delegates runtime to the CLIProxyAPI core. |
| First party | `copilot.microsoft.com` and `m365.cloud.microsoft/chat` | No public API document exists for the session endpoints these providers use. Behaviour is taken from the parity sources and from the browser sessions users export; it can change without notice and was not probed. |

## Verified gaps and fixes

| Gap | Fix |
| --- | --- |
| `PUT /api/providers/[id]` silently dropped `apiKey` for cookie rows, so the dashboard Edit form never replaced an expired web session, and a replaced credential kept the old cooldown. | Web-cookie providers now accept the replacement and clear `testStatus`, `lastError`, `errorCode`, `rateLimitedUntil`, `backoffLevel` and every `modelLock_*` key. Other providers and non-cookie rows are unchanged. |
| A WebSocket upgrade rejected with `Unexpected server response: 401/403` surfaced as a 502 envelope, so the credential was flagged as a transient failure. | `open-sse/utils/webSessionExpiry.js` maps it to the real status; both executors carry `error.status` in the SSE envelope and the JSON error. |
| A pasted JWT already past `exp` was still sent to Microsoft. | Both executors answer 401 locally with a re-import message and open no request. Validate and Test Connection report it for M365 and for Copilot Web JWTs; other Copilot Web pastes stay skipped (existing behaviour, covered by `web-session-probe-skip-14818.test.js`). Opaque tokens are never judged locally. |
| M365 accepted a pasted Chathub URL or key/value pair but not a HAR, unlike Copilot Web. | `parseHarCredential` in `open-sse/executors/copilot-m365-connection.js` reads the newest `wss://substrate.office.com/m365Copilot/Chathub/` entry. Ported in spirit from OmniRoute `open-sse/utils/m365Credentials.ts` (`inspectM365ChatHubUrl`) at `07a790f5c158`, narrowed to DurinDoor's single allowed host. The stored credential format is unchanged, and a HAR is never treated as a bare token. |

## Behaviour confirmed, no change

- Saving: both providers save as `authType: "cookie"` with the pasted text stored verbatim and never echoed. Cookie rows are not name-keyed, so a second paste creates a second account row.
- Discovery: static catalog only (`copilot/copilot-pro`, `copilot/gpt-4-turbo`, `copilot/gpt-4`, `m365/copilot-m365`, plus the image model `m365/copilot-m365-image`); the per-connection models route reports no listing support.
- Dispatch through `handleChat`: JSON and SSE for both providers; a personal connection never serves an M365 model and the reverse; a rejected account falls back to the next one and is not retried while cooled down.
- Usage: token counts are gateway estimates; neither provider reports quota or usage.
- Hashcash: the existing bounded proof-of-work answer for personal Copilot stays; no other attestation is attempted.

## Ported: native M365 sign-in, refresh and continuation

Ported from OmniRoute `cheaper-inference/OmniRoute` (MIT) at [`4265bb2ad5477450a07d3a43ea33a62c6c874878`](https://github.com/cheaper-inference/OmniRoute/tree/4265bb2ad5477450a07d3a43ea33a62c6c874878) (release/v3.8.55; `5ffa68e83544` has no later change to these files). The user-facing description is [docs/providers/copilot-m365-web.mdx](../../docs/providers/copilot-m365-web.mdx).

| OmniRoute | DurinDoor | Notes |
| --- | --- | --- |
| `src/lib/oauth/providers/copilot-m365-web.ts`, `m365AuthAttempts.ts` | `src/lib/oauth/copilotM365Provider.js`, registered as `copilot-m365-web` in `src/lib/oauth/providers.js`; constants in `open-sse/config/copilotM365.js` | PKCE authorize URL and code exchange. The attempt store is not ported: the shared server-bound flow record (`flowStore`) already makes an attempt single-use, expiring and reconnect-bound, so the adapter only checks the pasted native-client URL against the issued state. Token requests use `credentialFetch`, so a redirect off `login.microsoftonline.com` is an error. Work/school accounts only. |
| `open-sse/services/tokenRefresh/providers/m365.ts`, `refreshM365AccessToken` | `open-sse/services/tokenRefresh/copilotM365.js`, wired through `REFRESH_HANDLERS` and `CopilotM365WebExecutor.refreshCredentials` | Per connection and tenant; the rotated refresh token is persisted by the existing CAS refresh path. A dead grant is `unrecoverable_refresh_error` (reauth required); any other failure is transient. OmniRoute's `unauthorized_client` circuit breaker is not ported. |
| `m365Protocol/conversations.ts` | `open-sse/executors/copilot-m365-conversations.js` | Per-connection, per-model/profile/tool-set continuation keyed by a sha256 history chain. Process memory only. |
| `m365Protocol/images.ts` | `open-sse/executors/copilot-m365-images.js` | `UploadFile` plus `ImageFile` annotation; the upload is a credentialed `credentialFetch`; HTTPS URLs use the existing public-only guarded media fetch. |
| `m365Protocol/tools.ts`, `parseFencedToolCalls`, `toolArgumentSchema.ts` | `open-sse/executors/copilot-m365-tools.js` | Fenced-block tool calls, one buffered turn. |
| `m365ExecutorOutput.ts` | `open-sse/executors/copilot-m365-output.js` | Text and tool-call output; citations, reasoning and typed errors were added in the later port below. |
| `m365Identity.ts` and the identity merge in the connection store | `open-sse/utils/m365Identity.js`, the `copilot-m365-web` branches in `connectionsRepo.js` and `flowCompletion.js` | Rows are the same account only for the same `oid@tid`; two tenants sharing an email stay separate, and a reconnect with another identity is refused. |

"Personal conversation reuse" has no separate OmniRoute implementation at the pin: `copilot-web.ts` opens a conversation per request. The reuse ported here is the per-connection M365 store, which serves individual-tier (personal) M365 connections. `copilot-web` itself is unchanged.

Manual session entry is unchanged and still saves a `cookie` row. A native sign-in saves an `oauth` row beside it.

## Ported: image generation, turn composer, connect dialog and automatic tier

Ported from OmniRoute `cheaper-inference/OmniRoute` (MIT) at [`5ffa68e835442a12ed1204a2eebf4076c298aecb`](https://github.com/cheaper-inference/OmniRoute/tree/5ffa68e835442a12ed1204a2eebf4076c298aecb) (release/v3.8.55). CLIProxyAPI at `6960763455c4` has no Copilot Web or M365 file, so nothing was taken from it. The user-facing description is [docs/providers/copilot-m365-web.mdx](../../docs/providers/copilot-m365-web.mdx).

| OmniRoute | DurinDoor | Notes |
| --- | --- | --- |
| `m365Protocol/citations.ts` | `open-sse/executors/copilot-m365-citations.js` | Private-use citation markers become numbered Markdown links plus `url_citation` annotations; a source that never arrives is dropped. Only `http(s)` targets are kept. |
| `m365Protocol/composer.ts` | `open-sse/executors/copilot-m365-composer.js` | Replaces the old snapshot accumulator in the executor. Message snapshots by id, cursor writes, hidden control and tool messages, and the reasoning summary (`contentOrigin: "ChainOfThoughtSummary"` or `addToChainOfThought`). Streaming stays append-only; a rewrite still fails a stream with `m365_stream_rewritten`. |
| `m365Turn.ts` (error table, `M365TurnError`, final-result classification) | `open-sse/executors/copilot-m365-turn.js` | Licence codes, `Throttled`/`PerUserThrottled`, `OutOfCredits` (priority access and `ReasoningTurnExhausted`), `Disengaged`, `InternalError`, and a 429 upgrade refusal. The transport is not ported: DurinDoor keeps its own socket loop (`runM365Socket` in `copilot-m365-web.js`) and calls `m365FrameError` on each frame. Unlike OmniRoute, an unknown final `result.value` is not an error, so existing completion handling is unchanged. The `InternalError` retry in a fresh conversation is not ported. |
| `m365ExecutorOutput.ts` (`m365Failure`, annotations, `reasoning_content`) | `open-sse/executors/copilot-m365-output.js` | Public codes `m365_model_not_licensed`, `m365_account_not_licensed`, `m365_throttled`, `priority_access_exhausted`, `reasoning_turns_exhausted`, `provider_safety_rejection`; `m365_error_code` carries only an allow-listed licence code; 429 always has a bounded `Retry-After`. A stream holds its HTTP status until the first text, so a refusal before any text answers with its own status. |
| `disableMemory=1` in `copilot-m365-web.ts` | `buildWsUrl({ disableMemory })`, set by the executor | Every turn is a temporary chat. `providerSpecificData.temporaryChat: false` opts a connection out; temporary and history turns never share a continuation. |
| `m365Protocol/profile.ts` | `open-sse/executors/copilot-m365-profile.js` | Documented model ids select a tone and, for some, a scenario and licence; explicit connection fields win. `copilot-m365` has no profile and keeps the previous empty tone and tier defaults. OmniRoute's enterprise option sets and extra message types are not ported. |
| `m365ImageGeneration.ts`, `m365Protocol/imageGeneration.ts`, `M365_IMAGE_ARTIFACT_SCOPE`, `refreshM365ScopedToken` | `open-sse/executors/copilot-m365-image-generation.js`, `open-sse/handlers/imageProviders/copilotM365.js`, `M365_IMAGE_ARTIFACT_SCOPE` in `open-sse/config/copilotM365.js`, `mintM365ScopedToken` in `open-sse/services/tokenRefresh/copilotM365.js` | `/v1/images/generations` with `m365/copilot-m365-image`. One temporary turn with the image option sets and the `GenerateGraphicArt` message type; artifacts are fetched only from `https://designerapp.officeapps.live.com` with a Designer token minted from the connection's refresh token at its own tenant. Both requests use `credentialFetch`, so a redirect to another origin is an error. The rotated refresh token is persisted through the image handler's `onCredentialsRefreshed` (now passed to executor adapters). A pasted session is refused before the turn. |
| (no upstream counterpart) | `src/shared/components/CopilotM365AuthModal.js`, "Microsoft sign-in" on the provider page | Calls the existing `authorize` and `exchange` routes; the verifier stays on the server. |
| (no upstream counterpart) | `resolveM365Tier` in `open-sse/executors/copilot-m365-connection.js` | A native sign-in without `tier`, `scenario`, `licenseType`, `agent` or `isEdu` routes as `enterprise`, because sign-in already refuses the consumer tenant. `tier: "individual"` (or `personal`) opts out. Pasted sessions keep the individual defaults. Education accounts are not detected and still set `tier: "edu"`. |

## Not ported

- OmniRoute's native turn transport (`runM365Turn`): its frame-size limits, stop frame on abort and metrics frame. DurinDoor's socket loop keeps its own timeouts.
- The one-shot retry of a content-less `InternalError` in a fresh conversation.
- OmniRoute's `unauthorized_client` refresh circuit breaker (unchanged from the sign-in port).

## Tests

`tests/unit/provider-cookie-lifecycle-copilot.test.js` covers both providers end to end against the real DB layer, route handlers and gateway chat handler with closed mocks.

`tests/unit/copilot-m365-signin.test.js` covers the native sign-in, refresh and continuation port: the PKCE URL and exchange, single-use attempts, refresh rotation, per-connection isolation, continuation reuse, an image round and a tool round, and JSON and streamed chat through the OpenAI and Anthropic routes, all with closed mocks.

`tests/unit/copilot-m365-remaining.test.js` covers image generation through `/v1/images/generations` (temporary turn, Designer token at the account's tenant, artifact host allow-list, no cross-origin redirect, rotated refresh token persisted, pasted session refused, quota answer), citations in OpenAI JSON and streams and in Anthropic output, the reasoning summary as `reasoning_content` and as an Anthropic thinking block, licence, throttle, credit and safety error mapping (JSON, stream and upgrade refusal), account fallback after a licence refusal, temporary chats, tone profiles, automatic tier selection, and the connect dialog starting the PKCE flow and exchanging the pasted callback, all with closed mocks.
