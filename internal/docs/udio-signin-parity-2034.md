# Udio sign-in and music contract — #2034

Comparison pins: CLIProxyAPI `6faa8d20b2673404cff70a2f2d9537ae0d0e684d`, EasyCLIProxyAPI `e4223d5eefa22a3301ca7e2a28d05897432b07f9`, OmniRoute `e3c1531afd07d5e06f7ffab658584a7ae2e3627e`.

- [CLIProxyAPI executor registration](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/sdk/cliproxy/service_executors.go) does not establish a Udio executor or session login. Its generic compatibility facilities are not a Udio music contract.
- [EasyCLIProxyAPI guided provider choices](https://github.com/router-for-me/EasyCLIProxyAPI/blob/e4223d5eefa22a3301ca7e2a28d05897432b07f9/src/pages/EasyModePage.tsx) do not list Udio; its [management API](https://github.com/router-for-me/EasyCLIProxyAPI/blob/e4223d5eefa22a3301ca7e2a28d05897432b07f9/src-tauri/src/management_api.rs) delegates operations to its core. This is not evidence of a Udio-specific flow in that core.
- [OmniRoute Udio registry](https://github.com/cheaper-inference/OmniRoute/blob/e3c1531afd07d5e06f7ffab658584a7ae2e3627e/open-sse/config/providers/registry/udio/index.ts) identifies an API-key field sent as a cookie. Its [music handler](https://github.com/cheaper-inference/OmniRoute/blob/e3c1531afd07d5e06f7ffab658584a7ae2e3627e/open-sse/handlers/musicGeneration.ts) accepts the existing cookie, posts prompt and `samplerOptions: { seed: -1 }`, reads `track_ids`, polls songs, and downloads a finished track. It does not establish a refresh or expiry contract.

DurinDoor's registry accepts an existing session cookie rather than an OAuth flow; expiry requires a replacement cookie. The music handler now supplies OmniRoute's random-seed default (ported from `open-sse/handlers/musicGeneration.ts`). DurinDoor retains its asynchronous owned-job interface: all submitted IDs must finish before completion, and polling requires the original caller and connection. This intentionally differs from OmniRoute's synchronous first-ready-track download. Accepted usage and terminal settlement remain governed by `src/sse/handlers/music.js`.

Mock tests cover the submission, selected cookie, polling, identity mismatch and upstream 401; the existing media usage tests cover ownership and accounting. These do not validate a real session, expiry timing, provider availability, entitlement, audio download, or live upstream schema. No provider calls were made.

## Saved-cookie lifecycle (#2034)

Offline lifecycle evidence is `tests/unit/provider-cookie-lifecycle-suno-udio-zenmux.test.js`, shared with Suno: real database, provider routes, `GET /v1/models/music`, the `/v1/music/generations` submit and poll routes with durable media jobs and a real caller API key, account fallback and the usage route, with synthetic credentials and closed fetch. The pins above are the 2026-11-20 snapshot, reused and not re-fetched. No first-party Udio page, account, browser or media request was used, so no first-party contract is claimed.

Verified for Udio: submit posts to the pinned generate-proxy URL with the selected cookie and `track_ids` become the job identity; polling uses `GET /api/songs?songIds=`; the job stays `submitted` until every track reports `finished` with a song path; ownership, replay, usage, 401 fallback and re-paste behave as for Suno (see the Suno note for the full list).

Gap found and fixed: Validate and Test Connection used the generic probe, which POSTed the generate-proxy endpoint with the saved cookie. They now skip without any outbound request. The usage route now reports DurinDoor's 30-day history for the saved session. Known limits are those listed for Suno.
