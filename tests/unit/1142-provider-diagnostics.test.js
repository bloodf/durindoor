import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ConnectionRow from "../../src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js";
import { classifyProviderDiagnostic } from "../../src/app/(dashboard)/dashboard/providers/[id]/providerDiagnostics.js";

const callbacks = { onMoveUp() {}, onMoveDown() {}, onToggleActive() {}, onEdit() {}, onDelete() {} };
const renderRow = (status) => {
  const { oneByOneStatus, ...connection } = status;
  return renderToStaticMarkup(React.createElement(ConnectionRow, {
    connection: { id: "c1", provider: "demo", authType: "apikey", name: "Demo", isActive: true, ...connection },
    oneByOneStatus, proxyPools: [], isOAuth: false, isFirst: true, isLast: true, ...callbacks,
  }));
};

describe("secret-safe provider diagnostics #1142", () => {
  it.each([
    ["401 invalid api key", "auth", "Authentication problem"],
    ["429 quota exceeded", "quota", "Quota or rate limit"],
    ["404 model not found", "unsupported", "Unsupported model or check"],
    ["socket closed", "runtime", "Connection check failed"],
  ])("maps %s to bounded category %s", (error, category, title) => {
    expect(classifyProviderDiagnostic(error).category).toBe(category);
    expect(classifyProviderDiagnostic(error).title).toBe(title);
  });

  it("shows generic persisted and live guidance without rendering upstream text", () => {
    const secret = "401 invalid key sk-live-abc Cookie: session=private";
    const html = renderRow({ lastError: secret, testStatus: "error" });
    expect(html).toContain("Authentication problem");
    expect(html).not.toContain(secret);
    expect(html).not.toContain("sk-live-abc");
    const live = renderRow({ oneByOneStatus: { state: "failed", error: secret } });
    expect(live).toContain("Authentication problem");
    expect(live).not.toContain("session=private");
  });

  it("explains unsupported checks and unavailable providers with fixed guidance", () => {
    expect(renderRow({ oneByOneStatus: { state: "skipped", error: "sensitive upstream response" } })).toContain("Test not supported");
    expect(renderRow({ oneByOneStatus: { state: "unavailable", error: "private body" } })).toContain("Provider unavailable");
  });
});
