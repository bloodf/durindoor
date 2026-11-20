# 1072: Claude system metadata

Source: https://github.com/decolua/9router/pull/5774, pinned head `5da71fe4dd75ef8c2722ae5a9405f1921bc96866` (open at inspection). Its patch removes a leading `x-anthropic-billing-header` line from each OpenAI system message before joining cached Claude system text.

Local evidence: `open-sse/translator/request/openai-to-claude.js` previously joined extracted system and developer text without this removal. The same translator also serves compatible providers and adds the Claude persona only when the routed provider is `claude`. The local Claude-to-OpenAI translator already removes this leading line; provider-owned handling remains separate in `open-sse/utils/claudeCloaking.js`.

Disposition: adapted the leading-line removal for system messages routed to Claude only. Header-only messages are omitted; remaining text, developer messages, other providers and the existing cache block structure are preserved. Extraction retains the existing local array joining behavior. The scoped offline test covers these boundaries and input immutability.

Related source: https://github.com/decolua/9router/pull/5772 was closed without merging. It overlaps #5774 in removing the same leading metadata, but proposes handling each array text block separately and a shared helper. Those broader changes are not included in the pinned #5774 adaptation.
