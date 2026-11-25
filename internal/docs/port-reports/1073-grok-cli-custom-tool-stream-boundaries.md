# Grok CLI custom-tool stream boundaries (#1073)

Grok Build custom-tool response wrappers transfer provider attempt ownership to the returned response. Stream framing and per-call argument accumulation use the existing pending SSE limit; oversized events or arguments terminate the stream. Explicit item IDs take precedence over output indexes, and completed custom calls suppress repeated argument frames. Ordinary function frames and terminal response identities remain intact.
