import { expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import NativeProviderReadiness from "../../src/app/(dashboard)/dashboard/providers/[id]/NativeProviderReadiness.jsx";

it("renders separate readiness and blockers without contacting a provider", () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network call"));
  try {
    const html = renderToStaticMarkup(React.createElement(NativeProviderReadiness, {
      providerId: "openai",
      connections: [{ provider: "openai", testStatus: "active" }],
    }));
    expect(html).toContain('aria-label="Provider readiness"');
    expect(html).toContain("Catalog metadata");
    expect(html).toContain("Configured, not verified");
    expect(html).toContain("Current authentication</dt><dd>UNKNOWN");
    expect(html).toContain("Actual inference</dt><dd>UNKNOWN");
    expect(html).toContain("Saved successful credential validations: 1");
    expect(html).toContain("Missing or stale evidence remains UNKNOWN");
    expect(html).toContain("unlisted native operations are unsupported on the native route");
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    fetch.mockRestore();
  }
});
