import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ required: true, annotations: new WeakMap(), reasons: [], resolve: vi.fn() }));
vi.mock("@/lib/localDb", async (original) => ({ ...(await original()), getSettings: async () => ({ requireApiKey: fixture.required }) }));
vi.mock("@/sse/services/mediaRoutes.js", async (original) => ({
  ...(await original()),
  resolveMediaRoute: async () => ({ error: Response.json({ error: { message: "No fixture route" } }, { status: 400 }) }),
}));
vi.mock("@/lib/db/repos/usageRepo.js", async (original) => ({ ...(await original()), getBillingEpoch: async () => "epoch" }));
vi.mock("@/sse/services/auth.js", async (original) => ({ ...(await original()), resolveClientApiKey: fixture.resolve, getProviderCredentials: async () => null, getProviderCredentialsWithQuotaPreflight: async () => null }));
vi.mock("open-sse/services/operationalMetrics.js", async (original) => ({
  ...(await original()),
  annotateClientAdmissionFailure: (response, reason) => { fixture.annotations.set(response, reason); fixture.reasons.push(reason); return response; },
  copyClientAdmissionFailure: (source, target) => { if (fixture.annotations.has(source)) fixture.annotations.set(target, fixture.annotations.get(source)); return target; },
}));

const handlers = await Promise.all(["embeddings", "tts", "stt", "fetch", "search", "systemone", "rerank", "moderations", "imageGeneration", "imageEdit", "music", "video", "nativeProvider", "chat", "codexAlphaSearch"].map((name) => import(`../../src/sse/handlers/${name}.js`)));
const [embeddings, tts, stt, fetchHandler, search, systemone, rerank, moderations, imageGeneration, imageEdit, music, video, native, chat, codex] = handlers;
const gemini = await import("../../src/app/api/v1beta/models/[...path]/route.js");

function request(key, body = {}, method = "POST", path = "/v1/test") {
  const headers = key ? { authorization: `Bearer ${key}` } : {};
  return new Request(`https://example.test${path}`, { method, headers: { ...headers, "content-type": "application/json" }, ...(method === "GET" ? {} : { body: JSON.stringify(body) }) });
}
function multipart(key) {
  const form = new FormData();
  form.set("model", "invalid");
  return new Request("https://example.test/v1/test", { method: "POST", headers: key ? { authorization: `Bearer ${key}` } : {}, body: form });
}
// Expected post-admission validation results for the intentionally incomplete fixtures.
const admitted = {
  embeddings: [400, "Missing required field: input"],
  tts: [400, "Missing required field: input"],
  stt: [400, "Missing required field: file"],
  fetch: [400, "Missing required field: url"],
  search: [400, "Missing required field: query"],
  systemone: [400, "Missing model"],
  rerank: [400, "Missing model"],
  moderations: [400, "Missing model"],
  imageGeneration: [400, "Missing required field: prompt"],
  imageEdit: [400, "Missing required field: image"],
  "music generation": [400, "No fixture route"],
  "music poll": [403, "Music polling requires durable ownership and x-9router-connection-id"],
  "video generation": [400, "No fixture route"],
  "video poll": [403, "Video polling requires durable ownership and x-9router-connection-id"],
  nativeProvider: [400, "Missing gateway model identity"],
  chat: [404, "No active credentials for provider: openai. Connect an account for this provider in the dashboard."],
  "chat messages": [404, "No active credentials for provider: openai. Connect an account for this provider in the dashboard."],
  codexAlphaSearch: [400, "Invalid search request"],
  "gemini native": [503, "No active credentials for provider: gemini"],
};
// Chat must resolve a concrete model before the mocked missing-credentials check.
const cases = [
  ["embeddings", (key) => embeddings.handleEmbeddings(request(key))],
  ["tts", (key) => tts.handleTts(request(key))],
  ["stt", (key) => stt.handleStt(multipart(key))],
  ["fetch", (key) => fetchHandler.handleFetch(request(key))],
  ["search", (key) => search.handleSearch(request(key))],
  ["systemone", (key) => systemone.handleSystemone(request(key))],
  ["rerank", (key) => rerank.handleRerank(request(key))],
  ["moderations", (key) => moderations.handleModerations(request(key))],
  ["imageGeneration", (key) => imageGeneration.handleImageGeneration(request(key))],
  ["imageEdit", (key) => imageEdit.handleImageEdit(multipart(key))],
  ["music generation", (key) => music.handleMusicGeneration(request(key))],
  ["music poll", (key) => music.handleMusicGet(request(key, {}, "GET"), "job")],
  ["video generation", (key) => video.handleVideoGeneration(request(key))],
  ["video create", (key) => video.handleVideoCreate(request(key), "generations")],
  ["video poll", (key) => video.handleVideoGet(request(key, {}, "GET"), "job")],
  ["nativeProvider", (key) => native.handleNativeProvider(request(key, {}, "GET"), "anthropic", "/v1/files")],
  // A supported registry model reaches credential admission; an unknown bare
  // placeholder now correctly stops earlier with model_not_found.
  ["chat", (key) => chat.handleChat(request(key, { model: "openai/gpt-4o", messages: [{ role: "user", content: "hello" }] }))],
  ["chat messages", (key) => chat.handleChat(request(key, { model: "openai/gpt-4o", messages: [{ role: "user", content: "hello" }] }, "POST", "/v1/messages"))],
  ["codexAlphaSearch", (key) => codex.handleCodexAlphaSearch(request(key))],
  ["gemini native", (key) => gemini.POST(request(key, { generationConfig: { responseModalities: ["AUDIO"] } }), { params: Promise.resolve({ path: ["gemini-2.5-flash-preview-tts:generateContent"] }) })],
];

beforeEach(() => {
  fixture.resolve.mockReset();
  fixture.resolve.mockImplementation(async (req, { required }) => {
    const key = req.headers.get("authorization")?.slice(7) || null;
    return { apiKey: key, auth: key === "bad" ? { ok: false, reason: "invalid" } : !key && required ? { ok: false, reason: "missing" } : { ok: true, apiKeyId: key ? "id" : null, billingEpoch: "epoch" } };
  });
});

describe.each(cases)("%s admission", (name, invoke) => {
  it.each([true, false])("handles missing, invalid, and valid keys with requireApiKey=%s", async (required) => {
    fixture.required = required;
    for (const key of [null, "bad", "good"]) {
      fixture.reasons = [];
      const response = await invoke(key);
      expect(fixture.resolve).toHaveBeenLastCalledWith(expect.any(Request), { required });
      const denied = key === "bad" || (!key && required);
      if (denied) {
        const message = key ? "Invalid API key" : "Missing API key";
        expect(response.status).toBe(401);
        const body = await response.json();
        const wrapped = !["gemini native", "nativeProvider", "codexAlphaSearch"].includes(name);
        if (wrapped) {
          const target = name === "chat messages" ? body : body.error;
          expect(target.request_id).toEqual(expect.any(String));
          delete target.request_id;
        }
        if (name === "gemini native") expect(body).toEqual({ error: { message } });
        else if (name === "chat messages") expect(body).toEqual({ type: "error", error: { type: "authentication_error", message } });
        else expect(body).toEqual({ error: { message, type: "authentication_error", code: "invalid_api_key" } });
        expect(response.headers.get("content-type")).toContain("application/json");
        expect(response.headers.get("access-control-allow-origin")).toBe(name === "gemini native" ? null : "*");
        expect(fixture.reasons.at(-1)).toBe(key ? "auth_invalid" : "auth_missing");
      } else {
        const expected = name === "video create" ? (key ? [400, "No fixture route"] : [403, "Video jobs require a stored caller API key"]) : admitted[name];
        expect(response.status).toBe(expected[0]);
        expect((await response.json()).error.message).toBe(expected[1]);
        expect(fixture.annotations.get(response)).toBeUndefined();
      }
    }
  });
});
