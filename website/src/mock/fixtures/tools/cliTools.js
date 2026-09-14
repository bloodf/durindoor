// CLI tool configuration seeds. Each entry is the tool's on-disk config as the
// real settings routes would read it, plus whether the CLI is installed.
// Mix: several tools point at DurinDoor, a few are installed but untouched,
// and a few are not installed at all.
import { API_KEYS, LOCAL_PORT } from "../world.js";

export const LOCAL_BASE = `http://localhost:${LOCAL_PORT}`;
export const LOCAL_V1 = `${LOCAL_BASE}/v1`;
const WORKSTATION_KEY = API_KEYS[0].key;
const AGENTS_KEY = API_KEYS[2].key;

export const HOME = "/Users/balin";

// Remote plugins Claude Cowork ships with (src/shared/constants/coworkPlugins.js).
export const COWORK_DEFAULT_PLUGINS = Object.freeze([
  { name: "exa", title: "Exa", description: "Real-time web search and code documentation", url: "https://mcp.exa.ai/mcp", transport: "http", oauth: false, toolNames: ["web_search_exa", "web_fetch_exa"] },
  { name: "tavily", title: "Tavily", description: "Real-time web search optimized for LLM agents", url: "https://mcp.tavily.com/mcp", transport: "http", oauth: true, toolNames: ["tavily_search", "tavily_extract", "tavily_crawl", "tavily_map"] },
]);

export const COWORK_LOCAL_STDIO_PLUGINS = Object.freeze([
  {
    name: "browsermcp", title: "Browser MCP", description: "Control your running Chrome (requires Chrome extension)",
    extensionUrl: "https://chromewebstore.google.com/detail/browser-mcp-automate-your/bjfgambnhccakkhmkepdoekmckoijdlc",
    command: "npx", args: ["-y", "@browsermcp/mcp@latest"],
    toolNames: ["browser_navigate", "browser_snapshot", "browser_click", "browser_type", "browser_screenshot", "browser_get_console_logs", "browser_wait", "browser_press_key", "browser_go_back", "browser_go_forward"],
  },
]);

export const CLI_TOOL_SEEDS = Object.freeze({
  claude: {
    installed: true,
    config: {
      $schema: "https://json.schemastore.org/claude-code-settings.json",
      env: {
        ANTHROPIC_BASE_URL: LOCAL_V1,
        ANTHROPIC_AUTH_TOKEN: WORKSTATION_KEY,
        ANTHROPIC_DEFAULT_OPUS_MODEL: "cc/claude-opus-5",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "daily-coder",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "groq/openai/gpt-oss-120b",
        CLAUDE_CODE_MAX_CONTEXT_TOKENS: "400000",
      },
      permissions: { allow: ["Bash(git status)", "Bash(npm test:*)"] },
      theme: "dark",
    },
  },
  codex: {
    installed: true,
    config: [
      'model = "thinker"',
      'model_provider = "9router"',
      'model_reasoning_effort = "high"',
      "",
      "[model_providers.9router]",
      'name = "DurinDoor"',
      `base_url = "${LOCAL_V1}"`,
      'wire_api = "responses"',
      "",
      "[agents.subagent]",
      'model = "cx/gpt-5.5"',
      "",
    ].join("\n"),
  },
  opencode: {
    installed: true,
    config: {
      $schema: "https://opencode.ai/config.json",
      provider: {
        "9router": {
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: LOCAL_V1, apiKey: AGENTS_KEY },
          models: {
            "daily-coder": { name: "daily-coder", modalities: { input: ["text", "image"], output: ["text"] } },
            "cc/claude-sonnet-5": { name: "cc/claude-sonnet-5", modalities: { input: ["text", "image"], output: ["text"] } },
            "deepseek/deepseek-v4-pro": { name: "deepseek/deepseek-v4-pro", modalities: { input: ["text", "image"], output: ["text"] } },
          },
        },
      },
      model: "9router/daily-coder",
      agent: { explorer: { description: "Fast explorer subagent for codebase exploration", mode: "subagent", model: "9router/cheap-fallback" } },
    },
  },
  droid: {
    installed: true,
    config: { model: "claude-sonnet-4-5", customModels: [], autonomyLevel: "medium" },
  },
  openclaw: { installed: false, config: null },
  hermes: {
    installed: true,
    config: { model: { default: "cheap-fallback", provider: "custom", base_url: LOCAL_V1, api_key: "${OPENAI_API_KEY}" } },
  },
  cowork: {
    installed: true,
    config: {},
  },
  cline: {
    installed: true,
    config: {
      actModeApiProvider: "openai",
      planModeApiProvider: "openai",
      openAiBaseUrl: LOCAL_BASE,
      openAiModelId: "vision-stack",
      planModeOpenAiModelId: "vision-stack",
    },
  },
  kilo: { installed: false, config: null },
  "deepseek-tui": {
    installed: true,
    config: { provider: "openai", "providers.openai": { base_url: LOCAL_V1, api_key: WORKSTATION_KEY, model: "deepseek/deepseek-v4-pro" } },
  },
  jcode: { installed: false, config: null },
  "grok-build": {
    installed: true,
    config: { model: null, default: "grok-build" },
  },
  copilot: {
    installed: true,
    config: [
      {
        name: "DurinDoor", vendor: "azure", apiKey: WORKSTATION_KEY,
        models: ["daily-coder", "gh/gpt-5.4"].map((id) => ({
          id, name: id, url: `${LOCAL_V1}/chat/completions#models.ai.azure.com`, toolCalling: true, vision: false, maxInputTokens: 128000, maxOutputTokens: 16000,
        })),
      },
    ],
  },
});

export const CLI_TOOL_PATHS = Object.freeze({
  claude: { settingsPath: `${HOME}/.claude/settings.json` },
  codex: { configPath: `${HOME}/.codex/config.toml` },
  opencode: { configPath: `${HOME}/.config/opencode/opencode.json` },
  droid: { settingsPath: `${HOME}/.factory/settings.json` },
  openclaw: { settingsPath: `${HOME}/.openclaw/openclaw.json` },
  hermes: { configPath: `${HOME}/.hermes/config.yaml` },
  cowork: { configPath: `${HOME}/Library/Application Support/Claude-3p/configLibrary/3f1c9a7e-2b44-4d0e-9a61-5c8e7d2b1f03.json` },
  cline: { globalStatePath: `${HOME}/.cline/data/globalState.json` },
  kilo: { authPath: `${HOME}/.local/share/kilo/auth.json` },
  "deepseek-tui": { configPath: `${HOME}/.deepseek/config.toml` },
  jcode: { configPath: `${HOME}/.jcode/config.toml` },
  "grok-build": { configPath: `${HOME}/.grok/config.toml` },
  copilot: { configPath: `${HOME}/Library/Application Support/Code/User/chatLanguageModels.json` },
});

export const NOT_INSTALLED_MESSAGES = Object.freeze({
  claude: "Claude CLI is not installed",
  codex: "Codex CLI is not installed",
  opencode: "OpenCode CLI is not installed",
  droid: "Factory Droid CLI is not installed",
  openclaw: "Open Claw CLI is not installed",
  hermes: "Hermes Agent is not installed",
  cowork: "Claude Desktop (Cowork mode) not detected",
  cline: "Cline CLI is not installed",
  kilo: "Kilo Code CLI is not installed",
  "deepseek-tui": "DeepSeek TUI is not installed",
  jcode: "jcode not installed. Install via: curl -fsSL https://raw.githubusercontent.com/1jehuang/jcode/master/scripts/install.sh | bash",
  "grok-build": "Grok Build is not installed",
});
