// MITM interception state, model alias mappings, and a small slice of the
// Anthropic MCP registry used by the Cowork marketplace modal.

export const MITM_SEED = Object.freeze({
  running: true,
  pid: 48213,
  certExists: true,
  certTrusted: true,
  dnsStatus: { antigravity: true, kiro: false },
  mitmRouterBaseUrl: "http://localhost:20128",
});

// tool -> alias -> { model, reasoningEffort? }; targets reference world combos/aliases.
export const MITM_ALIAS_SEED = Object.freeze({
  antigravity: {
    "gemini-3.8-flash-high": { model: "ag/gemini-3.8-flash-high" },
    "gemini-pro-agent": { model: "vision-stack", reasoningEffort: "high" },
    "claude-opus-4-6-thinking": { model: "cc/claude-opus-5", reasoningEffort: "xhigh" },
    "claude-sonnet-4-6": { model: "daily-coder" },
    "gpt-oss-120b-medium": { model: "groq/openai/gpt-oss-120b" },
  },
  kiro: {
    "claude-sonnet-5": { model: "daily-coder" },
    "claude-haiku-4.5": { model: "cheap-fallback" },
  },
});

export const COWORK_REGISTRY = Object.freeze([
  {
    name: "com.linear/linear", slug: "linear", title: "Linear", description: "Find, create and update Linear issues, projects and comments.",
    url: "https://mcp.linear.app/mcp", transport: "http", oauth: true, toolNames: ["list_issues", "create_issue", "update_issue", "list_projects", "create_comment"], toolCount: 5, iconUrl: null,
  },
  {
    name: "com.notion/notion", slug: "notion", title: "Notion", description: "Search and edit pages and databases in your Notion workspace.",
    url: "https://mcp.notion.com/mcp", transport: "http", oauth: true, toolNames: ["search", "fetch", "create_pages", "update_page"], toolCount: 4, iconUrl: null,
  },
  {
    name: "ai.exa/exa", slug: "exa", title: "Exa", description: "Real-time web search and code documentation.",
    url: "https://mcp.exa.ai/mcp", transport: "http", oauth: false, toolNames: ["web_search_exa", "web_fetch_exa"], toolCount: 2, iconUrl: null,
  },
  {
    name: "com.context7/context7", slug: "context7", title: "Context7", description: "Up-to-date library documentation and code examples.",
    url: "https://mcp.context7.com/mcp", transport: "http", oauth: false, toolNames: ["resolve-library-id", "query-docs"], toolCount: 2, iconUrl: null,
  },
  {
    name: "com.cloudflare/docs", slug: "cloudflare-docs", title: "Cloudflare Docs", description: "Search Cloudflare developer documentation.",
    url: "https://docs.mcp.cloudflare.com/sse", transport: "sse", oauth: false, toolNames: ["search_cloudflare_documentation"], toolCount: 1, iconUrl: null,
  },
  {
    name: "com.sentry/sentry", slug: "sentry", title: "Sentry", description: "Inspect issues, events and releases from Sentry.",
    url: "https://mcp.sentry.dev/mcp", transport: "http", oauth: true, toolNames: ["find_issues", "get_issue_details", "find_releases"], toolCount: 3, iconUrl: null,
  },
]);

export const COWORK_REGISTRY_TOOLS = Object.freeze({
  "https://mcp.exa.ai/mcp": [
    { name: "web_search_exa", description: "Search the web and return clean, ranked results" },
    { name: "web_fetch_exa", description: "Fetch a URL and return readable content" },
  ],
  "https://mcp.context7.com/mcp": [
    { name: "resolve-library-id", description: "Resolve a package name to a Context7 library id" },
    { name: "query-docs", description: "Fetch documentation for a library id and topic" },
  ],
  "https://docs.mcp.cloudflare.com/sse": [
    { name: "search_cloudflare_documentation", description: "Semantic search over Cloudflare docs" },
  ],
});
