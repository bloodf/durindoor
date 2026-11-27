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

## Missing-in-DurinDoor contracts and next units

The rows below are exact unmatched IDs in the pinned OmniRoute registry and
absent from the composed DurinDoor registry. Their prior “retired” labels are
not used as current policy. The owner addition rule makes these implementable
provider candidates; an implementation should document any known dead-origin
or terms uncertainty and remain mock-covered until an authorized real-account
check is separately scheduled.

| Provider / pinned upstream contract | Auth delta | Current local evidence and test coverage | State and implementable next-unit acceptance |
| --- | --- | --- | --- |
| `chatgpt`: OAuth plan-usage route to OpenAI Responses; [registry](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/config/providers/registry/chatgpt/index.ts), [OAuth protocol](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/src/lib/oauth/chatgptProtocol.ts), [executor](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/executors/chatgpt.ts). | Plan scope `chatgpt.tokens.use.direct` and resource-bound OAuth grant differ from local `chatgpt-plan`/Codex token scopes and backend route. | `chatgpt` absent; `chatgpt-plan` is registered with its own executor and `tests/unit/chatgpt-plan-access.test.js`; it does not establish the platform Responses credential/route. | **Implementable gap.** Add a separate OAuth identity/credential class. Mock authorize/PKCE, token exchange and refresh, bearer Responses dispatch, model discovery, response normalization, and isolation from `codex` and `chatgpt-plan`. |
| `g4f-groq`: optional API key at G4F Groq gateway; [registry](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/config/providers/registry/g4f-groq/index.ts). | Optional key, with anonymous and keyed modes; not equivalent to local Groq API-key auth. | No composed `g4f-groq` identity or dedicated gateway executor; no provider-specific offline test found. | **Implementable gap.** Fixture both no-key and synthetic-key calls; assert exact gateway URL/header presence, model passthrough, normalized JSON/SSE and error behavior; prove no external request. |
| `monsterapi`: API-key inference route; [registry](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/config/providers/registry/monsterapi/index.ts). | Provider API key and MonsterAPI endpoint/catalog semantics, not a generic OpenAI-compatible alias. | No composed identity or executor; no provider-specific offline test. Older endpoint-health disposition is historical and does not settle present service availability. | **Implementable gap; live status unverified.** Fake server covers missing/valid key, model/path mapping, JSON/SSE and provider errors. Keep live endpoint acceptance separate. |
| `predibase`: hosted inference route; [registry](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7b83979f40be488c5da8772b9/open-sse/config/providers/registry/predibase/index.ts). | Bearer key plus deployment/model route semantics. | No composed identity or dedicated executor; no provider-specific offline test. Prior DNS finding is historical, not a current reachability result. | **Implementable gap; live status unverified.** Mock authorization, endpoint construction, deployment/model selection, response and error conversion. Only a separately authorized live check can resolve availability. |
| `seekai`: hosted chat endpoint; [registry](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7b83979f40be488c5da8772b9/open-sse/config/providers/registry/seekai/index.ts). | Inherited shared auth; exact missing credential behavior must follow the composed upstream builder. | No composed identity or dedicated executor; no provider-specific offline test. Prior certificate/site report is historical. | **Implementable gap; live status unverified.** First pin inherited auth behavior from the shared builder, then fake endpoint tests for URL, auth, model, success, stream and error mapping. |
| `syntx`: custom API endpoint and executor; [registry](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7b83979f40be488c5da8772b9/open-sse/config/providers/registry/syntx/index.ts), [executor](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7b83979f40be488c5da8772b9/open-sse/executors/syntx.ts). | Bearer key and provider-specific request conversion. | No composed identity or executor; no provider-specific offline test. Prior reseller/terms assessment remains dated evidence, not an implementation veto. | **Implementable gap; authorization/live status require explicit documentation.** Use synthetic key and fake endpoint; assert outbound request fields, model mapping, stream parsing and normalized error. Document unresolved vendor terms in the provider note. |

No row above claims the provider is live, operational, or authorized by virtue of
OmniRoute source. The test acceptance is deterministic and offline. Existing
source parity or registry entries establish code paths only, not account access.

## Separate live-only verification

The existing #2034 handoff names live sign-in checks for HuggingChat, Muse Spark
Web, ZCode, Freebuff, Zed-hosted, MiniMax Code, WorkBuddy, Devin Desktop,
Cursor API key and newly added web-session providers. The current local code and
mock suites are not substitutes for those checks. These remain **live-only
verification**, separate from implementable missing contracts; no real account
was used for this catalog. Antigravity, CLIProxyAPI/Easy auth, and web-cookie
groups remain excluded from this catalog's provider-addition table.

## Tracker boundaries and evidence limits

The open tracker list on 2026-11-27 includes [#2034](https://github.com/bloodf/durindoor/issues/2034),
[#2642](https://github.com/bloodf/durindoor/issues/2642) TrustedRouter review,
and distinct architecture items. This document makes no claims for #2642 or
architecture lanes and changes no GitHub issue. All source identities and
unmatched status refer to the pins above; the local evidence refers only to
`1184034cec8dbe158ae3e69479a06b1bb7a93359`. Live provider behavior, accepted
credentials, pricing, regional availability and account quotas were not tested.
