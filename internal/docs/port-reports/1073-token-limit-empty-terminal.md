# #1073 Token-limit completions with empty visible output

[OmniRoute #3595](https://github.com/cheaper-inference/OmniRoute/pull/3595) was
reviewed at head `93f3e268a8d29dee324cdb41dc3a48c2d3f33046` and merge
`1bc858837af4b9fa29208117b21e19f67dd19671`. The patch was read from
`/var/tmp/durindoor-omniroute-source.4eUb6QtM/source.git` as the exact diff
from first parent `2947bfd5eb85605cb6139f7543975843fd860f0c`. The pinned head and
merge have the same tree. The comparison base was DurinDoor integration
`759c7a281b1fcfef82fcc5e734002b1809719b46`. The [June report](1073-june-existing-response-contracts.md#5-omniroute-3595---a-token-limit-truncated-response-is-a-normal-terminal-status)
records the pre-port diagnostic results.

The non-streaming guard now accepts an OpenAI completion with an exact
`finish_reason: "length"` and a message object, or a Claude message with an
exact `stop_reason: "max_tokens"` and a content array. The normal protocol
validation still runs first. Claude `content: null` remains an empty-response
error, and Antigravity retains its existing provider-specific empty-stop policy.
The port covers the token-limit reasons. Empty tool turns retain DurinDoor's
existing handling.

On streams the gateway uses the original finish or stop reason and the existing
terminal tracker. A valid OpenAI terminal includes the choice finish and
`[DONE]`. A valid Claude terminal includes the Messages lifecycle through
`message_stop`. The terminal guard can forward the completion at zero output
tokens, and the account and combo peeks can replay it without treating it as
empty. The evidence stays on the in-process stream body and its replay, so a
synthetic client sentinel alone does not qualify. Buffering Claude SSE to JSON
also keeps the terminal response without invoking the empty-stream cooldown.

Ordinary empty `stop` and `end_turn` responses still follow their existing error
or retry paths. Existing Claude refusal, wire-error, terminal validation, output
metadata, usage buffering and cache-token behavior continue through the same
paths. Output-token counts remain part of the existing stream classifier and
accounting, independently of the token-limit decision.

The offline regression fixture checks both dialects at zero and nonzero output
usage, native and translated streaming, buffered Claude SSE, replay, combo retry,
and empty or incomplete responses. The existing Antigravity and Claude
`content: null` assertions remain in their original fixtures.
