# Open upstream PR ports: rows 41-80, port candidates 9-15

Source rows come from [the disposition report](open-prs-nov25-02.md). That report has 15 port-candidate rows, so the requested candidates 9-16 are these seven. Each PR's head and file diff were fetched again with `gh api`; every head matched the SHA in the source report. `git log --grep` found no earlier commit on this branch naming any of the seven numbers. A source comment already named #5350. No live provider call or credential was used.

| Row | PR | Head SHA | Final disposition | Evidence |
|---:|---|---|---|---|
| 58 | 9router #5518 | `c437a9ec5408f50ed595e5e25168f1a79547e0b2` | **ported in this change** (null effort); the rest already present | See [#5518](#5518-custom-responses-reasoning). |
| 61 | 9router #5490 | `ecf61fcde5b91d67f28a3436945187b0fc10e009` | **ported in this change** (connection test); the rest already present | See [#5490](#5490-keyless-compatible-endpoints). |
| 67 | 9router #5436 | `f475fe71babbbf10eccc1278b34e927c390ebb12` | **already present** | See [#5436](#5436-deepmerge-override). |
| 70 | 9router #5381 | `ae46e3c2712bdf52efeef7cadc53fe388c487dd9` | **already present** (lifecycle); wire fingerprint changes not ported | See [#5381](#5381-opencode-tls-lifecycle-and-wire-fingerprint). |
| 71 | 9router #5373 | `272669dd49dfe7b701fea65b663290142fc3d671` | **already present** | See [#5373](#5373-flux1-schnell-dimensions). |
| 75 | 9router #5350 | `c9f6db7e02367da74cb360506dc50b2fbcb983ac` | **already present** | See [#5350](#5350-flux2-reference-image). |
| 80 | 9router #5342 | `5676ba81b46d6ec2d481b56e36396316ea280314` | **ported in this change** (account fallback); client identity changes and dependent probes not ported | See [#5342](#5342-codebuddy). |

## #5518 custom Responses reasoning

The upstream test file was run against this tree before any change: 12 of 14 cases passed. Nested `reasoning.effort` for custom Responses nodes, and keeping the other `reasoning` fields, came in with `1a396376917` (#2055) in [thinkingUnified.js](../../../open-sse/translator/concerns/thinkingUnified.js). [custom-responses-reasoning-port.test.js](../../../tests/unit/custom-responses-reasoning-port.test.js) covers that.

- Ported: `reasoning_effort: null` produced `reasoning: { effort: null, summary: "auto" }`. [openai-responses.js](../../../open-sse/translator/request/openai-responses.js) now leaves `reasoning` alone. Test: [responses-null-reasoning-effort-port.test.js](../../../tests/unit/responses-null-reasoning-effort-port.test.js).
- Intentional difference: the other failing case expected `none` to omit `reasoning` for `openai.gpt-6-astra`. This tree's capability row says that model cannot disable reasoning, so it sends the `low` floor. Unchanged.

## #5490 keyless compatible endpoints

LAN compatible nodes (`f36660dae2c`, #2030) already made the key optional in [connection creation](../../../src/lib/providerRouteHandlers.js), [key validation](../../../src/app/api/providers/validate/route.js), [node validation](../../../src/app/api/provider-nodes/validate/route.js), [model discovery](../../../src/app/api/providers/[id]/models/fetchConnectionModels.js), [the public catalog](../../../src/shared/models/modelCatalogSources.js) and the add-key modal, <src/app/(dashboard)/dashboard/providers/[id]/AddApiKeyModal.js>. A probe of the default executor with an empty or missing key showed no credential header.

This tree also accepts an omitted key for compatible nodes, where upstream accepts only an explicit empty string. That existing behaviour is unchanged.

- Ported: the saved-connection test in [testUtils.js](../../../src/app/api/providers/[id]/test/testUtils.js) still sent `Bearer` with an empty or missing key, and an empty `x-api-key` for Anthropic-compatible nodes. It now sends neither. Test: [keyless-compatible-connection-test-port.test.js](../../../tests/unit/keyless-compatible-connection-test-port.test.js); four of its six cases failed before the fix.

## #5436 deepmerge override

[The root lockfile](../../../pnpm-lock.yaml) already resolves only `deepmerge@4.3.1`, which is what the PR's `^4.3.1` override selects there. `gh api advisories/GHSA-gcqx-w48m-w2h4` reports the advisory as withdrawn, with affected range `>= 4.2.0, <= 4.3.1` and no patched version, so a floor would change nothing. The PR also raises `next` to `^16.4.3`; this tree pins 16.4.5. Its `minimatch` and `eslint` edits are not part of the deepmerge row. This tree manages `minimatch` separately in [pnpm-workspace.yaml](../../../pnpm-workspace.yaml). It has no `gitbook/` package.

## #5381 OpenCode TLS lifecycle and wire fingerprint

Lifecycle behaviour is already present, in a different design:

- [opencodeTlsClient.js](../../../open-sse/services/opencodeTlsClient.js) creates no per-request sessions. It keeps one direct transport and at most 16 proxy transports, uses ephemeral cookies, cancels the live body on abort, and closes transports on reset. Proxy egress uses the same TLS transport.
- [The base executor](../../../open-sse/executors/base.js) already cancels discarded responses on retry and fallback.
- [opencode-tls-client.test.js](../../../tests/unit/opencode-tls-client.test.js) and [opencode-tls-executor.test.js](../../../tests/unit/opencode-tls-executor.test.js) pass.

Not ported: the new user agent and client name, generated project and request IDs, the related session-header and cache-key changes (including dropping `x-client-request-id` from OpenCode session derivation), and a new connection for each request, which the PR describes as stopping 429 limit states from carrying over. These exist to match the official client more closely and avoid the free tier's controls. [The #5776 report](1072-opencode-free-client-5776.md) already excludes expanding that behaviour. The PR's exact version pins edit `lazyRuntime.js`, which this tree does not have.

## #5373 FLUX.1 Schnell dimensions

[cloudflareAi.js](../../../open-sse/handlers/imageProviders/cloudflareAi.js) omits `width` and `height` for Schnell (`1a396376917`, #2055), and [the registry row](../../../open-sse/providers/registry/cloudflare-ai.js) has empty `params`. Test: [cloudflare-schnell-dimensions.test.js](../../../tests/unit/cloudflare-schnell-dimensions.test.js). The PR's other change is to `skills/9router-image/SKILL.md` documentation.

## #5350 FLUX.2 reference image

The same adapter sends the reference as the `input_image_0` file part, rejects `images` and invalid bytes, and fetches remote URLs through the guarded fetcher (added in `f427398291e`, #2045, and hardened since). Test: [cloudflare-flux-reference-image.test.js](../../../tests/unit/cloudflare-flux-reference-image.test.js).

## #5342 CodeBuddy

Ported: plan refusals (11158 and `MODEL_NOT_IN_PLAN`) and exhausted credits (14018) sent as HTTP 400 stayed request-scoped, so no other account or combo member was tried. An account restriction (11140) got the generic 403 cooldown. [errorConfig.js](../../../open-sse/config/errorConfig.js) now gives the first group a 2-minute cooldown and the restriction 30 minutes. [accountFallback.js](../../../open-sse/services/accountFallback.js) now also reads `msg` and `displayMsg`; without that, rule matching saw only the numeric code.

Two deliberate differences from upstream:

- The rules apply only to `codebuddy-cn` and `codebuddy-intl`. Upstream applies these phrases to every provider.
- A 400 naming a model outside the catalog stays request-scoped, following the existing #2315 protection. On `codebuddy-intl`, which accepts unlisted model IDs, such a refusal does not rotate accounts.

Test: [codebuddy-plan-restriction-fallback-port.test.js](../../../tests/unit/codebuddy-plan-restriction-fallback-port.test.js).

Already present: `max_completion_tokens` reaches both executors as `max_tokens`, and the `developer` role arrives as `system` (both probed offline). [codebuddy-intl.js](../../../open-sse/executors/codebuddy-intl.js) keeps caller system instructions. API-key connections already send a credential from [their registry entries](../../../open-sse/providers/registry/codebuddy-intl.js).

Not ported:

- The WorkBuddy desktop identity headers and the wider prompt-rewrite pattern. They make the gateway treat DurinDoor as a different client and get past its content filter.
- The `ck_` dual-auth headers, `/v3/config` test, validation and usage probes. Upstream defines and verifies them only together with that identity, and nothing offline shows they work without it. So WorkBuddy `ck_` key support is **not** added.
- The `reasoning_content` to `reasoning` rename, which the PR justifies for the WorkBuddy channel. This tree keeps `reasoning_content`.
- JWT-derived user and tenant headers and the caller-derived conversation ID. These are new channel behaviour, not a fix to an existing contract here.
