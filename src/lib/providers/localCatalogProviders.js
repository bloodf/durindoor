// Web-session providers whose model list is the curated registry catalog. They publish no
// list-models endpoint a session cookie or token may be sent to, so discovery answers from
// the registry without a request (see fetchConnectionModels and canDiscoverModels).
export const LOCAL_CATALOG_WEB_PROVIDERS = new Set([
  "t3-web", "adapta-web",
  "claude-web", "gemini-web", "deepseek-web", "doubao-web", "zai-web", "chatgpt-web-codex",
]);
