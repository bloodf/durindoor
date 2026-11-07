import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { catalogDiscoveryStatus } from "../../src/shared/utils/catalogDiscoveryStatus.js";
import ModelCatalogProvenance from "../../src/app/(dashboard)/dashboard/providers/[id]/ModelCatalogProvenance.js";

const now = Date.parse("2026-11-07T12:00:00Z");
const status = { enabled: true, models: [], syncedAt: "2026-11-07T11:00:00Z", intervalHours: 2 };

describe("catalog discovery provenance", () => {
  it("uses the configured interval without claiming live availability", () => {
    expect(catalogDiscoveryStatus(status, now)).toBe("Within the configured sync interval. Availability is not verified.");
    expect(catalogDiscoveryStatus({ ...status, intervalHours: 1 }, now)).toBe("STALE. The stored snapshot is older than the configured sync interval.");
  });
  it("distinguishes failed retained snapshots from unknown discovery", () => {
    expect(catalogDiscoveryStatus({ ...status, error: "failed" }, now)).toBe("STALE. The last discovery attempt failed; the previous snapshot is retained.");
    for (const patch of [{ syncedAt: null }, { syncedAt: "invalid" }, { syncedAt: "2027-01-01" }, { intervalHours: null }]) {
      expect(catalogDiscoveryStatus({ ...status, ...patch }, now)).toBe("UNKNOWN");
    }
    expect(catalogDiscoveryStatus({ error: "failed" }, now)).toBe("UNKNOWN");
  });
  it("renders the effective runtime source separately from unverified vendor identity", () => {
    const render = (patch) => renderToStaticMarkup(React.createElement(ModelCatalogProvenance, { providerId: "openai", status: { ...status, ...patch } }));
    expect(render({})).toContain("Provider discovery with derived registry variants");
    expect(render({ enabled: false })).toContain("Built-in registry");
    expect(render({ models: null })).toContain("Built-in registry");
    expect(render({ syncedAt: null })).toContain("UNKNOWN");
    expect(render({})).toContain("A list-models response does not verify the model vendor or its capabilities.");
  });
});
