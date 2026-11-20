import { isString } from "@/shared/utils/typeChecks";

// Use the server catalog, which applies connection state, live catalogs,
// model aliases, disabled models, and exposure settings together.
export async function loadActiveCliModels(fetchModels = fetch) {
  const response = await fetchModels("/api/v1/models", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load active models");
  const catalog = await response.json();
  if (!Array.isArray(catalog?.data)) throw new Error("Invalid model catalog");
  return [...new Set(catalog.data
    .filter((entry) => entry?.owned_by !== "combo" && isString(entry?.id) && entry.id.trim())
    .map((entry) => entry.id))];
}
