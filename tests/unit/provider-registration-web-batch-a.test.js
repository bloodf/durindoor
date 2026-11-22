// @vitest-environment happy-dom
/**
 * Registration batch A (#2034): Claude Web (#1165), Gemini Web (#1190), DeepSeek Web (#1173),
 * Doubao Web (#1176), Z.ai Web (#1251) and ChatGPT Web Codex (#1162).
 *
 * The production registry, executor map, cookie-import contract, extension table and picker are
 * deliberately not mocked. Route-level chat coverage is in provider-registration-web-batch-a-routes.test.js.
 */
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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
import { ChatGptWebCodexExecutor } from "../../open-sse/executors/chatgpt-web-codex.js";
import { ClaudeWebExecutor } from "../../open-sse/executors/claude-web.js";
import { DeepSeekWebExecutor } from "../../open-sse/executors/deepseek-web.js";
import { DoubaoWebExecutor } from "../../open-sse/executors/doubao-web.js";
import { GeminiWebExecutor } from "../../open-sse/executors/gemini-web.js";
import { ZaiWebExecutor } from "../../open-sse/executors/zai-web.js";
import { PROVIDERS as EXTENSION_PROVIDERS } from "../../extensions/provider-cookie-capture/providers.js";
import { APIKEY_PROVIDERS, WEB_COOKIE_PROVIDERS } from "../../src/shared/constants/providers.js";
import { buildImportedCookieHeader, describeCookieImportContract, getCookieImportContract } from "../../src/lib/providers/cookieImport/contract.js";
import { buildImportCandidates } from "../../src/shared/utils/cookieImportParser.js";
import { probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";
import { isConversationProbeProvider } from "../../src/lib/providers/conversationProbe.js";
import { canDiscoverModels } from "../../src/lib/providerRouteHandlers.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import ModelSelectModal from "../../src/shared/components/ModelSelectModal.js";

const session = "__Secure-next-auth.session-token";

// Every provider the batch registers, with what the registry must say about it.
const BATCH = [
  { id: "claude-web", issue: 1165, alias: "cw", executor: ClaudeWebExecutor, name: "Claude Web", model: "Claude Fable 5.1", models: 10,
    origin: "https://claude.ai", cookieNames: ["sessionKey"], cookiePrefixes: [] },
  { id: "gemini-web", issue: 1190, alias: "gweb", executor: GeminiWebExecutor, name: "Gemini Web (Subscription)", model: "Gemini 3.7 Flash", models: 3,
    origin: "https://gemini.google.com", cookieNames: ["__Secure-1PSID", "__Secure-1PSIDTS"], cookiePrefixes: [], cookieDomain: "google.com" },
  { id: "deepseek-web", issue: 1173, alias: "ds-web", executor: DeepSeekWebExecutor, name: "DeepSeek Web", model: "DeepSeek V4 Pro Think", models: 14 },
  { id: "doubao-web", issue: 1176, alias: "doubao-web", executor: DoubaoWebExecutor, name: "Doubao Web", model: "Dola Speed", models: 2,
    origin: "https://www.dola.com", cookieNames: ["sessionid", "s_v_web_id"], cookiePrefixes: [] },
  { id: "zai-web", issue: 1251, alias: "zai-web", uiAlias: "zw", executor: ZaiWebExecutor, name: "Z.ai Web", model: "GLM-5.3-Flash", models: 3,
    origin: "https://chat.z.ai", cookieNames: ["token"], cookiePrefixes: [] },
  { id: "chatgpt-web-codex", issue: 1162, alias: "cgpt-codex", executor: ChatGptWebCodexExecutor, name: "ChatGPT Web Codex", model: "Extra High", models: 7,
    origin: "https://chatgpt.com", cookieNames: [session], cookiePrefixes: [`${session}.`] },
];
const COOKIE_BATCH = BATCH.filter((entry) => entry.origin);

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
  });

  it("keeps the staged directory empty: nothing is left unregistered", () => {
    const stagedDir = path.resolve(import.meta.dirname, "../../open-sse/providers/private");
    const left = fs.existsSync(stagedDir) ? fs.readdirSync(stagedDir).filter((file) => file.endsWith(".js")) : [];
    for (const entry of BATCH) expect(left).not.toContain(`${entry.id}.js`);
  });
});

describe("executor resolves", () => {
  it.each(BATCH)("$id and its alias reach the dedicated executor, not the default transport", (entry) => {
    expect(hasSpecializedExecutor(entry.id)).toBe(true);
    expect(getExecutor(entry.id)).toBeInstanceOf(entry.executor);
    expect(getExecutor(entry.alias)).toBe(getExecutor(entry.id));
    expect(getExecutor(entry.uiAlias ?? entry.alias)).toBe(getExecutor(entry.id));
  });
});

describe("extension profile and dashboard import recognise the cookies", () => {
  it.each(COOKIE_BATCH)("$id is a cookie provider the extension table and the import contract agree on", (entry) => {
    expect(WEB_COOKIE_PROVIDERS[entry.id]).toMatchObject({ authType: "cookie" });
    const contract = getCookieImportContract(entry.id);
    expect(contract).toMatchObject({ origin: entry.origin, extensionCapture: true });
    expect([...contract.cookieNames]).toEqual(entry.cookieNames);
    expect([...contract.cookiePrefixes]).toEqual(entry.cookiePrefixes);
    expect(EXTENSION_PROVIDERS[entry.id]).toMatchObject({ origin: entry.origin, cookieNames: entry.cookieNames, cookiePrefixes: entry.cookiePrefixes });
    expect(describeCookieImportContract(contract)).toEqual({ origin: entry.origin, cookieNames: entry.cookieNames, cookiePrefixes: entry.cookiePrefixes });
  });

  it.each(COOKIE_BATCH)("$id: the manifest asks for the origin as an optional host permission", (entry) => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../extensions/provider-cookie-capture/manifest.json"), "utf8"));
    expect(manifest.optional_host_permissions).toContain(`${entry.origin}/*`);
    expect(manifest.permissions).not.toContain("cookies");
  });

  it.each(COOKIE_BATCH)("$id: a cURL request and a cookie list import to the stored header; strays are refused", (entry) => {
    const contract = getCookieImportContract(entry.id);
    const host = new URL(entry.origin).hostname;
    // Google sets its session cookies on the parent domain of the Gemini host.
    const domain = entry.cookieDomain ? `.${entry.cookieDomain}` : host;
    const cookies = entry.cookieNames.map((name) => ({ name, value: "synthetic", secure: true, domain }));
    const noise = { name: "cf_clearance", value: "synthetic" };
    const approved = { origin: entry.origin, url: `${entry.origin}/request`, cookies: [...cookies, noise] };
    const other = { ...approved, origin: `${entry.origin}.example`, url: `${entry.origin}.example/request` };

    expect(buildImportCandidates({ kind: "curl", parsed: other }, contract).ok).toBe(false);
    expect(buildImportCandidates({ kind: "curl", parsed: approved }, contract))
      .toMatchObject({ ok: true, candidates: [{ origin: entry.origin, dropped: [noise.name] }] });
    expect(buildImportedCookieHeader(contract, cookies)).toEqual({
      ok: true, header: entry.cookieNames.map((name) => `${name}=synthetic`).join("; "),
    });
    expect(buildImportedCookieHeader(contract, cookies.slice(1)).ok).toBe(false);
    expect(buildImportedCookieHeader(contract, [...cookies, noise]).ok).toBe(false);
    expect(buildImportedCookieHeader(contract, [{ ...cookies[0], domain: "other.example" }, ...cookies.slice(1)]).ok).toBe(false);
  });

  it("DeepSeek Web takes its local-storage userToken as an API-key credential: no cookie import, but a local-storage capture and import", () => {
    expect(APIKEY_PROVIDERS["deepseek-web"]).toMatchObject({ name: "DeepSeek Web", authType: "apikey", apiKeyOptionalWith: "userToken" });
    expect(WEB_COOKIE_PROVIDERS["deepseek-web"]).toBeUndefined();
    const contract = getCookieImportContract("deepseek-web");
    expect(contract).toMatchObject({ origin: "https://chat.deepseek.com", authType: "apikey", extensionCapture: true, cookieNames: [], localStorageKeys: ["userToken"] });
    expect(describeCookieImportContract(contract)).toEqual({ origin: "https://chat.deepseek.com", cookieNames: [], cookiePrefixes: [], localStorageKeys: ["userToken"] });
    expect(EXTENSION_PROVIDERS["deepseek-web"]).toMatchObject({ origin: "https://chat.deepseek.com", cookieNames: [], localStorageKeys: ["userToken"] });
    // A cookie header, cURL or HAR carries no token, so only the localStorage path imports it.
    expect(buildImportedCookieHeader(contract, [{ name: "ds_session_id", value: "synthetic" }]).ok).toBe(false);
  });
});

describe("validation, test and model-list hooks", () => {
  it.each(["claude-web", "gemini-web", "chatgpt-web-codex"])("%s validates through its own read-only session request", async (id) => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 401 }));
    const cookie = { "claude-web": "sessionKey=synthetic", "gemini-web": "__Secure-1PSID=synthetic; __Secure-1PSIDTS=synthetic", "chatgpt-web-codex": `${session}=synthetic` }[id];
    const origin = { "claude-web": "https://claude.ai/", "gemini-web": "https://gemini.google.com/", "chatgpt-web-codex": "https://chatgpt.com/" }[id];
    expect(await probeRegistryProvider(id, cookie, fetcher)).toMatchObject({ valid: false, status: 401 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url).startsWith(origin)).toBe(true);
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.headers.Cookie).toContain("synthetic");
  });

  it.each(["doubao-web", "zai-web"])("%s is never probed through its chat endpoint", (id) => {
    expect(isConversationProbeProvider(id)).toBe(true);
  });

  it("DeepSeek Web validates with a GET to users/current and never falls back to a chat POST", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 500 }));
    await probeRegistryProvider("deepseek-web", "synthetic-usertoken", fetcher);
    expect(fetcher.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`)).toEqual(["GET https://chat.deepseek.com/api/v0/users/current"]);
  });

  it.each(BATCH)("$id discovers its curated catalog without sending the credential anywhere", async (entry) => {
    const fetcher = vi.fn(async () => { throw new Error("closed mock: no request expected"); });
    vi.stubGlobal("fetch", fetcher);
    try {
      expect(canDiscoverModels({ provider: entry.id })).toBe(true);
      const found = await fetchConnectionModels({ id: "synthetic", provider: entry.id, apiKey: "synthetic-credential" });
      expect(found).toMatchObject({ provider: entry.id, connectionId: "synthetic", source: "local_catalog" });
      expect(found.models).toHaveLength(entry.models);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
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
