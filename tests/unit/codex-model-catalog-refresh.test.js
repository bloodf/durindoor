import { describe, expect, it } from "vitest";
import { catalogEntryForConnection, connectionEndpoint, connectionCatalogKey, mergeSyncedCatalog } from "../../src/lib/modelAutoSync/catalog.js";
import { parseCodexModels } from "../../src/app/api/providers/[id]/models/modelsConfig.js";

describe("Codex account catalog", () => {
  const a = { id: "a", providerSpecificData: { baseUrl: "https://untrusted.example" } };
  const b = { id: "b" };
  it("accepts supported visible entries and respects the client version", () => {
    const rows = parseCodexModels({ models: [
      { slug: "opaque" }, { slug: "unsupported", supported_in_api: false },
      { slug: "hidden", visibility: "hide" }, { slug: "future", minimal_client_version: "999.0.0" }
    ] });
    expect(rows.map((row) => row.id)).toContain("opaque");
    for (const id of ["unsupported", "hidden", "future"]) expect(rows.map((row) => row.id)).not.toContain(id);
  });
  it("uses only the matching account row and ignores legacy provider-wide data", () => {
    const endpoint = connectionEndpoint("codex", a);
    expect(endpoint).toBe("https://chatgpt.com/backend-api/codex/responses");
    const row = mergeSyncedCatalog(null, [{ id: "opaque", kind: "llm" }], { now: 1, connectionId: "a", endpoint });
    const catalogs = { codex: row, [connectionCatalogKey("codex", "a")]: row };
    expect(catalogEntryForConnection(catalogs, "codex", a)).toEqual(row);
    expect(catalogEntryForConnection(catalogs, "codex", b)).toBeNull();
    expect(catalogEntryForConnection({ codex: row }, "codex", a)).toBeNull();
  });
});
