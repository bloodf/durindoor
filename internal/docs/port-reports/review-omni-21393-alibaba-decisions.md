# Review: OmniRoute #21393 Alibaba DashScope decisions backend

Status: DONE (read-only review). One concrete gap recorded; nothing implemented, no issue, PR, claim or live probe touched.

## Upstream identity (read via `gh api`, read-only)

- PR: [cheaper-inference/OmniRoute#21393](https://github.com/cheaper-inference/OmniRoute/pull/21393) "feat(systemone): add Alibaba DashScope decisions backend" by SecInsight
- State: **open**, not draft, mergeable_state `blocked`
- Head: `e14ae16c6407776636eb18f9e01ca74c94119ac2` (1 commit, `feat/alibaba-systemone-backend`), last updated 2026-11-27T03:13:04Z
- Base recorded by the PR: `release/v3.8.55` @ `9671192011beb2d7f83979f40be488c5da8772b9`. The live branch had moved to `b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523` (2026-11-27T14:40:38Z) at check time, so the PR base is stale.
- Changed files: 10, +198/−2. Substantive files: `open-sse/config/systemOneRegistry.ts`, `src/app/api/v1/_shared/systemOneAlibabaUrl.ts` (new), `src/app/api/v1/_shared/systemOneRoute.ts`, `open-sse/config/imageRegistryData.ts`, `tests/unit/systemone-alibaba-backend.test.ts` (new). The remainder are dashboard endpoint-tag and i18n strings, not evaluated.
- Upstream behaviour: `alibaba/decision-model` and `dashscope/decision-model-preview` resolve to an `alibaba` System One backend, allow-listed to `decision-model` / `decision-model-preview`. The URL is derived from the connection's `providerSpecificData.baseUrl` and rewritten to `…/compatible-mode/v1/systemone`. Two image IDs (`qwen-image-2.1-pro`, `qwen-image-2.1-turbo`) are added to the Alibaba image registry.

## DurinDoor comparison base

- `origin/main`: `29490b783e83176d4d6a4162f76ee3dc79db66ea`
- Train head (this checkout, branch `orq/tp3r51/omni-review-21393-a1`): `d27f288cb59be43a4c1068ac314076cde0297413`. No `orq/tp3r51/integration` ref exists locally; this HEAD was used as the frozen train head.
- `origin/main..HEAD` touches System One only in a Liquid-only guard (`open-sse/handlers/systemoneCore.js`, `src/sse/handlers/systemone.js`, `provider === "liquid"`). It does not affect the Alibaba path.

## Ownership and claims

- `gh` searches of DurinDoor issues and PRs for 21393, Alibaba, DashScope and decision-model: no matching issue or PR. No claim found.
- The sync-lane list (#21435, #21432, #21426, #21412, #21425, #21427, #21349, #21433; 9router #5884/#5904) does not include 21393.
- Adjacent open work in the same System One area, for different providers: issue #2644 / PR #2675 (Liquid System One decisions) and issue #2637 / PR #2677 (OpenRouter decision models). Neither covers Alibaba; both touch `systemoneConfig` and the same handler files, so a future Alibaba port must rebase on them.
- `internal/docs/port-reports/2026-11-27-full-parity-refresh.md:1689` (row O0021) lists this PR as "Unrecorded at this head; review required". This report resolves that row.

## Verdict: concrete missing behaviour (severity: low)

**Decision models are unreachable through `POST /v1/systemone` on `origin/main`.**

Trace (from code; not executed):

1. Request `{"model":"alibaba/decision-model","state":…,"questions":{…}}` passes admission and the body checks at `src/sse/handlers/systemone.js:82-91`.
2. `getModelInfo("alibaba/decision-model")` resolves to provider `alibaba`, model `decision-model`. The `alibaba` registry entry is `passthroughModels: true` (`open-sse/providers/registry/alibaba.js:61`), so no allow-list rejects it.
3. Credentials are selected (`systemone.js:154`). If no `alibaba` connection exists, the handler returns 400 `No credentials for provider: alibaba` (`systemone.js:169`). If one exists, the flow reaches `handleSystemoneCore`.
4. `open-sse/handlers/systemoneCore.js:53-55`: `PROVIDER_MEDIA["alibaba"]?.systemoneConfig` is undefined, because no Alibaba registry entry has `systemoneConfig` (`grep` over `open-sse/providers/registry` shows only laya, opencode, opencode-zen, openrouter, subq, typesafe). The core returns 400 `Provider 'alibaba' does not support System One.` before any outbound request.

Upstream instead maps these IDs to a dedicated backend in `resolveSystemOneTarget` with a per-connection URL. DurinDoor has no equivalent. `open-sse/config/systemone.js` only normalises base URLs.

Severity is low: it is a missing feature that fails closed with HTTP 400, not a regression and not a security or accounting issue. A partial workaround may exist: `docs/reference/api.mdx:213` documents Custom System One nodes that accept a complete `/systemone` endpoint, so a DashScope workspace URL could be registered as a `systemone-compatible-*` node. I did not test this live, so treat it as unverified.

Porting note: upstream's `open-sse/config/systemOneRegistry.ts` and `systemOneRoute.ts` do not exist locally. The natural DurinDoor shape is a `systemoneConfig` on `open-sse/providers/registry/alibaba.js` with a per-connection URL, which needs the `userConfigurableHost`-style path in `systemoneCore.js:73-85` or a new one. The upstream test imports `open-sse/config/systemOneRegistry.ts`, so it cannot be ported unchanged.

## Image hunk: inapplicable as an ID-only add

Upstream adds `qwen-image-2.1-pro` and `qwen-image-2.1-turbo` to its Alibaba image registry (`open-sse/config/imageRegistryData.ts`). DurinDoor has no Alibaba image provider: `open-sse/providers/registry/alibaba.js` has `serviceKinds: ["llm","video"]` and no `imageConfig`, and no `imageRegistryData` file exists locally. Adding the two IDs alone would not make them routable. The missing item is the whole Alibaba image family, which is a separate intake, not part of this candidate. I did not trace the exact error for an image request.

## Not verified

- No tests were run, and no product code was executed. The verdict rests on source reads of `origin/main` objects and the train head.
- The upstream test suite was not run.
- Whether `getModelInfo` resolves `alibaba/decision-model` as traced in step 2 was read from the registry flags, not executed.
- Upstream was read at PR head `e14ae16c`. If the PR changes, this verdict needs re-reading.

## Reproduce the reads

```bash
gh api repos/cheaper-inference/OmniRoute/pulls/21393 --jq '{state,head:.head.sha,base:.base.sha}'
git show 'origin/main:open-sse/handlers/systemoneCore.js' | sed -n 53,55p
git show 'origin/main:src/sse/handlers/systemone.js' | sed -n 96,99p
git show 'origin/main:open-sse/providers/registry/alibaba.js' | grep -n passthroughModels
```
