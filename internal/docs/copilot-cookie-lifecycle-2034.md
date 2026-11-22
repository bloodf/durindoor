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
- Discovery: static catalog only (`copilot/copilot-pro`, `copilot/gpt-4-turbo`, `copilot/gpt-4`, `m365/copilot-m365`); the per-connection models route reports no listing support.
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
| `m365ExecutorOutput.ts` | `open-sse/executors/copilot-m365-output.js` | Text and tool-call output only. |
| `m365Identity.ts` and the identity merge in the connection store | `open-sse/utils/m365Identity.js`, the `copilot-m365-web` branches in `connectionsRepo.js` and `flowCompletion.js` | Rows are the same account only for the same `oid@tid`; two tenants sharing an email stay separate, and a reconnect with another identity is refused. |

"Personal conversation reuse" has no separate OmniRoute implementation at the pin: `copilot-web.ts` opens a conversation per request. The reuse ported here is the per-connection M365 store, which serves individual-tier (personal) M365 connections. `copilot-web` itself is unchanged.

Manual session entry is unchanged and still saves a `cookie` row. A native sign-in saves an `oauth` row beside it.

## Not ported

- OmniRoute's image generation (`m365ImageGeneration.ts`, the Designer token mint and `M365_IMAGE_ARTIFACT_SCOPE`).
- The native turn transport and composer (`m365Turn.ts`, `composer.ts`, `citations.ts`): DurinDoor keeps its own socket loop, so there are no citation annotations, reasoning summaries, typed licence/throttle error codes, `disableMemory` temporary chats or documented-model tone profiles.
- The dashboard connect dialog for native sign-in. The OAuth routes are the interface until a dialog is added.
- Automatic `tier` selection: a native work account still needs `providerSpecificData.tier`.

## Tests

`tests/unit/provider-cookie-lifecycle-copilot.test.js` covers both providers end to end against the real DB layer, route handlers and gateway chat handler with closed mocks.

`tests/unit/copilot-m365-signin.test.js` covers the native sign-in, refresh and continuation port: the PKCE URL and exchange, single-use attempts, refresh rotation, per-connection isolation, continuation reuse, an image round and a tool round, and JSON and streamed chat through the OpenAI and Anthropic routes, all with closed mocks.
