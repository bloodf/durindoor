// MITM server (Antigravity / Kiro interception), per-tool model aliases, and
// the Claude Cowork MCP marketplace lookups.
import { reply, badRequest } from "../../http.js";
import { LOCAL_BASE } from "../../fixtures/tools/cliTools.js";
import { MITM_SEED, MITM_ALIAS_SEED, COWORK_REGISTRY, COWORK_REGISTRY_TOOLS } from "../../fixtures/tools/mitm.js";

const STATUS = "tools.mitmStatus";
const ALIASES = "tools.mitmAliases";
const REASONING_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);

function mitmView(state) {
  return {
    running: state.running,
    pid: state.running ? state.pid : null,
    certExists: state.certExists,
    certTrusted: state.certTrusted,
    dnsStatus: state.dnsStatus,
    hasCachedPassword: true,
    isWin: false,
    needsSudoPassword: false,
    isAdmin: false,
    mitmRouterBaseUrl: state.mitmRouterBaseUrl || LOCAL_BASE,
  };
}

// Mirrors normalizeAliasMappings(): keep entries with a model or reasoning effort.
function normalizeMappings(mappings) {
  return Object.fromEntries(
    Object.entries(mappings || {})
      .map(([alias, value]) => {
        const entry = typeof value === "string" ? { model: value } : value || {};
        const model = String(entry.model || "").trim();
        const effort = REASONING_EFFORTS.has(entry.reasoningEffort) ? entry.reasoningEffort : undefined;
        return [alias, { ...(model ? { model } : {}), ...(effort ? { reasoningEffort: effort } : {}) }];
      })
      .filter(([alias, entry]) => alias && (entry.model || entry.reasoningEffort)),
  );
}

function registerServer(router, store) {
  router.get("/api/cli-tools/antigravity-mitm", () => mitmView(store.get(STATUS)));

  router.post("/api/cli-tools/antigravity-mitm", ({ body = {} }) => {
    const pid = 40000 + Math.floor(Math.random() * 20000);
    const next = store.update(STATUS, (state) => ({
      ...state, running: true, pid, certExists: true, mitmRouterBaseUrl: body.mitmRouterBaseUrl || state.mitmRouterBaseUrl,
    }));
    return { success: true, running: next.running, pid: next.pid };
  });

  router.delete("/api/cli-tools/antigravity-mitm", () => {
    store.update(STATUS, (state) => ({
      ...state, running: false, pid: null, dnsStatus: Object.fromEntries(Object.keys(state.dnsStatus || {}).map((tool) => [tool, false])),
    }));
    return { success: true, running: false };
  });

  router.patch("/api/cli-tools/antigravity-mitm", ({ body = {} }) => {
    const { tool, action } = body;
    if (!action) return badRequest("action required");
    if (action === "trust-cert") {
      const next = store.update(STATUS, (state) => ({ ...state, certExists: true, certTrusted: true }));
      return { success: true, certTrusted: next.certTrusted };
    }
    if (action !== "enable" && action !== "disable") return badRequest("action must be enable, disable, or trust-cert");
    if (!tool) return badRequest("tool required for DNS changes");
    const next = store.update(STATUS, (state) => ({ ...state, dnsStatus: { ...state.dnsStatus, [tool]: action === "enable" } }));
    return { success: true, dnsStatus: next.dnsStatus };
  });

  router.get("/api/cli-tools/antigravity-mitm/alias", ({ searchParams }) => {
    const tool = searchParams?.get("tool");
    const all = store.get(ALIASES) || {};
    return { aliases: tool ? normalizeMappings(all[tool]) : all };
  });

  router.put("/api/cli-tools/antigravity-mitm/alias", ({ body = {} }) => {
    const { tool, mappings } = body;
    if (!tool || !mappings || typeof mappings !== "object" || Array.isArray(mappings)) return badRequest("tool and mappings required");
    if (!store.get(STATUS).dnsStatus?.[tool]) {
      return reply({ error: `DNS must be enabled for ${tool} before editing model mappings` }, { status: 403 });
    }
    const filtered = normalizeMappings(mappings);
    store.update(ALIASES, (all = {}) => ({ ...all, [tool]: filtered }));
    return { success: true, aliases: filtered };
  });
}

function registerCoworkRegistry(router) {
  router.get("/api/cli-tools/cowork-mcp-registry", () => ({ cached: true, servers: COWORK_REGISTRY, total: COWORK_REGISTRY.length }));

  router.post("/api/cli-tools/cowork-mcp-tools", ({ body = {} }) => {
    if (!body.url || typeof body.url !== "string") return badRequest("url required");
    const server = COWORK_REGISTRY.find((item) => item.url === body.url);
    if (server?.oauth) return { requiresAuth: true, tools: [] };
    const tools = COWORK_REGISTRY_TOOLS[body.url] || (server?.toolNames || []).map((name) => ({ name, description: "" }));
    return { tools };
  });
}

export default function registerMitm(router, { store }) {
  store.define(STATUS, () => MITM_SEED);
  store.define(ALIASES, () => MITM_ALIAS_SEED);
  registerServer(router, store);
  registerCoworkRegistry(router);
}
