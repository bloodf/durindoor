export const GITHUB_CLAUDE_MAX_PROMPT_TOKENS = 200_000;
export const GITHUB_COUNT_TOKENS_PREFLIGHT_RATIO = 0.5;
export const GITHUB_COUNT_TOKENS_TIMEOUT_MS = 10_000;

/**
 * Request fields forwarded to Copilot's /v1/messages shim from a Claude-source
 * body. Beta-only client fields (context_management, mcp_servers, metadata, ...)
 * stay off the wire, as they did when the request crossed the OpenAI shape.
 */
export const GITHUB_MESSAGES_BODY_FIELDS = Object.freeze([
  "model", "messages", "system", "max_tokens", "stream", "temperature", "top_p", "top_k",
  "stop_sequences", "tools", "tool_choice", "thinking", "output_config",
]);
