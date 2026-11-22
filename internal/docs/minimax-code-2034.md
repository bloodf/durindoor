# MiniMax Code account inference investigation (#2034)

Status: staged behind a guard; no MiniMax Code provider is registered. The owner's work
order for #2034 builds it with mocked-contract tests instead of leaving it blocked: see
`docs/providers/minimax-code.mdx`, `open-sse/providers/private/minimax-code.js` and
`tests/unit/minimax-code-provider.test.js`. The authorization question below is not
resolved by that work, which is why dispatch stays off unless a connection sets
`providerSpecificData.enableSessionDispatch === true`. This is a source review, not a
live account test or a claim that MiniMax cannot support another client.

## Pinned evidence

- [First-party OAuth endpoints at 3c21163c](https://github.com/MiniMax-AI/minimax-code/blob/3c21163c85a9684030cb147bfef48c6284fa3c46/packages/oauth-core/src/endpoint-config.ts) select production account origins `https://account.minimax.io` (en) and `https://account.minimax.cn` (cn), with `/oauth2/device/code`, `/oauth2/token`, and `/oauth2/revoke`.
- [First-party OAuth contracts](https://github.com/MiniMax-AI/minimax-code/blob/3c21163c85a9684030cb147bfef48c6284fa3c46/packages/oauth-core/src/contracts.ts) bind the MiniMax Code client `mcode-public` to scope `agent.default` and audience `agent-backend`. The [OAuth core README](https://github.com/MiniMax-AI/minimax-code/blob/3c21163c85a9684030cb147bfef48c6284fa3c46/packages/oauth-core/README.md) describes profile-isolated credentials and refresh. Public source alone does not establish authorization for DurinDoor to use this client binding.
- [OmniRoute's OAuth implementation](https://github.com/cheaper-inference/OmniRoute/blob/575c3d49c15b2ff444e39c83a6ee648f19a2923e/src/lib/oauth/providers/minimax-code.ts) uses device authorization with S256 PKCE. Its [gateway implementation](https://github.com/cheaper-inference/OmniRoute/blob/575c3d49c15b2ff444e39c83a6ee648f19a2923e/open-sse/executors/minimaxCodeGateway.ts) selects and rotates CLI profile records, and can try another record after refresh failure. It uses `https://agent.minimax.io/mavis/api/v1/llm/v1/messages` for Anthropic-shaped requests, including streaming. This demonstrates OmniRoute's implementation, not provider authorization for an independent client, a regional gateway contract, or an account-bound catalog.
- The [OmniRoute registry](https://github.com/cheaper-inference/OmniRoute/blob/575c3d49c15b2ff444e39c83a6ee648f19a2923e/open-sse/config/providers/registry/minimax-code/index.ts) lists `MiniMax-M3.1-Flash` and `MiniMax-M3`; static IDs are not evidence of authorization for a particular account or region. The [first-party catalog](https://github.com/MiniMax-AI/minimax-code/blob/3c21163c85a9684030cb147bfef48c6284fa3c46/packages/config/src/minimax-model-catalog.ts) is likewise not proof of a DurinDoor account entitlement.
- The [first-party lease protocol](https://github.com/MiniMax-AI/minimax-code/blob/3c21163c85a9684030cb147bfef48c6284fa3c46/packages/oauth-lease-protocol/README.md) describes short-lived leases from the host to its tool subprocesses. The [architecture](https://github.com/MiniMax-AI/minimax-code/blob/3c21163c85a9684030cb147bfef48c6284fa3c46/docs/architecture.md) describes that broker for tool integration, not an operator-managed, account-bound inference delegation interface for DurinDoor.

## Blocker and boundary

The reviewed sources do not establish a MiniMax-approved client binding and grant for DurinDoor, or a supported operator-managed inference sidecar/token lease with explicit account and region binding. They also do not establish the authorized per-account model catalog or a complete independently supported nonagent JSON/SSE inference contract. Until these are documented or granted by MiniMax, copying the MiniMax Code client binding or emulating its profile is not an approved native integration; the tool subprocess lease is not sufficient evidence for delegation.

The existing `minimax` and `minimax-cn` API-key and Token Plan routes remain separate. No CLI profile is read or modified. DurinDoor offers no MiniMax Code device login, refresh, account catalog, managed chat or SSE, account quota handling, or delegated connection. The requested mock lifecycle, account isolation, proxy and inference acceptance evidence therefore cannot yet be demonstrated. A future implementation needs a provider-approved binding or documented delegation, explicit account/region selection, encrypted connection storage, strict proxy and failure handling, and the full mock coverage before registration.
