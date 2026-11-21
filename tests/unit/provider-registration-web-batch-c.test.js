// @vitest-environment happy-dom
/**
 * Registration batch C (#2034): PromptQL (#1228), Notion AI Web (#1214), NoTrack Web (#1215),
 * Tencent AI Studio Web (#1236), TinyCMS Web (#1237), Blackbox Web (#1159) and Conol Web (#1169).
 *
 * The production registry, executor map, cookie-import contract, extension table and picker are
 * deliberately not mocked. Route-level chat coverage is in provider-registration-web-batch-c-routes.test.js;
 * the import API's localStorage path is in api/provider-cookie-import-local-storage.test.js.
 * Closed mocks only: every credential is synthetic and no request leaves the test.
 */
import fs from "node:fs";
import path from "node:path";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const h = React.createElement;

vi.mock("@/shared/hooks/useModelCaps", () => ({ useModelCaps: () => ({ getCaps: () => null }) }));
vi.mock("@/shared/hooks/useOrcaRouterCatalog", () => ({ useOrcaRouterCatalog: () => ({ models: [] }) }));
// The dashboard import dialog renders its footer buttons, so the stub keeps both.
vi.mock("../../src/shared/ui/components/Modal.jsx", () => ({ default: ({ children, footer }) => h("section", null, children, footer) }));
vi.mock("../../src/shared/ui/components/ProviderLogo.jsx", () => ({ ProviderLogo: () => null }));
// Same field stub as provider-cookie-import-dashboard.test.js: the label wraps its input.
vi.mock("@/shared/ui/components/Input.jsx", () => ({
  default: ({ label, value, onChange, disabled }) => h("label", null, label, h("input", { value, onChange, disabled })),
}));
vi.mock("../../src/shared/components/CapacityBadges", () => ({ default: () => null }));
vi.mock("@/lib/localDb", () => ({
  getApiKeyProviderConnectionIds: vi.fn(async () => []),
  getProviderConnections: vi.fn(async () => []),
}));

import registry from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getExecutor, hasSpecializedExecutor } from "../../open-sse/executors/index.js";
import { PromptQlExecutor } from "../../open-sse/executors/promptql.js";
import { NotionWebExecutor } from "../../open-sse/executors/notion-web.js";
import { NotrackWebExecutor } from "../../open-sse/executors/notrack-web.js";
import { TencentAIStudioWebExecutor } from "../../open-sse/executors/tencent-aistudio-web.js";
import { TinyCmsExecutor, tinyCmsDeviceUuid } from "../../open-sse/executors/tinycms-web.js";
import { BlackboxWebExecutor } from "../../open-sse/executors/blackbox-web.js";
import { ConolWebExecutor } from "../../open-sse/executors/conol-web.js";
import { PROVIDERS as EXTENSION_PROVIDERS, PAIRING_HEADER } from "../../extensions/provider-cookie-capture/providers.js";
import { parsePairing, preflightPermissions, runCapture, confirmationFor, readLocalStorageItems } from "../../extensions/provider-cookie-capture/capture.js";
import { APIKEY_PROVIDERS, WEB_COOKIE_PROVIDERS } from "../../src/shared/constants/providers.js";
import { buildImportedCookieHeader, describeCookieImportContract, getCookieImportContract, validateImportedLocalStorage } from "../../src/lib/providers/cookieImport/contract.js";
import { buildImportCandidates } from "../../src/shared/utils/cookieImportParser.js";
import { probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";
import { isConversationProbeProvider } from "../../src/lib/providers/conversationProbe.js";
import { canDiscoverModels } from "../../src/lib/providerRouteHandlers.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import ModelSelectModal from "../../src/shared/components/ModelSelectModal.js";
import CookieImportModal from "../../src/app/(dashboard)/dashboard/providers/[id]/CookieImportModal.js";

const UUID = "Rsynthetic-device-uuid";

// Every provider the batch registers, with what the registry must say about it.
const BATCH = [
  { id: "promptql", issue: 1228, alias: "pql", executor: PromptQlExecutor, name: "PromptQL (Experimental)", model: "GPT-5.6 Terra", models: 6,
    origin: "https://prompt.ql.app", cookieNames: ["__Host-next-auth.csrf-token", "next-auth.session-token"] },
  { id: "notion-web", issue: 1214, alias: "nw", executor: NotionWebExecutor, name: "Notion AI Web", model: "Notion AI (default)", models: 1,
    origin: "https://app.notion.com", cookieNames: ["token_v2"] },
  { id: "notrack-web", issue: 1215, alias: "ntw", executor: NotrackWebExecutor, name: "NoTrack Web", model: "NoTrack C", models: 1,
    origin: "https://notrack.ai", cookieNames: ["uid", "si_usr_id", "si_ses_id"] },
  { id: "tencent-aistudio-web", issue: 1236, alias: "tasw", executor: TencentAIStudioWebExecutor, name: "Tencent AI Studio Web", model: "Hunyuan 3D (via Tencent AI Studio)", models: 3,
    origin: "https://aistudio.tencent.ai", cookieNames: ["sessionid"] },
  { id: "tinycms-web", issue: 1237, alias: "tcw", executor: TinyCmsExecutor, name: "TinyCMS Web", model: "Claude Fable 5", models: 22,
    origin: "https://site.tinycms.xyz", cookieNames: [], localStorageKeys: ["app-config-uuid"] },
  { id: "blackbox-web", issue: 1159, alias: "bb-web", executor: BlackboxWebExecutor, name: "Blackbox Web", model: "gpt-4-turbo", models: 6,
    origin: "https://app.blackbox.ai", cookieNames: ["next-auth.session-token"] },
  { id: "conol-web", issue: 1169, alias: "cnl", executor: ConolWebExecutor, name: "Conol Web", model: "mimo-v2.5-pro", models: 28,
    origin: "https://conol.ai", cookieNames: ["__Secure-better-auth.session_token"] },
];
const COOKIE_BATCH = BATCH.filter((entry) => entry.cookieNames.length > 0);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("production registry contains each registered provider", () => {
  it.each(BATCH)("$id is one registry entry with its executor, catalog and unique priority", (entry) => {
    expect(registry.filter((candidate) => candidate.id === entry.id)).toHaveLength(1);
    const registered = registry.find((candidate) => candidate.id === entry.id);
    expect(registered.display.name).toBe(entry.name);
    expect(registered.alias).toBe(entry.alias);
    expect(PROVIDERS[entry.id]).toMatchObject({ format: "openai", executor: entry.id });
    expect(PROVIDER_MODELS[registered.alias]).toHaveLength(entry.models);
    // Sort keys stay distinct so the provider cards keep a stable order.
    expect(registry.filter((candidate) => candidate.priority === registered.priority)).toHaveLength(1);
    // The alias addresses this provider only.
    expect(registry.filter((candidate) => [candidate.id, candidate.alias, candidate.uiAlias].includes(entry.alias))).toHaveLength(1);
  });

  it("leaves nothing of the batch in the staged directory; the TinyCMS signer stays vendored there", () => {
    const stagedDir = path.resolve(import.meta.dirname, "../../open-sse/providers/private");
    const left = fs.readdirSync(stagedDir).filter((file) => file.endsWith(".js"));
    for (const entry of BATCH) expect(left).not.toContain(`${entry.id}.js`);
    expect(fs.existsSync(path.join(stagedDir, "tinycms-web/signer.js"))).toBe(true);
  });
});

describe("executor resolves", () => {
  it.each(BATCH)("$id and its alias reach the dedicated executor, not the default transport", (entry) => {
    expect(hasSpecializedExecutor(entry.id)).toBe(true);
    expect(getExecutor(entry.id)).toBeInstanceOf(entry.executor);
    expect(getExecutor(entry.alias)).toBe(getExecutor(entry.id));
  });

  it("TinyCMS takes a pasted API key first and falls back to the imported localStorage value", () => {
    expect(tinyCmsDeviceUuid({ apiKey: `  ${UUID}  ` })).toBe(UUID);
    expect(tinyCmsDeviceUuid({ apiKey: null, providerSpecificData: { "app-config-uuid": UUID } })).toBe(UUID);
    expect(tinyCmsDeviceUuid({ apiKey: "Rpasted-device", providerSpecificData: { "app-config-uuid": UUID } })).toBe("Rpasted-device");
    expect(tinyCmsDeviceUuid({})).toBe("");
  });
});

describe("extension profile and dashboard import recognise the credential", () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../extensions/provider-cookie-capture/manifest.json"), "utf8"));

  it.each(COOKIE_BATCH)("$id is a cookie provider the extension table and the import contract agree on", (entry) => {
    expect(WEB_COOKIE_PROVIDERS[entry.id]).toMatchObject({ authType: "cookie" });
    const contract = getCookieImportContract(entry.id);
    expect(contract).toMatchObject({ origin: entry.origin, extensionCapture: true, authType: "cookie" });
    expect([...contract.cookieNames]).toEqual(entry.cookieNames);
    expect(EXTENSION_PROVIDERS[entry.id]).toMatchObject({ origin: entry.origin, cookieNames: entry.cookieNames, cookiePrefixes: [] });
    expect(describeCookieImportContract(contract)).toEqual({ origin: entry.origin, cookieNames: entry.cookieNames, cookiePrefixes: [] });
    // The dashboard's provider list carries the same contract the Import cookies dialog opens with.
    expect(WEB_COOKIE_PROVIDERS[entry.id].cookieImport).toMatchObject({ origin: entry.origin, cookieNames: entry.cookieNames });
  });

  it.each(BATCH)("$id: the manifest asks for the origin as an optional host permission only", (entry) => {
    expect(manifest.optional_host_permissions).toContain(`${entry.origin}/*`);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.permissions).toEqual(["activeTab"]);
  });

  it.each(COOKIE_BATCH)("$id: a cURL request and a cookie list import to the stored header; strays are refused", (entry) => {
    const contract = getCookieImportContract(entry.id);
    const host = new URL(entry.origin).hostname;
    const cookies = entry.cookieNames.map((name) => ({ name, value: "synthetic", secure: true, domain: host }));
    const noise = { name: "cf_clearance", value: "synthetic" };
    const approved = { origin: entry.origin, url: `${entry.origin}/request`, cookies: [...cookies, noise] };
    const other = { ...approved, origin: `${entry.origin}.example`, url: `${entry.origin}.example/request` };

    expect(buildImportCandidates({ kind: "curl", parsed: other }, contract).ok).toBe(false);
    expect(buildImportCandidates({ kind: "curl", parsed: approved }, contract))
      .toMatchObject({ ok: true, candidates: [{ origin: entry.origin, dropped: [noise.name] }] });
    expect(buildImportedCookieHeader(contract, cookies)).toEqual({
      ok: true, header: entry.cookieNames.map((name) => `${name}=synthetic`).join("; "),
    });
    expect(buildImportedCookieHeader(contract, [...cookies, noise]).ok).toBe(false);
    if (cookies.length > 1) expect(buildImportedCookieHeader(contract, cookies.slice(1)).ok).toBe(false);
    // A cookie contract takes no localStorage value.
    expect(validateImportedLocalStorage(contract, { "app-config-uuid": UUID }).ok).toBe(false);
  });

  it("TinyCMS is an API-key provider whose import contract names one localStorage item and no cookie", () => {
    expect(APIKEY_PROVIDERS["tinycms-web"]).toMatchObject({ name: "TinyCMS Web", authType: "apikey", apiKeyOptionalWith: "app-config-uuid" });
    expect(WEB_COOKIE_PROVIDERS["tinycms-web"]).toBeUndefined();
    const contract = getCookieImportContract("tinycms-web");
    expect(contract).toMatchObject({ origin: "https://site.tinycms.xyz", authType: "apikey", extensionCapture: true, localStorageKeys: ["app-config-uuid"] });
    expect([...contract.cookieNames]).toEqual([]);
    expect(describeCookieImportContract(contract)).toEqual({ origin: "https://site.tinycms.xyz", cookieNames: [], cookiePrefixes: [], localStorageKeys: ["app-config-uuid"] });
    expect(EXTENSION_PROVIDERS["tinycms-web"]).toMatchObject({ origin: "https://site.tinycms.xyz", cookieNames: [], localStorageKeys: ["app-config-uuid"] });
    expect(APIKEY_PROVIDERS["tinycms-web"].cookieImport).toMatchObject({ localStorageKeys: ["app-config-uuid"] });
    expect(manifest.optional_permissions).toContain("scripting");

    expect(buildImportedCookieHeader(contract, undefined)).toEqual({ ok: true, header: "" });
    expect(buildImportedCookieHeader(contract, [{ name: "sid", value: "synthetic" }]).ok).toBe(false);
    expect(validateImportedLocalStorage(contract, { "app-config-uuid": ` ${UUID} ` })).toEqual({ ok: true, values: { "app-config-uuid": UUID } });
    for (const values of [undefined, {}, { "app-config-uuid": "Xnot-a-device" }, { "app-config-uuid": "" }, { other: UUID }, { "app-config-uuid": UUID, other: UUID }, { "app-config-uuid": "R bad value" }]) {
      expect(validateImportedLocalStorage(contract, values).ok, JSON.stringify(values)).toBe(false);
    }
  });
});

describe("TinyCMS capture paths (closed mocks)", () => {
  const NOW = Date.UTC(2026, 10, 21, 12, 0, 0);
  const pairing = (contract = { origin: "https://site.tinycms.xyz", cookieNames: [], cookiePrefixes: [], localStorageKeys: ["app-config-uuid"] }) => JSON.stringify({ pairing: {
    token: `ddpair_${"B".repeat(43)}`, header: PAIRING_HEADER, provider: "tinycms-web", action: "create", name: "Synthetic TinyCMS",
    expiresAt: new Date(NOW + 60_000).toISOString(), importUrl: "https://dashboard.example/api/providers/cookie-import", contract,
  } });

  function makeChrome({ items = { "app-config-uuid": UUID }, frameId = 0 } = {}) {
    const calls = [];
    const held = new Set();
    const names = (q) => [...(q.permissions ?? []), ...(q.origins ?? [])];
    const chrome = {
      tabs: { get: async (id) => ({ id, url: "https://site.tinycms.xyz/chat" }) },
      permissions: {
        contains: async (q) => names(q).every((n) => held.has(n)),
        request: async (q) => { calls.push(["permissions.request", q]); names(q).forEach((n) => held.add(n)); return true; },
        remove: async (q) => { calls.push(["permissions.remove", q]); names(q).forEach((n) => held.delete(n)); return true; },
      },
      cookies: { getAllCookieStores: async () => { calls.push(["cookies.getAllCookieStores"]); return []; }, get: async () => { calls.push(["cookies.get"]); return null; } },
      scripting: {
        executeScript: async (details) => {
          calls.push(["scripting.executeScript", { target: details.target, args: details.args }]);
          // Run the injected reader against a synthetic page storage, as the browser would.
          const page = { getItem: (key) => items[key] ?? null, setItem: () => { throw new Error("the reader must not write"); } };
          vi.stubGlobal("localStorage", page);
          try { return [{ frameId, result: details.func(...details.args) }]; } finally { vi.unstubAllGlobals(); }
        },
      },
    };
    return { chrome, calls };
  }

  const capture = async (options) => {
    const parsed = parsePairing(pairing(), NOW);
    expect(parsed.ok).toBe(true);
    const plan = { ...parsed.plan, tabId: 9 };
    const harness = makeChrome(options);
    await preflightPermissions(harness.chrome, plan);
    const fetch = vi.fn(async () => ({ status: 201, ok: true, json: async () => ({ connection: { id: "c-tiny", name: "Synthetic TinyCMS" } }) }));
    const result = await runCapture({ chrome: harness.chrome, fetch, plan, confirmed: confirmationFor(plan), now: () => NOW });
    return { ...harness, result, fetch, plan };
  };

  it("the extension reads only app-config-uuid with chrome.scripting and posts it without cookies", async () => {
    const { result, calls, fetch } = await capture();
    expect(result).toMatchObject({ ok: true, action: "create", cookieCount: 0, localStorageCount: 1 });
    // Only scripting and the two hosts are requested; cookie access is neither asked for nor used.
    expect(calls.find(([name]) => name === "permissions.request")[1]).toEqual({
      permissions: ["scripting"], origins: ["https://site.tinycms.xyz/*", "https://dashboard.example/*"],
    });
    expect(calls.some(([name]) => name.startsWith("cookies."))).toBe(false);
    expect(calls.find(([name]) => name === "scripting.executeScript")[1]).toEqual({ target: { tabId: 9 }, args: [["app-config-uuid"]] });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://dashboard.example/api/providers/cookie-import");
    expect(JSON.parse(init.body)).toEqual({ provider: "tinycms-web", origin: "https://site.tinycms.xyz", localStorage: { "app-config-uuid": UUID } });
    expect(calls.find(([name]) => name === "permissions.remove")[1]).toEqual({ permissions: ["scripting"], origins: ["https://site.tinycms.xyz/*", "https://dashboard.example/*"] });
  });

  it("sends nothing when the page has no value or only a subframe answered", async () => {
    for (const options of [{ items: {} }, { frameId: 3 }, { items: { "app-config-uuid": "has space" } }]) {
      const { result, fetch } = await capture(options);
      expect(result).toMatchObject({ ok: false, code: "no_local_storage" });
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it("refuses a pairing that drops the built-in localStorage item", () => {
    expect(parsePairing(pairing({ origin: "https://site.tinycms.xyz", cookieNames: [], cookiePrefixes: [] }), NOW)).toMatchObject({ ok: false, code: "invalid_pairing" });
  });

  it("the injected reader only reads the names it is given", () => {
    const getItem = vi.fn((key) => ({ "app-config-uuid": UUID, other: "synthetic-other" })[key] ?? null);
    vi.stubGlobal("localStorage", { getItem });
    expect(readLocalStorageItems(["app-config-uuid"])).toEqual({ "app-config-uuid": UUID });
    expect(getItem.mock.calls).toEqual([["app-config-uuid"]]);
  });

  it("the dashboard import takes a pasted UUID field and sends it through the authenticated import API", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const fetchMock = vi.fn(async (url) => ({
      ok: true, status: 201,
      json: async () => (String(url).endsWith("/pairing")
        ? { pairing: { token: "ddpair_synthetic", header: PAIRING_HEADER } }
        : { ok: true, action: "create", connection: { id: "c-tiny", provider: "tinycms-web", name: "Tiny" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const onSuccess = vi.fn();
    try {
      await act(async () => {
        root.render(h(CookieImportModal, {
          isOpen: true, provider: "tinycms-web", providerName: "TinyCMS Web",
          importContract: APIKEY_PROVIDERS["tinycms-web"].cookieImport, connections: [], onSuccess, onClose: vi.fn(),
        }));
      });
      const buttons = () => [...container.querySelectorAll("button")];
      // No Cookie header, cURL or HAR source: the only manual input is the named value.
      expect(buttons().map((button) => button.textContent)).not.toContain("HAR file");
      expect(container.querySelector("textarea")).toBeNull();
      const type = async (label, value) => {
        const input = [...container.querySelectorAll("label")].find((node) => node.textContent.startsWith(label)).querySelector("input");
        await act(async () => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
      };
      const importButton = () => buttons().find((button) => button.textContent === "Import session");
      await type("Connection name", "Tiny");
      await type("localStorage app-config-uuid", "Xnot-a-device");
      expect(importButton().disabled).toBe(true);
      expect(container.textContent).toContain("does not have the format");
      await type("localStorage app-config-uuid", UUID);
      expect(importButton().disabled).toBe(false);
      await act(async () => { importButton().click(); });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ provider: "tinycms-web", action: "create", name: "Tiny" });
      const [importUrl, init] = fetchMock.mock.calls[1];
      expect(importUrl).toBe("/api/providers/cookie-import");
      expect(init.headers[PAIRING_HEADER]).toBe("ddpair_synthetic");
      expect(JSON.parse(init.body)).toEqual({ provider: "tinycms-web", origin: "https://site.tinycms.xyz", localStorage: { "app-config-uuid": UUID }, name: "Tiny" });
      expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ id: "c-tiny" }));
      // The pasted value is gone from the page after the submission.
      expect(container.innerHTML).not.toContain(UUID);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

describe("validation, test and model-list hooks", () => {
  it("Notion validates with its workspace and model list and never calls the inference endpoint", async () => {
    const fetcher = vi.fn(async (url) => new Response(JSON.stringify(String(url).endsWith("getSpaces") ? { s: { space: { "space-synthetic": {} } } } : { models: [] }), { status: 200 }));
    expect(await probeRegistryProvider("notion-web", "token_v2=synthetic", fetcher)).toEqual({ valid: true, status: 200 });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["https://app.notion.com/api/v3/getSpaces", "https://app.notion.com/api/v3/getAvailableModels"]);
    const expired = vi.fn(async () => new Response("{}", { status: 401 }));
    expect(await probeRegistryProvider("notion-web", "token_v2=synthetic; space_id=s", expired)).toMatchObject({ valid: false, status: 401 });
    expect(expired.mock.calls.map(([url]) => url)).toEqual(["https://app.notion.com/api/v3/getAvailableModels"]);
  });

  it("Tencent AI Studio validates with one read-only GET to /api/user/info", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 401 }));
    expect(await probeRegistryProvider("tencent-aistudio-web", "sessionid=synthetic", fetcher)).toMatchObject({ valid: false, status: 401 });
    expect(fetcher.mock.calls.map(([url, init]) => `${init.method} ${url}`)).toEqual(["GET https://aistudio.tencent.ai/api/user/info"]);
  });

  it("TinyCMS validates the imported UUID against the challenge endpoint, never the chat endpoint", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ challenge: "c", challengeId: "id" }), { status: 200 }));
    expect(await probeRegistryProvider("tinycms-web", null, fetcher, { "app-config-uuid": UUID })).toEqual({ valid: true, status: 200 });
    const [url, init] = fetcher.mock.calls[0];
    expect(`${init.method} ${url}`).toBe("GET https://gov.freegpt.win/api/challenge");
    expect(init.headers.uuid).toBe(UUID);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([["blackbox-web", "GET", "https://app.blackbox.ai/api/auth/session"], ["conol-web", "GET", "https://conol.ai/api/agent-servers"]])(
    "%s validates with its declared read-only session request", async (id, method, url) => {
      const fetcher = vi.fn(async () => new Response("{}", { status: 401 }));
      expect(await probeRegistryProvider(id, "synthetic=1", fetcher)).toMatchObject({ valid: false, status: 401 });
      expect(fetcher.mock.calls.map(([target, init]) => `${init?.method ?? "GET"} ${target}`)).toEqual([`${method} ${url}`]);
    });

  it("NoTrack Web is never probed through its chat dispatch", () => {
    expect(isConversationProbeProvider("notrack-web")).toBe(true);
    for (const id of ["notion-web", "tencent-aistudio-web", "tinycms-web", "blackbox-web", "conol-web", "promptql"]) expect(isConversationProbeProvider(id)).toBe(false);
  });

  it.each(BATCH.filter((entry) => entry.id !== "promptql"))("$id discovers its curated catalog without sending the credential anywhere", async (entry) => {
    const fetcher = vi.fn(async () => { throw new Error("closed mock: no request expected"); });
    vi.stubGlobal("fetch", fetcher);
    expect(canDiscoverModels({ provider: entry.id })).toBe(true);
    const found = await fetchConnectionModels({ id: "synthetic", provider: entry.id, apiKey: "synthetic-credential" });
    expect(found).toMatchObject({ provider: entry.id, connectionId: "synthetic", source: "local_catalog" });
    expect(found.models).toHaveLength(entry.models);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("PromptQL lists live models only when the connection carries its playground JWT", () => {
    expect(canDiscoverModels({ provider: "promptql", apiKey: "next-auth.session-token=synthetic" })).toBe(false);
    expect(canDiscoverModels({ provider: "promptql", providerSpecificData: { token: "synthetic.jwt.value", projectId: "p" } })).toBe(true);
  });
});

describe("model picker reaches the registered providers", () => {
  const picker = (activeProviders) => renderToStaticMarkup(React.createElement(ModelSelectModal, {
    isOpen: true, onClose: () => {}, onSelect: () => {}, activeProviders,
  }));

  it.each(BATCH)("lists $model for an active $id connection and not without one", (entry) => {
    expect(picker([])).not.toContain(entry.model);
    expect(picker([{ provider: entry.id, id: "synthetic", name: "Synthetic", isActive: true }])).toContain(entry.model);
  });
});
