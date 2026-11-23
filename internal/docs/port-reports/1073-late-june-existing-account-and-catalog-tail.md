# #1073 late-June existing account and catalog tail

## Scope and pins

Four pinned OmniRoute PRs were compared against the current DurinDoor quota-observation path, the retired-model and retired-provider catalog surfaces, and the account-state handling for billing failures. This is a documentation audit only: no product code, tests, workflows, credential access, live provider traffic, paid APIs, browser, Docker or e2e were used.

| PR | Exact PR head | Enclosing merge | Patch base | Public patch |
| --- | --- | --- | --- | --- |
| [OmniRoute #4492](https://github.com/cheaper-inference/OmniRoute/pull/4492) | [`b12c80fa0c8cbed7b70e659ea11195d4e11a252c`](https://github.com/cheaper-inference/OmniRoute/commit/b12c80fa0c8cbed7b70e659ea11195d4e11a252c) | [`b28f6e93464f8a626c29ead13203984e7f073be2`](https://github.com/cheaper-inference/OmniRoute/commit/b28f6e93464f8a626c29ead13203984e7f073be2) | `aa019bbb95d1f635929739be445f14835ab5dd9a` | [head diff](https://github.com/cheaper-inference/OmniRoute/commit/b12c80fa0c8cbed7b70e659ea11195d4e11a252c) |
| [OmniRoute #5280](https://github.com/cheaper-inference/OmniRoute/pull/5280) | [`994ad8ec7ccff79c36caf945839cd8fcf5248461`](https://github.com/cheaper-inference/OmniRoute/commit/994ad8ec7ccff79c36caf945839cd8fcf5248461) | [`f5445a2e5e368b64563de5f56fc99b1f9c0d3246`](https://github.com/cheaper-inference/OmniRoute/commit/f5445a2e5e368b64563de5f56fc99b1f9c0d3246) | `ba38e31ff43dbc8856ee73e2dae2d67b0e48eb3e` | [head diff](https://github.com/cheaper-inference/OmniRoute/commit/994ad8ec7ccff79c36caf945839cd8fcf5248461) |
| [OmniRoute #5346](https://github.com/cheaper-inference/OmniRoute/pull/5346) | [`a94ec710bff3216e8cd37ba196f88fa35d3807bf`](https://github.com/cheaper-inference/OmniRoute/commit/a94ec710bff3216e8cd37ba196f88fa35d3807bf) | [`c06bf68ac13602d98937693c1e061d43ad5d3e83`](https://github.com/cheaper-inference/OmniRoute/commit/c06bf68ac13602d98937693c1e061d43ad5d3e83) | `890ca5a40c99070d203aa5d878d88f31a4d2d4d0` | [head diff](https://github.com/cheaper-inference/OmniRoute/commit/a94ec710bff3216e8cd37ba196f88fa35d3807bf) |
| [OmniRoute #5530](https://github.com/cheaper-inference/OmniRoute/pull/5530) | [`17ddc9674806d880c2931290d5079dd7c081fd72`](https://github.com/cheaper-inference/OmniRoute/commit/17ddc9674806d880c2931290d5079dd7c081fd72) | [`2ce25e7da8d281c2833cb7d6cbff17eda190e202`](https://github.com/cheaper-inference/OmniRoute/commit/2ce25e7da8d281c2833cb7d6cbff17eda190e202) | `b09875d3b370638852c2323fe632c2851792a0f9` | [head diff](https://github.com/cheaper-inference/OmniRoute/commit/17ddc9674806d880c2931290d5079dd7c081fd72) |

### Patch-base note

Every enclosing merge in this window is a single-parent commit whose own first-parent diff is patch-id identical to its PR head's diff, so no unrelated PR content rides along in any of the four merges and the head diff is the exact public patch for each PR.

- #4492, #5346 and #5530: the merge's first parent is the head's own parent, so the merge tree reproduces the head patch on the identical base.
- #5280 is the one case where the merge's first parent (`f8620742095f97c91f2896f3f65e7d48990a5e8e`) is *not* the head's parent (`ba38e31ff43dbc8856ee73e2dae2d67b0e48eb3e`). The head's base is an ancestor of the merge's base, so the release-branch content between them is what makes a naive `head-base..merge` comparison look like a 297-file patch. That content is release-branch material, not PR content: the merge's own first-parent diff touches exactly the same eight files as the head diff, and seven of the eight resulting files are byte-identical between the head tree and the merge tree. The eighth, `docs/guides/USER_GUIDE.md`, differs only in its `version` / `lastUpdated` front matter; the model-list content the PR changes is identical. The head diff is therefore the exact public patch.

The audit separates four kinds of upstream change, which must not be dispositioned as one:

- a **structural extraction** that moves code without changing behavior (#4492);
- a **retired catalog entry** that is already absent from the local catalogs (#5280);
- a **nonexistent provider id** whose removal is a no-op in this fork (#5530);
- a **new automatic disable control** that adds state the fork does not have (#5346's per-key terminal disable), whose sibling signal rule is a proven compatibility fix that the fork already carries.

## Current local behavior

### Ordinary quota observation (Codex)

DurinDoor observes Codex quota with a dedicated quota fetcher, not from the headers of an in-flight chat turn.

- The quota source is [`open-sse/services/quota/providers/codex.js`](../../../open-sse/services/quota/providers/codex.js). It reads the Codex usage payload's `rate_limit.primary_window` / `secondary_window` shape and normalizes each window through `quotaPercent` on `used_percent` ([`codex.js`](../../../open-sse/services/quota/providers/codex.js)) and [`classifyCodexQuotaWindow`](../../../open-sse/shared/codexQuotaWindow.js). [`fetchCodexQuota`](../../../open-sse/services/quota/providers/codex.js) is the entry point.
- The display path is separate and equally header-free: [`appendCodexQuotaWindows`](../../../open-sse/services/usage/codex.js) maps the same primary/secondary windows into per-plan, per-review and per-spark rows.
- Persisted quota state lands in the `providerQuotaSnapshots` table ([`quotaSnapshotsRepo.js`](../../../src/lib/db/repos/quotaSnapshotsRepo.js)), not in the provider connection's `providerSpecificData` blob, and it is pruned by the ordinary retention runner ([`runner.js`](../../../src/lib/dataRetention/runner.js)).
- The fork's persisted-data policy for provider connections is a single JSON `data` column ([`schema.js`](../../../src/lib/db/schema.js)); quota *observations* are a separate store owned by the quota repositories, and quota *exhaustion* state is owned by the quota preflight rather than by a field written during a chat turn.

There is no `providerSpecificData.codexQuotaState`, no `codexScopeRateLimitedUntil` and no `codexExhaustedWindow` anywhere in the tree. The local equivalents of the upstream per-scope cooldown are the catalog-declared quota family and model scope ([`providerQuota.js`](../../../open-sse/config/providerQuota.js)) and the account layer's `modelLock_<scope>` field, whose scope is the canonical catalog model id — effort-suffixed variants such as `gpt-5.3-codex-xhigh` collapse onto their catalog model ([`fallbackScope.js`](../../../open-sse/services/fallbackScope.js), [`providerModels.js`](../../../open-sse/config/providerModels.js)) — rather than a hardcoded Codex scope table.

### Catalog retirement and provider identity

DurinDoor's provider catalog is derived from the registry, and its retirement policy is deliberately different from upstream's delete-the-entry policy.

- The dashboard catalogs are built from registry entries by their `category` field ([`src/shared/constants/providers.js`](../../../src/shared/constants/providers.js)), so `APIKEY_PROVIDERS`, `WEB_COOKIE_PROVIDERS`, `OAUTH_PROVIDERS` and the free categories are disjoint views of one registry. A provider id therefore lands in exactly one catalog by construction.
- The fork does not delete a provider's registry file to retire it. The documented states are *hidden*, *risk notice*, and *not runnable yet*, and existing connections are left alone ([`internal/docs/product/providers/retired.mdx`](../product/providers/retired.mdx)).
- Models retire differently from providers: a catalog model past its shutdown date is rejected at request time with HTTP 410 `model_shutdown`, driven by the provider-scoped records in [`open-sse/services/modelLifecycle.js`](../../../open-sse/services/modelLifecycle.js).

The two catalogs touched by these PRs are:

- [`open-sse/providers/registry/chatgpt-web.js`](../../../open-sse/providers/registry/chatgpt-web.js) advertises `gpt-6*`, `gpt-5-6*` and `gpt-5-5*` lanes. It carries none of `gpt-5.2-pro`, `gpt-5.2-thinking`, `gpt-5.2-instant` or `gpt-4-5`.
- [`open-sse/providers/registry/codex.js`](../../../open-sse/providers/registry/codex.js) advertises `gpt-6.2-*`, `gpt-6-*`, `gpt-5.6-*`, `gpt-5.4*` and `gpt-5.3-codex*`. It carries no `gpt-5.2`.
- The ChatGPT-web backend slug map lives in [`open-sse/executors/chatgpt-web/models.js`](../../../open-sse/executors/chatgpt-web/models.js). It resolves the registry ids through [`REGISTRY_MODEL_ALIASES`](../../../open-sse/executors/chatgpt-web/models.js) and then [`resolveChatGptModel`](../../../open-sse/executors/chatgpt-web/models.js). It holds no `gpt-5.2*`, `gpt-5-1`, `gpt-5` or `gpt-5-mini` slug.
- The Codex effort model has no per-model table to prune: effort is parsed from the model-id suffix by [`splitCodexEffortSuffix`](../../../open-sse/executors/codex.js), so an unlisted model keeps whatever suffix it carries.
- The dashboard's Codex tool card (`CodexToolCard.js`) has no hardcoded model suggestion list. It is a free-text model input plus a picker fed by `/api/models/alias`, so there is no static list to prune.

The generic `openai` catalog is deliberately left intact locally as well: [`open-sse/providers/registry/openai.js`](../../../open-sse/providers/registry/openai.js) still lists `gpt-5.2`, `gpt-5.2-pro`, `gpt-5`, `gpt-5-mini` and the dated snapshots, and third-party routes keep their own copies (`cursor`, `github`, `opencode-zen`, `trae`, `windsurf`, `freeaiapikey`). That matches upstream's stated intent in #5280, and the fork adds a runtime gate on top: `gpt-5.2-codex` is a recorded shutdown, so a request for it is refused with 410 before the executor is dispatched.

### Account state on billing failures

The fork's failure-state unit is the provider **connection**, not the API key.

- A connection stores one credential. [`projectProviderCredentials`](../../../src/sse/services/auth.js) projects a stored row into a single `apiKey` / `accessToken`; the table has no per-key columns ([`schema.js`](../../../src/lib/db/schema.js)). There is no `apiKeyHealth` map, no `extraApiKeys` round-robin list, and no per-key rotator anywhere in the tree. The one `extraApiKeys` read in the tree is a cookie-header aggregation for a single provider ([`open-sse/executors/muse-spark-web.js`](../../../open-sse/executors/muse-spark-web.js)), not key rotation.
- HTTP 402 is already classified as a billing error ([`errorConfig.js`](../../../open-sse/config/errorConfig.js)) and as a **terminal** cooldown rule ([`errorConfig.js`](../../../open-sse/config/errorConfig.js)), where `COOLDOWN.long` is 120 s ([`errorConfig.js`](../../../open-sse/config/errorConfig.js)). Terminal billing text rules cover `"insufficient balance"` ([`errorConfig.js`](../../../open-sse/config/errorConfig.js)), `"insufficient credit"` and `"credit balance is too low"` ([`errorConfig.js`](../../../open-sse/config/errorConfig.js)).
- `terminal` in this fork means "retrying cannot fix this": the account is still benched and the request still rotates to a sibling account, but no client-facing `Retry-After` is advertised ([`accountFallback.js`](../../../open-sse/services/accountFallback.js)).
- The out-of-credit body signals upstream #5346 adds are already present, in a superset form, in the fork's `CREDITS_EXHAUSTED_SIGNALS` ([`fakeSuccessBodyClassifier.js`](../../../open-sse/services/fakeSuccessBodyClassifier.js)): it already contains `insufficient balance`, `insufficient_balance`, `insufficient account balance`, `insufficient credit balance`, `insufficient credits` and `insufficient credit`.
- The single owner of persisted failure state is the atomic writer [`recordProviderConnectionFallbackState`](../../../src/lib/db/repos/connectionsRepo.js). It rejects any cooldown outside 0..7 days ([`connectionsRepo.js`](../../../src/lib/db/repos/connectionsRepo.js)), writes the `modelLock_<scope>` field, the availability marker and the stored reason under one transaction, and refuses to demote a durable reauth.
- Durable quarantine exists, but only where it is already owned: a permanent Codex OAuth invalidation sets `testStatus: "reauth_required"` and `isActive: false` ([`auth.js`](../../../src/sse/services/auth.js)). A generic 402 does not reach that path — it produces the terminal cooldown and nothing more.

## Fixture evidence

All of these are ordinary offline fixtures: mocked fetches, synthetic bodies and in-memory databases. No credentials, no provider traffic, no live quota access.

- [`tests/unit/provider-quota-fetchers.test.js`](../../../tests/unit/provider-quota-fetchers.test.js) exercises the Codex quota fetcher against mocked payloads.
- [`tests/unit/provider-quota-normalizers.test.js`](../../../tests/unit/provider-quota-normalizers.test.js) and [`tests/unit/quota-snapshot-repository.test.js`](../../../tests/unit/quota-snapshot-repository.test.js) pin the quota window classification, the persisted snapshot shape and the timestamp rules that the Codex quota rows depend on.
- [`tests/unit/codex-spark-quota-shapes.test.js`](../../../tests/unit/codex-spark-quota-shapes.test.js) pins the Codex spark window shapes, and [`tests/unit/chatcore-quota-reservation.test.js`](../../../tests/unit/chatcore-quota-reservation.test.js) pins the reservation ledger that the quota observation feeds.
- [`tests/unit/chatcore-model-lifecycle.test.js`](../../../tests/unit/chatcore-model-lifecycle.test.js) pins the runtime retirement gate: a shutdown model is refused with HTTP 410 `model_shutdown` before the executor is dispatched, and the request is never forwarded.
- [`tests/unit/port9r-retired-model-catalog-5781.test.js`](../../../tests/unit/port9r-retired-model-catalog-5781.test.js) pins the catalog-retirement policy this fork actually uses: retired direct ids are absent from the direct provider catalogs while third-party routes (OpenRouter, Kilocode) keep theirs.
- [`tests/unit/fleet-provider-chatgpt-web-codex-acceptance.test.js`](../../../tests/unit/fleet-provider-chatgpt-web-codex-acceptance.test.js) pins the two catalogs as distinct identities with disjoint model sets and distinct executors.
- [`tests/unit/chatgpt-web-http-models-split.test.js`](../../../tests/unit/chatgpt-web-http-models-split.test.js) and [`tests/unit/chatgpt-web-http-max-thinking-effort.test.js`](../../../tests/unit/chatgpt-web-http-max-thinking-effort.test.js) pin the ChatGPT-web slug map and the effort resolution that the catalog ids resolve through.
- [`tests/unit/omniroute-provider-icons.test.js`](../../../tests/unit/omniroute-provider-icons.test.js) pins the provider-icon wiring invariant in the direction that matters here: every *registered* id must be in `KNOWN_SVGS`.
- [`tests/unit/provider-cookie-import-contracts.test.js`](../../../tests/unit/provider-cookie-import-contracts.test.js) pins the exact set of `webCookie` registry ids, which is the local proof that the web-cookie catalog is a registry view rather than a second hand-maintained list.
- [`tests/unit/omniroute-simple-providers-b1e.test.js`](../../../tests/unit/omniroute-simple-providers-b1e.test.js) and its sibling files pin that every registry id stays unique.

## Dispositions

### #4492 — structural extraction, no local counterpart, no port

The exact patch moves the body of `persistCodexQuotaState` out of `open-sse/handlers/chatCore.ts` into a new pure leaf `open-sse/handlers/chatCore/codexQuota.ts` and adds a characterization test. The upstream commit states the handler keeps its impure parts byte-identical: the same log emission, the same cache invalidation on every 429, the same `updateProviderConnection` write and the same credentials mutation, in the same order. The patch changes no observable behavior; it only relocates code and adds a unit test.

DurinDoor has no `persistCodexQuotaState`, no `chatCore/codexQuota` module, and no codex quota header parsing. There is nothing to extract and nothing that the patch's behavior describes: the fork's Codex quota observation is a dedicated fetcher over the Codex usage payload, persisted to the quota snapshot store, and its 429 handling is the account layer's cooldown rather than a per-scope timestamp written into `providerSpecificData`.

**Disposition: no port.** This is a source-side structural extraction with no local counterpart and no behavior delta. Nothing in the fork is changed, and no compatibility fix is claimed.

### #5280 — retired catalog entries already absent locally; no port

The exact patch drops retired models from the ChatGPT-web registry (`gpt-5.2-pro`, `gpt-5.2-thinking`, `gpt-5.2-instant`, `gpt-4-5`), from the ChatGPT-web slug map (`gpt-5.2*`, `gpt-5.1`, `gpt-5`, `gpt-5-mini`), from the Codex registry (`gpt-5.2`), from the Codex per-model effort table (`gpt-5.2-codex`), and from the dashboard's Codex model suggestion list; it also updates the user guide and swaps two retired sample models in the upstream tests. Upstream states the intent explicitly: the third-party proxies that still route these models and the generic `openai` catalog are intentionally left untouched.

Every retired id is already absent from the corresponding local surface, and the surfaces that upstream edited structurally do not exist locally in the shape it edited:

- the ChatGPT-web registry and slug map carry no retired id at all, so the catalog and the slug map cannot drift apart for these models;
- the Codex registry carries no `gpt-5.2`;
- the Codex effort model has no per-model table, so there is no `gpt-5.2-codex` entry to remove — an unlisted model keeps the effort encoded in its own id;
- the dashboard Codex tool card has no static model list to prune.

The fork is also stricter than the patch in the one place where a retired model could still be requested: the lifecycle table records `gpt-5.2-codex` as a shutdown under the `openai` provider scope ([`modelLifecycle.js`](../../../open-sse/services/modelLifecycle.js)), and the decision is keyed on provider and model together ([`modelLifecycle.js`](../../../open-sse/services/modelLifecycle.js)), so such a request is refused with 410 before dispatch rather than merely being absent from a catalog. The generic `openai` catalog and the third-party routes keep their copies, matching the upstream intent.

**Disposition: already covered; no port.** The retired ids are absent from both local catalogs, the local retirement gate additionally rejects them at runtime, and the shared vendor-capability and third-party catalogs are left intact exactly as upstream chose to leave them.

### #5346 — split: signal half already covered; automatic-disable half is a new control this fork does not have

The exact patch has two components.

**Component (a) — the out-of-credit body signals.** It adds `insufficient balance`, `insufficient_balance` and `insufficient account balance` to the upstream credits-exhausted signal list. DurinDoor already carries all three, in a superset that also includes `insufficient credit balance`, `insufficient credits` and `insufficient credit` ([`fakeSuccessBodyClassifier.js`](../../../open-sse/services/fakeSuccessBodyClassifier.js)). The fork additionally treats the HTTP status itself as terminal ([`errorConfig.js`](../../../open-sse/config/errorConfig.js)), so a bare 402 with no recognizable body text is still a terminal billing failure rather than a transient retry.

**Component (b) — the per-key terminal disable.** It adds `recordKeyTerminal` to the upstream key rotator, a 402 branch in the key-health handler that marks the current key invalid in one shot and persists `apiKeyHealth` into the connection's `providerSpecificData`, and a regression test asserting that the rotator then skips the depleted key and falls through to a healthy sibling. Upstream's own commit describes this as closing a *per-key* gap on an "API Key Round-Robin connection" that carries several keys in `providerSpecificData.extraApiKeys`.

DurinDoor has no per-key rotation to disable. A provider connection holds one credential, the fork's failure-state unit is the connection, and there is no `apiKeyHealth` map and no rotator. Porting component (b) would therefore mean introducing a per-key rotation feature and a second persisted account-state store inside `providerSpecificData`, alongside the atomic connection writer that is the fork's single owner of failure state. That is new state and a new owner, not a compatibility fix, and it conflicts with the local persisted-data policy in which connection failure state is written by one bounded transaction.

The local equivalent of the *intent* — a depleted balance must stop being retried — is a terminal, non-backoff cooldown on the connection, persisted through the atomic writer and therefore surviving a restart.

**Disposition: component (a) already covered, no port. Component (b) is a new automatic disable control and is not ported.** It is recorded as an upstream-only control rather than a compatibility gap, and it is not proposed as a port: doing so would add a rotation feature and a second owner of account state that the fork does not have and has not asked for.

### #5530 — nonexistent provider id and a structurally impossible duplicate; no port

The exact patch has two halves.

**Half 1 — Phind removal.** The upstream service shut down on 2026-01-16, so the patch deletes the Phind registry entry, its executor and its aliases, both catalog entries, the web-session credential profile, the arena-elo prefix, the lobe icon, and seventeen i18n message keys.

Phind was never ported into DurinDoor. There is no `open-sse/providers/registry/phind.js`, no `open-sse/executors/phind.js`, no Phind import in the registry index, no Phind entry in the API-key or web-cookie catalogs, no web-session credential profile, no arena-elo prefix, no i18n key and no product-document mention. The only occurrences of `phind` in the tree are port-report prose and the cosmetic residue described below. Deleting a provider that does not exist is a no-op, and it is also consistent with the fork's provider-ownership policy, which never deletes a registry file to retire a provider ([`internal/docs/product/providers/retired.mdx`](../product/providers/retired.mdx)).

**Half 2 — the HuggingChat catalog duplicate.** Upstream had `huggingchat` listed in both the web-cookie and the API-key catalogs, which rendered a self-contradictory "no API key required" card in the API-key section; the API-key counterpart is the separate `huggingface` Inference API id.

This fork cannot hold that duplicate. The catalogs are projections of one registry keyed by `category` ([`src/shared/constants/providers.js`](../../../src/shared/constants/providers.js)), and `huggingchat` is a web-cookie provider (`category: "webCookie"`, `authType: "cookie"`, [`huggingchat.js`](../../../open-sse/providers/registry/huggingchat.js)) while the API-key path is the distinct `huggingface` id (`category: "apikey"`, [`huggingface.js`](../../../open-sse/providers/registry/huggingface.js)). One id, one category, one catalog entry. The upstream regression test for the duplicate has no local analogue because the invariant it asserts is structural here.

**Bounded residue.** One inert trace of the upstream provider survives: the icon map in [`ProviderLogo.jsx`](../../../src/shared/ui/components/ProviderLogo.jsx) still carries a `"phind": "svg"` entry, and the inherited asset `public/providers/phind.svg` is still shipped. The key is unreachable — no registry entry has the id `phind`, `phind` is not in `KNOWN_SVGS`, and the icon map is read by provider id — so it renders nothing and affects no request. It is also not a violation of the existing icon fixture, which asserts the registry-id → `KNOWN_SVGS` direction only. This is a cosmetic leftover, not a behavior difference; it is recorded rather than removed, because removing it is a product edit.

**Disposition: no port.** Both halves of the upstream patch are already the local state: the provider id does not exist here, and the duplicate-catalog condition the patch fixes is structurally impossible in this fork.

## Acceptance

No product or test change is proposed by this report. #4492, #5280 and #5530 are no-port rows, and the signal half of #5346 is already covered.

One narrow gap is demonstrated, and it is stated here with ordinary offline acceptance rather than a patch.

### The demonstrated narrow gap: no durable out-of-credit state for a 402

Upstream #5346's outcome for a depleted key is durable: the key is marked invalid immediately and stays out of rotation until an operator resets it. DurinDoor's outcome for the same upstream 402 is a terminal cooldown of 120 s on the connection ([`errorConfig.js`](../../../open-sse/config/errorConfig.js)), persisted as a `modelLock_<scope>` deadline by the atomic writer ([`connectionsRepo.js`](../../../src/lib/db/repos/connectionsRepo.js)). The connection is excluded from selection only until that deadline passes. There is no durable "this account is out of credit" state for a generic 402: the connection becomes selectable again after the cooldown expires, and each re-selection spends another request against a balance that will not recover mid-session.

The existing durable-quarantine mechanism is narrower than the upstream remedy: it is reached only by a permanent Codex OAuth invalidation and by durable-credential providers ([`auth.js`](../../../src/sse/services/auth.js)), and it is expressed as `testStatus: "reauth_required"` with `isActive: false`, which `clearAccountError` does not clear.

Ordinary offline acceptance for that gap, should the owner approve closing it, is a connection-level test with synthetic bodies and no provider traffic:

- A 402 billing response must leave the connection in a **durable** out-of-credit state that survives a restart, so the account is not re-selected on the next request; today the acceptance would show it is re-selected once the 120 s cooldown expires.
- The durable state must clear only when the operator replaces the credential or explicitly clears the account error, exactly like the existing durable-reauth path, and it must not be cleared by a later successful request from the same connection.
- A 402 must still rotate to a sibling account when one exists, and the terminal classification must keep withholding the client-facing `Retry-After`.
- The atomic writer must remain the only writer of the new state, the cooldown bound must stay inside 0..7 days, and the new state must not demote an existing durable reauth.
- The body-signal path must stay covered independently of the status path, so a non-402 out-of-credit body is still recognized.

The remedy would be a connection-level durable billing-quarantine owned by the existing atomic writer, deliberately *not* a per-key rotator: adding per-key health would introduce a rotation feature and a second owner of account state that the fork does not have, and would conflict with the persisted-data policy in which connection failure state is written by one bounded transaction. This is recorded for the owner; it is not implemented, and no product code, test, or workflow was changed by this report.
