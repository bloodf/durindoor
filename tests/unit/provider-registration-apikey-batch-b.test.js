// @vitest-environment happy-dom
/**
 * Registration batch B (#2034): Helyx AI (#1193), TabiToken (#1235), TwinMind (#1240), HyperAgent (#1194),
 * MaxAI (#1202), Arena (#1198), ChatPlayground (#1163), Cloudflare AI Playground (#1167), Poe, g4f Gemini
 * (#1185), g4f NVIDIA (#1187), g4f Ollama (#1188) and g4f Pollinations (#1189).
 *
 * Not registered: SYNTX (#1234), MonsterAPI (#1208) and g4f Groq (#1186) have a dead upstream and only a doc;
 * PromptQL (#1228) moved to batch C.
 *
 * The production registry, executor map, cookie-import contract, extension table and picker are
 * deliberately not mocked. Route-level chat coverage is in provider-registration-apikey-batch-b-routes.test.js.
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
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { ChatPlaygroundExecutor } from "../../open-sse/executors/chatplayground.js";
import { CloudflarePlaygroundExecutor } from "../../open-sse/executors/cloudflare-playground.js";
import { LmarenaExecutor } from "../../open-sse/executors/lmarena.js";
import { MaxaiExecutor } from "../../open-sse/executors/maxai.js";
import { TwinmindExecutor } from "../../open-sse/executors/twinmind.js";
import { PoeExecutor } from "../../open-sse/executors/poe.js";
import { HyperAgentExecutor } from "../../open-sse/executors/hyperagent.js";
import { PROVIDERS as EXTENSION_PROVIDERS } from "../../extensions/provider-cookie-capture/providers.js";
import { APIKEY_PROVIDERS, FREE_PROVIDERS, LIVE_CATALOG_PROVIDERS, WEB_COOKIE_PROVIDERS } from "../../src/shared/constants/providers.js";
import { buildImportedCookieHeader, describeCookieImportContract, getCookieImportContract } from "../../src/lib/providers/cookieImport/contract.js";
import { buildImportCandidates } from "../../src/shared/utils/cookieImportParser.js";
import { liveCatalogModelEntries } from "../../src/shared/utils/liveCatalogModels.js";
import { probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";
import { isConversationProbeProvider, isGuardedWebSessionProvider } from "../../src/lib/providers/conversationProbe.js";
import { canDiscoverModels } from "../../src/lib/providerRouteHandlers.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import ModelSelectModal from "../../src/shared/components/ModelSelectModal.js";

// Every provider the batch registers, with what the registry must say about it.
const BATCH = [
  { id: "helyxai", issue: 1193, alias: "helyxai", name: "Helyx AI", model: "Qwen3 235B", models: 12, executor: DefaultExecutor },
  { id: "tabitoken", issue: 1235, alias: "tabitoken", name: "TabiToken", model: "Claude Opus 4.8 Thinking", models: 4, executor: DefaultExecutor },
  { id: "twinmind", issue: 1240, alias: "twinmind", name: "TwinMind", model: "TwinMind", models: 13, executor: TwinmindExecutor, localCatalog: true },
  { id: "hyperagent", issue: 1194, alias: "ha", name: "HyperAgent", model: "Claude Opus Latest", models: 6, executor: HyperAgentExecutor, localCatalog: true },
  { id: "maxai", issue: 1202, alias: "mx", name: "MaxAI", model: "GPT-5.6 Luna", models: 13, executor: MaxaiExecutor,
    origin: "https://www.maxai.co", cookieNames: ["access_token", "device_id", "user_id"], cookiePrefixes: [], localCatalog: true },
  { id: "lmarena", issue: 1198, alias: "lma", name: "Arena", model: "GPT OSS 120B", models: 7, executor: LmarenaExecutor,
    origin: "https://arena.ai", cookieNames: ["arena-auth-prod-v1"], cookiePrefixes: ["arena-auth-prod-v1."], localCatalog: true },
  { id: "chatplayground", issue: 1163, alias: "cpl", name: "ChatPlayground", model: null, liveCatalog: true, models: 0, executor: ChatPlaygroundExecutor,
    origin: "https://app.chatplayground.ai", cookieNames: ["__client", "__session"], cookiePrefixes: [] },
  { id: "cloudflare-playground", issue: 1167, alias: "cfp", name: "Cloudflare AI Playground", model: "Granite 4.0 H Micro (IBM)", models: 20, executor: CloudflarePlaygroundExecutor, localCatalog: true, noAuth: true },
  { id: "poe", alias: "poe", name: "Poe", model: "Gemini 3.0 Pro", models: 3, executor: PoeExecutor },
  { id: "g4f-gemini", issue: 1185, alias: "g4fgem", name: "g4f Gemini", model: "Gemini 2.5 Pro (g4f)", models: 2, executor: DefaultExecutor },
  { id: "g4f-nvidia", issue: 1187, alias: "g4fnv", name: "g4f NVIDIA", model: "MiniMax M2.7 (g4f/NVIDIA)", models: 3, executor: DefaultExecutor },
  { id: "g4f-ollama", issue: 1188, alias: "g4foll", name: "g4f Ollama", model: "Gemma 3 4B (g4f/Ollama)", models: 1, executor: DefaultExecutor },
  { id: "g4f-pollinations", issue: 1189, alias: "g4fpol", name: "g4f Pollinations", model: "OpenAI Fast (g4f/Pollinations)", models: 2, executor: DefaultExecutor },
];
const COOKIE_BATCH = BATCH.filter((entry) => entry.origin);
const DEDICATED = BATCH.filter((entry) => entry.executor !== DefaultExecutor);
const REGISTRY_FETCHER = BATCH.filter((entry) => !entry.blocked && !entry.localCatalog && entry.id !== "chatplayground");

describe("production registry contains each registered provider", () => {
  it.each(BATCH)("$id is exactly one registry entry with its alias and catalog", (entry) => {
    expect(registry.filter((candidate) => candidate.id === entry.id)).toHaveLength(1);
    const registered = registry.find((candidate) => candidate.id === entry.id);
    expect(registered.display.name).toBe(entry.name);
    expect(registered.alias).toBe(entry.alias);
    expect(PROVIDERS[entry.id]).toMatchObject({ format: expect.any(String) });
    expect(PROVIDER_MODELS[registered.alias] ?? []).toHaveLength(entry.models);
    // No other registry entry may claim this alias: it would make model strings ambiguous.
    const claimed = registry.filter((candidate) => [candidate.alias, candidate.uiAlias, ...(candidate.aliases ?? [])].includes(entry.alias));
    expect(claimed.map((candidate) => candidate.id)).toEqual([entry.id]);
  });

  it("keeps Poe single: the staged entry replaced the generic OmniRoute cloud row", () => {
    expect(registry.filter((candidate) => candidate.id === "poe")).toHaveLength(1);
    expect(PROVIDERS.poe).toMatchObject({ messagesUrl: "https://api.poe.com/v1/messages", executor: "poe" });
  });

  it("keeps TwinMind off the tokenmarket alias", () => {
    expect(registry.find((candidate) => candidate.id === "tokenmarket").aliases).toContain("tm");
    expect(registry.find((candidate) => candidate.id === "twinmind").alias).not.toBe("tm");
  });

  it("leaves the dead-upstream providers unregistered", () => {
    for (const id of ["syntx", "monsterapi", "g4f-groq"]) {
      expect(registry.some((candidate) => candidate.id === id), id).toBe(false);
    }
  });

  it("keeps the staged directory clear of the registered ids", () => {
    const stagedDir = path.resolve(import.meta.dirname, "../../open-sse/providers/private");
    const left = fs.existsSync(stagedDir) ? fs.readdirSync(stagedDir).filter((file) => file.endsWith(".js")) : [];
    for (const entry of BATCH) expect(left).not.toContain(`${entry.id}.js`);
  });
});

describe("executor resolves", () => {
  it.each(DEDICATED)("$id and its alias reach the dedicated executor, not the default transport", (entry) => {
    expect(hasSpecializedExecutor(entry.id)).toBe(true);
    expect(getExecutor(entry.id)).toBeInstanceOf(entry.executor);
    // An alias may hold its own instance of the same executor class for the same provider.
    expect(getExecutor(entry.alias)).toBeInstanceOf(entry.executor);
    expect(getExecutor(entry.alias).provider).toBe(getExecutor(entry.id).provider);
  });

  it.each(BATCH.filter((entry) => entry.executor === DefaultExecutor))("$id is served by the default OpenAI-style executor on its own transport", (entry) => {
    expect(hasSpecializedExecutor(entry.id)).toBe(false);
    const executor = getExecutor(entry.id);
    expect(executor).toBeInstanceOf(DefaultExecutor);
    expect(getExecutor(entry.alias)).toBe(executor);
    expect(executor.provider).toBe(entry.id);
    expect(executor.config.baseUrl).toBe(registry.find((candidate) => candidate.id === entry.id).transport.baseUrl);
  });

  it.each(BATCH.filter((entry) => entry.blocked))("$id fails closed: 501 provider_port_pending and no outbound request", async (entry) => {
    const fetcher = vi.fn(async () => { throw new Error("closed mock: no request expected"); });
    vi.stubGlobal("fetch", fetcher);
    try {
      const executor = getExecutor(entry.id);
      expect(() => executor.buildUrl()).toThrow(/not ported|port|requires/i);
      expect(() => executor.buildHeaders({ apiKey: "synthetic-credential" })).toThrow();
      const result = await executor.execute({ model: "auto", body: { messages: [] }, stream: false, credentials: { apiKey: "synthetic-credential" } });
      expect(result.response.status).toBe(501);
      expect(await result.response.text()).toContain("provider_port_pending");
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps the dead-upstream ids on the default fallback guard", () => {
    expect(hasSpecializedExecutor("g4f-groq")).toBe(false);
    expect(PROVIDERS["g4f-groq"]).toBeUndefined();
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
    expect(buildImportedCookieHeader(contract, cookies.slice(1)).ok).toBe(false);
    expect(buildImportedCookieHeader(contract, [...cookies, noise]).ok).toBe(false);
    expect(buildImportedCookieHeader(contract, [{ ...cookies[0], domain: "other.example" }, ...cookies.slice(1)]).ok).toBe(false);
  });

  it("Arena accepts contiguous numbered cookie chunks and refuses a gap", () => {
    const contract = getCookieImportContract("lmarena");
    const chunk = (name) => ({ name, value: "synthetic", secure: true, domain: "arena.ai" });
    expect(buildImportedCookieHeader(contract, [chunk("arena-auth-prod-v1.0"), chunk("arena-auth-prod-v1.1")]))
      .toEqual({ ok: true, header: "arena-auth-prod-v1.0=synthetic; arena-auth-prod-v1.1=synthetic" });
    expect(buildImportedCookieHeader(contract, [chunk("arena-auth-prod-v1.0"), chunk("arena-auth-prod-v1.2")]).ok).toBe(false);
  });

  it.each(BATCH.filter((entry) => !entry.origin))("$id has no cookie import or extension profile", (entry) => {
    expect(getCookieImportContract(entry.id)).toBeNull();
    expect(WEB_COOKIE_PROVIDERS[entry.id]).toBeUndefined();
    expect(EXTENSION_PROVIDERS[entry.id]).toBeUndefined();
  });

  it("files the credential-style providers under their own categories", () => {
    for (const id of ["helyxai", "tabitoken", "twinmind", "hyperagent", "poe", "g4f-gemini", "g4f-nvidia", "g4f-ollama", "g4f-pollinations"]) {
      expect(APIKEY_PROVIDERS[id], id).toBeDefined();
    }
    expect(FREE_PROVIDERS["cloudflare-playground"]).toMatchObject({ noAuth: true });
  });
});

describe("validation, test and model-list hooks", () => {
  it("Arena validates with a read-only method check on its chat route", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 405 }));
    vi.stubGlobal("fetch", fetcher);
    try {
      expect(await probeRegistryProvider("lmarena", "arena-auth-prod-v1=synthetic", fetcher)).toMatchObject({ valid: true });
      const [url, init] = fetcher.mock.calls[0] ?? [];
      expect(String(url ?? "")).toContain("https://arena.ai/");
      expect(init?.method ?? "GET").toBe("GET");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("ChatPlayground validates with a GET to its user endpoint, never a chat POST", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 401 }));
    expect(await probeRegistryProvider("chatplayground", "__client=synthetic; __session=synthetic", fetcher)).toMatchObject({ valid: false, status: 401 });
    expect(fetcher.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`)).toEqual(["GET https://app.chatplayground.ai/api/user"]);
  });

  it.each(["cloudflare-playground"])("%s is never probed through its chat transport", (id) => {
    expect(isConversationProbeProvider(id)).toBe(true);
  });

  it.each(["twinmind", "hyperagent"])("%s never sends its saved credential during Validate or Test Connection", (id) => {
    expect(isGuardedWebSessionProvider(id)).toBe(true);
    expect(isConversationProbeProvider(id)).toBe(true);
  });

  it.each(BATCH.filter((entry) => entry.localCatalog))("$id discovers its curated catalog without sending the credential anywhere", async (entry) => {
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

  it.each(REGISTRY_FETCHER)("$id lists models from its own endpoint with its own key", async (entry) => {
    const fetcher = vi.fn(async () => Response.json({ data: [{ id: "synthetic-model" }] }));
    vi.stubGlobal("fetch", fetcher);
    try {
      expect(canDiscoverModels({ provider: entry.id, apiKey: "synthetic-credential" })).toBe(true);
      const found = await fetchConnectionModels({ id: "synthetic", provider: entry.id, apiKey: "synthetic-credential" });
      expect(found.models.map((model) => model.id)).toEqual(["synthetic-model"]);
      const registered = registry.find((candidate) => candidate.id === entry.id);
      expect(fetcher).toHaveBeenCalledTimes(1);
      const [url, init] = fetcher.mock.calls[0];
      expect(String(url)).toBe(registered.modelsFetcher.url);
      const headers = new Headers(init.headers);
      expect(`${headers.get("authorization") ?? ""}${headers.get("x-api-key") ?? ""}`).toContain("synthetic-credential");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("ChatPlayground lists its bots with the session Cookie header, not a Bearer token", async () => {
    const fetcher = vi.fn(async () => Response.json({ data: [{ botId: "gpt-4o", displayName: "GPT-4o" }, { displayName: "no bot id" }] }));
    vi.stubGlobal("fetch", fetcher);
    try {
      expect(canDiscoverModels({ provider: "chatplayground", apiKey: "__client=a; __session=b" })).toBe(true);
      const found = await fetchConnectionModels({ id: "synthetic", provider: "chatplayground", apiKey: "__client=a; __session=b" });
      expect(found.models).toEqual([{ id: "gpt-4o", name: "GPT-4o" }]);
      const [url, init] = fetcher.mock.calls[0];
      expect(String(url)).toBe("https://app.chatplayground.ai/api/models");
      expect(new Headers(init.headers).get("cookie")).toBe("__client=a; __session=b");
      expect(new Headers(init.headers).get("authorization")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("model picker reaches the registered providers", () => {
  const picker = (activeProviders) => renderToStaticMarkup(React.createElement(ModelSelectModal, {
    isOpen: true, onClose: () => {}, onSelect: () => {}, activeProviders,
  }));

  it.each(BATCH.filter((entry) => entry.model && !entry.noAuth))("lists $model for an active $id connection and not without one", (entry) => {
    expect(picker([])).not.toContain(entry.model);
    expect(picker([{ provider: entry.id, id: "synthetic", name: "Synthetic", isActive: true }])).toContain(entry.model);
  });

  it("lists the anonymous Cloudflare Playground models without any connection", () => {
    expect(picker([])).toContain("Granite 4.0 H Micro (IBM)");
  });

  it("asks for ChatPlayground's signed-in catalog, since it has no static model list", () => {
    expect(PROVIDER_MODELS.cpl ?? []).toHaveLength(0);
    expect(LIVE_CATALOG_PROVIDERS).toContain("chatplayground");
    expect(liveCatalogModelEntries("cpl", [{ id: "gpt-4o", name: "GPT-4o" }, { name: "no bot id" }]))
      .toEqual([{ id: "gpt-4o", name: "GPT-4o", value: "cpl/gpt-4o", kind: null }]);
  });
});
