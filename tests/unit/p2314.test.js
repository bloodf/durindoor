/**
 * #2314 item 4 (catalogs): provider catalog modules live under
 * open-sse/services/catalogs/.
 *
 * Guards three things:
 *   1. every moved module is importable from its new path and exposes exactly
 *      the export names it exposed before the move;
 *   2. the old top-level path is gone, so no re-export shim keeps the flat
 *      layout alive;
 *   3. open-sse/services/ top level no longer holds a *Models.js, *Catalog.js
 *      or catalogCache.js file.
 */
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SERVICES_DIR = path.join(REPO_ROOT, "open-sse", "services");
const CATALOGS_DIR = path.join(SERVICES_DIR, "catalogs");

/** Module file name -> the export names it must keep exposing. */
const CATALOG_MODULES = {
  aihordeImageCatalog: [
    "AI_HORDE_ANONYMOUS_KEY",
    "AI_HORDE_API_BASE",
    "AI_HORDE_CATALOG_FETCH_TIMEOUT_MS",
    "AI_HORDE_CATALOG_MAX_BYTES",
    "AI_HORDE_CATALOG_POLL_MS",
    "AI_HORDE_CATALOG_URL",
    "AI_HORDE_CLIENT_AGENT",
    "AI_HORDE_LISTING_WAIT_MS",
    "HordeImageCatalog",
    "aiHordeImageCatalog",
    "listHordeImageModelRows",
    "parseHordeImageModels",
    "readBoundedBody",
    "readBoundedJson",
  ],
  antigravityCatalog: [
    "ANTIGRAVITY_CAPABILITY_CACHE_TTL_MS",
    "ANTIGRAVITY_CAPABILITY_HINTS_META_KEY",
    "ANTIGRAVITY_CATALOG_OUTCOME",
    "ANTIGRAVITY_CATALOG_URL",
    "antigravityCapabilityRouteFingerprint",
    "antigravityCatalogEndpoint",
    "antigravityCatalogProxyUrl",
    "antigravityCatalogRouteFingerprint",
    "antigravityCatalogUserAgent",
    "antigravityForbiddenBackoff",
    "buildAntigravityCapabilityHintsPsdPatch",
    "buildAntigravityCatalogBody",
    "buildPersistedAntigravityCapabilityHints",
    "classifyAntigravityCatalogStatus",
    "normalizeAntigravityModelId",
    "parseAntigravityCatalogModels",
    "parseAntigravityModelCapabilityHints",
    "parsePersistedAntigravityCapabilityHints",
    "recordAntigravityForbidden",
    "resolveAntigravityConnectionProject",
    "reuseAntigravityCapabilityHints",
    "sanitizeAntigravityPersistedEndpoint",
  ],
  catalogCache: ["createCatalogCache"],
  clineModels: ["resolveClineModels"],
  clinepassModels: ["resolveClinepassModels"],
  cloudflareModels: ["cloudflareInferenceId", "discoverCloudflareModels"],
  commandcodeModels: ["COMMANDCODE_MODELS_URL", "parseCommandCodeModels", "resolveCommandCodeModels"],
  copilotModels: ["clearCopilotModelCache", "resolveCopilotModels"],
  cursorModels: [
    "addCursorEffortAliases",
    "clearCursorModelCache",
    "mergeCursorModelFlags",
    "normalizeCursorAvailableModels",
    "parseCursorAvailableModels",
    "parseCursorUsableModels",
    "resolveAutoModelSelection",
    "resolveCursorModels",
  ],
  kimchiModels: [
    "KIMCHI_API",
    "buildKimchiModelsUrl",
    "clearKimchiCatalog",
    "getCachedKimchiModelMetadata",
    "normalizeKimchiModel",
    "resolveKimchiModels",
  ],
  kiroModels: [
    "clearKiroModelCache",
    "enrichKiroCredentialsFromSsoCache",
    "invalidateKiroModelCache",
    "isKiroSsoToken",
    "isRefreshableKiroAuthError",
    "resolveKiroCredentialsFromSsoCache",
    "resolveKiroModels",
  ],
  ollamaCatalog: ["discoverOllamaCatalog", "getOllamaCatalogModel", "isLegacyOllamaEmbeddingModel"],
  openrouterCatalog: [
    "OPENROUTER_DECISIONS_MODELS_URL",
    "OPENROUTER_LOOKUP_BUDGET_MS",
    "OPENROUTER_MODELS_URL",
    "clearOpenRouterCatalogCache",
    "getOpenRouterModelCapabilities",
    "isOpenRouterDecisionModel",
    "isOpenRouterFreeModel",
    "mapOpenRouterModel",
    "mergeOpenRouterCatalogs",
    "resolveOpenRouterDecisionModels",
    "resolveOpenRouterModels",
    "warmOpenRouterCatalog",
  ],
  qoderModels: ["clearQoderCatalog", "getQoderModelConfig", "invalidateQoderCatalog", "resolveQoderModels"],
};

const MODULE_NAMES = Object.keys(CATALOG_MODULES);

describe("#2314 catalog modules under open-sse/services/catalogs", () => {
  it.each(MODULE_NAMES)("%s is importable from the catalogs path with the same exports", async (name) => {
    const module = await import(path.join(CATALOGS_DIR, `${name}.js`));

    expect(Object.keys(module).sort()).toEqual([...CATALOG_MODULES[name]].sort());
  });

  it.each(MODULE_NAMES)("%s no longer has a top-level shim in open-sse/services", (name) => {
    expect(existsSync(path.join(SERVICES_DIR, `${name}.js`))).toBe(false);
  });

  it("keeps open-sse/services top level free of catalog modules", () => {
    const leftovers = readdirSync(SERVICES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => name.endsWith("Models.js") || name.endsWith("Catalog.js") || name === "catalogCache.js");

    expect(leftovers).toEqual([]);
  });
});
