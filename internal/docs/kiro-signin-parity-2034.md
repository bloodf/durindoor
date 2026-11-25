# Kiro upstream comparison (#2034)

Sources inspected: CLIProxyAPI `6eb8554f0ede` (`internal/auth` and `internal/runtime/executor` contain no Kiro or CodeWhisperer references), and OmniRoute `5ffa68e83544`. Identity cloaking and detection evasion are outside this comparison. The changes retain DurinDoor's proxy routing, server-bound OAuth claims, event validation and account isolation.

| Behavior | Upstream source | DurinDoor state |
| --- | --- | --- |
| Builder ID / IDC client registration, scopes, device URL and grant | OmniRoute `src/lib/oauth/providers/kiro.ts`, `constants/oauth.ts` | Already matched. IDC registration omits the Builder ID issuer. |
| Social device authorization and polling | OmniRoute `src/app/api/oauth/kiro/social-authorize/route.ts`, `social-exchange/route.ts`, `kiroSocialPoll.ts` | Ported here, including slow-down intervals; device code and routing are bound to an expiring, single-claim server flow. The existing PKCE callback remains available for compatibility. |
| Social PKCE URL and code exchange | OmniRoute `src/lib/oauth/services/kiro.ts` | Already matched; local flow binds state and verifier server-side. |
| OIDC, social and external IdP refresh | OmniRoute `src/lib/oauth/services/kiro.ts`, `open-sse/services/tokenRefresh/providers/kiro.ts` | Imported social tokens now use social refresh even when an OIDC client is present; Builder ID uses its registration region. External IdP response validation and proxy routing are intentionally retained. Local refresh does not re-register an OIDC client on every failure: a new registration is not evidence that it can refresh a token issued to another client. |
| Profile discovery and API key validation | OmniRoute `src/lib/oauth/services/kiro.ts`, `src/app/api/oauth/kiro/api-key/route.ts` | API keys now validate against regional Amazon Q model listing, auto-probe the supported regions, and tolerate denied profile discovery. Other profile discovery remains cross-region and uses validated hostnames. |
| Request envelope, model translation and conversation identity | OmniRoute `open-sse/executors/kiro.ts`, `translator/request/openai-to-kiro.ts` | Local translation retains surface-specific system prompt handling, media, tool results and request-scoped conversation identity. The executor preserves additional locally supported fields rather than applying upstream's top-level allowlist. |
| Runtime endpoints and retries | OmniRoute `open-sse/executors/kiro.ts` | Ported branded-gateway fallback for 401/403/404 and the two known 400 messages; API keys use regional Amazon Q. Local proxy, bounded retries and quota dispatch accounting remain in force. |
| Quota and rate limits | OmniRoute `open-sse/services/usage/kiro.ts`, `open-sse/executors/kiro.ts` | Overage and empty-breakdown display ported here. Local account cooldown and quota admission remain in force. |
| Model catalog | OmniRoute `open-sse/config/providers/registry/kiro/index.ts`, `open-sse/services/kiroModels.ts` | Dynamic account catalog already supported. Static catalog intentionally retains DurinDoor aliases and variants; availability is account-dependent. |
| EventStream, response errors and usage | OmniRoute `open-sse/executors/kiro.ts`, `executors/kiro/eventstream.ts` | Local stream validates frames, terminal provenance and tool calls. Context percentage now estimates total tokens without double-counting completion; local estimates remain explicitly marked and credits preserved. |
| Headers | OmniRoute `open-sse/executors/kiro.ts` | Authentication type headers already matched; identity presentation is outside scope. |

The social device endpoints and client identifier are defined in the service, so no change to `src/lib/oauth/providers.js` is required for this port. The two existing assertions changed by this pass pinned the old API-key validation call order and CodeWhisperer-first API-key runtime host.

Follow-up completed: device polling reads the response body once and classifies malformed non-JSON responses as `invalid_response`.
