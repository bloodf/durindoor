import { isString } from "../../../../shared/utils/typeChecks.js";

function stdioPreset({ slug, title, packageName, args = [], env = {}, setup, docs, requirements = [] }) {
  return {
    slug,
    title,
    kind: "npx",
    transport: "stdio",
    command: "npx",
    args: JSON.stringify(["-y", packageName, ...args]),
    env: JSON.stringify(env),
    headers: "{}",
    url: "",
    oauth: false,
    providerConnectionId: undefined,
    setup,
    docs,
    requirements,
  };
}

export const MCP_SERVER_PRESETS = [
  { id: "custom", label: "Custom", hint: "Enter server configuration", setup: "Enter your server configuration. No preset values are applied.", docs: null },
  { id: "zai-search", label: "Z.AI Web Search", hint: "Hosted HTTP", slug: "zai-search", title: "Z.AI Web Search", kind: "http", transport: "http", url: "https://api.z.ai/api/mcp/web_search_prime/mcp", command: "", args: "[]", env: "{}", headers: "{}", oauth: false, providerConnectionId: undefined, setup: "Enter a saved Z.AI provider connection ID. The gateway supplies its stored API key without exposing it in Headers.", docs: "https://docs.z.ai", requirements: [{ type: "providerConnection", message: "Enter a saved Z.AI provider connection ID before saving." }] },
  { id: "context7", label: "Context7", hint: "Hosted HTTP", slug: "context7", title: "Context7", kind: "http", transport: "http", url: "https://mcp.context7.com/mcp", command: "", args: "[]", env: "{}", headers: "{}", oauth: false, providerConnectionId: undefined, setup: "Uses Context7 public access. Its API-key authentication uses Authorization headers, which gateway intentionally does not accept.", docs: "https://context7.com/docs/installation" },
  { id: "github", label: "GitHub", hint: "Local Docker", slug: "github", title: "GitHub", kind: "docker", transport: "stdio", command: "docker", args: "[\"run\",\"-i\",\"--rm\",\"-e\",\"GITHUB_PERSONAL_ACCESS_TOKEN\",\"ghcr.io/github/github-mcp-server\"]", env: "{}", headers: "{}", url: "", oauth: false, providerConnectionId: undefined, setup: "Docker must be installed. Set GITHUB_PERSONAL_ACCESS_TOKEN in Env JSON with a least-privilege GitHub PAT.", docs: "https://github.com/github/github-mcp-server", requirements: [{ type: "env", key: "GITHUB_PERSONAL_ACCESS_TOKEN", message: "Set GITHUB_PERSONAL_ACCESS_TOKEN in Env JSON before saving GitHub." }] },
  stdioPreset({ id: "playwright", slug: "playwright", title: "Playwright", packageName: "@playwright/mcp@latest", setup: "Node.js 18+ and browser dependencies are required on the gateway host.", docs: "https://github.com/microsoft/playwright-mcp" }),
  stdioPreset({ id: "filesystem", slug: "filesystem", title: "Filesystem", packageName: "@modelcontextprotocol/server-filesystem", setup: "Add only explicit non-root directories in Args JSON after the package argument; never grant /. Example shape: [\"-y\", \"@modelcontextprotocol/server-filesystem\", \"/approved/directory\"].", docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem", requirements: [{ type: "filesystemPath", message: "Add at least one explicit non-root absolute directory to Args JSON before saving Filesystem." }] }),
  stdioPreset({ id: "memory", slug: "memory", title: "Memory", packageName: "@modelcontextprotocol/server-memory", setup: "Persistent local knowledge graph. Review host storage policy before enabling.", docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory" }),
  stdioPreset({ id: "sequential-thinking", slug: "sequential-thinking", title: "Sequential Thinking", packageName: "@modelcontextprotocol/server-sequential-thinking", setup: "No credentials required.", docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking" }),
  { id: "fetch", label: "Fetch", hint: "Local Python", slug: "fetch", title: "Fetch", kind: "python", transport: "stdio", command: "uvx", args: "[\"mcp-server-fetch\"]", env: "{}", headers: "{}", url: "", oauth: false, providerConnectionId: undefined, setup: "Install uv on the gateway host. No credentials required; server retrieves public web content from gateway host.", docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch" },
  stdioPreset({ id: "brave-search", slug: "brave-search", title: "Brave Search", packageName: "@brave/brave-search-mcp-server", setup: "Set BRAVE_API_KEY in Env JSON before saving.", docs: "https://github.com/brave/brave-search-mcp-server", requirements: [{ type: "env", key: "BRAVE_API_KEY", message: "Set BRAVE_API_KEY in Env JSON before saving Brave Search." }] }),
  { id: "firecrawl", label: "Firecrawl", hint: "Hosted HTTP", slug: "firecrawl", title: "Firecrawl", kind: "http", transport: "http", url: "https://mcp.firecrawl.dev/v2/mcp", command: "", args: "[]", env: "{}", headers: "{}", oauth: false, providerConnectionId: undefined, setup: "Keyless access is rate limited. This preset does not connect a Firecrawl account. Do not put bearer tokens in Headers.", docs: "https://docs.firecrawl.dev/mcp-server/keyless" },
  { id: "notion", label: "Notion", hint: "Hosted HTTP + OAuth", slug: "notion", title: "Notion", kind: "http", transport: "http", url: "https://mcp.notion.com/mcp", command: "", args: "[]", env: "{}", headers: "{}", oauth: true, providerConnectionId: undefined, setup: "Save, then use Login to authorize Notion. Gateway needs a public HTTPS callback URL.", docs: "https://developers.notion.com/guides/mcp/get-started-with-mcp" },
  { id: "linear", label: "Linear", hint: "Hosted HTTP + OAuth", slug: "linear", title: "Linear", kind: "http", transport: "http", url: "https://mcp.linear.app/mcp", command: "", args: "[]", env: "{}", headers: "{}", oauth: true, providerConnectionId: undefined, setup: "Save, then use Login to authorize Linear. Gateway needs a public HTTPS callback URL.", docs: "https://linear.app/docs/mcp" },
].map((preset) => ({ ...preset, id: preset.id ?? preset.slug, label: preset.label ?? preset.title, hint: preset.hint ?? "Local stdio" }));

export const MCP_SERVER_PRESET_OPTIONS = MCP_SERVER_PRESETS.map(({ id, label, hint }) => ({ value: id, label, hint }));

export function getMcpServerPreset(id) {
  return MCP_SERVER_PRESETS.find((preset) => preset.id === id) ?? MCP_SERVER_PRESETS[0];
}

export function presetSaveError(preset, form) {
  if (!preset?.requirements?.length) return null;
  const args = parseJson(form.args, []);
  const env = parseJson(form.env, {});
  for (const requirement of preset.requirements) {
    if (requirement.type === "env" && (!isString(env[requirement.key]) || !env[requirement.key].trim())) return requirement.message;
    if (requirement.type === "providerConnection" && (!isString(form.providerConnectionId) || !form.providerConnectionId.trim())) return requirement.message;
    if (requirement.type === "filesystemPath") {
      const paths = Array.isArray(args) ? args.slice(2) : [];
      if (!paths.length || !paths.every(isNonRootAbsolutePath)) return requirement.message;
    }
  }
  return null;
}

function isNonRootAbsolutePath(path) {
  if (!isString(path) || !path.startsWith("/")) return false;
  let depth = 0;
  for (const segment of path.split("/")) {
    if (segment === "..") depth = Math.max(0, depth - 1);
    else if (segment && segment !== ".") depth += 1;
  }
  return depth > 0;
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}
