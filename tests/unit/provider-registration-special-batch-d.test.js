// @vitest-environment happy-dom
// Registration batch D (#2034): Cursor API, Devin Desktop, WorkBuddy, MiniMax Code, Zed Hosted and
// Freebuff. The production registry, executor map, sign-in services and model picker are used as
// shipped; nothing here composes or mocks them. The only fakes are the outbound network edges,
// which must never be reached while a connection has not opted in.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const network = vi.hoisted(() => vi.fn(async () => { throw new Error("Unexpected outbound request"); }));
vi.mock("../../open-sse/utils/proxyFetch.js", async (original) => ({ ...(await original()), proxyAwareFetch: network }));
vi.mock("@/shared/hooks/useModelCaps", () => ({ useModelCaps: () => ({ getCaps: () => null }) }));
vi.mock("@/shared/hooks/useOrcaRouterCatalog", () => ({ useOrcaRouterCatalog: () => ({ models: [] }) }));
vi.mock("../../src/shared/ui/components/Modal.jsx", () => ({ default: ({ children }) => children }));
vi.mock("../../src/shared/ui/components/ProviderLogo.jsx", () => ({ ProviderLogo: () => null }));
vi.mock("../../src/shared/components/CapacityBadges", () => ({ default: () => null }));
vi.mock("@/lib/localDb", () => ({
  getApiKeyProviderConnectionIds: vi.fn(async () => []),
  getProviderConnections: vi.fn(async () => []),
}));

import registry from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getExecutor, hasSpecializedExecutor } from "../../open-sse/executors/index.js";
import { CursorApiExecutor } from "../../open-sse/executors/cursor-api.js";
import { DevinDesktopExecutor } from "../../open-sse/executors/devin-desktop.js";
import { FreebuffExecutor } from "../../open-sse/executors/freebuff.js";
import { MinimaxCodeExecutor } from "../../open-sse/executors/minimax-code.js";
import { WorkbuddyExecutor } from "../../open-sse/executors/workbuddy.js";
import { ZedHostedExecutor } from "../../open-sse/executors/zed-hosted.js";
import { APIKEY_PROVIDERS, LIVE_CATALOG_PROVIDERS, OAUTH_PROVIDERS } from "../../src/shared/constants/providers.js";
import { SESSION_DISPATCH_OPT_IN_KEY, SESSION_DISPATCH_PROVIDERS } from "../../src/shared/constants/sessionDispatchProviders.js";
import { generateAuthData, getProvider, pollForToken, requestDeviceCode } from "../../src/lib/oauth/providers.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import ModelSelectModal from "../../src/shared/components/ModelSelectModal.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const providerFile = (directory, id) => path.join(here, "../../open-sse/providers", directory, `${id}.js`);

const BATCH = [
  { id: "cursor-api", alias: "cua", Executor: CursorApiExecutor, name: "Cursor API (key exchange, unverified)", list: APIKEY_PROVIDERS, model: "gpt-5.2" },
  { id: "devin-desktop", alias: undefined, Executor: DevinDesktopExecutor, name: "Devin Desktop", list: OAUTH_PROVIDERS, model: "swe-1-7" },
  { id: "workbuddy", alias: "wb", Executor: WorkbuddyExecutor, name: "WorkBuddy", list: OAUTH_PROVIDERS, model: null },
  { id: "minimax-code", alias: "mmcode", Executor: MinimaxCodeExecutor, name: "MiniMax Code (account sign-in, guarded)", list: OAUTH_PROVIDERS, model: "MiniMax-M3" },
  { id: "zed-hosted", alias: "zdh", Executor: ZedHostedExecutor, name: "Zed Hosted Models (opt-in)", list: OAUTH_PROVIDERS, model: null },
  { id: "freebuff", alias: "fb", Executor: FreebuffExecutor, name: "Freebuff (session, opt-in)", list: OAUTH_PROVIDERS, model: "deepseek/deepseek-v4-flash" },
];

afterEach(() => {
  network.mockClear();
  vi.unstubAllGlobals();
});

describe("registration batch D: production registry", () => {
  it.each(BATCH)("registers $id once with a unique alias and no staged copy left", ({ id, alias }) => {
    expect(registry.filter((entry) => entry.id === id)).toHaveLength(1);
    expect(registry.filter((entry) => entry.alias === alias && alias !== undefined)).toHaveLength(alias ? 1 : 0);
    expect(registry.filter((entry) => (entry.aliases || []).includes(alias))).toHaveLength(0);
    expect(PROVIDERS[id]).toBeTruthy();
    expect(fs.existsSync(providerFile("private", id))).toBe(false);
    expect(fs.existsSync(providerFile("registry", id))).toBe(true);
  });

  it.each(BATCH)("lists $id in the dashboard under its auth kind, and nowhere else", ({ id, name, list }) => {
    expect(list[id]).toMatchObject({ id, name });
    for (const other of [APIKEY_PROVIDERS, OAUTH_PROVIDERS].filter((candidate) => candidate !== list)) {
      expect(other[id]).toBeUndefined();
    }
  });

  it("keeps the identities distinct from the providers they resemble", () => {
    expect(registry.find((entry) => entry.id === "cursor")).toBeTruthy();
    expect(getExecutor("cursor-api")).not.toBe(getExecutor("cursor"));
    expect(registry.find((entry) => entry.id === "devin-cli")).toBeTruthy();
    expect(registry.find((entry) => entry.id === "zed")).toMatchObject({ hidden: true, transport: null });
    expect(registry.find((entry) => entry.id === "minimax").category).toBe("apikey");
    expect(PROVIDERS["minimax-code"].baseUrl).not.toBe(PROVIDERS.minimax.baseUrl);
    expect(registry.find((entry) => entry.id === "codebuddy-cn")).toBeTruthy();
    expect(registry.find((entry) => entry.id === "workbuddy")).not.toBe(registry.find((entry) => entry.id === "codebuddy-cn"));
  });
});

describe("registration batch D: executors and sign-in services", () => {
  it.each(BATCH)("resolves the $id executor, shared between the id and its alias", ({ id, alias, Executor }) => {
    expect(hasSpecializedExecutor(id)).toBe(true);
    expect(getExecutor(id)).toBeInstanceOf(Executor);
    if (alias) {
      expect(hasSpecializedExecutor(alias)).toBe(true);
      expect(getExecutor(alias)).toBe(getExecutor(id));
    }
  });

  it("resolves a sign-in service for every OAuth identity and the key exchange for Cursor API", () => {
    expect(getProvider("devin-desktop")).toMatchObject({ flowType: "import_token", supportsBrowserPkce: true, fixedPort: 59653 });
    expect(getProvider("devin-cli")).toMatchObject({ flowType: "import_token" });
    expect(getProvider("devin-cli").supportsBrowserPkce).toBeUndefined();
    expect(getProvider("workbuddy")).toMatchObject({ flowType: "device_code" });
    expect(getProvider("minimax-code")).toMatchObject({ flowType: "device_code" });
    expect(getProvider("freebuff")).toMatchObject({ flowType: "device_code" });
    expect(getProvider("zed-hosted")).toMatchObject({ flowType: "authorization_code" });
    expect(() => getProvider("zed")).toThrow("Unknown provider");
    expect(() => getProvider("cursor-api")).toThrow("Unknown provider");
    expect(getExecutor("cursor-api").resolveSession).toBeTypeOf("function");
  });

  it("starts the Devin Desktop browser sign-in on its fixed loopback with a 96-byte PKCE verifier", async () => {
    const auth = await generateAuthData("devin-desktop", "https://dashboard.invalid/callback");
    const url = new URL(auth.authUrl);
    expect(url.origin + url.pathname).toBe("https://app.devin.ai/auth/cli/continue");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:59653/callback");
    expect(url.searchParams.get("code_challenge")).toBe(auth.codeChallenge);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(auth.redirectUri).toBe("http://127.0.0.1:59653/callback");
    expect(Buffer.from(auth.codeVerifier, "base64url")).toHaveLength(96);
    // devin-cli keeps the import-only path: no authorize URL.
    expect((await generateAuthData("devin-cli", "https://dashboard.invalid/callback")).authUrl).toBeNull();
  });

  it("starts the Zed Hosted native-app sign-in with a server-side private key and its system id", async () => {
    const auth = await generateAuthData("zed-hosted", "http://127.0.0.1:20128/callback");
    expect(new URL(auth.authUrl).pathname).toBe("/native_app_signin");
    expect(auth.redirectUri).toBe("http://127.0.0.1:20128/");
    expect(auth.codeVerifier).toMatch(/^zed-rsa-pkcs1:/);
    expect(auth.meta).toEqual({ systemId: expect.any(String) });
  });

  it("requests device codes through the shared device-code entry, on closed mocks", async () => {
    const respond = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const fetchMock = vi.fn(async (url) => {
      const target = String(url);
      if (target.startsWith("https://www.workbuddy.ai/v2/plugin/auth/state")) return respond({ code: 0, data: { state: "wb-state", authUrl: "https://www.workbuddy.ai/login" } });
      if (target === "https://freebuff.com/api/auth/cli/code") return respond({ loginUrl: "https://freebuff.com/login", fingerprintHash: "hash", expiresAt: String(Date.now() + 300_000) });
      if (target === "https://account.minimax.cn/oauth2/device/code") return respond({ device_code: "mm-code", user_code: "ABCD", verification_uri: "https://account.minimax.cn/device", expires_in: 300, interval: 5 });
      throw new Error(`Unexpected request ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    network.mockImplementation((url, init, proxyOptions) => fetchMock(url, init, proxyOptions));

    expect(await requestDeviceCode("workbuddy")).toMatchObject({ device_code: "wb-state", verification_uri: "https://www.workbuddy.ai/login" });
    expect(await requestDeviceCode("freebuff")).toMatchObject({ verification_uri: "https://freebuff.com/login" });
    // The dashboard region reaches the account host that issues the code.
    expect(await requestDeviceCode("minimax-code", "challenge", { region: "cn" })).toMatchObject({ user_code: "ABCD" });
    // Neither WorkBuddy nor Freebuff needs the PKCE verifier to poll.
    fetchMock.mockImplementationOnce(async () => respond({ code: 11217 }));
    expect(await pollForToken("workbuddy", "wb-state", null, null)).toMatchObject({ success: false, error: "authorization_pending" });
    network.mockReset();
  });
});

describe("registration batch D: model picker", () => {
  /** Mounts the real picker for one active connection; live catalogs come from the closed route fake. */
  async function pickerText(provider, liveModels = []) {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const response = (body) => ({ ok: true, json: async () => body });
    const bodies = {
      "/api/settings": { hidePaidModels: false }, "/api/v1/models": { data: [] },
      "/api/combos": { combos: [] }, "/api/provider-nodes": { nodes: [] },
      "/api/models/custom": { models: [] }, "/api/models/disabled": { disabled: {} },
      "/api/models/auto-sync": { providers: {} },
      [`/api/providers/${provider}-one/models`]: { models: liveModels },
    };
    const fetchMock = vi.fn(async (url) => {
      if (!(url in bodies)) throw new Error(`Unexpected request ${url}`);
      return response(bodies[url]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(React.createElement(ModelSelectModal, {
          isOpen: true, onClose: () => {}, onSelect: () => {},
          activeProviders: [{ provider, id: `${provider}-one`, name: `${provider} account`, isActive: true }],
        }));
      });
      return { text: container.textContent, fetchMock };
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  }

  it.each(BATCH.filter((entry) => entry.model))("lists the $id catalog for an active connection", async ({ id, alias, model, name }) => {
    const entry = PROVIDER_MODELS[alias || id].find((candidate) => candidate.id === model);
    expect(entry).toBeTruthy();
    const { text } = await pickerText(id);
    // The picker groups by provider name and labels each option with the catalog name.
    expect(text).toContain(name);
    expect(text).toContain(entry.name);
  });

  it.each(["workbuddy", "zed-hosted"])("offers %s, which ships no static list, through the live catalog route", async (id) => {
    expect(LIVE_CATALOG_PROVIDERS).toContain(id);
    expect(registry.find((entry) => entry.id === id).models).toEqual([]);
    const { text, fetchMock } = await pickerText(id, [{ id: "synthetic-live-model", name: "Synthetic live model" }]);
    expect(fetchMock).toHaveBeenCalledWith(`/api/providers/${id}-one/models`);
    expect(text).toContain(OAUTH_PROVIDERS[id].name);
    expect(text).toContain("Synthetic live model");
  });
});

describe("registration batch D: the opt-in guard defaults to off", () => {
  const body = { model: "m", messages: [{ role: "user", content: "hi" }] };
  const credentialsFor = (providerSpecificData) => ({ apiKey: "crsr_synthetic", accessToken: "synthetic-token", providerSpecificData });
  const notOptedIn = [undefined, {}, { [SESSION_DISPATCH_OPT_IN_KEY]: "true" }, { [SESSION_DISPATCH_OPT_IN_KEY]: 1 }, { [SESSION_DISPATCH_OPT_IN_KEY]: false }];

  it("names exactly this batch as the opt-in providers, under one key", () => {
    expect([...SESSION_DISPATCH_PROVIDERS].sort()).toEqual(BATCH.map(({ id }) => id).sort());
    expect(SESSION_DISPATCH_OPT_IN_KEY).toBe("enableSessionDispatch");
  });

  it.each(BATCH)("refuses $id dispatch with 403 and no outbound request until the boolean true is set", async ({ id, model }) => {
    for (const providerSpecificData of notOptedIn) {
      const result = await getExecutor(id).execute({
        model: model || "m", body: structuredClone(body), stream: false,
        credentials: credentialsFor(providerSpecificData),
      });
      expect(result.response.status).toBe(403);
    }
    expect(network).not.toHaveBeenCalled();
  });

  it.each(["cursor-api", "devin-desktop", "zed-hosted"])("refuses %s model discovery with no outbound request until opted in", async (provider) => {
    const fetchMock = vi.fn(() => { throw new Error("Unexpected outbound request"); });
    vi.stubGlobal("fetch", fetchMock);
    for (const providerSpecificData of notOptedIn) {
      const listed = await fetchConnectionModels({ provider, id: `${provider}-c`, ...credentialsFor(providerSpecificData) });
      expect(listed.error).toBeTruthy();
      expect([401, 403]).toContain(listed.status);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });

  it("serves the fixed MiniMax Code and Freebuff catalogs without sending the token anywhere", async () => {
    const fetchMock = vi.fn(() => { throw new Error("Unexpected outbound request"); });
    vi.stubGlobal("fetch", fetchMock);
    for (const [provider, model] of [["minimax-code", "MiniMax-M3"], ["freebuff", "deepseek/deepseek-v4-flash"]]) {
      const listed = await fetchConnectionModels({ provider, id: `${provider}-c`, ...credentialsFor(undefined) });
      expect(listed).toMatchObject({ source: "local_catalog", models: expect.arrayContaining([expect.objectContaining({ id: model })]) });
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });
});
