# Antigravity contract comparison for #2034

Compared on 2026-11-20, without provider credentials or account traffic. These are source comparisons, not evidence that Google currently accepts any particular client, model, or account.

## Revisions

| Side | Revision | Note |
| --- | --- | --- |
| CLIProxyAPI `main` | [`6faa8d20b2673404cff70a2f2d9537ae0d0e684d`](https://github.com/router-for-me/CLIProxyAPI/commit/6faa8d20b2673404cff70a2f2d9537ae0d0e684d) | Subject `fix(codex): strip uniqueItems keyword from tool parameter schemas`. |
| EasyCLIProxyAPI | [`e4223d5eefa22a3301ca7e2a28d05897432b07f9`](https://github.com/router-for-me/EasyCLIProxyAPI/commit/e4223d5eefa22a3301ca7e2a28d05897432b07f9) | Desktop console for CLIProxyAPI. |
| OmniRoute | [`fbd339668384803bc3a9d42370fc413a55e013d5`](https://github.com/cheaper-inference/OmniRoute/commit/fbd339668384803bc3a9d42370fc413a55e013d5) | Release-train merge for v3.8.55 (`chore(release): rafacpti23 train b of 11 PRs for v3.8.55`). The `v3.8.55` tag was not published when this was read; the SHA is the commit on the `release/v3.8.55` line. |
| DurinDoor | `3164ce3095774d5f7da49b3922195dd7376e6bb5` | Comparison base for the reproduction. |

Every upstream path cited below was fetched at the SHA above and resolved with HTTP 200.

## Sign-in and project provisioning

- [CLIProxyAPI at 6faa8d2](https://github.com/router-for-me/CLIProxyAPI/tree/6faa8d20b2673404cff70a2f2d9537ae0d0e684d): [OAuth constants](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/internal/auth/antigravity/constants.go) and [authentication and project provisioning](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/internal/auth/antigravity/auth.go). Its client is embedded; DurinDoor deliberately requires operator-supplied client settings. Both request cloud-platform, userinfo email/profile, cclog and experimentsandconfigs; CLIProxyAPI also requests aicode. Both use Google authorization and token endpoints; CLIProxyAPI uses v2 userinfo and daily Cloud Code for project provisioning, while DurinDoor uses v1 userinfo and production Cloud Code. CLIProxyAPI loads a project first, then polls onboarding when missing and takes the returned project; this repair follows that control flow without copying credentials or adding scopes.
- [EasyCLIProxyAPI at e4223d5](https://github.com/router-for-me/EasyCLIProxyAPI/blob/e4223d5eefa22a3301ca7e2a28d05897432b07f9/README.md) is a desktop console managing a CLIProxyAPI core for this OAuth/proxy path, rather than an independent provider implementation. It delegates every provider contract to that core: the README lists "Antigravity OAuth" as an authorization entry point and describes starting, stopping and upgrading the CLIProxyAPI core, plus routing all requests through the unified local CLIProxyAPI endpoint. Its separate official-CLI ACP bridge is not the OAuth proxy path compared here.
- [OmniRoute release/v3.8.55 at fbd3396](https://github.com/cheaper-inference/OmniRoute/tree/fbd339668384803bc3a9d42370fc413a55e013d5): [OAuth configuration](https://github.com/cheaper-inference/OmniRoute/blob/fbd339668384803bc3a9d42370fc413a55e013d5/src/lib/oauth/constants/oauth.ts), [OAuth provider](https://github.com/cheaper-inference/OmniRoute/blob/fbd339668384803bc3a9d42370fc413a55e013d5/src/lib/oauth/providers/antigravity.ts), and [project bootstrap](https://github.com/cheaper-inference/OmniRoute/blob/fbd339668384803bc3a9d42370fc413a55e013d5/open-sse/services/antigravityProjectBootstrap.ts). It uses the same five scopes as DurinDoor, production bootstrap, and bounded onboarding when the project is missing. Its bootstrap also distinguishes a completed response without a project as requiring manual project setup; this change fails the sign-in instead of persisting an empty project.

## Reproduced defect

DurinDoor loaded the account project during sign-in but never waited for it. `src/lib/oauth/providers.js` read `cloudaicompanionProject` from the `loadCodeAssist` response, and when that was empty it started `onboardUser` as a fire-and-forget promise that the OAuth callback never awaited. The connection row was written first, with an empty `projectId`, and the background onboarding result was discarded.

The reproduced failures, from `tests/unit/antigravity-flow.test.js` against the pre-fix provider code:

- The saved connection carried `projectId === ""` instead of the onboarded project.
- `onboardUser` was never called when `loadCodeAssist` returned no project, so a cold account could never obtain one through sign-in.
- A failed project lookup and a completed onboarding without a project both returned HTTP 200 and saved a connection anyway.
- A `cloudaicompanionProject` returned as a plain string was stored untrimmed (`" existing-project "`).

## Fixed behavior

`src/lib/oauth/providers.js`, Antigravity `postExchange`:

1. The `loadCodeAssist` call must succeed. A non-2xx response fails the sign-in instead of falling through to an empty project.
2. The project id is read from either shape Google uses — a plain string or an object with an `id` — and is trimmed in both cases.
3. When no project is present, `onboardUser` runs inline and is awaited. `onboardUser` is a long-running operation: a `done:false` answer means the account project is still being provisioned, so the request is re-sent until it settles. Only a `done:true` response carries the project.
4. A settled response without a project fails the sign-in. The connection is not saved, so no row ever carries an empty or placeholder project.

The sign-in poll is bounded and operator-tunable through `ANTIGRAVITY_ONBOARD_MAX_ATTEMPTS` (default 10) and `ANTIGRAVITY_ONBOARD_RETRY_DELAY_MS` (default 5000). These are separate from the `ONBOARD_MAX_ATTEMPTS` / `ONBOARD_RETRY_DELAY_MS` variables used by the runtime project-discovery path (`open-sse/services/projectId.js`), so an operator who already tuned the runtime knobs does not silently shorten the sign-in poll.

### Upstream poll bounds and body field, checked and not changed

- CLIProxyAPI polls `onboardUser` up to 5 times with a 2 s gap (`internal/auth/antigravity/auth.go`, `OnboardUser`). OmniRoute uses the same 5 attempts with a 2 s interval (`open-sse/services/antigravityProjectBootstrap.ts`, `ONBOARD_POLL_MAX_ATTEMPTS` / `ONBOARD_POLL_INTERVAL_MS`). DurinDoor keeps 10 attempts with a 5 s gap, matching the pre-existing loop bound in the same function, and is now configurable. No reproduced failure justifies shortening it.
- CLIProxyAPI and OmniRoute both send the tier as `tier_id`; DurinDoor sends `tierId`. The Cloud Code API is a proto3 JSON service, and proto3 JSON parsing accepts both the original field name and its lowerCamelCase form, so the two spellings address the same field. DurinDoor keeps `tierId` because its runtime discovery path (`open-sse/services/projectId.js`) already sends that spelling; changing one path without the other would split the contract for no gain.

## Headers, models, quota and responses

[CLIProxyAPI's executor](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/internal/runtime/executor/antigravity_executor.go) and [OmniRoute's endpoint configuration](https://github.com/cheaper-inference/OmniRoute/blob/fbd339668384803bc3a9d42370fc413a55e013d5/open-sse/config/antigravityUpstream.ts) use daily Cloud Code generation endpoints. DurinDoor's registry and executor do likewise, sending bearer authorization and the configured IDE user agent; its bootstrap uses production Cloud Code. CLIProxyAPI uses separate header profiles for load and onboarding; OmniRoute defines profiles in [antigravityHeaders.ts](https://github.com/cheaper-inference/OmniRoute/blob/fbd339668384803bc3a9d42370fc413a55e013d5/open-sse/services/antigravityHeaders.ts). No header fingerprint changes are included here.

[CLIProxyAPI's model registry](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/internal/registry/models/models.json) contains IDs including `claude-opus-4-6-thinking` and `claude-sonnet-4-6`. [OmniRoute's aliases](https://github.com/cheaper-inference/OmniRoute/blob/fbd339668384803bc3a9d42370fc413a55e013d5/open-sse/config/antigravityModelAliases.ts) map the 3.7 Flash display tiers to `gemini-3.7-flash-tiered`, and 3.1 Pro High to `gemini-pro-agent`. DurinDoor's registry maintains its own aliases and catalog; differences are not changed without a reproduced failure. OmniRoute's [usage service](https://github.com/cheaper-inference/OmniRoute/blob/fbd339668384803bc3a9d42370fc413a55e013d5/open-sse/services/usage/antigravity.ts) queries available-model quota and its weekly quota service adds group data; DurinDoor uses the corresponding available-model and weekly-summary calls in `open-sse/services/usage/google.js`.

For responses, CLIProxyAPI's [Claude translator](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/internal/translator/antigravity/claude/antigravity_claude_response.go) and OmniRoute's [stream collector](https://github.com/cheaper-inference/OmniRoute/blob/fbd339668384803bc3a9d42370fc413a55e013d5/open-sse/executors/antigravity/sseCollect.ts) handle Cloud Code response envelopes. The local flow test exercises wrapped candidate text and usage through both public chat formats in JSON and SSE; it does not establish parity for every tool, image, thought, or error response.

## Limits

- No live verification. Every upstream statement comes from reading the pinned upstream trees at the SHAs above. No provider API was called, no credential was used, and no browser or paid API was involved.
- "Upstream signs in with scope X" means "the upstream code contains a path for X", not "sign-in method X currently works against the vendor". Google may accept a different client, scope set, or project tier than the ones compared here.
- The `v3.8.55` OmniRoute tag was not published at the time of reading, so the comparison is pinned to the release-train commit SHA rather than to a tag object.
- The test drives the OAuth route, the local database, the `/v1/models` route, and the OpenAI and Anthropic chat routes with mocked provider HTTP. It does not exercise Google's real token issuance, project provisioning, quota endpoints, or the real `daily-cloudcode-pa.googleapis.com` generation path.

## agy connection and catalog refresh (issue #2034)

At the pinned snapshots, [CLIProxyAPI's Antigravity auth](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/internal/auth/antigravity/auth.go) implements OAuth and project lookup, and its [executor](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/internal/runtime/executor/antigravity_executor.go) handles generation. [EasyCLIProxyAPI's management API](https://github.com/router-for-me/EasyCLIProxyAPI/blob/e4223d5eefa22a3301ca7e2a28d05897432b07f9/src-tauri/src/management_api.rs) delegates OAuth to the core; its deployed core revision is not established by the desktop revision. [OmniRoute's agy registry](https://github.com/cheaper-inference/OmniRoute/blob/e3c1531afd07d5e06f7ffab658584a7ae2e3627e/open-sse/config/providers/registry/agy/index.ts) identifies a separate agy provider using the Antigravity executor and OAuth client configuration; its [executor](https://github.com/cheaper-inference/OmniRoute/blob/e3c1531afd07d5e06f7ffab658584a7ae2e3627e/open-sse/executors/antigravity.ts) handles streaming. This change aligns catalog refresh with the same operator-configured client used by the local agy request refresh, consistent with the OmniRoute registry; it does not import upstream credentials.

The synthetic test imports an existing `agy` connection via DurinDoor's legacy `db.json` migration, signs in an `antigravity` account with the same email, forces a catalog 401 and refresh, and sends streaming requests through both provider IDs with a closed outbound mock. It verifies token and project separation. This is a DurinDoor data-file import, not native parsing of an Antigravity CLI auth file; no dedicated CLI auth-file importer was found. It does not establish live provider acceptance, full upstream request parity, or compatibility with arbitrary exported credential formats. Existing project onboarding remains covered separately by `antigravity-flow.test.js`.
