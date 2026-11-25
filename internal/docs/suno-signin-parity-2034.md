# Suno session and music comparison (#2034)

Compared offline on 2026-11-20 against the revisions in
[the sign-in comparison](./claude-signin-parity-2034.md). No account, provider
session or media-generation request was used.

## Revision-bound evidence

- CLIProxyAPI [`6faa8d20b2673404cff70a2f2d9537ae0d0e684d`](https://github.com/router-for-me/CLIProxyAPI/commit/6faa8d20b2673404cff70a2f2d9537ae0d0e684d): its
  [executor registration](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/sdk/cliproxy/service_executors.go)
  and [API routes](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/internal/api/server_routes.go)
  do not establish a built-in Suno cookie sign-in or direct music task contract.
  Generic compatible providers and plugins are not proof of one.
- EasyCLIProxyAPI [`e4223d5eefa22a3301ca7e2a28d05897432b07f9`](https://github.com/router-for-me/EasyCLIProxyAPI/commit/e4223d5eefa22a3301ca7e2a28d05897432b07f9): the
  [guided OAuth choices](https://github.com/router-for-me/EasyCLIProxyAPI/blob/e4223d5eefa22a3301ca7e2a28d05897432b07f9/src/pages/EasyModePage.tsx)
  do not include Suno. Its [management API](https://github.com/router-for-me/EasyCLIProxyAPI/blob/e4223d5eefa22a3301ca7e2a28d05897432b07f9/src-tauri/src/management_api.rs)
  delegates provider management to a separately versioned core; its bundled core
  version and third-party plugins were not resolved here.
- OmniRoute [`e3c1531afd07d5e06f7ffab658584a7ae2e3627e`](https://github.com/cheaper-inference/OmniRoute/commit/e3c1531afd07d5e06f7ffab658584a7ae2e3627e): its
  [music registry](https://github.com/cheaper-inference/OmniRoute/blob/e3c1531afd07d5e06f7ffab658584a7ae2e3627e/open-sse/config/musicRegistry.ts)
  lists Suno models under Kie, using a Kie bearer key. Its
  [music handler](https://github.com/cheaper-inference/OmniRoute/blob/e3c1531afd07d5e06f7ffab658584a7ae2e3627e/open-sse/handlers/musicGeneration.ts)
  and [Kie executor](https://github.com/cheaper-inference/OmniRoute/blob/e3c1531afd07d5e06f7ffab658584a7ae2e3627e/open-sse/executors/kie.ts)
  submit and poll a Kie task, then return completed audio URLs. This is not a
  direct Suno session contract and gives no Suno cookie expiry or refresh rule.

## Local contract and coverage

The existing [registry](../../open-sse/providers/registry/suno.js) describes a
pasted cookie. [Provider creation](../../src/lib/providerRouteHandlers.js)
accepts it in `apiKey`, stores it as cookie auth, and redacts it from the
response. It does not derive an expiry or refresh a session. The music
[handler](../../src/sse/handlers/music.js) binds a submitted job to its caller,
connection and accounting event; the [core](../../open-sse/handlers/musicGenerationCore.js)
submits with the selected cookie and polls clip IDs. Streaming clips remain
pending; completed clips with audio and durations settle usage. Account policy
may allow fallback after an error; a failed polling request stays bound to the
original connection.

[The regression](../../tests/unit/suno-signin-parity.test.js) exercises provider
creation and music entry points with two fake sessions, closed transport, a
mocked job repository and mocked accounting. It checks submission, polling,
credential isolation, a streaming-to-complete transition and a 401 when the
mocked account policy declines fallback. The separate
[database-backed lifecycle tests](../../tests/unit/media-music-usage.test.js)
cover caller and connection ownership, idempotent settlement and terminal
replay. The mock expiry response is not evidence of a real expiry duration or
refresh protocol. No direct Suno upstream equivalence, live session validity,
media output, full CI gate or independent review is claimed. No implementation
port was justified by the examined upstream contracts; the existing flow is
preserved.

## Saved-cookie lifecycle (#2034)

Offline lifecycle evidence is `tests/unit/provider-cookie-lifecycle-suno-udio-zenmux.test.js`: real database, provider routes, `GET /v1/models/music`, the `/v1/music/generations` submit and poll routes with durable media jobs and a real caller API key, account fallback and the usage route. Credentials are synthetic and fetch is closed unless a test opens it with a canned answer. The pins above are the 2026-11-20 snapshot and were reused, not re-fetched. No first-party Suno page, account, browser or media request was used, so no first-party contract is claimed.

Verified: create without exposing the cookie; discovery under the music kind and absence from the chat model list; submit to the pinned endpoint with the selected cookie; asynchronous `submitted`, `streaming` (still pending) and `complete` states; poll bound to the submitting connection and caller (404 for another caller or connection, no upstream call); terminal replay without an upstream call; usage settled once with clip duration; 401 on submit falls back to a sibling and cools the expired connection; 401 on poll is returned and the job stays bound; re-paste replaces the cookie, clears the cooldown and a later poll uses it.

Gap found and fixed (DurinDoor-original): Validate and Test Connection fell through to the generic registry probe, which sent a GET and then a POST to the music submit endpoint with the saved cookie, starting a generation on the account. `suno` and `udio` are now in `src/lib/providers/conversationProbe.js`, so both checks skip with no outbound request. The usage route answered "Usage not available"; it now reports DurinDoor's 30-day history for the saved session.

Known limits, unchanged: no expiry time or refresh flow is established, a 401 on poll does not cool the connection (only submit does), there is no job timeout, and no attestation is emulated.
