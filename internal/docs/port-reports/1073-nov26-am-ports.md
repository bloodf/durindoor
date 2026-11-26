# November 26 morning port candidates

Scope: every row marked "Port candidate" in [the morning dispositions](1073-nov26-am.md). That report has **one** such row. The work order named three; three lines of the report contain the phrase (the summary count, the section heading and the row). The summary table counts 1.

On 2026-11-26 the pull request was open, its head matched the SHA in the source row, and its diff (2 commits, 5 files) was fetched with `gh api`. No live provider was called.

| PR | Head | Final disposition | Evidence |
|---|---|---|---|
| OmniRoute [#21221](https://github.com/cheaper-inference/OmniRoute/pull/21221) | `547e684a20ff` | Partly ported: static `glm-5.4` row. Live discovery **held for an owner decision** | [Registry](../../../open-sse/providers/registry/zai.js) now lists `glm-5.4`; [the provider catalog](../../../docs/providers/catalog.mdx) was regenerated. [Test](../../../tests/unit/port-omniroute-21221-zai-glm54-static.test.js) failed before the row and passes with it. The gap in the source row stays open: [discovery config](../../../src/app/api/providers/[id]/models/modelsConfig.js) has no `zai` entry. |

## Ported: static `glm-5.4`

- It was absent from the `zai` list here. That list is the only catalog `zai` has.
- Upstream reports that the model answers on its coding-plan chat surface (probe of 2026-11-25). This was not checked from DurinDoor.
- No capability or price numbers were added. The existing `glm-5*` patterns resolve it: 200,000 context and 128,000 output in [capabilities](../../../open-sse/providers/capabilities.js), and the family price in [pricing](../../../open-sse/providers/pricing.js). Neither is a verified `glm-5.4` figure.

## Held: live model discovery

Today a `zai` API-key connection gets `400 Provider zai does not support models listing`. [The acceptance test](../../../tests/unit/fleet-provider-zai-web-acceptance.test.js), added by DurinDoor [#1298](https://github.com/bloodf/durindoor/pull/1298), requires exactly that in "installed zai: static catalog only, no live discovery, raw x-api-key auth". Porting discovery means removing that assertion. The work order forbids weakening tests, and [the earlier hold](1073-nov25-pm-ports.md) and the source row leave the choice to an owner. No such decision was found in `internal/docs`. The provider rule quoted on [#1251](https://github.com/bloodf/durindoor/issues/1251) covers adding providers, not discovery for `zai`. The test is unchanged and passes.

This is not marked "Not applicable": model discovery already exists here for other providers, and upstream classifies the change as a bug fix.

**Decision needed:** may installed `zai` use `GET https://api.z.ai/api/paas/v4/models` with `Authorization: Bearer <key>`? Chat would keep `x-api-key` on the Anthropic route. A yes means replacing the "no live discovery" assertions with assertions on that exact request.

A port after a yes also has to handle these:

- **Listed models can disappear.** After a sync, [the synced catalog](../../../src/lib/modelAutoSync/catalog.js) (`effectiveSyncedModels`) replaces the static rows, keeping only certain derived review rows. Upstream's 13-id live snapshot omits six local ids: `glm-4.7-flash`, `glm-4.7-flashx`, `glm-4.5-x`, `glm-4.5-airx`, `glm-4-32b-0414-128k` and `glm-4.5-flash`. Upstream's second commit protects only `glm-4.7-flash`.
- **Upstream's protection does not carry over as written.** It adds `targetFormat: "claude"` to that row so that upstream's catalog admission keeps it. The upstream paths `src/lib/db/models/activeSyncedCatalog.ts` and `src/lib/providerModels` are absent here. The tag was not ported, because no discovery was ported.
- **Auto-sync eligibility changes.** A discovery config entry also makes `zai` eligible in [the sync runner](../../../src/lib/modelAutoSync/runner.js). `zai` is not in `MODEL_AUTO_SYNC_DEFAULT_PROVIDERS`, so sync would stay off until an operator enables it.

The other upstream files have no local counterpart: `src/lib/providerModels/hardcodedModelsConfigIds.ts` and `changelog.d` are absent, and the upstream test targets upstream modules.
