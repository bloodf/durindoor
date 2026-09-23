export default {
  id: "chipotle",
  priority: 70,
  hasFree: true,
  alias: "pepper",
  uiAlias: "pepper",
  display: {
    name: "Chipotle Pepper",
    icon: "restaurant",
    color: "#ad2118",
    textIcon: "CP",
    website: "https://amelia.chipotle.com",
    notice: {
      text: "No-auth Amelia/Chipotle web chat provider. Availability depends on the public Chipotle Amelia session endpoint.",
    },
  },
  category: "free",
  // amelia.chipotle.com returns 404 (Azure Application Gateway) on every path
  // checked, including root and /v1/models — the host is decommissioned, not a
  // licensing risk, so this uses the same mechanism as dify/databricks/zed
  // (hidden: true) rather than the deprecated/deprecationNotice risk-notice
  // pair used for claude/codex/etc. Existing connections keep routing.
  hidden: true,
  noAuth: true,
  // Registry-curated auto-combo membership (open-sse/config/providers.js
  // NOAUTH_PROVIDERS) is intentionally kept even for a currently-down host:
  // it is an opportunistic candidate like duckduckgo-web/theoldllm, not a
  // guaranteed-always-up member — matches the locked upstream-equivalent set.
  autoComboNoAuth: true,
  transport: {
    baseUrl: "https://amelia.chipotle.com",
    baseUrls: ["https://amelia.chipotle.com"],
    format: "openai",
    noAuth: true,
  },
  models: [{ id: "pepper-1", name: "Pepper (Chipotle AI)" }],
  passthroughModels: true,
};
