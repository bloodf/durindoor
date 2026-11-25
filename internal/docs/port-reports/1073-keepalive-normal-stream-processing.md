# #1073: keepalive frames and normal stream processing

Source: OmniRoute [#1146](https://github.com/cheaper-inference/OmniRoute/pull/1146), head `1e7df542df2e5ed17cb49195ccdeab4b7ec9bf51`, merged as `bd33b53805cc69f90a161383273f921f8b71d3ff`. The prior local port and its source comparison are recorded in [1073-passthrough-empty-keepalive-block.md](1073-passthrough-empty-keepalive-block.md). The integrated adaptation `6c8a739efa` discarded every line following a matching label, including payloads and prefix matches. This repair is independent of the rejected diagnostic commit `c91c573661`.

Chat and Responses passthrough now hold a candidate beginning at a frame boundary until an empty block ends or a line requires ordinary processing. Exact, case-sensitive `keepalive` labels only are candidates. A payload, another field or comment, or the 65536-character bound releases the candidate to the original line processing loop, including terminal, usage and replay handling. Existing incomplete empty tails remain suppressed; nonempty tails use the existing tail handler. Conservative fail-open handling preserves other fields and comments. The preexisting field-only behavior remains in the normal path.

Local evidence: the focused offline test preserves the original assertions and adds data-bearing Chat and Responses events, prefix labels, and an unterminated payload. The same Chat usage-only JSON under `provider-status` and `keepalive` reaches the single completion callback with 7 prompt, 3 completion and 10 total tokens. No provider traffic or full suite was run.

```sh
test -s internal/docs/port-reports/1073-keepalive-normal-stream-processing.md && (cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-passthrough-empty-keepalive-block.test.js)
```

Result: 1 file, 15 tests passed.
