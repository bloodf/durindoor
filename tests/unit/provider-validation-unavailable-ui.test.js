// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { providerValidationOutcome } from "@/shared/utils/providerValidationOutcome.js";

vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({ getKimchiUserAgent: () => "offline", updateKimchiUserAgent: vi.fn() }));
let AddApiKeyModal, EditConnectionModal, ConnectionsCard, ProvidersPage;
let host, root, validation, providerConnections;
const response = (data) => ({ ok: true, json: async () => data });

vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
({ default: AddApiKeyModal } = await import("@/app/(dashboard)/dashboard/providers/[id]/AddApiKeyModal.js"));
({ default: EditConnectionModal } = await import("@/shared/components/EditConnectionModal.js"));
({ default: ConnectionsCard } = await import("@/app/(dashboard)/dashboard/providers/components/ConnectionsCard.js"));
({ default: ProvidersPage } = await import("@/app/(dashboard)/dashboard/providers/page.js"));
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  validation = { valid: false, unavailable: true, error: "Provider unavailable - try again later" };
  providerConnections = [];
  globalThis.fetch = vi.fn(async (url) => {
    if (url === "/api/providers/validate" || url === "/api/providers/c1/test") return response(validation);
    if (url === "/api/providers") return response({ connections: providerConnections });
    if (url === "/api/provider-nodes") return response({ nodes: [] });
    if (String(url).startsWith("/api/proxy-pools")) return response({ proxyPools: [] });
    if (url === "/api/settings") return response({});
    if (url === "/api/providers/test-batch") return response({ mode: "apikey", summary: { total: 1, passed: 0, failed: 0, skipped: 0, unavailable: 1 }, results: [{ connectionId: "c1", connectionName: "Test", provider: "wafer", ...validation }] });
    throw new Error(`Unexpected request: ${url}`);
  });
});

it("shows an unavailable batch result without calling it a credential failure", async () => {
  providerConnections = [{ id: "c1", provider: "openai", authType: "apikey", name: "Test", isActive: true, testStatus: "active", priority: 1 }];
  await act(async () => root.render(React.createElement(ProvidersPage)));
  const button = document.querySelector('button[aria-label="Test all API Key connections"]');
  expect(button).toBeTruthy();
  await act(async () => button.click());
  expect(document.body.textContent).toContain("1 unavailable");
  expect(document.body.textContent).toContain("UNAVAILABLE");
  expect(document.body.textContent).toContain("Provider unavailable - try again later");
  expect(document.body.textContent).not.toContain("1 failed");
});

describe("saved connection test", () => {
  it.each([
    [{ valid: false, unavailable: true, error: "Provider unavailable - try again later" }, "Unavailable"],
    [{ valid: false, error: "Invalid API key" }, "Failed"],
    [{ valid: true, error: null }, "Valid"],
  ])("shows the probe result", async (result, label) => {
    validation = result;
    await act(async () => root.render(React.createElement(EditConnectionModal, { isOpen: true, connection: { id: "c1", provider: "wafer", authType: "apikey", name: "Test", priority: 1, providerSpecificData: {} }, proxyPools: [], onSave: vi.fn(), onClose: vi.fn() })));
    await click("Test Connection");
    expect(document.body.textContent).toContain(label);
    if (result.unavailable) {
      expect(document.body.textContent).toContain(result.error);
      expect(document.body.textContent).not.toContain("Failed");
    }
  });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

async function click(text) {
  const button = [...document.querySelectorAll("button")].find((node) => node.textContent.trim().endsWith(text));
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
async function enterKey() {
  const input = document.querySelector('input[type="password"]');
  expect(input).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "test-key");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const cases = [
  ["provider detail add", () => React.createElement(AddApiKeyModal, { isOpen: true, provider: "wafer", providerName: "Wafer", existingConnectionNames: [], proxyPools: [], onSave: vi.fn(), onClose: vi.fn() })],
  ["edit connection", () => React.createElement(EditConnectionModal, { isOpen: true, connection: { id: "c1", provider: "wafer", authType: "apikey", name: "Test", priority: 1, providerSpecificData: {} }, proxyPools: [], onSave: vi.fn(), onClose: vi.fn() })],
  ["connections card add", () => React.createElement(ConnectionsCard, { providerId: "wafer", isOAuth: false })],
];
describe.each(cases)("%s", (name, element) => {
  it.each([
    [{ valid: false, unavailable: true, error: "Provider unavailable - try again later" }, "Unavailable"],
    [{ valid: false, error: "Invalid API key" }, "Invalid"],
  ])("shows the validation outcome", async (result, label) => {
    validation = result;
    await act(async () => root.render(element()));
    if (name === "connections card add") await click("Add Connection");
    await enterKey();
    await click("Check");
    expect(document.body.textContent).toContain(label);
    if (result.unavailable) expect(document.body.textContent).not.toContain("Invalid");
  });
});

describe("strict unavailable flag", () => {
  it.each([false, null, undefined, "true", 1])("rejects non-boolean unavailable %s", (unavailable) => {
    expect(providerValidationOutcome({ valid: false, unavailable })).toBe("failed");
  });
});
