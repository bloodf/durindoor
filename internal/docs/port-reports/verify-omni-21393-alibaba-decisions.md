# Verify: OmniRoute #21393 Alibaba decisions candidate

Status: DONE (read-only verification). Candidate **confirmed as a missing optional feature, severity low**. It is not an existing-behaviour defect. No product code, tests, issues, PRs, services or live providers were touched.

## Inputs

- Report under test: commit `8039e7ff11186463482aa640dad823d49915c734` (`docs(port): record review verdict for OmniRoute #21393 Alibaba decisions`), file `internal/docs/port-reports/review-omni-21393-alibaba-decisions.md`.
- Comparison base: `main` = `29490b783e83176d4d6a4162f76ee3dc79db66ea` (tree `ba241eb7e1ff2a3840359ad583320c5645090c69`).
- Train object named in the brief: `32a783d76d45d90bf0517015442f43fadd96106c`. This is a **commit**, not a tree; its tree is `fd449b3cefa538d912c3b51dee0ed774ede580e6` (`merge: include #2683 in train/2`). Its System One diff against `main` covers only Liquid guards plus an unrelated `resolvedThinkingEffort` hunk in `dispatch.js`, so it does not change the Alibaba path.
- The report's own train head, `d27f288cb59be43a4c1068ac314076cde0297413`, is a merge with `main` as an ancestor. Its System One diff was not separately read.

```bash
git rev-parse --verify -q 8039e7ff11
git cat-file -t 29490b783e83176d4d6a4162f76ee3dc79db66ea     # commit
git cat-file -t 32a783d76d45d90bf0517015442f43fadd96106c     # commit
git log -1 --format='%T %s' 32a783d76d45d90bf0517015442f43fadd96106c
# fd449b3cefa538d912c3b51dee0ed774ede580e6 merge: include #2683 in train/2
git diff --stat 29490b783e83176d4d6a4162f76ee3dc79db66ea 32a783d76d45d90bf0517015442f43fadd96106c -- open-sse/handlers src/sse/handlers open-sse/providers/registry/alibaba.js
#  open-sse/handlers/systemoneCore.js  | 19 +++++++++++++------
#  src/sse/handlers/systemone.js       | 13 +++++++++----
```

## Claim-by-claim result

| # | Claim in the candidate | Result | Evidence |
|---|---|---|---|
| 1 | `alibaba` registry entry has no `systemoneConfig` on `main` | **Confirmed** | `git grep -n systemoneConfig 29490b78 -- open-sse/providers/registry` lists only laya, opencode-zen, opencode, openrouter, subq, typesafe. |
| 2 | `handleSystemoneCore` returns 400 `Provider 'alibaba' does not support System One.` before any outbound request | **Confirmed** (source + executed) | `open-sse/handlers/systemoneCore.js:53-55`. Probe output below. |
| 3 | `alibaba` is `passthroughModels: true`, so no allow-list rejects `decision-model` | **Confirmed** | `open-sse/providers/registry/alibaba.js:61`. |
| 4 | With no `alibaba` connection, the handler returns 400 `No credentials for provider: alibaba` | **Confirmed** (source) | `src/sse/handlers/systemone.js:167-169`. |
| 5 | With an `alibaba` connection, the core's 400 is returned to the client, not fallen back on or cooled down | **Confirmed** (executed classifier + source) | Probe output below. `alibaba` is not in `isDurableCredentialProvider` (`accountFallback.js:611`, only `orcarouter`). No `ERROR_RULES` text or pattern matches the message, and there are no status-400 rules. |
| 6 | Upstream dedicated `resolveSystemOneTarget` / per-connection URL has no DurinDoor equivalent | **Confirmed** | No `systemOneRegistry`, `systemOneRoute`, `systemOneAlibabaUrl` or `decision-model` string anywhere in `main`'s non-doc sources. `open-sse/config/systemone.js` only normalises base URLs. |
| 7 | Image hunk (`qwen-image-2.1-pro` / `-turbo`) is not an ID-only add | **Confirmed** | `alibaba.js` has `serviceKinds: ["llm","video"]` and no `imageConfig`. No `imageRegistryData` file exists in the tree. |
| 8 | `dashscope/decision-model-preview` resolves to `alibaba` on DurinDoor | **Not supported on DurinDoor** (source-read, not executed) | No `dashscope` alias appears in any registry entry, and `MEDIA_ONLY_ALIASES` (`open-sse/services/model.js:9-15`) has no `dashscope` key. `ALIAS_TO_PROVIDER_ID` is built only from `id`, `alias`, `uiAlias`, `aliases`. So on `main` it resolves to provider `dashscope`, which is not in the registry. The candidate describes this as the upstream mapping, which is accurate for upstream. |
| 9 | Custom System One node could act as a workaround (docs `api.mdx:213`) | **Unverified** | The doc line exists and describes a custom node that accepts a base URL or complete `/systemone` endpoint. Whether DashScope exposes a `/systemone` path is a live-provider question. Not tested. |
| 10 | Upstream file layout and upstream test import paths | **Not re-verified** | These are upstream claims. I did not re-fetch the PR, so they stand as the candidate's claims only. |

## Reproduction (offline, executed)

Method: extracted `open-sse/`, `src/` and `package.json` from `main` with `git archive` into a private `/var/tmp` directory. Installed `main`'s frozen lockfile there with `pnpm install --frozen-lockfile --prefer-offline --ignore-scripts`. This did **not** touch the worktree or `~/.9router`. Ran with `env -i` (stripped environment), private `HOME`/`DATA_DIR`/`TMPDIR`, `NODE_ENV=test`, `timeout 300`. No `send` function or network was supplied, and the core returned before any fetch.

Probe (`probe.mjs`, imports the real modules):

```js
const { checkFallbackError } = await import("./open-sse/services/accountFallback.js");
const { handleSystemoneCore } = await import("./open-sse/handlers/systemoneCore.js");
const fb = checkFallbackError({ status: 400, errorText: "Provider 'alibaba' does not support System One.", backoffLevel: 0, provider: "alibaba", model: "decision-model" });
console.log("fallback:", JSON.stringify(fb));
const r = await handleSystemoneCore({ body: { model: "alibaba/decision-model", state: {}, questions: {} }, modelInfo: { provider: "alibaba", model: "decision-model" }, credentials: { apiKey: "x" }, log: null });
console.log("core status:", r.status, "success:", r.success, "error:", r.error);
```

Command and output:

```
$ env -i PATH=/usr/bin:/bin HOME=$W/home DATA_DIR=$W/data TMPDIR=$W/tmp NODE_ENV=test timeout 300 node probe.mjs
fallback: {"shouldFallback":false,"cooldownMs":0,"requestScoped":true,"scope":null}
core status: 400 success: false error: Provider 'alibaba' does not support System One.
```

Error-rule check (`ERROR_RULES` from `open-sse/config/errorConfig.js`, 49 rules, same stripped environment, one import stubbed in a scratch copy):

```
total rules: 49 text/pattern hits: []
status-400 rules: []
```

Model-ID resolution through `getModelInfoCore` did not run. Importing `src/shared` requires the `@/shared` alias, which plain Node does not resolve. The result for `alibaba/decision-model` (provider `alibaba`, model `decision-model`) rests on the source read of `parseModel` and `ALIAS_TO_PROVIDER_ID`.

No live provider was contacted. No credentials were used. The `handleSystemone` handler was not executed end to end because it needs the database, admission and credential services. The trace is source-level for that layer.

## Ownership and issues

- `gh issue list --repo bloodf/durindoor --state all` with `21393`, `Alibaba`, `DashScope`, `decision-model`: no issue names Alibaba decision models. #762 (Alibaba Token Plan catalog campaign) is closed and unrelated.
- Open System One issues: only #2644 (Liquid native decisions). Adjacent: #2637 (OpenRouter decision models in discovery). Neither covers Alibaba.
- Auth and sync lanes: the brief names #2266 and #2289 as auth-owned. Their titles are "combo routing" (#2266) and "compression split" (#2289). Neither is about provider auth or System One. The candidate's fix area (`systemone.js`, `systemoneCore.js`, `registry/alibaba.js`, `imageRegistryData`) does not overlap the auth files read in the trace (`accountErrors.js`, `accountFallback.js`), which would be read-only.
- I did not list or inspect PRs.

## Verdict

- **Confirmed**: `POST /v1/systemone` with `alibaba/decision-model` or `dashscope/...` cannot reach a decision backend on `main`. It fails closed with 400 and does not penalise any account.
- **Classification**: absent optional upstream feature. It is not an existing-behaviour defect. The current 400 text is the designed response for a provider without `systemoneConfig`.
- **Severity: low.** Fail-closed, no outbound request, no cooldown, no billing or accounting effect.
- **Dropped**: nothing in the candidate's DurinDoor-side trace. The image hunk is not a separate defect. It belongs to the missing Alibaba image family.
- **Uncertain**: the custom System One workaround (claim 9), upstream file layout and test paths (claim 10), and live DashScope acceptance of any `/systemone` path. None of these were tested, and this report makes no live-acceptance claim.

## Porting note

A DurinDoor port would put `systemoneConfig` on `open-sse/providers/registry/alibaba.js`. That needs a per-connection URL, which means extending the `userConfigurableHost`-style path in `systemoneCore.js` (around lines 73-85), not a fixed `baseUrl`. The upstream `systemOneRegistry.ts` shape cannot be ported unchanged. This is a separate intake, not a fix for an existing defect.
