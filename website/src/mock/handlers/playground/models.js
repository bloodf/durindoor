// Public model catalog, plugin manifest and realtime auth probe.

import { reply } from "../../http.js";
import { generateProviderPluginManifest } from "open-sse/config/providerPluginManifestRegistry.js";
import { KIND_SLUG_MAP, buildModelCatalog } from "../../fixtures/playgroundCatalog.js";
import { onBoth } from "./stream.js";

const list = (data) => ({ object: "list", data });

function modelsByPath({ params }) {
  const rest = String(params.rest || "").replace(/^\/+|\/+$/g, "");
  const kinds = KIND_SLUG_MAP[rest];
  if (kinds) return list(buildModelCatalog(kinds));

  const all = buildModelCatalog(["llm", ...Object.values(KIND_SLUG_MAP).flat()]);
  const found = all.find((entry) => entry.id === rest);
  if (found) return found;
  return reply(
    { error: { message: `The model '${rest}' does not exist or you do not have access to it.`, type: "invalid_request_error", code: "model_not_found" } },
    { status: 404 },
  );
}

export default function registerModels(router) {
  onBoth(router, "get", "/models", () => list(buildModelCatalog()));
  onBoth(router, "get", "/models/*rest", modelsByPath);
  onBoth(router, "get", "/provider-plugin-manifest", () => generateProviderPluginManifest());
  onBoth(router, "get", "/realtime/auth", () => ({ ok: true }));
  onBoth(router, "post", "/realtime/auth", () => ({
    ok: true,
    client_secret: { value: `ek_demo_${Date.now().toString(36)}`, expires_at: Math.floor(Date.now() / 1000) + 60 },
  }));
  // The realtime socket itself cannot be mocked over fetch; answer plain GETs politely.
  router.get("/v1/realtime", () => reply({ error: { message: "Realtime requires a WebSocket upgrade", type: "invalid_request_error" } }, { status: 426 }));
}
