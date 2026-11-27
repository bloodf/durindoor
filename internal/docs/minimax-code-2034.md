# MiniMax Code account inference investigation (#2034)

Status: registered behind a guard (registration batch D). The owner's work
order for #2034 builds it with mocked-contract tests instead of leaving it blocked: see
`docs/providers/minimax-code.mdx`, `open-sse/providers/registry/minimax-code.js` and
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

## Public guide provenance before main integration

- **The gateway is an internal MiniMax endpoint, not a published API.** `https://agent.minimax.io/mavis/api/v1/llm/v1/messages` comes from OmniRoute's reading of the MiniMax Code app. MiniMax does not document it for third-party clients, and it can change or be closed without notice. When that happens requests fail with the gateway's status.

DurinDoor applies the managed-gateway limits OmniRoute ships (`MINIMAX_CODE_*`), with the same names and defaults. They are read on every request, so a change takes effect without a restart. Set them in the environment of the DurinDoor process.

- The budgets and the single retry above are ported from OmniRoute's transport. Their defaults, including the 1000000 window and the 100000 ms call budget, come from that source and are not verified against a live gateway.

- OmniRoute's other `MINIMAX_CODE_*` settings (`MINIMAX_CODE_REGION`, `MINIMAX_CODE_AUTH_FILE`, `MINIMAX_CODE_PROFILE_DIR`, `MINIMAX_CODE_AUTH_RECORD`, `MINIMAX_CODE_GATEWAY_URL`) belong to its local `~/.minimax` profile and are not ported. Region and gateway URL are per-connection fields here.

- [MiniMax Code OAuth endpoints](https://github.com/MiniMax-AI/minimax-code/blob/3c21163c85a9684030cb147bfef48c6284fa3c46/packages/oauth-core/src/endpoint-config.ts): account origins and `/oauth2/device/code`, `/oauth2/token`, `/oauth2/revoke`

- [MiniMax Code OAuth contracts](https://github.com/MiniMax-AI/minimax-code/blob/3c21163c85a9684030cb147bfef48c6284fa3c46/packages/oauth-core/src/contracts.ts): `mcode-public`, `agent.default`, `agent-backend`

- [OmniRoute registry entry](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/config/providers/registry/minimax-code/index.ts)

- [OmniRoute device sign-in](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/src/lib/oauth/providers/minimax-code.ts)

- [OmniRoute executor](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/executors/minimax-code.ts)

- [OmniRoute gateway transport and refresh](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/executors/minimaxCodeGateway.ts)

- [OmniRoute provider page](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/docs/providers/MINIMAX_CODE.md)

## Accepted-work follow-up (Refs #2034)

The previous transport inherited an unsafe assumption: HTTP 500/503/529 meant
no work was done. Neither the pinned first-party sources above nor the pinned
OmniRoute gateway transport establishes a no-work/no-billing guarantee for those
statuses. A transport retry implementation is not such a guarantee. Until an
explicit primary-source contract supplies that evidence, all bare 5xx outcomes
are uncertain and terminal. No new vendor guarantee is asserted here.

MiniMax classification now precedes base operator retry overrides. Only 429 and
proven unsent DNS/connect failures retain automatic retry; token refresh follows
explicit authentication rejection. Unknown outcomes retain one error receipt on
the selected connection through the existing usage ledger, with null cost and
unknown cost/token/outcome provenance. Frozen numeric token columns use zero
placeholders, explicitly marked unmeasured; they are not successful usage or a
zero-cost assertion. Other providers and Codex quota handling are unchanged.

Focused coverage strengthens the obsolete bare-500/503/529 retry assertions,
keeps proven ECONNREFUSED fallback, and adds dropped/5xx uncertainty and operator
override cases. The real handleChat/two-account SQLite tests assert the receipt,
selected connection, unknown provenance and absence of sibling replay.

Validation uses the explicitly supplied Node v24.22.3 path and existing dependency
links from the repository checkout after matching package manifests and lockfiles.
No installs, full suite, provider traffic or real account data were used. The first
focused run passed 95/96 tests; the old overloaded-error-to-429 assertion failed
because overload is now uncertain. That assertion is strengthened to require the
unknown-outcome code and a nonempty bounded public message. The pinned sources
above supply no no-work guarantee for that error either.

The combo executor also honors the terminal response marker before fallback and
awaits MiniMax cancellation at its own deadline, so the race cannot start another
model before uncertainty is recorded. Added mock cases cover combo terminality,
whole-call deadline and dispatched cancellation. `git diff --check` passes.
The parent supplied the repository author identity for command-scoped Git variables;
no global configuration or real-home configuration was read or copied.

Focused rerun: **96 tests passed in 3 files** (17.58 s), using at most two
workers, with the explicit private environment and no installs:

```sh
cd tests
node node_modules/vitest/vitest.mjs run unit/minimax-code-budget.test.js unit/provider-signin-minimax-code-parity.test.js unit/minimax-code-provider.test.js --maxWorkers=2 --silent
```

`node --check` passed for the modified executor, base, chat core, combo and two
initially modified test files. `git diff --check` passes. Full local CI and
independent review remain the orchestrator gate's responsibility.
