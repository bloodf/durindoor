# 1073: model scope for empty Grok payment errors

## Source

[OmniRoute #20461](https://github.com/cheaper-inference/OmniRoute/pull/20461), `fix(sse): stop an empty grok 402 from parking the whole connection`, inspected 2026-11-20 at head `d67892c0c274a8254d97c019a3758bc6dfd0632c` (open, non-draft, mergeable; observed checks green; no unresolved review threads).

Exact change: in upstream `open-sse/services/accountFallback/sharedWalletCredits.ts`, `isSharedWalletCredits402` returned `true` for an empty or blank body from `grok-cli`, `grok-web` and `xai-oauth`. The PR returns `false` there, so only a 402 carrying the usage-balance signal is a shared-wallet credit exhaustion and an empty 402 takes the ordinary per-model path. The rest of the diff is test and changelog updates.

## Disposition: no code port needed

The upstream defect cannot occur here. The structure it modifies does not exist in DurinDoor, and the behavior it moves toward is already the current behavior.

Local evidence (current checkout):

- There is no shared-wallet classifier and no `xai-oauth` provider. `rg -i "shared.?wallet|xai-oauth|credits_exhausted"` finds no runtime code, apart from a comment in `open-sse/config/upstreamStatusRestatement.js`. The Grok routes present are `grok-cli` (alias `gb`), `grok-web` and `xai` (`open-sse/providers/registry/`). All three set `passthroughModels: true`; none sets `passthroughConnectionWideErrors`.
- Classification: `checkFallbackError` in `open-sse/services/accountFallback.js` has no Grok-specific 402 rule. An empty 402 falls through to the generic `{ status: 402, cooldownMs: long, terminal: true }` rule in `open-sse/config/errorConfig.js`, returning `scope: null` (not `"connection"`).
- Scope: `markAccountUnavailable` (`src/sse/services/auth.js`) sets `accountWide` only for GitHub reset hints, runtime 429 exhaustion, opt-in passthrough connection errors, or a provider rule with `scope: "connection"`. None applies to a 402, so `resolveFallbackModelScope` (`open-sse/services/fallbackScope.js`) resolves the catalog model id and the lock is `modelLock_<model>`.
- Persistence: `recordProviderConnectionFallbackState` (`src/lib/db/repos/connectionsRepo.js`) writes only that model's lock key and version stamp, plus the same `testStatus: "unavailable"`, `errorCode` and `lastError` fields every provider failure already records. Nothing writes a `credits_exhausted` state for these routes, and sibling catalog models on the connection stay selectable.
- Uncatalogued model strings collapse to the existing bounded `modelLock___all` key by design (`boundedModelScope`), so request-chosen strings cannot create durable keys. This is unchanged and not specific to 402 or Grok.
- Explicit credit-balance evidence: bodies such as "Your credit balance is too low" or "insufficient credits" already match the terminal text rules in `errorConfig.js` and are listed in `CREDITS_EXHAUSTED_SIGNALS` (`open-sse/services/fakeSuccessBodyClassifier.js`). Locally they receive the same long terminal cooldown and the same model scope as an empty 402. An empty body matches no signal. The two are distinguishable by evidence, but policy does not differ.
- Combo: `open-sse/services/combo.js` treats 402 as a failed member (quota-weighted score) and advances to the next member; an empty 402 does not end the request.
- `grok-cli` `parseError` (`open-sse/executors/grok-cli.js`) returns the base parse for an empty body and extracts `code`/`message` only from a JSON 402 body.

## Not ported

- The shared-wallet module, the `xai-oauth` provider and its sign-in, and the usage-balance signal matcher: they have no counterpart here and upstream's architecture is out of scope.
- Any change to cooldown length, currency/charging handling, quota display, or eligibility. A 402 remains terminal with the long cooldown; the existing per-model scope is left as is.

## Protection added

`tests/unit/omni-grok-empty-payment-model-scope.test.js` runs offline against a temp `DATA_DIR` database with no network:

- `checkFallbackError` classifies empty, blank, `null` and `undefined` 402 bodies on `grok-cli`, `grok-web` and `xai` as terminal with `scope: null` and no exhaustion evidence; an explicit credit-balance body is distinguishable by signal but has the same cooldown and scope.
- Real `markAccountUnavailable` persistence for an empty body, an ordinary mocked payment body and an explicit credit-balance body: only `modelLock_<failing model>` is written, no `modelLock___all`, a sibling catalog model stays unlocked, and `testStatus` is not `credits_exhausted`.
- An uncatalogued model string yields only the bounded `modelLock___all` key.
- `handleComboChat` advances through consecutive empty 402 members to a successful one.

Verification limits: offline mocked responses only. No live provider, credential, paid API, browser or full-suite run was performed.
