# #1072: preserve native Anthropic search declarations

Compared the `claude.js` tool-filter hunk from [9router #5496 at f5b26e176836a8b000e0279833fdb171524ac1cb](https://github.com/decolua/9router/commit/f5b26e176836a8b000e0279833fdb171524ac1cb) with the published [assessment](1072-9r-codex-claude-search-5496.md). The existing route validator accepts native search for `anthropic`, but the preparation filter removed the declared tool and, when empty, its choice. The upstream native route contract includes `anthropic` alongside `claude` and compatible routes.

The native tool filter now includes `anthropic` in that existing contract. Tool definitions and choice continue through the existing preparation passes; validation, Codex mapping, history handling, limits and authentication are unchanged. No search integration or provider request was added.

Offline evidence: `test -s internal/docs/port-reports/1072-anthropic-native-search-tool-preservation-5496.md && (cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/port9r-anthropic-native-search-tool-5496.test.js)`. The fixture checks native declarations and choice, including search controls, and the existing unsupported route's rejection and filtering. The existing Codex and DeepSeek fixtures provide additional regression coverage. No provider traffic or full suite was run.
