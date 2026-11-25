# Responses replay identity and EOF

OmniRoute #15510 (commit 408b4f2bd) supplies sequence-number replay suppression, already ported locally. This follow-up retains the local terminal and usage delivery contract: a terminal or usage event for a different response is forwarded without replacing the active response identity or advancing its watermark. A new identified non-protected response event resets the watermark, while streams without IDs retain sequence-based behavior. State remains per stream and constant sized.

The translated EOF path now applies the same replay check as ordinary frames before recording or translating an unterminated final event. Fresh EOF events still flow through translation and existing incomplete-stream handling; snapshot-only completions remain supported. Passthrough framing, protected accounting and terminal events remain intact.

Offline coverage exercises the two independently reviewed regressions, interrupted and completed EOF, unrelated terminal and usage events, reset numbering and independent trackers. Existing replay and terminal snapshot tests cover additional raw, translated, usage and snapshot contracts. No live provider calls are needed.

## Replayed creation of a seen response

Follow-up to DurinDoor #2107 and OmniRoute #15510. A reconnect that replays the creation of an already-seen response, while a newer response is active, used to reset the watermark to that older id. The newer response's earlier deltas were then forwarded a second time. The tracker now keeps a capped list (16) of superseded response ids per stream. A non-protected event carrying one of those ids is treated as a replay and dropped without touching the active id or watermark. An id never seen before is still a genuine new response and starts fresh numbering. Terminal, usage and final EOF delivery are unchanged, and the client contract is untouched.

Offline coverage replays a historical creation with a current delta, a duplicate unterminated EOF and a fresh EOF, and confirms a real new response still resets numbering.
