# Claude initial-output accounting

Issue: [#2702](https://github.com/bloodf/durindoor/issues/2702).

Only an initial numeric `message_start` output count of `1` is provisional. Initial measured counts such as `0`, `5` and `80` remain authoritative when a later receipt omits output usage. A later explicit output receipt, including `0` or `1`, replaces the earlier count; a lower final receipt is not discarded.

Reading a stream snapshot must not consume provisional state before the final provider receipt arrives. Finalization resolves missing provisional output once, preserves raw receipt data, and keeps interruption persistence from being counted twice. Empty estimated canonical output is the literal number `0`.

The regression coverage exercises both Claude and OpenAI client projections, measured and absent receipts, repeated starts, thinking and tool content, snapshots and interruption persistence. The older stream-tail assertion that treated initial measured `5` as provisional is corrected to require a final measurement and retain literal `5`; its lower-final-`3` control remains.

This addresses a conditional accounting defect. It does not establish how frequently real providers send a placeholder, change provider retry or cooldown policy, or prove live-provider behavior. The failure baseline remains unchanged.
