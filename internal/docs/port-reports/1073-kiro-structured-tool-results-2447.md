# #1073: Kiro structured tool-result content

OmniRoute #2447, head `12ab83a45dff0a24512ff16a952df348c5d10f0b`,
first-parent merge `52903fea74bac343beb865f3e4127a2d75290ac4`, adds
serialization at the Claude-style `tool_result` conversion in
`open-sse/translator/request/openai-to-kiro.ts`. Its JSON and image examples
show content previously reduced to empty text. The same first-parent diff also
changes error status and missing tool IDs, and includes unrelated database
adapter files; those changes are outside this port.

The local comparison in `1073-late-may-kiro-responses-replay.md` identifies a
second input to this bridge: OpenAI tool-role messages also discarded
non-string content. Both local paths now use the same text serializer, including
when tool interactions are flattened without declared tools. Text and JSON
objects survive, and recognized images become media-type placeholders without
copying their payload or URL. Empty and invalid content retains the existing
empty text, rather than adopting upstream's `(no output)` placeholder. Caller
IDs, error status, result wire shape, routing, and turn handling remain local
contracts. Native converters and upstream's ID synthesis are not ported.

The supported representation is a string, a result record, or a top-level list
of strings and result blocks. The list is walked once: nested lists are
unsupported and produce no output. Structured records still use JSON
serialization, and recognized image blocks retain their safe placeholders.
