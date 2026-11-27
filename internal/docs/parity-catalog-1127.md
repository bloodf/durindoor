# Provider parity catalog — 2026-11-27 (#2034)

## Scope and source pins

This refresh covers provider identities and non-cookie authentication contracts
from CLIProxyAPI, EasyCLIProxyAPI, and OmniRoute. It excludes OmniRoute's
Antigravity and CLIProxyAPI/Easy auth groups already handled in their dedicated
parity records, plus web-cookie/session providers. It does not call a provider,
use an account or credential, or claim live availability.

| Source | Branch | Exact head | Pinned source |
| --- | --- | --- | --- |
| CLIProxyAPI | `main` | `47f18e4d82bd72f7d2b5ecf5ede93e4837a4625e` | [service executor registry](https://github.com/router-for-me/CLIProxyAPI/blob/47f18e4d82bd72f7d2b5ecf5ede93e4837a4625e/sdk/cliproxy/service_executors.go), [auth classification](https://github.com/router-for-me/CLIProxyAPI/blob/47f18e4d82bd72f7d2b5ecf5ede93e4837a4625e/sdk/cliproxy/auth/classification.go) |
| EasyCLIProxyAPI | `main` | `29567ead8164a00724dfdc2087f02a23895636ee` | [guided setup page](https://github.com/router-for-me/EasyCLIProxyAPI/blob/29567ead8164a00724dfdc2087f02a23895636ee/src/pages/EasyModePage.tsx) |
| OmniRoute | `release/v3.8.55` | `9671192011beb2d7f83979f40be488c5da8772b9` | [provider registry](https://github.com/cheaper-inference/OmniRoute/tree/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/config/providers/registry), [executor dispatch](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/executors/index.ts) |
| DurinDoor | work-order checkout | `1184034cec8dbe158ae3e69479a06b1bb7a93359` | [composed registry](../../open-sse/providers/registry/index.js), [executor dispatch](../../open-sse/executors/index.js) |

The three public heads were resolved with `git ls-remote`; read-only, depth-one
source checkouts matched those SHAs. The generated DurinDoor registry composes
417 entries at this checkout. A route counts as present only when registration,
credential handling and dispatch agree. For detailed identity inventories and
prior mock evidence see [CLIProxyAPI](./provider-parity-cliproxyapi.md),
[EasyCLIProxyAPI](./provider-parity-easycliproxyapi.md), and the [OmniRoute
dispositions](./provider-parity-current-dispositions.md). Those reports are
historical snapshots where their pins differ; current local evidence below
supersedes their absence claims.

Owner direction recorded on #2034 on 2026-11-23 is current: providers may ship
with offline mock coverage while real-account verification remains explicitly
unverified, and that is not a release blocker. Prior retirement dispositions
remain evidence about their date and reason, not a standing prohibition on a
later owner-authorized addition. Do not infer live service status from registry
presence or mocks. Do not add identity-cloaking behavior.

## Inventory reconciliation

| Provider set | Current upstream inventory | DurinDoor registration and dispatch | State / next acceptance |
| --- | --- | --- | --- |
| CLIProxyAPI native outbound providers | `codex`, `claude`, `gemini`, `gemini-interactions`, `vertex`, `aistudio`, `antigravity`, `kimi`, `xai`, `devin`, `meta`; generic configured `openai-compatibility`. See pinned [auth registry](https://github.com/router-for-me/CLIProxyAPI/blob/47f18e4d82bd72f7d2b5ecf5ede93e4837a4625e/internal/cmd/auth_manager.go) and [executor registration](https://github.com/router-for-me/CLIProxyAPI/blob/47f18e4d82bd72f7d2b5ecf5ede93e4837a4625e/sdk/cliproxy/service_executors.go). | Provider-specific routes are composed in `open-sse/providers/registry/index.js` and selected by `open-sse/executors/index.js`; the detailed CLIProxyAPI matrix records distinct credentials and endpoint contracts. | **Source parity established for provider identity coverage** in the existing matrix. No new provider identity was found in the pinned source range. Residual parity is at request, refresh, quota, and inbound compatibility level, not missing registration; select those independently from the current closure section of the linked inventory. Offline route tests remain the acceptance evidence. |
| EasyCLIProxyAPI guided setup | Seven guided OAuth identities and nine API-key setup choices remain in the pinned desktop UI; the desktop source does not pin its bundled CLIProxyAPI core revision. | DurinDoor has native provider connections and generic configured-compatible connections. | **No new upstream identity delta.** Exact runtime, refresh, model and quota parity is unprovable from Easy's UI source alone. Next scoped acceptance, if guided-onboarding parity is wanted: exercise representative API-key and OAuth forms against synthetic config, and verify the selected provider ID, auth fields and endpoint without asserting core behavior that is not pinned. |
| OmniRoute non-cookie identities | The pinned registry and executor tree retain the requested non-cookie provider contracts. Full historical identity dispositions are linked above; direct source links in rows below pin the actionable unmatched contracts. | Current registry/executor checks show several prior “missing” reports have since shipped: `freebuff`, `nlpcloud`, `openference`, `xkiro`, `cursor-api`, `zed-hosted`, and `devin-cli-agentic` are composed; `freebuff` has OAuth/API-key modes, `openference` has its own OAuth identity separate from `openference-api`. | **Do not re-file historical absences.** Offline evidence includes `tests/unit/freebuff-provider.test.js`, `nlpcloud-provider.test.js`, `openference-provider.test.js`, `cursor-api-provider.test.js`, `zed-hosted-provider.test.js`, and `devin-cli-agentic-provider.test.js`. Live account/provider acceptance remains unverified for entries whose docs say so. |

## OmniRoute contracts: corrections, staged work and retired candidates

Corrected 2026-11-27. The first version of this section listed `chatgpt` as
absent and listed five dead or closed candidates as implementable gaps. It also
said `g4f-groq` had no provider-specific offline test, although one exists.

### Already covered: `chatgpt`

`chatgpt` is **not missing**. DurinDoor registers it as `chatgpt-plan`, hidden
and owner-operated. Only the exact ID `chatgpt` is absent.

| Contract | Pinned OmniRoute | DurinDoor |
| --- | --- | --- |
| OAuth scopes and resource ([upstream config](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/config/chatgpt.ts), [protocol](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/src/lib/oauth/chatgptProtocol.ts)) | `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct` for resource `https://api.openai.com/v1`; issuer `https://auth.openai.com`; PKCE | The same scopes, resource, issuer, authorize path, token URL and PKCE in [`chatgptPlanProtocol.js`](../../src/lib/oauth/chatgptPlanProtocol.js). This is a separate credential class from `codex`. |
| Models and inference ([registry](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/config/providers/registry/chatgpt/index.ts), [executor](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/executors/chatgpt.ts)) | Discovery at `/v1/models`, Responses at `/v1/responses` | Both in [`chatgpt-plan/index.js`](../../open-sse/providers/chatgpt-plan/index.js) and [`chatgpt-plan.js`](../../open-sse/executors/chatgpt-plan.js), dispatched by [`chatgptPlanDispatch.js`](../../src/sse/services/chatgptPlanDispatch.js) instead of the shared executor map. |

Deliberate differences include DurinDoor's guarded, opt-in enrollment, scoped
gateway keys and its own agent name. See the
[provider guide](../../docs/providers/chatgpt-plan.md) and
[transport note](./chatgpt-plan-transport.md). Offline evidence is in
`tests/unit/chatgpt-plan-*.test.js`; this correction ran the `provider`,
`oauth`, `enrollment`, `model-list`, `inference` and `gateway-dispatch` files.
No sign-in or request was made to OpenAI.

### Registered, mock-tested: `renderhour`

| Pinned contract | DurinDoor state | Remaining |
| --- | --- | --- |
| Media jobs with an `rh_` key or subscription OAuth: [models](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/config/providers/registry/renderhour/mediaModels.ts), [job client](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/handlers/mediaGeneration/renderhour.ts) | **Registered.** Image, text-to-video and speech with an `rh_` key or a plan sign-in (operator `RENDERHOUR_OAUTH_CLIENT_ID`), connection create/validate and pinned-list discovery. Closed-mock evidence: `tests/unit/provider-media-registration-1127.test.js` and the `renderhour-*` files. Not verified live. | Reference uploads, image-to-video and voice choice are refused. Only `url` output for images and video. Live account and sign-in acceptance. See the [provider note](../../docs/providers/renderhour.md). |

The separate Adobe Firefly Services API (`adobe-firefly-api`) is registered the same way for images and Adobe's native video; it is not a consumer Firefly route. See [the provider note](../../docs/providers/adobe-firefly-api.md).

### Retired candidates

These exact IDs are in the pinned OmniRoute registry. DurinDoor has no route for
them. They are **not queued**. The evidence is dated and already in this
repository; this refresh made no new probe. It does not show that a service is
unavailable today. The owner direction above allows a later owner-authorized
addition, but a pinned registry row alone is not a reason to revive one. Any
revival needs new first-party evidence for the recorded problem.

| Candidate / pinned upstream | Recorded evidence | Existing offline check |
| --- | --- | --- |
| `g4f-groq`: [registry](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/config/providers/registry/g4f-groq/index.ts) | Issue [#1186](https://github.com/bloodf/durindoor/issues/1186), closed not planned as a public gateway front ([dispositions](./provider-parity-current-dispositions.md)). A [2026-11-21 probe](./g4f-groq-2034.md) of the pinned model list returned HTTP 404. The other four G4F gateways have since been registered, so that shared basis no longer excludes them; it says nothing new about this route's 404. | `tests/unit/fleet-provider-g4f-groq-acceptance.test.js`, `tests/unit/provider-registration-apikey-batch-b.test.js` |
| `monsterapi`: [registry](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/config/providers/registry/monsterapi/index.ts) | Issue [#1208](https://github.com/bloodf/durindoor/issues/1208), closed not planned: DNS failure and ambiguous free-catalog terms. A [later note](./monsterapi-2034.md) records both the API and developer hosts failing to resolve. | `tests/unit/provider-registration-apikey-batch-b.test.js` |
| `predibase`: [registry](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/config/providers/registry/predibase/index.ts) | Issue [#1227](https://github.com/bloodf/durindoor/issues/1227), closed not planned: the documented host did not resolve. | The free-model row is marked discontinued, asserted by `tests/unit/port-omniroute-free-catalog-retired.test.js`. |
| `seekai`: [registry](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/config/providers/registry/seekai/index.ts) | Issue [#1232](https://github.com/bloodf/durindoor/issues/1232), closed not planned: the 2026-11-03 review found the site offline, an invalid origin certificate and no API documentation. | None |
| `syntx`: [registry](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/config/providers/registry/syntx/index.ts), [executor](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/executors/syntx.ts) | Issue [#1234](https://github.com/bloodf/durindoor/issues/1234), closed not planned: reseller with no public API documentation or named operator. A [2026-11-21 check](../../docs/providers/syntx.mdx) got HTTP 404 from the pinned chat route. | `tests/unit/provider-registration-apikey-batch-b.test.js` |

Registry presence, a staged module and mocks do not show that a provider is
live, operational or authorized.

## Separate live-only verification

The existing #2034 handoff names live sign-in checks for HuggingChat, Muse Spark
Web, ZCode, Freebuff, Zed-hosted, MiniMax Code, WorkBuddy, Devin Desktop,
Cursor API key and newly added web-session providers. The current local code and
mock suites are not substitutes for those checks. These remain **live-only
verification**, separate from implementable missing contracts; no real account
was used for this catalog. Antigravity, CLIProxyAPI/Easy auth, and web-cookie
groups remain excluded from this catalog's OmniRoute tables. The four web-session
identities registered for #2034 on 2026-11-27 (`inner-ai-web`, `poe-web`,
`venice-web`, `v0-vercel-web`) are recorded in
[parity-web-1127.md](./parity-web-1127.md); they are available with mocked
coverage only and join this live-only list.

## Tracker boundaries and evidence limits

The open tracker list on 2026-11-27 includes [#2034](https://github.com/bloodf/durindoor/issues/2034),
[#2642](https://github.com/bloodf/durindoor/issues/2642) TrustedRouter review,
and distinct architecture items. This document makes no claims for #2642 or
architecture lanes and changes no GitHub issue. All source identities and
unmatched status refer to the pins above; the local evidence refers to
`1184034cec8dbe158ae3e69479a06b1bb7a93359`, except the `renderhour` and
`adobe-firefly-api` modules, which were added and registered after it. Live provider behavior, accepted
credentials, pricing, regional availability and account quotas were not tested.
