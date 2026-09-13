// Per-tool translation between the settings routes' request/response shapes
// and the stored config. Each adapter mirrors its route in
// src/app/api/cli-tools/<tool>-settings/route.js:
//   view(config)            -> response fields besides `installed`
//   apply(config, body)     -> { config } or { error }
//   reset(config, query)    -> next config
import { redactSecrets } from "@/shared/utils/secretRedaction.js";
import { CLI_TOOL_PATHS, COWORK_DEFAULT_PLUGINS, COWORK_LOCAL_STDIO_PLUGINS, LOCAL_BASE } from "../../fixtures/tools/cliTools.js";

const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/;
const COWORK_APPLIED_ID = "3f1c9a7e-2b44-4d0e-9a61-5c8e7d2b1f03";

// The demo runs on a public origin; stored URLs are rewritten to the local
// DurinDoor port so every card reads as "connected to this machine".
export function localize(url) {
  try {
    const parsed = new URL(url);
    if (LOCAL_HOST_RE.test(parsed.hostname)) return url;
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${LOCAL_BASE}${path}`;
  } catch {
    return url;
  }
}

const withV1 = (url) => (url.endsWith("/v1") ? url : `${url}/v1`);
const withoutV1 = (url) => (url.endsWith("/v1") ? url.slice(0, -3) : url);
const isLocal = (url) => /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(url || "");
const fail = (error) => ({ error });
const paths = (tool) => CLI_TOOL_PATHS[tool];

function omitKeys(object, predicate) {
  return Object.fromEntries(Object.entries(object || {}).filter(([key]) => !predicate(key)));
}

const claude = {
  view: (config) => ({ settings: redactSecrets(config), has9Router: Boolean(config?.env?.ANTHROPIC_BASE_URL), ...paths("claude") }),
  apply: (config, { env, maxContextTokens }) => {
    if (!env || typeof env !== "object") return fail("Invalid env object");
    const kept = omitKeys(config?.env, (key) => key.startsWith("ANTHROPIC_") || key === "CLAUDE_CODE_MAX_CONTEXT_TOKENS");
    const nextEnv = { ...kept, ...env, ANTHROPIC_BASE_URL: localize(env.ANTHROPIC_BASE_URL || `${LOCAL_BASE}/v1`) };
    const finalEnv = maxContextTokens ? { ...nextEnv, CLAUDE_CODE_MAX_CONTEXT_TOKENS: String(maxContextTokens) } : omitKeys(nextEnv, (key) => key === "CLAUDE_CODE_MAX_CONTEXT_TOKENS");
    return { config: { ...config, env: finalEnv } };
  },
  reset: (config) => ({ ...config, env: omitKeys(config?.env, (key) => key.startsWith("ANTHROPIC_") || key === "CLAUDE_CODE_MAX_CONTEXT_TOKENS") }),
};

const codex = {
  view: (config) => ({ config, has9Router: Boolean(config?.includes('model_provider = "9router"')), ...paths("codex") }),
  apply: (_config, { baseUrl, apiKey, model, subagentModel }) => {
    if (!baseUrl || !apiKey || !model) return fail("baseUrl, apiKey and model are required");
    const lines = [
      `model = "${model}"`, 'model_provider = "9router"', 'model_reasoning_effort = "high"', "",
      "[model_providers.9router]", 'name = "DurinDoor"', `base_url = "${withV1(localize(baseUrl))}"`, 'wire_api = "responses"', "",
      "[agents.subagent]", `model = "${subagentModel || model}"`, "",
    ];
    return { config: lines.join("\n") };
  },
  reset: () => 'model = "gpt-5.5"\nmodel_reasoning_effort = "medium"\n',
};

const opencode = {
  view: (config) => {
    const provider = config?.provider?.["9router"];
    return {
      config: redactSecrets(config),
      has9Router: Boolean(provider),
      ...paths("opencode"),
      opencode: {
        models: Object.keys(provider?.models || {}),
        activeModel: config?.model?.startsWith("9router/") ? config.model.replace(/^9router\//, "") : null,
        baseURL: provider?.options?.baseURL || null,
      },
    };
  },
  apply: (config, { baseUrl, apiKey, model, models, activeModel, subagentModel }) => {
    const list = (Array.isArray(models) ? models : model ? [model] : []).filter((item) => typeof item === "string" && item);
    if (!baseUrl || list.length === 0) return fail("baseUrl and at least one model are required");
    const existing = config?.provider?.["9router"] || {};
    const modelMap = { ...existing.models };
    list.forEach((id) => { modelMap[id] = { name: id, modalities: { input: ["text", "image"], output: ["text"] } }; });
    const nextModel = activeModel === "" ? "" : `9router/${activeModel || list[0]}`;
    return {
      config: {
        ...config,
        provider: {
          ...config?.provider,
          "9router": { npm: existing.npm || "@ai-sdk/openai-compatible", options: { baseURL: withV1(localize(baseUrl)), apiKey: apiKey || existing.options?.apiKey || "sk_durindoor" }, models: modelMap },
        },
        model: nextModel,
        agent: { ...config?.agent, explorer: { description: "Fast explorer subagent for codebase exploration", mode: "subagent", model: `9router/${subagentModel || list[0]}` } },
      },
    };
  },
  patch: (config, { clearActiveModel }) => (clearActiveModel === true && config?.model?.startsWith("9router/") ? { ...config, model: "" } : config),
  reset: (config, query) => {
    const provider = config?.provider?.["9router"];
    const target = query?.model;
    if (target && provider?.models?.[target]) {
      const remaining = Object.keys(provider.models).filter((id) => id !== target);
      if (remaining.length) {
        const nextModel = config.model === `9router/${target}` ? `9router/${remaining[0]}` : config.model;
        return { ...config, model: nextModel, provider: { ...config.provider, "9router": { ...provider, models: omitKeys(provider.models, (id) => id === target) } } };
      }
    }
    if (target && !provider?.models?.[target]) return config;
    const { model: currentModel, agent, ...rest } = config || {};
    const next = { ...rest, provider: omitKeys(config?.provider, (key) => key === "9router") };
    if (currentModel && !currentModel.startsWith("9router/")) next.model = currentModel;
    const nextAgent = omitKeys(agent, (key) => key === "explorer" && agent.explorer?.model?.startsWith("9router/"));
    return Object.keys(nextAgent).length ? { ...next, agent: nextAgent } : next;
  },
};

const droid = {
  view: (config) => ({ settings: redactSecrets(config), has9Router: Boolean(config?.customModels?.some((m) => m.id?.startsWith("custom:9Router"))), ...paths("droid") }),
  apply: (config, { baseUrl, apiKey, model, models, activeModel }) => {
    const list = (Array.isArray(models) ? models : model ? [model] : []).filter((item) => typeof item === "string" && item);
    if (!baseUrl || list.length === 0) return fail("baseUrl and at least one model are required");
    const others = (config?.customModels || []).filter((m) => !m.id?.startsWith("custom:9Router"));
    const entries = list.map((id, index) => ({
      model: id, id: `custom:9Router-${index}`, index, baseUrl: withV1(localize(baseUrl)), apiKey: apiKey || "sk_durindoor",
      displayName: id, maxOutputTokens: 131072, noImageSupport: false, provider: "openai",
    }));
    const defaultIndex = activeModel === "" ? -1 : Math.max(list.indexOf(activeModel), 0);
    const next = { ...config, customModels: [...others, ...entries] };
    return { config: defaultIndex >= 0 ? { ...next, model: `custom:9Router-${defaultIndex}` } : next };
  },
  reset: (config) => ({ ...config, customModels: (config?.customModels || []).filter((m) => !m.id?.startsWith("custom:9Router")) }),
};

const openclaw = {
  view: (config) => ({
    settings: redactSecrets(config),
    agents: (config?.agents?.list || []).map((agent) => ({ ...agent, currentModel: agent.model?.replace(/^9router\//, "") || null })),
    has9Router: Boolean(config?.models?.providers?.["9router"]),
    ...paths("openclaw"),
  }),
  apply: (config, { baseUrl, apiKey, model, agentModels = {} }) => {
    if (!baseUrl || !model) return fail("baseUrl and model are required");
    const ids = [...new Set([model, ...Object.values(agentModels).filter(Boolean)])];
    const allowlist = omitKeys(config?.agents?.defaults?.models, (key) => key.startsWith("9router/"));
    ids.forEach((id) => { allowlist[`9router/${id}`] = {}; });
    const list = config?.agents?.list?.map((agent) => (agentModels[agent.id] ? { ...agent, model: `9router/${agentModels[agent.id]}` } : agent));
    return {
      config: {
        ...config,
        agents: { ...config?.agents, defaults: { ...config?.agents?.defaults, model: { primary: `9router/${model}` }, models: allowlist }, ...(list ? { list } : {}) },
        models: { ...config?.models, providers: { ...config?.models?.providers, "9router": { baseUrl: withV1(localize(baseUrl)), apiKey: apiKey || "your_api_key", api: "openai-completions", models: ids.map((id) => ({ id, name: id.split("/").pop() || id })) } } },
      },
    };
  },
  reset: (config) => ({ ...config, models: { ...config?.models, providers: omitKeys(config?.models?.providers, (key) => key === "9router") } }),
};

const hermes = {
  view: (config) => ({ settings: { model: config?.model || null }, has9Router: config?.model?.provider === "custom" && isLocal(config?.model?.base_url), ...paths("hermes") }),
  apply: (config, { baseUrl, model }) => {
    if (typeof baseUrl !== "string" || typeof model !== "string") return fail("baseUrl and model are required");
    return { config: { ...config, model: { default: model, provider: "custom", base_url: withV1(localize(baseUrl)), api_key: "${OPENAI_API_KEY}" } } };
  },
  reset: (config) => ({ ...config, model: null }),
};

const coworkEntry = (plugin) => ({
  name: plugin.name, url: plugin.url, transport: plugin.transport || "http", ...(plugin.oauth ? { oauth: true } : {}),
  toolPolicy: Object.fromEntries((plugin.toolNames || []).map((tool) => [tool, "allow"])),
});
const STDIO_NAMES = new Set(COWORK_LOCAL_STDIO_PLUGINS.map((plugin) => plugin.name));
const isBridge = (entry) => STDIO_NAMES.has(entry.name) && String(entry.url).includes("/api/mcp/");

const cowork = {
  view: (config) => {
    const managed = Array.isArray(config?.managedMcpServers) ? config.managedMcpServers : [];
    const baseUrl = config?.inferenceGatewayBaseUrl || null;
    return {
      config: redactSecrets(config),
      has9Router: config?.inferenceProvider === "gateway" && Boolean(baseUrl),
      ...paths("cowork"),
      cowork: {
        appliedId: COWORK_APPLIED_ID,
        baseUrl,
        models: config?.inferenceModels || [],
        provider: config?.inferenceProvider || null,
        plugins: managed.filter((m) => !m.custom && !isBridge(m)).map((m) => ({
          name: m.name, url: m.url, transport: m.transport, oauth: Boolean(m.oauth),
          toolNames: COWORK_DEFAULT_PLUGINS.find((plugin) => plugin.name === m.name)?.toolNames || Object.keys(m.toolPolicy || {}),
        })),
        localPlugins: managed.filter(isBridge).map((m) => m.name),
        customPlugins: managed.filter((m) => m.custom).map((m) => ({ name: m.name, url: m.url, transport: m.transport, custom: true })),
      },
      defaultPlugins: COWORK_DEFAULT_PLUGINS,
      localStdioPlugins: COWORK_LOCAL_STDIO_PLUGINS,
    };
  },
  apply: (config, { baseUrl, apiKey, models, plugins, localPlugins, customPlugins }) => {
    if (!baseUrl || !apiKey) return fail("baseUrl and apiKey are required");
    const modelList = (Array.isArray(models) ? models : []).filter((m) => typeof m === "string" && m.trim());
    if (!modelList.length) return fail("At least one model is required");
    const remote = (Array.isArray(plugins) ? plugins : COWORK_DEFAULT_PLUGINS).filter((p) => p?.name && p?.url).map(coworkEntry);
    const bridges = (Array.isArray(localPlugins) ? localPlugins : []).filter((name) => STDIO_NAMES.has(name))
      .map((name) => ({ name, url: `${LOCAL_BASE}/api/mcp/${name}/sse`, transport: "sse" }));
    const custom = (Array.isArray(customPlugins) ? customPlugins : []).filter((p) => p?.name && p?.url)
      .map((p) => ({ name: p.name, url: p.url, transport: p.transport || "sse", custom: true }));
    return {
      config: {
        ...config, inferenceProvider: "gateway", inferenceGatewayBaseUrl: withV1(localize(baseUrl)), inferenceGatewayApiKey: apiKey,
        inferenceModels: modelList, managedMcpServers: [...remote, ...bridges, ...custom],
      },
    };
  },
  reset: () => ({}),
  applyMessage: "Cowork enabled (3p mode set). Quit & reopen Claude Desktop.",
};

const cline = {
  view: (config) => ({
    settings: { actModeApiProvider: config?.actModeApiProvider, planModeApiProvider: config?.planModeApiProvider, openAiBaseUrl: config?.openAiBaseUrl, openAiModelId: config?.openAiModelId },
    has9Router: (config?.actModeApiProvider === "openai" || config?.planModeApiProvider === "openai") && isLocal(config?.openAiBaseUrl),
    ...paths("cline"),
  }),
  apply: (config, { baseUrl, apiKey, model }) => {
    if (!baseUrl || !apiKey || !model) return fail("baseUrl, apiKey and model are required");
    return { config: { ...config, actModeApiProvider: "openai", planModeApiProvider: "openai", openAiBaseUrl: withoutV1(localize(baseUrl)), openAiModelId: model, planModeOpenAiModelId: model } };
  },
  reset: (config) => omitKeys(config, (key) => ["actModeApiProvider", "planModeApiProvider", "openAiBaseUrl", "openAiModelId", "planModeOpenAiModelId"].includes(key)),
  applyMessage: "Cline settings applied successfully!",
};

const kilo = {
  view: (config) => {
    const entry = config?.["openai-compatible"] || config?.["9router"];
    return { settings: { auth: config ? Object.keys(config) : [] }, has9Router: Boolean(entry) && isLocal(entry.baseUrl), ...paths("kilo") };
  },
  apply: (config, { baseUrl, apiKey, model }) => {
    if (!baseUrl || !apiKey || !model) return fail("baseUrl, apiKey and model are required");
    return { config: { ...config, "openai-compatible": { type: "api-key", apiKey, baseUrl: withV1(localize(baseUrl)), model } } };
  },
  reset: (config) => omitKeys(config, (key) => key === "openai-compatible" || key === "9router"),
  applyMessage: "Kilo Code settings applied successfully!",
};

const deepseekTui = {
  view: (config) => ({ settings: redactSecrets(config), has9Router: config?.provider === "openai" && isLocal(config?.["providers.openai"]?.base_url), ...paths("deepseek-tui") }),
  apply: (_config, { baseUrl, apiKey, model }) => {
    if (!baseUrl || !model) return fail("baseUrl and model are required");
    return { config: { provider: "openai", "providers.openai": { base_url: withV1(localize(baseUrl)), api_key: apiKey || "sk_durindoor", model } } };
  },
  reset: () => ({ provider: "deepseek" }),
  resetMessage: "DeepSeek TUI config reset to DeepSeek defaults",
};

const jcode = {
  view: (config) => ({ config, has9Router: Boolean(config?.providers?.["9router"]), ...paths("jcode") }),
  apply: (config, { baseUrl, apiKey, models }) => {
    if (!baseUrl || !apiKey) return fail("baseUrl and apiKey are required");
    const provider = {
      type: "openai-compatible", base_url: withV1(localize(baseUrl)), auth: "bearer", api_key_env: "JCODE_9ROUTER_API_KEY",
      env_file: "provider-9router.env", default_model: models?.[0] || "cc/claude-opus-4-7", requires_api_key: true,
    };
    return { config: { ...config, providers: { ...config?.providers, "9router": provider } } };
  },
  reset: (config) => ({ ...config, providers: omitKeys(config?.providers, (key) => key === "9router") }),
};

const grokBuild = {
  view: (config) => ({ settings: { model: config?.model || null, default: config?.default || null }, has9Router: Boolean(config?.model?.base_url) && config?.default === "9router", ...paths("grok-build") }),
  apply: (config, { baseUrl, model }) => {
    if (!baseUrl || !model) return fail("baseUrl and model are required");
    return { config: { ...config, model: { model, base_url: withV1(localize(baseUrl)), name: "DurinDoor", api_backend: "chat_completions" }, default: "9router" } };
  },
  reset: () => ({ model: null, default: "grok-build" }),
  applyMessage: "Grok Build settings applied successfully!",
};

const copilot = {
  view: (config) => {
    const entry = Array.isArray(config) ? config.find((item) => item.name === "DurinDoor") : null;
    return { config: redactSecrets(config), has9Router: Boolean(entry), ...paths("copilot"), currentModel: entry?.models?.[0]?.id || null, currentUrl: entry?.models?.[0]?.url || null };
  },
  apply: (config, { baseUrl, apiKey, models }) => {
    if (!baseUrl || !models?.length) return fail("baseUrl and models are required");
    const url = `${withV1(localize(baseUrl))}/chat/completions#models.ai.azure.com`;
    const entry = {
      name: "DurinDoor", vendor: "azure", apiKey: apiKey || "sk_durindoor",
      models: models.map((id) => ({ id, name: id, url, toolCalling: true, vision: false, maxInputTokens: 128000, maxOutputTokens: 16000 })),
    };
    return { config: [...(Array.isArray(config) ? config : []).filter((item) => item.name !== "DurinDoor"), entry] };
  },
  reset: (config) => (Array.isArray(config) ? config : []).filter((item) => item.name !== "DurinDoor"),
  applyMessage: "Copilot models saved. Reload VS Code to pick them up.",
};

export const CLI_TOOL_ADAPTERS = Object.freeze({
  claude, codex, opencode, droid, openclaw, hermes, cowork, cline, kilo, "deepseek-tui": deepseekTui, jcode, "grok-build": grokBuild, copilot,
});

// Tools reported by /api/cli-tools/all-statuses (copilot is a guide tool there).
export const STATUS_TOOL_IDS = Object.freeze(["claude", "codex", "opencode", "droid", "openclaw", "hermes", "cowork", "cline", "kilo", "deepseek-tui", "jcode", "grok-build"]);
