# #1073: Grok CLI top-level custom tools

Reviewed OmniRoute [PR #14738](https://github.com/cheaper-inference/OmniRoute/pull/14738)'s named changed-file diff at head `025940f6816f2c27c1523b6efe667665b4f6cada`; its integration commit is `2d838a9ec73e9933b265e17fdc0279f78275eceb`. The comparison is [1073-september-existing-grok-tool-envelope.md](1073-september-existing-grok-tool-envelope.md).

The same-format Grok CLI executor lowers top-level Responses custom declarations to function declarations with a required string `input`, and lowers replayed custom calls and outputs to paired function history. It restores declared custom names and freeform inputs in JSON and streamed Responses output, including echoed declarations, without placing restoration metadata in the wire body. Existing namespace restoration runs first; ordinary function handling and identical-format dispatch remain in place. The response stream remains incremental and downstream cancellation propagates upstream. Additional tools, namespace custom children and tool-choice expansion are outside this port.

Offline mocked executor fixtures first failed on the missing wire schema and unmodified streamed function call. The requested four-file Vitest command covers the new boundary and existing protocol, namespace, and translator history behavior. No live provider traffic was used.
