# Windsurf contract comparison for #2034

Compared at the pinned revisions below without provider traffic or credentials. This is a source comparison, not proof that either service accepts a particular account or model.

- [CLIProxyAPI at 6faa8d2](https://github.com/router-for-me/CLIProxyAPI/tree/6faa8d20b2673404cff70a2f2d9537ae0d0e684d): the recursive repository tree contains no Windsurf-named implementation. This is a bounded filename finding, not proof that no plugin or indirect integration exists.
- [EasyCLIProxyAPI at e4223d5](https://github.com/router-for-me/EasyCLIProxyAPI/blob/e4223d5eefa22a3301ca7e2a28d05897432b07f9/README.md) manages the CLIProxyAPI core and routes requests through its unified endpoint; its listed built-in OAuth providers do not include Windsurf. Plugins can provide additional integrations, which were not assessed.
- [OmniRoute migration 151](https://github.com/cheaper-inference/OmniRoute/blob/fbd339668384803bc3a9d42370fc413a55e013d5/src/lib/db/migrations/151_windsurf_to_devin_desktop.sql) moves the retired Windsurf provider identity to Devin Desktop. Its [OAuth provider](https://github.com/cheaper-inference/OmniRoute/blob/fbd339668384803bc3a9d42370fc413a55e013d5/src/lib/oauth/providers/devin-desktop.ts) supports import and Devin CLI browser sign-in, with no refresh token. Its [executor](https://github.com/cheaper-inference/OmniRoute/blob/fbd339668384803bc3a9d42370fc413a55e013d5/open-sse/executors/devin-desktop.ts) uses GetUserJwt followed by a different chat contract, sending the raw model ID; its [registry](https://github.com/cheaper-inference/OmniRoute/blob/fbd339668384803bc3a9d42370fc413a55e013d5/open-sse/config/providers/registry/devin-desktop/index.ts) points to server.codeium.com.

DurinDoor retains its separate Windsurf import-token flow without refresh, and sends its account token and mapped model in a framed GetChatMessage request through the selected proxy. The upstream migration does not establish that an existing imported Windsurf credential is a Devin session credential or that a Devin browser login is valid for this transport. Accordingly neither migration nor session extraction is enabled here. Existing aliases and unknown-model passthrough are retained; account entitlement and current provider acceptance remain unverified. Tool and media support remain subject to the existing executor restrictions. The mock tests do not validate real sign-in, refresh, model availability, server responses, or cross-service credential compatibility.

### Request error disclosure

Windsurf HTTP error bodies can contain arbitrary upstream material. The executor's
error parser returns a fixed message to the gateway; the gateway still reads the
bounded original body for rate-limit evidence and retains the HTTP status. For
successful HTTP responses carrying gRPC errors, the executor retains a numeric
trailer status or a fixed message instead of returning the upstream message.
The existing 502 treatment of gRPC failures is unchanged. This intentionally
replaces the earlier runtime test contract that exposed `grpc-message` and error
chunk text. The parser's internal chunk decoder still exposes decoded material
for protocol parsing; it is not a public error or log contract.
