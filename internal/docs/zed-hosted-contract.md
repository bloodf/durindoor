# Zed-hosted inference contract review

Reviewed for #2034 against OmniRoute release/v3.8.55 candidate
`4624250231f49ed118fb4522a9d735e4894322c6` and DurinDoor `main` and the
working branch on 2026-11-20. Status: documented gap; no Zed-hosted support is
implemented or claimed. **Superseded for staging by the owner's order on #2034:**
the sign-in and gateway flow is now ported behind a per-connection opt-in
(`providerSpecificData.enableSessionDispatch === true`), unregistered and tested
only against closed mocks; see `docs/providers/zed-hosted.mdx`. The authorization
question below is unchanged and remains the operator's to settle.

Zed describes [hosted models](https://zed.dev/docs/account/zed-hosted-models)
as models billed through Zed. Its [provider guide](https://zed.dev/docs/ai/llm-providers)
describes those models for Zed-owned AI features and says external agents own
their model access and authentication. Its [authentication guide](https://zed.dev/docs/authentication)
describes signing in through Zed. The separate [API access guide](https://zed.dev/docs/ai/use-api-access)
describes keys issued by other providers. These documents do not specify a
third-party gateway registration, credential, or authorized hosted-model API.

The [current General Terms](https://zed.dev/terms), last updated November 18,
2026, state in Section 2.4 (Restrictions):

> Customer will not (and will not permit anyone else to), directly or indirectly, do any of the following: (a) provide access to, distribute, sell, or sublicense any Product to a third party; (b) seek to access non-public APIs associated with any Product; (c) copy any element of a Product; (d) interfere with the operation of a Product, circumvent any access restrictions, or conduct any security or vulnerability test of a Product; (e) transmit any viruses or other harmful materials to a Product or others; (f) take any action that risks harm to others or to the security, availability, or integrity of a Product except for the purposes of legitimate security or malware research; or (g) access or use a Product or Output in a manner that violates any applicable relevant local, state, federal or international laws, regulations, or conventions, including those related to data privacy or data transfer, international communications, or export of data (collectively, “Laws”), or the Agreement.

This restriction makes the absence of a documented, independently authorized
gateway contract material. It does not establish that a particular gateway
flow is a non-public API or decide whether Zed would authorize one. This remains
a documentation gap, not a determination that Zed forbids such access.

The pinned OmniRoute [registry entry](https://github.com/cheaper-inference/OmniRoute/blob/4624250231f49ed118fb4522a9d735e4894322c6/open-sse/config/providers/registry/zed-hosted/index.ts)
defines a distinct `zed-hosted` identity, an empty live-discovered catalog, and
`cloud.zed.dev` endpoints. Its [auth helper](https://github.com/cheaper-inference/OmniRoute/blob/4624250231f49ed118fb4522a9d735e4894322c6/open-sse/shared/zedAuth.ts)
implements a generated RSA keypair and native-app sign-in followed by a hosted
LLM token exchange. Its [executor](https://github.com/cheaper-inference/OmniRoute/blob/4624250231f49ed118fb4522a9d735e4894322c6/open-sse/executors/zed-hosted.ts)
composes provider-specific request and response translations over a streaming
completion endpoint. These exact three paths were confirmed in the pinned
source commit above. The existence of that implementation does not establish
Zed's authorization for a separate gateway to use the native-client flow.

DurinDoor's existing `zed` / `zd` entry is hidden import metadata with no
transport or models; it is not Zed-hosted inference. Neither reviewed DurinDoor
revision registers a `zed-hosted` connection. Existing provider-owned API keys
remain the supported BYOK path; Zed's API access guide documents keys issued by
providers for Zed-owned AI features. No documented operator-authorized
hosted-model dispatch credential or independent gateway authentication
contract was identified in the public documentation reviewed. An operator
therefore has no documented contract here for authorizing DurinDoor to dispatch
through a Zed-hosted account. Obtain first-party documentation or authorization
covering independent gateway authentication, model discovery, and inference
before implementing a hosted connection or its lifecycle. This review used
public documentation only; it did not access Zed accounts, APIs, or credentials.
