# Responses incomplete stream usage (#1073)

Responses streams can end with `response.incomplete` and still report usage. The ordinary Responses passthrough and Codex same-format streaming paths now pass that reported usage through the same normalization and completion accounting used for `response.completed` and `response.done`. The original terminal and content remain on the wire, and the completion callback runs once.

A terminal without usage does not acquire a usage receipt from this change. Explicit errors and other terminal routes retain their existing handling. This change does not alter cost or billing semantics, estimate missing usage, or broaden support for other event types.
