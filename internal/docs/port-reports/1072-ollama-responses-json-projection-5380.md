# #1072: Ollama Responses JSON projection

Compared [9router #5380](https://github.com/decolua/9router/pull/5380), open at head `03727a07be3a357dc595450c5a61c7847d5bed93`, with the [nonstream and Gemini review](1072-nonstream-and-gemini-v1beta-open-prs.md) and local base `9f0f315b4ebb9803d27a6b9b270a7f7acfc6e84e`. Upstream normalizes Ollama JSON to a Chat completion and then projects it to the requested Responses shape. The fork returned the intermediate Chat completion for this client and transport combination.

The Ollama branch now projects that intermediate only for Responses clients, using the existing projector and tool-name resolution. Claude continues through the existing outer Messages conversion and Chat retains the normalized completion. Native usage, tool-call identity and completion status remain represented by the existing converters. Error checks and stream handling are unchanged; Gemini-native routes are outside this change.

Offline evidence (synthetic text and tool call, no provider traffic):

```sh
rg -q -F 03727a07be3a357dc595450c5a61c7847d5bed93 internal/docs/port-reports/1072-ollama-responses-json-projection-5380.md && (cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/nonstream-client-projection-5380.test.js unit/v1beta-gemini-tool-calling.test.js unit/v1beta-gemini-inline-data.test.js)
```

Result: 3 files and 16 tests passed. The projection fixture checks both Responses format aliases, Claude and Chat, including text, tool identity, usage and completion status. It checks native counts before the handler's existing usage buffer and filtering, as well as the resulting client-facing counts. The existing accumulated SSE assertion remains in place; the Gemini tests exercise the existing native tool and inline-data routes.
