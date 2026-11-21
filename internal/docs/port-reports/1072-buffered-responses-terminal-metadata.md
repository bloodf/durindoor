# #1072 Buffered Responses terminal metadata

When a provider sends a coherent buffered Responses terminal, its response ID
and creation timestamp fill fields missing from valid `response.created`
frames. A coherent `response.incomplete` can return partial output and usage
with its incomplete status. Terminal snapshots fill missing output indices
within the existing item limit. Observed items retain their original indices
and values.

The buffered converter skips the exact provider `keepalive` label when the
frame has no payload and contains only optional empty data lines. Data-bearing
keepalives and labels such as `keepalive-status` follow ordinary parsing.
Malformed frames, failed or truncated streams, and sparse or duplicate observed
indices still fail under the existing terminal and output checks.
