# OpenCode free client compatibility: #1072

Source: https://github.com/decolua/9router/pull/5776, pinned head `9d8614fad501171aeb2a7a390d025848c574965b` (parent diff inspected offline after fetching that commit).

The source changes the public client version from 2.0.26 to 2.3.2, routes chat and Responses through `/inference/openai/v1` and Messages through `/inference/anthropic/v1`, and changes the injected shell tool description and timeout description. The latter describes foreground timeout promotion to background and a different background timeout rule; its JSON types, minimum, required field and additional-properties rule remain unchanged. The source does not change reasoning or session logic in this commit.

DurinDoor's `open-sse/executors/opencode.js` already routes Muse to Responses, Union Alpha to Messages and other models to chat, forces streaming, preserves the caller's Responses cache key, and applies existing reasoning and tool handling. This port updates the free executor's API-family paths and public version metadata while retaining its model selection, caller user-agent handling, reasoning, tools, and session behavior. Other provider lanes and catalog/aliases are untouched.

The shell description change is explicitly a client fingerprint used for provider gating in `open-sse/utils/opencodeFingerprint.js`; it is excluded under the requested boundary against impersonation or bypassing provider controls. Existing fingerprint, session, authorization and transport behavior is not expanded. The pinned PR alone is the evidence for the v2.3.2 schema and route changes; its claims of live acceptance are not independently verified. No provider access or credentials were used. Offline coverage is in `tests/unit/port9r-opencode-free-client-5776.test.js`, with existing route and version expectations updated for the changed behavior.

The current #5776 head `f663037a82c7ada99bd4a02b745ea0f9e7761564` updates the public client version to 2.4.1. The route and fingerprint scope above is unchanged.
