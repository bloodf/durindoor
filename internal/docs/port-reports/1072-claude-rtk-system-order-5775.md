# Port report: Claude token-saver system order (#1072)

Source: https://github.com/decolua/9router/pull/5775, pinned head `0287751753917a516f8962d946913cbecd07e36b`.

Upstream changes the Claude array-system injection position when the last cache boundary is on an identity block, preserving that block before the token-saver prompt. Locally, `open-sse/rtk/systemInject.js` serves Caveman, Ponytail and custom prompts; it previously inserted before the last cache-controlled block even when that block was the leading existing Claude identity. `open-sse/config/appConstants.js` already supplies `CLAUDE_SYSTEM_PROMPT`, and `open-sse/translator/request/openai-to-claude.js` uses it in the existing Claude request path.

Disposition: port the ordering fix narrowly when the last cache boundary is the leading block and its text starts with the existing identity. Keep that block and its cache marker intact; the inserted prompt follows the boundary in this special case. For later boundaries, retain insertion before the last boundary. Other caller blocks, string systems, non-Claude shapes and exact duplicate prevention retain their existing behavior. This does not create or change identity content.

Offline coverage: `tests/unit/port9r-claude-rtk-system-order-5775.test.js` exercises the leading cached identity, caller content, repeat injection, later cache boundaries, ordinary Claude systems and OpenAI ordering.
