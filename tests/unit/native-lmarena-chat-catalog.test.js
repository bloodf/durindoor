// Arena (lmarena) chat catalog and model resolver, staged and unregistered.
// The pinned source's chat catalog is the 42 Text + 6 Search rows of its
// 75-row Direct-chat scrape; the 27 Image rows are not chat models. Every
// credential is synthetic, global.fetch throws if called, and the Arena TLS
// client is a mock.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tls = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/services/lmarenaTlsClient.js", () => ({ tlsFetchLMArena: tls }));

import {
  buildLmarenaChatRegistryModels,
  LMARENA_CHAT_BASE_URL,
  LMARENA_CHAT_MODEL_IDS,
  LMARENA_CHAT_MODELS,
  LMARENA_CHAT_PROVIDER_ALIASES,
  LMARENA_CHAT_PROVIDER_ID,
  LMARENA_CHAT_PROVIDER_METADATA,
  LMARENA_CHAT_SOURCE_REGISTRY_MODELS,
  LMARENA_CHAT_WIRE_MODALITY,
  LMARENA_CHAT_WIRE_MODE,
  LMARENA_SOURCE_IMAGE_ROWS,
  LMARENA_SOURCE_TOTAL_ROWS,
} from "../../open-sse/services/providerParity/native-lmarena-chat-catalog/config.js";
import {
  LMARENA_CHAT_REFUSAL_STATUS,
  LMARENA_CHAT_REFUSALS,
  lmarenaChatRefusalResponse,
  resolveLmarenaChatArenaId,
  resolveLmarenaChatModel,
  stripLmarenaModelPrefix,
} from "../../open-sse/services/providerParity/native-lmarena-chat-catalog/resolver.js";
import {
  buildLmarenaSourceChatWire,
  LMARENA_SOURCE_CHAT_WIRE_KEYS,
} from "../../open-sse/services/providerParity/native-lmarena-chat-catalog/contract.js";
import * as bundle from "../../open-sse/services/providerParity/native-lmarena-chat-catalog/index.js";
import { LMARENA_IMAGE_MODELS } from "../../open-sse/services/providerParity/native-lmarena-image/config.js";
import localRegistry from "../../open-sse/providers/registry/lmarena.js";
import { LmarenaExecutor } from "../../open-sse/executors/lmarena.js";

const ROOT = new URL("../../", import.meta.url);
const BUNDLE = new URL("open-sse/services/providerParity/native-lmarena-chat-catalog/", ROOT);
const registration = JSON.parse(readFileSync(new URL("registration.json", BUNDLE), "utf8"));
const COOKIE = "arena-auth-prod-v1=SYNTHETIC-arena-chat-session-0001";
const SECRETISH = "arena-auth-prod-v1=SYNTHETIC-should-never-echo";
const LOG = { debug() {}, info() {}, warn() {}, error() {} };

// LMARENA_DIRECT_CHAT_ENTRIES of the pinned directModels.ts, in source order:
// [catalogId, arenaId, publicName, displayName, organization, vision, category].
const SOURCE_CHAT_ROWS = [
  ["amazon.nova-pro-v1:0", "a14546b5-d78d-4cf6-bb61-ab5b8510a9d6", "amazon.nova-pro-v1:0", "amazon.nova-pro-v1:0", "amazon", true, "Text"],
  ["claude-haiku-4-5-20251001", "0199e8e9-01ed-73e0-96ba-cf43b286bf10", "claude-haiku-4-5-20251001", "claude-haiku-4-5-20251001", "anthropic", false, "Text"],
  ["claude-sonnet-5", "019f19f2-41f1-7c6d-9891-48d02fd9952c", "claude-sonnet-5", "claude-sonnet-5-high", "anthropic", true, "Text"],
  ["deepseek-v4-pro-thinking", "019dc1c1-c62d-7b70-85a1-e0565e29fce1", "deepseek-v4-pro-thinking", "deepseek-v4-pro-thinking", "deepseek", false, "Text"],
  ["dola-seed-2.0-preview-vision", "019c6453-641a-74f8-a689-a8a67175a359", "dola-seed-2.0-preview-vision", "dola-seed-2.0-preview-vision", "bytedance", true, "Text"],
  ["ernie-5.0-preview-1220", "019d44f1-26da-729f-a4ea-ddddfe7b4eae", "ernie-5.0-preview-1220", "ernie-5.0-preview-1220", "baidu", true, "Text"],
  ["gemini-3.1-flash-lite", "019f408a-186c-7f3a-9595-4e079e42a613", "gemini-3.1-flash-lite", "gemini-3.1-flash-lite", "google", true, "Text"],
  ["gemini-3.1-pro-preview", "019c7820-5480-78b6-9fef-04c0d7004054", "gemini-3.1-pro-preview", "gemini-3.1-pro-preview", "google", true, "Text"],
  ["gemini-3.6-flash", "019f90b1-c0ac-71ce-b295-487f261bf0f4", "gemini-3.6-flash", "gemini-3.6-flash", "google", true, "Text"],
  ["significant-otter", "019d2cd3-2641-7628-94bd-67ecb0a7134e", "significant-otter", "gemma-4-26b-a4b", "google", true, "Text"],
  ["pteronura", "019d2cd2-dd83-75ab-a421-d0ba2e22b1e3", "pteronura", "gemma-4-31b", "google", true, "Text"],
  ["glm-5.1", "019ebf6a-94d4-7649-b704-1dbbd5eb0942", "glm-5.1", "glm-5.2 (max)", "zai", false, "Text"],
  ["glm-5v-turbo", "019d4a09-9651-78cb-86ea-bb0fa5ec77f4", "glm-5v-turbo", "glm-5v-turbo", "zai", true, "Text"],
  ["gpt-oss-120b", "6ee9f901-17b5-4fbe-9cc2-13c16497c23b", "gpt-oss-120b", "gpt-oss-120b", "openai", false, "Text"],
  ["gpt-5.2-high", "019b1449-0313-7911-b836-419e2ed79b2e", "gpt-5.2-high", "gpt-5.2-high", "openai", true, "Text"],
  ["gpt-5.4-mini-high", "019cfcdd-5426-777e-8314-04619cb92cc4", "gpt-5.4-mini-high", "gpt-5.4-mini-high", "openai", true, "Text"],
  ["gpt-5.4-nano-high", "019cfcdd-0bca-706f-92b5-a4c4cbd022d8", "gpt-5.4-nano-high", "gpt-5.4-nano-high", "openai", true, "Text"],
  ["gpt-5.5-instant", "019e71ea-1e1d-740f-9c2d-dab5869ff108", "gpt-5.5-instant", "gpt-5.5-instant", "openai", true, "Text"],
  ["grok-4.3/text", "019f42aa-9c3b-76d1-8bdf-2e883b1ca227", "grok-4.3", "grok-4.5", "xai", true, "Text"],
  ["hunyuan-vision-1.5-thinking", "6a3a1e04-050e-4cb4-9052-b9ac4bec0c38", "hunyuan-vision-1.5-thinking", "hunyuan-vision-1.5-thinking", "tencent", true, "Text"],
  ["hy3", "019f3911-ba1c-7e36-b631-01893e557290", "hy3", "hy3", "tencent", false, "Text"],
  ["kimi-k2.6", "019dac54-e8a4-7c54-904a-ff0ecd82af42", "kimi-k2.6", "kimi-k2.6", "moonshot", true, "Text"],
  ["ling-2.5-1t", "019c6e76-fbbc-7e92-b0ba-784c7ef3ad8b", "ling-2.5-1t", "ling-2.5-1t", "ant-group", false, "Text"],
  ["longcat-2.0", "019f3a0a-bd19-7b19-9eed-a98453759b48", "longcat-2.0", "longcat-2.0", "meituan", false, "Text"],
  ["mercury-2", "019cc65f-c1e3-7574-b332-898ab71c8211", "mercury-2", "mercury-2", "inception-ai", false, "Text"],
  ["mimo-v2.5", "019db651-bd2f-7d80-ab12-d69c6bb623df", "mimo-v2.5", "mimo-v2.5", "xiaomi", true, "Text"],
  ["mimo-v2.5-pro", "019db650-909d-7dec-8711-1907d7233cd4", "mimo-v2.5-pro", "mimo-v2.5-pro", "xiaomi", false, "Text"],
  ["minimax-m3", "019e809d-f62d-7192-bb7f-1657e066b5f2", "minimax-m3", "minimax-m3", "minimax", true, "Text"],
  ["mistral-large-3", "019acbac-df7c-73dc-9716-ebe040daaa4e", "mistral-large-3", "mistral-large-3", "mistral", true, "Text"],
  ["mistral-medium-3.5", "019f30a4-044d-7a14-9d3b-2e7299159e36", "mistral-medium-3.5", "mistral-medium-3.5", "mistral", true, "Text"],
  ["mistral-small-2603", "019cf983-532b-73fa-a057-7658e1e1c5ee", "mistral-small-2603", "mistral-small-2603", "mistral", false, "Text"],
  ["nova-2-lite", "019ae300-83b7-7717-a1e0-31accd1ff6fa", "nova-2-lite", "nova-2-lite", "amazon", false, "Text"],
  ["nvidia-nemotron-3-nano-30b-a3b-bf16", "019b0aa7-334a-78e8-b2a8-885f31f4fc0c", "nvidia-nemotron-3-nano-30b-a3b-bf16", "nvidia-nemotron-3-nano-30b-a3b-bf16", "nvidia", false, "Text"],
  ["march26-chatbot1-public", "019cd9e3-c3ff-7225-92f2-c392259b1fbe", "march26-chatbot1-public", "nvidia-nemotron-3-super-120b-a12b", "nvidia", false, "Text"],
  ["may26-chatbot4-public", "019e8ea8-2052-7f2e-b1b6-59bd94be5203", "may26-chatbot4-public", "nvidia-nemotron-3-ultra-550b-a55b-nvfp4", "nvidia", false, "Text"],
  ["o3-2025-04-16", "cb0f1e24-e8e9-4745-aabc-b926ffde7475", "o3-2025-04-16", "o3-2025-04-16", "openai", true, "Text"],
  ["qwen3.5-397b-a17b", "019c6918-1d2a-7e3f-88ec-ada000b6ab16", "qwen3.5-397b-a17b", "qwen3.5-397b-a17b", "alibaba", true, "Text"],
  ["qwen3.7-max", "019e6530-f140-77b1-b6b8-5c859829d992", "qwen3.7-max", "qwen3.7-max", "alibaba", false, "Text"],
  ["qwen3.7-plus", "019e86fe-167d-77bd-94a8-df7aee4f4551", "qwen3.7-plus", "qwen3.7-plus", "alibaba", true, "Text"],
  ["ring-2.5-1t", "019c6e77-1b9f-7649-9136-43d07566c6c5", "ring-2.5-1t", "ring-2.5-1t", "ant-group", false, "Text"],
  ["step-3.5-flash", "019d22bb-fcf5-7866-9c07-de74fe05c9cc", "step-3.5-flash", "step-3.5-flash", "stepfun", false, "Text"],
  ["trinity-large-thinking", "019d50aa-447d-74d6-8661-405b4b6de5de", "trinity-large-thinking", "trinity-large-thinking", "arcee-ai", false, "Text"],
  ["claude-sonnet-5-search", "019f1a07-de72-7fbe-8d82-56dbd7348360", "claude-sonnet-5-search", "claude-sonnet-5-search", "anthropic", false, "Search"],
  ["gemini-2.5-pro-grounding", "b222be23-bd55-4b20-930b-a30cc84d3afd", "gemini-2.5-pro-grounding", "gemini-2.5-pro-grounding", "google", false, "Search"],
  ["gemini-3-flash-grounding", "019bda1f-3abc-783f-aac0-1ee102b247ba", "gemini-3-flash-grounding", "gemini-3-flash-grounding", "google", false, "Search"],
  ["gpt-5.2-search", "019b1448-f74a-72de-b25d-8666618f8c5a", "gpt-5.2-search", "gpt-5.2-search", "openai", false, "Search"],
  ["grok-4.3/search", "019de22d-1445-7296-9c88-a5877bc66ef8", "grok-4.3", "grok-4.3", "xai", false, "Search"],
  ["o3-search", "fbe08e9a-3805-4f9f-a085-7bc38e4b51d1", "o3-search", "o3-search", "openai", false, "Search"],
];

// The source resolveLmarenaArenaId, transcribed, applied to chat rows only.
function sourceResolve(requested, rows) {
  const raw = requested.replace(/^(?:lmarena|lma|arena)\//i, "").trim();
  if (!raw) return null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) return raw;
  const lower = raw.toLowerCase();
  const hit = rows.find(([catalogId, , publicName, displayName]) =>
    catalogId === raw || publicName === raw || displayName === raw ||
    catalogId.toLowerCase() === lower || publicName.toLowerCase() === lower || displayName.toLowerCase() === lower);
  return hit?.[1] ?? null;
}

let fetchSpy;
beforeEach(() => {
  fetchSpy = vi.fn(async () => { throw new Error("network is closed in this test"); });
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("source chat catalog", () => {
  it("holds exactly the 48 source Text + Search rows in source order", () => {
    expect(LMARENA_CHAT_MODELS.map((m) => [m.id, m.arenaId, m.publicName, m.name, m.organization, m.vision, m.category]))
      .toEqual(SOURCE_CHAT_ROWS);
    expect(LMARENA_CHAT_MODELS.filter((m) => m.category === "Text")).toHaveLength(42);
    expect(LMARENA_CHAT_MODELS.filter((m) => m.category === "Search")).toHaveLength(6);
    expect(LMARENA_CHAT_MODEL_IDS).toEqual(SOURCE_CHAT_ROWS.map((r) => r[0]));
    expect(Object.isFrozen(LMARENA_CHAT_MODELS) && Object.isFrozen(LMARENA_CHAT_MODELS[0])).toBe(true);
  });

  it("does not equate the 75 source rows with chat: the 27 Image rows are excluded", () => {
    expect(LMARENA_CHAT_MODELS.length + LMARENA_IMAGE_MODELS.length).toBe(LMARENA_SOURCE_TOTAL_ROWS);
    expect(LMARENA_IMAGE_MODELS).toHaveLength(LMARENA_SOURCE_IMAGE_ROWS);
    const chatIds = new Set(LMARENA_CHAT_MODELS.flatMap((m) => [m.id, m.arenaId]));
    for (const image of LMARENA_IMAGE_MODELS) {
      expect(chatIds.has(image.id)).toBe(false);
      expect(chatIds.has(image.arenaId)).toBe(false);
    }
    expect(LMARENA_CHAT_MODELS.every((m) => m.category === "Text" || m.category === "Search")).toBe(true);
    expect(new Set(LMARENA_CHAT_MODELS.map((m) => m.arenaId)).size).toBe(48);
    expect(new Set(LMARENA_CHAT_MODEL_IDS).size).toBe(48);
  });

  it("derives modalities and capabilities as the source getLMArenaModels does", () => {
    for (const m of LMARENA_CHAT_MODELS) {
      expect(m.inputModalities).toEqual(m.vision ? ["text", "image"] : ["text"]);
      expect(m.outputCapabilities).toEqual(m.category === "Search" ? ["text", "web"] : ["text"]);
    }
  });

  it("builds the source LMARENA_DIRECT_MODELS registry shape", () => {
    expect(LMARENA_CHAT_SOURCE_REGISTRY_MODELS).toEqual(SOURCE_CHAT_ROWS.map(([id, , , name, , vision]) =>
      (vision ? { id, name, supportsVision: true } : { id, name })));
  });

  it("keeps the local name and contextLength of the 7 rows the local registry lists", () => {
    const merged = buildLmarenaChatRegistryModels(localRegistry.models);
    expect(merged.map((m) => m.id)).toEqual(LMARENA_CHAT_MODEL_IDS);
    for (const local of localRegistry.models) {
      const row = merged.find((m) => m.id === local.id);
      expect(row, local.id).toBeTruthy();
      expect(row).toMatchObject({ name: local.name, contextLength: local.contextLength });
      expect(!!row.supportsVision).toBe(!!local.supportsVision);
    }
    const fresh = merged.find((m) => m.id === "grok-4.3/search");
    expect(fresh).toEqual({ id: "grok-4.3/search", name: "grok-4.3" });
    expect(buildLmarenaChatRegistryModels()).toEqual(LMARENA_CHAT_SOURCE_REGISTRY_MODELS);
    expect(buildLmarenaChatRegistryModels("nope")).toEqual(LMARENA_CHAT_SOURCE_REGISTRY_MODELS);
  });

  it("exposes source registry metadata", () => {
    expect(LMARENA_CHAT_PROVIDER_ID).toBe("lmarena");
    expect(LMARENA_CHAT_PROVIDER_ALIASES).toEqual(["lma"]);
    expect(LMARENA_CHAT_BASE_URL).toBe("https://arena.ai/nextjs-api/stream/create-evaluation");
    expect(LMARENA_CHAT_PROVIDER_METADATA).toMatchObject({
      format: "openai", executor: "lmarena", sourceAuthType: "apikey", sourceAuthHeader: "cookie",
      localConnectionAuthType: "cookie", serviceKinds: ["llm"], wire: { mode: "direct-battle", modality: "chat", modelField: "modelAId" },
    });
    expect(LMARENA_CHAT_PROVIDER_METADATA.chatModels).toBe(LMARENA_CHAT_MODELS);
  });

  it("keeps registration.json consistent with the module", () => {
    expect(registration.issue).toBe("#2034");
    expect(registration.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(registration.source.rowCounts).toEqual({ total: 75, text: 42, search: 6, image: 27, chat: 48 });
    expect(registration.models).toEqual(LMARENA_CHAT_MODELS.map(({ id, arenaId, publicName, name, organization, vision, category }) =>
      ({ id, arenaId, publicName, name, organization, vision, category })));
    expect(registration.localEvidence.equivalent).toBe(false);
    for (const name of Object.keys(registration.exports)) expect(bundle[name], name).toBeDefined();
  });
});

describe("model resolution", () => {
  it("resolves every row by catalog id, public name and display name, any case, with or without a prefix", () => {
    for (const [catalogId, arenaId, publicName, displayName] of SOURCE_CHAT_ROWS) {
      for (const key of [catalogId, publicName, displayName]) {
        const expected = sourceResolve(key, SOURCE_CHAT_ROWS);
        for (const variant of [key, key.toUpperCase(), key.toLowerCase(), `lmarena/${key}`, `LMA/${key}`, `arena/${key}`, `  ${key}  `]) {
          expect(resolveLmarenaChatArenaId(variant), variant).toBe(expected);
        }
      }
      expect(resolveLmarenaChatModel(catalogId)).toMatchObject({ ok: true, arenaModelId: arenaId, via: "catalog-id" });
    }
  });

  it("maps explicit chat UUIDs (any case) to the canonical row", () => {
    for (const [catalogId, arenaId] of SOURCE_CHAT_ROWS) {
      const r = resolveLmarenaChatModel(`lma/${arenaId.toUpperCase()}`);
      expect(r).toMatchObject({ ok: true, arenaModelId: arenaId, via: "uuid-catalog" });
      expect(r.model.id).toBe(catalogId);
    }
  });

  it("follows source order for the shared grok-4.3 public name", () => {
    expect(resolveLmarenaChatModel("grok-4.3")).toMatchObject({ arenaModelId: "019f42aa-9c3b-76d1-8bdf-2e883b1ca227", via: "public-name" });
    expect(resolveLmarenaChatModel("grok-4.3").model.id).toBe("grok-4.3/text");
    expect(resolveLmarenaChatModel("grok-4.3/search").model).toMatchObject({ category: "Search", arenaId: "019de22d-1445-7296-9c88-a5877bc66ef8" });
    expect(resolveLmarenaChatModel("grok-4.5").via).toBe("display-name");
  });

  it("resolves display-only aliases from the scrape", () => {
    expect(resolveLmarenaChatModel("gemma-4-31b").model.id).toBe("pteronura");
    expect(resolveLmarenaChatModel("GLM-5.2 (MAX)").model.id).toBe("glm-5.1");
    expect(resolveLmarenaChatModel("claude-sonnet-5-high").model.id).toBe("claude-sonnet-5");
    expect(resolveLmarenaChatModel("nvidia-nemotron-3-super-120b-a12b").model.id).toBe("march26-chatbot1-public");
  });

  it("passes an unknown explicit UUID through as the source does, or refuses it when asked", () => {
    const uuid = "00000000-0000-4000-8000-00000000abcd";
    expect(resolveLmarenaChatModel(`arena/${uuid}`)).toEqual({ ok: true, arenaModelId: uuid, model: null, via: "uuid-passthrough" });
    expect(resolveLmarenaChatModel(uuid, { allowUnknownUuid: false })).toMatchObject({ ok: false, reason: "unknown" });
  });

  it("strips only one leading provider prefix", () => {
    expect(stripLmarenaModelPrefix("lmarena/lma/x")).toBe("lma/x");
    expect(stripLmarenaModelPrefix("other/x")).toBe("other/x");
    expect(stripLmarenaModelPrefix(42)).toBe("");
  });
});

describe("refusals", () => {
  it("refuses every Image row by id, display name and UUID", () => {
    for (const image of LMARENA_IMAGE_MODELS) {
      for (const key of [image.id, image.name, `lmarena/${image.id}`, image.arenaId, image.arenaId.toUpperCase()]) {
        expect(resolveLmarenaChatModel(key), key).toMatchObject({ ok: false, status: 400, reason: "image", code: "lmarena_image_model_not_chat" });
      }
    }
  });

  it("refuses unknown names instead of guessing", () => {
    for (const key of ["gpt-9", "claude-sonnet-5x", "lmarena/", "lma/  ", "openai/gpt-5.2-high", "019f19f2-41f1-7c6d-9891-48d02fd9952"]) {
      const r = resolveLmarenaChatModel(key);
      expect(r.ok, key).toBe(false);
      expect(["unknown", "invalid"]).toContain(r.reason);
    }
    for (const key of [undefined, null, 7, {}, [], ""]) expect(resolveLmarenaChatModel(key)).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("never echoes the requested value and builds a request-free 400", async () => {
    const r = resolveLmarenaChatModel(SECRETISH);
    expect(JSON.stringify(r)).not.toContain("SYNTHETIC");
    const res = lmarenaChatRefusalResponse(r);
    expect(res.status).toBe(LMARENA_CHAT_REFUSAL_STATUS);
    const text = await res.text();
    expect(text).not.toContain("SYNTHETIC");
    expect(JSON.parse(text)).toEqual({ error: { message: LMARENA_CHAT_REFUSALS.unknown.message, type: "invalid_request_error", code: "lmarena_unknown_model" } });
    expect((await lmarenaChatRefusalResponse(undefined).json()).error.code).toBe("lmarena_invalid_model");
  });

  it("makes no network call for any resolution", () => {
    for (const key of [...LMARENA_CHAT_MODEL_IDS, "gpt-image-1", "nope"]) resolveLmarenaChatModel(key);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(tls).not.toHaveBeenCalled();
  });
});

describe("source wire model mapping", () => {
  const ids = { id: "id-1", userMessageId: "um-1", modelAMessageId: "ma-1" };

  it("reproduces the source transformRequest envelope with the resolved modelAId", () => {
    for (const [catalogId, arenaId, , , , , category] of SOURCE_CHAT_ROWS) {
      const wire = buildLmarenaSourceChatWire({ arenaModelId: resolveLmarenaChatArenaId(`lmarena/${catalogId}`), content: "user: hi", ids });
      expect(Object.keys(wire)).toEqual(LMARENA_SOURCE_CHAT_WIRE_KEYS);
      expect(wire).toEqual({
        id: "id-1", mode: LMARENA_CHAT_WIRE_MODE, modelAId: arenaId, userMessageId: "um-1", modelAMessageId: "ma-1",
        userMessage: { content: "user: hi", experimental_attachments: [], metadata: {} }, modality: LMARENA_CHAT_WIRE_MODALITY, recaptchaV3Token: null,
      });
      expect(wire.modality, category).toBe("chat");
    }
  });

  it("only forwards an operator-supplied reCAPTCHA token", () => {
    expect(buildLmarenaSourceChatWire({ arenaModelId: "a", content: "", ids, recaptchaV3Token: "op-token" }).recaptchaV3Token).toBe("op-token");
  });
});

describe("local executor comparison (mocked TLS)", () => {
  async function localModelAId(model) {
    tls.mockResolvedValueOnce({ status: 200, text: `data: ${JSON.stringify({ text: "hi" })}\n\n` });
    const result = await new LmarenaExecutor().execute({
      model, body: { messages: [{ role: "user", content: "hi" }] }, stream: false, credentials: { cookie: COOKIE }, log: LOG,
    });
    expect(result.response.status).toBe(200);
    const [url, init] = tls.mock.calls.at(-1);
    expect(url).toBe(LMARENA_CHAT_BASE_URL);
    expect(init.headers.Cookie).toBe(COOKIE);
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ mode: "direct-battle", modality: "chat" });
    return body.modelAId;
  }

  it("matches the staged resolver for the 6 ids the local ALLOW map covers", async () => {
    for (const id of ["amazon.nova-pro-v1:0", "claude-haiku-4-5-20251001", "claude-sonnet-5", "gemini-3.1-pro-preview", "gpt-5.2-high", "gpt-oss-120b"]) {
      expect(await localModelAId(id), id).toBe(resolveLmarenaChatArenaId(id));
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("documents the local gaps the resolver closes", async () => {
    // Listed in the local registry but missing from ALLOW: the raw name is sent.
    expect(await localModelAId("deepseek-v4-pro-thinking")).toBe("deepseek-v4-pro-thinking");
    expect(resolveLmarenaChatArenaId("deepseek-v4-pro-thinking")).toBe("019dc1c1-c62d-7b70-85a1-e0565e29fce1");
    // No case or display-name matching locally.
    expect(await localModelAId("Claude-Sonnet-5-High")).toBe("Claude-Sonnet-5-High");
    expect(resolveLmarenaChatArenaId("Claude-Sonnet-5-High")).toBe("019f19f2-41f1-7c6d-9891-48d02fd9952c");
    // An image catalog id is sent with modality chat locally; staged refuses it.
    expect(await localModelAId("gpt-image-1")).toBe("gpt-image-1");
    expect(resolveLmarenaChatModel("gpt-image-1").ok).toBe(false);
  });

  it("keeps the local missing-cookie path ahead of any send", async () => {
    const result = await new LmarenaExecutor().execute({ model: "claude-sonnet-5", body: { messages: [] }, stream: false, credentials: {}, log: LOG });
    expect(result.response.status).toBe(401);
    expect(tls).not.toHaveBeenCalled();
  });
});

describe("staging state (pre-registration only)", () => {
  it("is not imported by the registry or the executor", () => {
    for (const file of ["open-sse/providers/registry/lmarena.js", "open-sse/executors/lmarena.js"]) {
      expect(readFileSync(new URL(file, ROOT), "utf8")).not.toContain("native-lmarena-chat-catalog");
    }
    expect(localRegistry.models).toHaveLength(7);
  });
});
