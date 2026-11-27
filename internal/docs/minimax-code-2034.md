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

The earlier transport assumed that HTTP 500, 503 and 529 meant the gateway did
no work. Neither the pinned first-party sources above nor the pinned OmniRoute
gateway transport documents a no-work or no-billing refusal for those statuses.
A retry in OmniRoute's transport is a design choice, not a vendor guarantee. With
no explicit primary-source refusal evidence, every bare 5xx is an unknown outcome.
This change asserts no new vendor guarantee.

Behavior (MiniMax Code only; other providers and Codex quota handling unchanged):

- **Retry.** Only an explicit 429 and a transport error whose code proves the
  request never left (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `ENETUNREACH`,
  `EHOSTUNREACH`, `UND_ERR_CONNECT_TIMEOUT`, `ERR_PROXY_CONNECTION_FAILED`) are
  resent, on the same token, proxy route and caller signal. A 401 keeps its
  refresh path; other 4xx are not resent.
- **Unknown outcome.** Any 5xx (500, 502, 503, 504, 529), a 200 envelope with an
  overloaded or other server error, a connection lost after sending, the header
  deadline and the whole-call timeout are sent once and answered with
  `upstream_outcome_unknown` (or `gateway_timeout`) and a fixed, bounded public
  message. Gateway text is read only to classify and is never echoed.
- **Operator rules.** `computeRetryDelay` vetoes every HTTP retry except 429, and
  `execute()` drops non-429 `retry` rules from its own request policy before the
  base loop sees them. An operator rule therefore cannot resend a 5xx, network
  or header-deadline outcome. `skip` rules and `maxTransportAttempts` still apply.
- **Account, outer retry and combo.** `processAttemptResult` makes the outcome
  terminal (no sibling account, no outer transient retry, no cooldown). The combo
  loop returns it instead of trying the next model, and for MiniMax awaits the
  executor's own cancellation at the combo deadline instead of racing past it.
- **Receipt.** `chatCore` writes one `saveRequestUsage` row on the selected
  connection: `cost: null`, `costStatus: "unknown"`,
  `costSource: "minimax-unknown-outcome"`, `status: "error"`, and
  `meta.outcome`/`meta.tokenStatus` `"unknown"`. The zero token columns are
  frozen-schema placeholders, not measurements, and no success usage is
  reported. The receipt is keyed by the request's usage event id. A ledger error
  is logged and does not change the answer or trigger a resend. A client abort
  after dispatch also records the receipt; an abort during the unsent backoff
  does not, because nothing was sent.

### Test changes

Three existing files changed. The parent reviewed the changes and authorized
them as stronger contracts:

- `tests/unit/provider-signin-minimax-code-parity.test.js`: 500/503/529 moved
  from "replays a definite refusal" to "sends once, unknown outcome". The no-usage
  assertions now require exactly one durable unknown-cost receipt in SQLite on the
  connection whose token was sent. A 200 `api_error` envelope is unknown instead
  of `gateway_error`. New cases cover operator retry rules, combo no-advance,
  whole-call deadline and abort after dispatch. Every earlier scenario remains.
- `tests/unit/minimax-code-budget.test.js`: the retry-success, retry-then-surface,
  retry-count and backoff cases use 429 instead of 500/503. New cases cover
  500/503/529/502/504/drop single sends and operator `network`,
  `connect_timeout`, status and 429 rules.
- `tests/unit/minimax-code-provider.test.js`: a 200 `overloaded_error` envelope
  is now a 500 unknown outcome with a nonempty, bounded message instead of 429.

### Validation

The run used a private `HOME`, `DATA_DIR`, `TMPDIR`, XDG and npm/pnpm store
under `/var/tmp`, `env -i`, umask 077, no installs and no network. Dependencies
were linked read-only from a sibling worktree whose manifests and lockfiles match
byte for byte:

```sh
cd tests
node node_modules/vitest/vitest.mjs run unit/minimax-code-budget.test.js unit/provider-signin-minimax-code-parity.test.js unit/minimax-code-provider.test.js --maxWorkers=2
```

First run: 96/96 passed. In the second run, after the operator-rule cases were
added, 101/102 passed. The header-deadline case returned 500 `gateway_timeout`
because, with only `MINIMAX_CODE_RESPONSE_HEADERS_TIMEOUT_MS` set, the call
budget takes the same 40 ms value. The case now pins
`MINIMAX_CODE_GATEWAY_TIMEOUT_MS` so the header deadline is the only trigger.
The two-run limit left this change unrerun; the gate's suite must confirm it.
`node --check` and `git diff --check` pass.

### Gate 3 lint correction

Carried the three MiniMax follow-up commits through 8b7059b916 onto the
integration checkout. The abort catch now uses the existing isObject predicate
instead of a runtime typeof check, matching executor conventions. The truthiness
guard, unknown-outcome marker and original thrown abort remain intact. No retry,
receipt, combo or test architecture changed. The corrected header-deadline test
still sets a separate 5000 ms whole-call budget.

This checkout has no root or test node_modules. Under the required private
/var/tmp environment, the executor syntax check and git diff --check passed.
The focused three-file Vitest invocation could not start because Vitest is
absent; the anti-slop runner likewise reports missing oxlint. No dependencies
were installed and no full suite was run. The focused suite and lint gate still
require confirmation in the prepared gate checkout; earlier results above are
historical, not results for this head.
