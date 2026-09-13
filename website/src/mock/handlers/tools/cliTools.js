// CLI tool settings endpoints: per-tool GET/POST/PATCH/DELETE and the batch
// status endpoint the CLI Tools overview page reads.
import { reply, badRequest, notFound } from "../../http.js";
import { CLI_TOOL_SEEDS, NOT_INSTALLED_MESSAGES } from "../../fixtures/tools/cliTools.js";
import { CLI_TOOL_ADAPTERS, STATUS_TOOL_IDS } from "./cliToolAdapters.js";

const STATE = "tools.cliTools";

function toolState(store, toolId) {
  return store.get(STATE)?.[toolId] || { installed: false, config: null };
}

function saveTool(store, toolId, next) {
  store.update(STATE, (all = {}) => ({ ...all, [toolId]: next }));
}

function statusFor(store, toolId) {
  const adapter = CLI_TOOL_ADAPTERS[toolId];
  const { installed, config } = toolState(store, toolId);
  if (!installed) return { installed: false, settings: null, config: null, message: NOT_INSTALLED_MESSAGES[toolId] || "Not installed" };
  return { installed: true, ...adapter.view(config) };
}

function registerTool(router, store, toolId) {
  const adapter = CLI_TOOL_ADAPTERS[toolId];
  const path = `/api/cli-tools/${toolId}-settings`;

  router.get(path, () => statusFor(store, toolId));

  router.post(path, ({ body }) => {
    const current = toolState(store, toolId);
    const result = adapter.apply(current.config, body || {});
    if (result.error) return badRequest(result.error);
    // Writing the config file is what the real routes' install probe detects.
    saveTool(store, toolId, { installed: true, config: result.config });
    return { success: true, message: adapter.applyMessage || "Settings applied successfully!" };
  });

  router.patch(path, ({ body }) => {
    if (!adapter.patch) return reply({ error: "Method not allowed" }, { status: 405 });
    const current = toolState(store, toolId);
    saveTool(store, toolId, { ...current, config: adapter.patch(current.config, body || {}) });
    return { success: true, message: "Settings updated" };
  });

  router.delete(path, ({ query }) => {
    const current = toolState(store, toolId);
    if (!current.config) return { success: true, message: "No settings file to reset" };
    saveTool(store, toolId, { ...current, config: adapter.reset(current.config, query || {}) });
    return { success: true, message: adapter.resetMessage || "Settings reset successfully" };
  });
}

export default function registerCliTools(router, { store }) {
  store.define(STATE, () => CLI_TOOL_SEEDS);
  Object.keys(CLI_TOOL_ADAPTERS).forEach((toolId) => registerTool(router, store, toolId));

  router.get("/api/cli-tools/all-statuses", () =>
    Object.fromEntries(STATUS_TOOL_IDS.map((toolId) => [toolId, statusFor(store, toolId)])),
  );

  // Any other tool id (guide-only tools) has nothing on disk to configure.
  router.any("/api/cli-tools/:toolSettings", ({ params }) =>
    params.toolSettings.endsWith("-settings")
      ? { installed: false, settings: null, message: "This tool is configured from its guide" }
      : notFound(),
  );
}
