// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import KeysPage from "../../src/app/(dashboard)/dashboard/keys/page.js";
import EndpointPage from "../../src/app/(dashboard)/dashboard/endpoint/page.js";
import ApiKeyModelAccessModal from "../../src/app/(dashboard)/dashboard/endpoint/ApiKeyModelAccessModal.js";
import McpGatewayPage from "../../src/app/(dashboard)/dashboard/mcp-gateway/page.js";
import McpGatewayKeysPage from "../../src/app/(dashboard)/dashboard/mcp-gateway/keys/page.js";
import McpGatewayErrorView from "../../src/app/(dashboard)/dashboard/mcp-gateway/McpGatewayErrorView.jsx";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/keys",
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  useSearchParams: () => new URLSearchParams(),
}));

let host, root;
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const ok = (body = {}) => json(200, body);
const fail = (status = 503, body = { error: "unavailable" }) => json(status, body);
const flush = () => new Promise((resolve) => setTimeout(resolve, 30));
const settle = async () => { await act(async () => { await flush(); }); };
const render = async (element) => { await act(async () => { root.render(element); await flush(); }); };
const click = async (element) => { expect(element).toBeTruthy(); await act(async () => { element.click(); await flush(); }); };
const q = (selector) => document.querySelector(selector);
const buttons = () => [...document.querySelectorAll("button")];
// Visible text without decorative glyph ligatures ([aria-hidden] icon spans).
const label = (el) => {
  if (el.getAttribute("aria-label")) return el.getAttribute("aria-label").trim();
  const clone = el.cloneNode(true);
  clone.querySelectorAll('[aria-hidden="true"], .material-symbols-outlined').forEach((node) => node.remove());
  return clone.textContent.trim();
};
const named = (name) => buttons().find((el) => label(el) === name);
const byLabel = (label) => [...document.querySelectorAll("input,textarea")].find((el) => el.getAttribute("aria-label") === label || el.labels?.[0]?.textContent.trim().startsWith(label));
const setValue = async (element, value) => {
  expect(element).toBeTruthy();
  await act(async () => {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
  });
};
const setV5 = (on) => { if (on) document.documentElement.dataset.ui = "v5"; else delete document.documentElement.dataset.ui; };
const requests = () => fetch.mock.calls.map(([url, options]) => [options?.method || "GET", String(url), options?.body]);
const writes = () => requests().filter(([method]) => method !== "GET");

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(console, "log").mockImplementation(() => {});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); setV5(false);
  document.body.querySelectorAll("dialog").forEach((node) => node.remove());
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

// ---------------------------------------------------------------- /dashboard/keys

const apiKey = { id: "key-production", name: "Production key", maskedKey: "dd_live_••••", isActive: true, createdAt: "2026-09-01T10:00:00.000Z", expiresAt: null, allowedCombos: [], dailyLimitTokens: null, providerConnectionIds: [], policy: { allowedModels: [] }, usage: { totalTokens: 0, totalCost: 0, totalRequests: 0 } };
const keysRoute = (state, extra = {}) => async (url, options) => {
  const method = options?.method || "GET";
  const handler = extra[`${method} ${url}`];
  if (handler) return handler(options);
  if (url === "/api/keys" && method === "GET") return ok({ keys: state.keys, providerConnections: [], groups: [] });
  if (url === "/api/keys" && method === "POST") return ok({ key: "sk-secret-minted-once", expiresAt: null });
  if (url === "/api/keys/usage") return ok({ usage: {} });
  if (url === "/api/combos") return ok({ combos: [] });
  if (url === "/api/keys/policy-catalog") return ok({ models: [] });
  if (String(url).startsWith("/api/keys/")) return ok({ ok: true });
  return ok({});
};

describe.each([false, true])("keys, V5 %s", (v5) => {
  beforeEach(() => setV5(v5));

  it("creates a key with the same request and shows the secret once in a labelled field", async () => {
    const state = { keys: [apiKey] };
    vi.stubGlobal("fetch", vi.fn(keysRoute(state)));
    await render(React.createElement(KeysPage)); await settle();
    await click(named("Create Key"));
    await setValue(byLabel("Key Name"), "Build harness");
    await click(named("Create"));
    expect(writes()).toEqual([["POST", "/api/keys", JSON.stringify({ name: "Build harness", allowedCombos: [], dailyLimitTokens: null, expiresAt: null, policy: { allowedModels: [], maxTokens: null, maxCostUsd: null }, providerConnectionIds: [], isAdmin: false })]]);
    const field = byLabel("Newly issued API key");
    expect(field.value).toBe("sk-secret-minted-once"); expect(field.readOnly).toBe(true);
    await click(named("Done"));
    expect(document.body.innerHTML).not.toContain("sk-secret-minted-once");
  });

  it("keeps a key listed when revocation is rejected, then retries the same DELETE", async () => {
    const state = { keys: [apiKey] };
    let attempts = 0;
    vi.stubGlobal("fetch", vi.fn(keysRoute(state, { "DELETE /api/keys/key-production": () => (++attempts === 1 ? fail(503, { error: "Revocation rejected" }) : ok({ ok: true })) })));
    await render(React.createElement(KeysPage)); await settle();
    await click(named("Delete Production key"));
    const dialog = q('dialog[open], [role="dialog"]');
    expect(dialog).toBeTruthy();
    await click(named("Confirm"));
    expect(q('[role="dialog"] [role="alert"], dialog [role="alert"]')?.textContent).toContain("Revocation rejected");
    expect(document.body.textContent).toContain("Production key");
    // The V5 switch relabels the confirm control Retry; the request does not change.
    await click(named(v5 ? "Retry" : "Confirm"));
    expect(writes()).toEqual([["DELETE", "/api/keys/key-production", undefined], ["DELETE", "/api/keys/key-production", undefined]]);
  });

  it("blocks a duplicate revoke while one is pending", async () => {
    const state = { keys: [apiKey] };
    vi.stubGlobal("fetch", vi.fn(keysRoute(state, { "DELETE /api/keys/key-production": () => new Promise(() => {}) })));
    await render(React.createElement(KeysPage)); await settle();
    await click(named("Delete Production key"));
    await click(named("Confirm"));
    expect(named("Confirm").disabled).toBe(true);
    await click(named("Confirm"));
    expect(writes()).toHaveLength(1);
  });

  it("rotates through the same POST", async () => {
    const state = { keys: [apiKey] };
    vi.stubGlobal("fetch", vi.fn(keysRoute(state, { "POST /api/keys/key-production/rotate": () => ok({ key: "sk-rotated", id: "key-production", expiresAt: null }) })));
    await render(React.createElement(KeysPage)); await settle();
    await click(named("Rotate API key Production key"));
    await click(named("Confirm"));
    expect(writes()).toEqual([["POST", "/api/keys/key-production/rotate", undefined]]);
    expect(byLabel("Newly issued API key").value).toBe("sk-rotated");
  });

  it("empty list keeps the create call to action", async () => {
    vi.stubGlobal("fetch", vi.fn(keysRoute({ keys: [] })));
    await render(React.createElement(KeysPage)); await settle();
    expect(document.body.textContent).toContain("No API keys yet");
    expect(named("Create Key")).toBeTruthy();
  });
});

describe("keys V5 states", () => {
  it("shows a busy status while loading, then a read failure with Retry instead of the empty state", async () => {
    setV5(true);
    let failing = true; let release;
    const gate = new Promise((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      if (url === "/api/keys" && !options?.method) { await gate; return failing ? fail(503, { error: "Key store offline" }) : ok({ keys: [apiKey], providerConnections: [], groups: [] }); }
      return keysRoute({ keys: [apiKey] })(url, options);
    }));
    await act(async () => { root.render(React.createElement(KeysPage)); await flush(); });
    expect(q('[role="status"][aria-busy="true"]')?.getAttribute("aria-label")).toBe("Loading API keys");
    await act(async () => { release(); await flush(); });
    expect(q('[role="alert"]')?.textContent).toContain("Key store offline");
    expect(document.body.textContent).not.toContain("No API keys yet");
    failing = false;
    await click(named("Retry"));
    expect(document.body.textContent).toContain("Production key");
    // The page reads /api/keys with no options; the limits card adds its own read with cache options.
    expect(fetch.mock.calls.filter(([url, options]) => url === "/api/keys" && options === undefined)).toHaveLength(2);
  });

  it("names the key list", async () => {
    setV5(true);
    vi.stubGlobal("fetch", vi.fn(keysRoute({ keys: [apiKey] })));
    await render(React.createElement(KeysPage)); await settle();
    expect(q('ul[aria-label="API keys"]')).toBeTruthy();
  });

  it("offers no Retry control with the switch off", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url, options) => (url === "/api/keys" && !options?.method ? fail(503, { error: "Key store offline" }) : keysRoute({ keys: [] })(url, options))));
    await render(React.createElement(KeysPage)); await settle();
    expect(named("Retry")).toBeUndefined();
    expect(document.body.textContent).toContain("No API keys yet");
  });
});

// ------------------------------------------------------------- /dashboard/endpoint

const settings = { requireApiKey: true, requireLogin: true, hasPassword: true, tunnelDashboardAccess: false };
const tunnelStatus = { tunnel: { enabled: false, tunnelUrl: "", publicUrl: "", allUrls: [] }, tailscale: { enabled: false, tunnelUrl: "" } };
const endpointRoute = (overrides = {}) => async (url, options) => {
  const method = options?.method || "GET";
  const handler = overrides[`${method} ${url}`];
  if (handler) return handler(options);
  if (url === "/api/settings" && method === "GET") return ok(settings);
  if (url === "/api/settings" && method === "PATCH") return ok({});
  if (url === "/api/tunnel/status") return ok(tunnelStatus);
  if (url === "/api/monitoring") return ok({ runtime: { activeRequests: 2, memoryRssMB: 146, processUptimeSec: 3600 }, health: [{ id: "openai", name: "OpenAI", requests: 100, errors: 1, successRate: 99 }], activity: { recent: [] } });
  return ok({});
};

describe.each([false, true])("endpoint, V5 %s", (v5) => {
  beforeEach(() => setV5(v5));

  it("sends the same security PATCH", async () => {
    vi.stubGlobal("fetch", vi.fn(endpointRoute()));
    await render(React.createElement(EndpointPage)); await settle();
    await click(q('[role="switch"][aria-label="Require API key"]'));
    expect(writes()).toEqual([["PATCH", "/api/settings", JSON.stringify({ requireApiKey: false })]]);
  });

  it("retains the confirmed value and offers Retry when a security write is rejected", async () => {
    vi.stubGlobal("fetch", vi.fn(endpointRoute({ "PATCH /api/settings": () => fail(503, { error: "Security change rejected" }) })));
    await render(React.createElement(EndpointPage)); await settle();
    const toggle = q('[role="switch"][aria-label="Require API key"]');
    await click(toggle);
    expect(q('[role="alert"]')?.textContent).toContain("Security change rejected");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(named("Retry")).toBeTruthy();
    await click(named("Retry"));
    expect(writes()).toHaveLength(2);
    expect(writes()[1]).toEqual(writes()[0]);
  });

  it("shows a load failure with Retry that repeats the read", async () => {
    let failing = true;
    vi.stubGlobal("fetch", vi.fn(endpointRoute({ "GET /api/settings": () => (failing ? fail(503, { error: "Settings offline" }) : ok(settings)) })));
    await render(React.createElement(EndpointPage)); await settle();
    expect(q('[role="alert"]')?.textContent).toContain("could not be loaded");
    failing = false;
    await click(named("Retry"));
    expect(q('[role="switch"][aria-label="Require API key"]')).toBeTruthy();
    expect(requests().filter(([method, url]) => method === "GET" && url === "/api/settings")).toHaveLength(2);
  });
});

describe("endpoint V5 loading", () => {
  it("announces loading as a busy status", async () => {
    setV5(true);
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    await act(async () => { root.render(React.createElement(EndpointPage)); await flush(); });
    expect(q('[role="status"][aria-busy="true"]')?.getAttribute("aria-label")).toBe("Loading endpoint configuration");
  });
});

describe.each([false, true])("model access block list, V5 %s", (v5) => {
  beforeEach(() => setV5(v5));
  const denyKey = (patterns) => ({ id: "story-key", name: "Build harness", policy: { modelAccess: { mode: "deny", patterns } } });
  const mount = (key) => render(React.createElement(ApiKeyModelAccessModal, { apiKey: key, catalog: [], onClose() {}, onSave() {} }));

  it("explains an empty block list", async () => {
    vi.stubGlobal("fetch", vi.fn(endpointRoute()));
    await mount(denyKey([])); await settle();
    expect(document.body.textContent).toMatch(/empty blocklist blocks nothing/i);
  });

  it("rejects a duplicate rule on its field without a request", async () => {
    vi.stubGlobal("fetch", vi.fn(endpointRoute()));
    await mount(denyKey(["openai/*"])); await settle();
    const before = fetch.mock.calls.length;
    const field = byLabel("Add a rule");
    await setValue(field, "OPENAI/*");
    await click(named("Add"));
    const message = "That rule is already in the list.";
    expect(document.body.textContent).toContain(message);
    expect(field.getAttribute("aria-invalid")).toBe("true");
    const describedBy = field.getAttribute("aria-describedby");
    expect(document.getElementById(describedBy)?.textContent).toContain(message);
    expect(fetch.mock.calls.length).toBe(before);
  });

  it("saves the same PUT body", async () => {
    vi.stubGlobal("fetch", vi.fn(endpointRoute({ "PUT /api/keys/story-key": () => ok({ key: denyKey(["openai/*", "cx/*"]) }) })));
    await mount(denyKey(["openai/*"])); await settle();
    await setValue(byLabel("Add a rule"), "cx/*");
    await click(named("Add"));
    await click(named("Save"));
    expect(writes()).toEqual([["PUT", "/api/keys/story-key", JSON.stringify({ modelAccess: { mode: "deny", patterns: ["openai/*", "cx/*"] } })]]);
  });

  it(v5 ? "exposes the rule list as a focusable named region" : "renders the rule list without a region wrapper", async () => {
    vi.stubGlobal("fetch", vi.fn(endpointRoute()));
    await mount(denyKey(["openai/*"])); await settle();
    const region = q('[role="region"][aria-label="Block list"]');
    if (v5) { expect(region?.tabIndex).toBe(0); expect(region.querySelector("ul")).toBeTruthy(); } else expect(region).toBeNull();
  });
});

// ----------------------------------------------------------- /dashboard/mcp-gateway

const instances = [
  { id: "granola", slug: "granola", kind: "http", transport: "http", url: "https://mcp.granola.ai/mcp", oauth: true, oauthStatus: "connected", enabled: true },
  { id: "stale", slug: "legacy", kind: "http", transport: "http", url: "https://legacy.invalid/mcp", oauth: true, oauthStatus: "needs_login", enabled: true },
];
const gatewayRoute = (overrides = {}) => async (url, options) => {
  const method = options?.method || "GET";
  const handler = overrides[`${method} ${url}`];
  if (handler) return handler(options);
  if (url === "/api/mcp-gateway/instances") return ok({ instances });
  if (url === "/api/mcp-gateway/instances/granola/test") return ok({ ok: true, toolCount: 6, sample: [{ name: "fetch" }] });
  if (url === "/api/mcp-gateway/instances/stale/test") return fail(502, { ok: false, error: "401 requires re-login" });
  return ok({});
};
const row = (slug) => [...document.querySelectorAll("article")].find((node) => node.textContent.includes(slug));

describe.each([false, true])("mcp gateway instances, V5 %s", (v5) => {
  beforeEach(() => setV5(v5));

  it("tests an instance with the same POST and reports a login requirement", async () => {
    vi.stubGlobal("fetch", vi.fn(gatewayRoute()));
    await render(React.createElement(McpGatewayPage)); await settle();
    const target = row("legacy");
    await click([...target.querySelectorAll("button")].find((el) => label(el) === "Test"));
    expect(writes()).toEqual([["POST", "/api/mcp-gateway/instances/stale/test", undefined]]);
    const status = target.querySelector('[role="status"]');
    expect(status.textContent).toContain("Test failed: 401 requires re-login");
    expect([...status.querySelectorAll("button")].some((el) => label(el) === "Login")).toBe(true);
  });

  it("gives every instance action a name", async () => {
    vi.stubGlobal("fetch", vi.fn(gatewayRoute()));
    await render(React.createElement(McpGatewayPage)); await settle();
    for (const control of row("granola").querySelectorAll("button, [role=\"switch\"]")) {
      expect(label(control), control.outerHTML).not.toBe("");
    }
    expect(q('[role="switch"][aria-label="Disable instance"]')).toBeTruthy();
  });

  it("shows the empty state when there are no instances", async () => {
    vi.stubGlobal("fetch", vi.fn(gatewayRoute({ "GET /api/mcp-gateway/instances": () => ok({ instances: [] }) })));
    await render(React.createElement(McpGatewayPage)); await settle();
    expect(document.body.textContent).toContain("No instances yet");
  });

  it("the error boundary view offers Try again that calls reset", async () => {
    const reset = vi.fn();
    await render(React.createElement(McpGatewayErrorView, { reset }));
    expect(document.body.textContent).toContain("MCP Gateway failed to load");
    await click(named("Try again"));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe("mcp gateway instances V5 read failure", () => {
  it("offers Retry instead of the empty state and re-requests the same URL", async () => {
    setV5(true);
    let failing = true;
    vi.stubGlobal("fetch", vi.fn(gatewayRoute({ "GET /api/mcp-gateway/instances": () => (failing ? fail(503, { error: "Gateway offline" }) : ok({ instances })) })));
    await render(React.createElement(McpGatewayPage)); await settle();
    expect(q('[role="alert"]')?.textContent).toContain("Instances could not be loaded");
    expect(document.body.textContent).not.toContain("No instances yet");
    failing = false;
    await click(named("Retry"));
    expect(document.body.textContent).toContain("granola");
    expect(requests().filter(([method, url]) => method === "GET" && url === "/api/mcp-gateway/instances")).toHaveLength(2);
  });
});

// ------------------------------------------------------ /dashboard/mcp-gateway/keys

const gatewayKeys = [{ id: "k1", name: "Cursor laptop", machineId: null, createdAt: "2026-08-21T10:00:00Z" }];
const keysGatewayRoute = (overrides = {}) => async (url, options) => {
  const method = options?.method || "GET";
  const handler = overrides[`${method} ${url}`];
  if (handler) return handler(options);
  if (url === "/api/mcp-gateway/keys" && method === "GET") return ok({ keys: gatewayKeys });
  if (url === "/api/mcp-gateway/keys" && method === "POST") return ok({ key: { id: "k2", name: "Harness", key: "gw-minted-secret", createdAt: "2026-09-01T00:00:00Z" } });
  return ok({});
};

describe.each([false, true])("mcp gateway keys, V5 %s", (v5) => {
  beforeEach(() => setV5(v5));

  it("mints with the same body and shows the secret once", async () => {
    vi.stubGlobal("fetch", vi.fn(keysGatewayRoute()));
    await render(React.createElement(McpGatewayKeysPage)); await settle();
    await click(named("New key"));
    await setValue(byLabel("Key name"), "Harness");
    await click(named("Create key"));
    expect(writes()).toEqual([["POST", "/api/mcp-gateway/keys", JSON.stringify({ name: "Harness" })]]);
    if (v5) { const field = byLabel("Newly issued gateway key"); expect(field.value).toBe("gw-minted-secret"); expect(field.readOnly).toBe(true); }
    else expect(document.body.textContent).toContain("gw-minted-secret");
    await click(named("Done"));
    expect(document.body.innerHTML).not.toContain("gw-minted-secret");
  });

  it("blocks a duplicate mint while one is pending", async () => {
    vi.stubGlobal("fetch", vi.fn(keysGatewayRoute({ "POST /api/mcp-gateway/keys": () => new Promise(() => {}) })));
    await render(React.createElement(McpGatewayKeysPage)); await settle();
    await click(named("New key"));
    await click(named("Create key"));
    const submit = buttons().find((el) => el.textContent.includes("Create key"));
    expect(submit.disabled).toBe(true);
    await click(submit);
    expect(writes()).toHaveLength(1);
  });

  it("keeps the draft after a rejected mint and retries the same body", async () => {
    let attempts = 0;
    vi.stubGlobal("fetch", vi.fn(keysGatewayRoute({ "POST /api/mcp-gateway/keys": () => (++attempts === 1 ? fail(503, { error: "Key creation rejected" }) : ok({ key: { id: "k2", name: "Retry key", key: "gw-minted-secret" } })) })));
    await render(React.createElement(McpGatewayKeysPage)); await settle();
    await click(named("New key"));
    await setValue(byLabel("Key name"), "Retry key");
    await click(named("Create key"));
    expect(q('dialog [role="alert"], [role="dialog"] [role="alert"]')?.textContent).toContain("Key creation rejected");
    expect(byLabel("Key name").value).toBe("Retry key");
    await click(named(v5 ? "Retry" : "Create key"));
    expect(writes().map(([method, url, body]) => [method, url, body])).toEqual([
      ["POST", "/api/mcp-gateway/keys", JSON.stringify({ name: "Retry key" })],
      ["POST", "/api/mcp-gateway/keys", JSON.stringify({ name: "Retry key" })],
    ]);
  });

  it("shows the empty state", async () => {
    vi.stubGlobal("fetch", vi.fn(keysGatewayRoute({ "GET /api/mcp-gateway/keys": () => ok({ keys: [] }) })));
    await render(React.createElement(McpGatewayKeysPage)); await settle();
    expect(document.body.textContent).toContain("No gateway keys yet");
  });

  it.each(["http", "malformed", "network"])("offers Retry after a %s read failure", async (failure) => {
    let failing = true;
    vi.stubGlobal("fetch", vi.fn(keysGatewayRoute({ "GET /api/mcp-gateway/keys": () => {
      if (!failing) return ok({ keys: gatewayKeys });
      if (failure === "network") throw new Error("Connection interrupted");
      if (failure === "malformed") return { ok: true, status: 200, json: async () => { throw new SyntaxError("bad json"); } };
      return fail(503, { error: "Keys unavailable" });
    } })));
    await render(React.createElement(McpGatewayKeysPage)); await settle();
    expect(q('[role="alert"]')?.textContent).toContain("Keys could not be loaded");
    failing = false;
    await click(named("Retry"));
    expect(document.body.textContent).toContain("Cursor laptop");
  });
});
