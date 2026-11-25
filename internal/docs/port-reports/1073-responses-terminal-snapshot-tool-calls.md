# Responses terminal snapshot tool calls (#1073)

Completed Responses terminal snapshots can supply function calls missing from the preceding event stream. The Responses-to-Chat translator recovers their identities, names and complete arguments before the final tool-calls marker, while retaining calls and argument fragments already emitted from ordinary added, delta and done events. Output indices and call identities correlate repeated items. Text recovery and usage handling remain in place.

Recovery applies to function-call items in coherent completed snapshots. Incomplete and failed terminals retain their existing non-success semantics; custom tool input continues through its existing event handling. This does not introduce a new tool mode or change buffered response accumulation.

A named snapshot-only function at an unused output index receives its own fallback call ID even when an earlier call has already streamed. An anonymous function already associated with that output index is not replayed; ordinary anonymous done events retain their existing correlation behavior.
