// @vitest-environment happy-dom
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

const isolated = await vi.hoisted(async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const previous = process.env.DATA_DIR;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "provider-save-"));
  fs.chmodSync(directory, 0o700);
  process.env.DATA_DIR = directory;
  return { directory, previous, remove: () => fs.rmSync(directory, { recursive: true, force: true }) };
});
vi.mock("@/dashboardGuard", () => ({ isOperatorRequest: async () => true, canManageAccessConfig: async () => true }));
import { POST as createConnection } from "@/app/api/providers/route.js";
import { PUT as updateConnection } from "@/app/api/providers/[id]/route.js";
import { getProviderConnectionById, createProviderConnection, getProviderConnections, deleteProviderConnection } from "@/lib/localDb";
afterAll(() => {
  if (isolated.previous === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = isolated.previous;
  isolated.remove();
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = React.createElement;
vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({ getKimchiUserAgent: () => "offline", updateKimchiUserAgent: vi.fn() }));
vi.mock("@/shared/components/WebLoginModal", () => ({ default: () => null }));
import AddApiKeyModal from "@/app/(dashboard)/dashboard/providers/[id]/AddApiKeyModal.js";
import EditConnectionModal from "@/shared/components/EditConnectionModal.js";
import { POST } from "@/app/api/providers/validate/route.js";
import { probeRegistryProvider } from "@/app/api/providers/providerProbe.js";

// Real registry entries exercise chat-auth, catalog fallback and non-auth-failure probes.
// Only transport is replaced; the registry, validation route and rendered forms are real.
describe.each(["wafer", "qiniu", "gitlawb-gmi"])("%s credential-check outcomes", (provider) => {
  let container;
  let root;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    for (const connection of await getProviderConnections()) await deleteProviderConnection(connection.id);
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(["add", "edit"].flatMap((form) => [null, 503, 401, 403, 200].map((status) => [form, status])))
  ("%s displays the real validation result for status %s", async (form, status) => {
    const transport = vi.fn(async () => {
      if (status === null) throw new TypeError("offline transport detail");
      return new Response("", { status });
    });
    const probe = await probeRegistryProvider(provider, "fixture-key", transport);
    expect(probe).toMatchObject({ valid: status === 200, status });
    if (status === null || status === 503) expect(probe.unavailable).toBe(true);
    else expect(probe.unavailable).not.toBe(true);

    const payloads = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      if (url !== "/api/providers/validate") return transport(url, options);
      const response = await POST(new Request("http://localhost/api/providers/validate", options));
      payloads.push(await response.clone().json());
      return response;
    }));
    let storedId;
    const persist = vi.fn(async (updates) => {
      const body = form === "add" ? { provider, ...updates } : updates;
      const request = new Request("http://localhost/api/providers", {
        method: form === "add" ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const response = form === "add" ? await createConnection(request)
        : await updateConnection(request, { params: Promise.resolve({ id: storedId }) });
      expect(response.status).toBe(form === "add" ? 201 : 200);
      const result = await response.json();
      expect(JSON.stringify(result)).not.toContain("fixture-key");
      storedId = result.connection.id;
    });
    if (form === "edit") {
      const existing = await createProviderConnection({ provider, authType: "apikey", name: `edit-${status}`,
        apiKey: "previous-key", testStatus: "error", lastError: "Previous rejection" });
      storedId = existing.id;
    }
    const common = { isOpen: true, proxyPools: [], onSave: persist, onClose: vi.fn() };
    await act(async () => root.render(form === "add"
      ? h(AddApiKeyModal, { ...common, provider, providerName: provider, authType: "apikey" })
      : h(EditConnectionModal, { ...common, connection: { id: storedId, provider, name: `edit-${status}`, authType: "apikey", priority: 1, providerSpecificData: {} } })));
    const dialog = document.querySelector("dialog");
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    expect(document.getElementById(dialog.getAttribute("aria-labelledby"))).toBeTruthy();
    const label = Array.from(dialog.querySelectorAll("label")).find((node) => node.textContent.startsWith("API Key"));
    const input = document.getElementById(label.htmlFor);
    expect(input).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "fixture-key");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const check = Array.from(dialog.querySelectorAll("button")).find((node) => node.textContent === "Check");
    expect(check).toBeDefined();
    await act(async () => check.click());
    const unavailable = status === null || status === 503;
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({ valid: status === 200 });
    expect(payloads[0].unavailable === true).toBe(unavailable);
    if (status === 401 || status === 403) expect(payloads[0].error).toBe("Invalid API key");
    expect(dialog.textContent).toContain(unavailable ? "Unavailable" : status === 200 ? "Valid" : "Invalid");
    if (unavailable) {
      expect(dialog.textContent).not.toContain("Invalid");
      const badge = [...dialog.querySelectorAll("span")].find((node) => node.textContent === "Unavailable");
      expect(badge.className).toContain("text-dd-muted");
    }
    expect(JSON.stringify(payloads)).not.toContain("fixture-key");
    expect(JSON.stringify(payloads)).not.toContain("offline transport detail");
    expect(common.onSave).not.toHaveBeenCalled();
    const save = [...dialog.querySelectorAll("button")].find((node) => node.textContent === "Save");
    expect(save.disabled).toBe(false);
    await act(async () => save.click());
    expect(common.onSave).toHaveBeenCalledTimes(1);
    const updates = common.onSave.mock.calls[0][0];
    expect(updates.apiKey).toBe("fixture-key");
    if (form === "add" || status === 200) {
      expect(updates.testStatus).toBe(status === 200 ? "active" : "unknown");
    } else {
      // A failed recheck cannot erase the saved account's existing status/error.
      expect(updates).not.toHaveProperty("testStatus");
      expect(updates).not.toHaveProperty("lastError");
      expect(updates).not.toHaveProperty("lastErrorAt");
    }
    expect(payloads).toHaveLength(form === "edit" && status === 200 ? 1 : 2);
    const reloaded = await getProviderConnectionById(storedId);
    expect(reloaded.apiKey).toBe("fixture-key");
    expect(reloaded.testStatus).toBe(status === 200 ? "active" : form === "add" ? "unknown" : "error");
    if (form === "edit") expect(reloaded.lastError).toBe(status === 200 ? null : "Previous rejection");
  });
});

describe("provider validation API outage evidence", () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each(["wafer", "qiniu"])("preserves unavailability from the %s probe", async (provider) => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));
    const result = await POST(new Request("http://localhost/api/providers/validate", { method: "POST", body: JSON.stringify({ provider, apiKey: "test-key" }) }));
    expect(await result.json()).toMatchObject({ valid: false, unavailable: true, error: "Provider unavailable - try again later" });
  });
  it.each([401, 403])("keeps HTTP %s as invalid credentials", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status })));
    const result = await POST(new Request("http://localhost/api/providers/validate", { method: "POST", body: JSON.stringify({ provider: "wafer", apiKey: "test-key" }) }));
    const data = await result.json();
    expect(data).toMatchObject({ valid: false, error: "Invalid API key" });
    expect(data.unavailable).not.toBe(true);
  });
  it("reports ChatGPT Web server errors as unavailable rather than rejected credentials", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));
    const result = await POST(new Request("http://localhost/api/providers/validate", { method: "POST", body: JSON.stringify({ provider: "chatgpt-web", apiKey: "test-token" }) }));
    expect(await result.json()).toEqual({ valid: false, unavailable: true, error: "Provider unavailable - try again later" });
  });
});
