# #1072: Claude native search over Codex

Claude Messages requests declaring `web_search_20250305` can use Codex hosted
search. The declaration is converted in place to a Responses `web_search` tool,
with `web_search_call.action.sources` included alongside encrypted reasoning.
Only explicit declarations enable search. Client-supplied `include` fields are not
forwarded by this conversion. A forced hosted search choice is accepted only
for the Claude native-search conversion; ordinary Chat choice validation is unchanged.

Hosted search actions become Claude `server_tool_use` and
`web_search_tool_result` blocks. Source URLs come from the search action or,
when attributable to one search, URL citations. Late or unattributed citations
are presented as answer-source text. Search counts appear in
`usage.server_tool_use.web_search_requests`. Streaming and accumulated responses
share the evidence conversion; ordinary Responses-to-Claude requests continue
through the existing translator. Search history forwarded to Codex retains
queries and source URLs as text; Codex does not produce Anthropic encrypted
search content.

Codex cannot enforce Anthropic search restrictions or `max_uses`, so requests
with those controls are rejected instead of silently weakening them. Other
unsupported routes return a 400. Native Anthropic and routes declaring support
for the tool, including DeepSeek's Claude transport, retain their existing
behavior. `/v1/search` is a separate surface.
