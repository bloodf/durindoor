// Gemini 4 Argon on Gemini/Vertex (#1369): upstream 9router 29fc880e (catalog,
// Vertex defaultLocation), 9c141910 (API-key project/location) and eb373017
// (sampling params dropped, functionResponse last) for non-Antigravity paths.
import "../translator/registerAll.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VertexExecutor } from "../../open-sse/executors/vertex.js";
import gemini from "../../open-sse/providers/registry/gemini.js";
import vertex from "../../open-sse/providers/registry/vertex.js";
import { openaiToGeminiRequest } from "../../open-sse/translator/request/openai-to-gemini.js";
import { claudeToGeminiRequest } from "../../open-sse/translator/request/claude-to-gemini.js";

async function vertexUrl(model, credentials) {
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await new VertexExecutor("vertex").execute({
    model,
    body: { contents: [{ role: "user", parts: [{ text: "hi" }] }] },
    stream: false,
    credentials,
    proxyOptions: { disableEnvProxy: true },
  });
  return fetchMock.mock.calls[0][0];
}

const BASE = "https://aiplatform.googleapis.com/v1";

describe("Vertex Argon endpoints", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists Argon on gemini and vertex with a global default location", () => {
    expect(gemini.models.map((m) => m.id)).toContain("gemini-4-argon");
    expect(vertex.models.find((m) => m.id === "gemini-4-argon")?.defaultLocation).toBe("global");
  });

  it("raw API key keeps the projectless endpoint for models without a default location", async () => {
    expect(await vertexUrl("gemini-2.5-flash", { apiKey: "k", providerSpecificData: { projectId: "p", location: "eu" } }))
      .toBe(`${BASE}/publishers/google/models/gemini-2.5-flash:generateContent?key=k`);
  });

  it("raw API key with an explicit project honors location for Argon, defaulting to global", async () => {
    expect(await vertexUrl("gemini-4-argon", { apiKey: "k", providerSpecificData: { projectId: "p" } }))
      .toBe(`${BASE}/projects/p/locations/global/publishers/google/models/gemini-4-argon:generateContent?key=k`);
    expect(await vertexUrl("gemini-4-argon", { apiKey: "k", providerSpecificData: { projectId: "p", location: "eu" } }))
      .toBe("https://aiplatform.eu.rep.googleapis.com/v1/projects/p/locations/eu/publishers/google/models/gemini-4-argon:generateContent?key=k");
  });

  it("raw API key without a project keeps the projectless endpoint", async () => {
    expect(await vertexUrl("gemini-4-argon", { apiKey: "k", providerSpecificData: {} }))
      .toBe(`${BASE}/publishers/google/models/gemini-4-argon:generateContent?key=k`);
  });

  it("OAuth uses the model's default location before us-central1", async () => {
    expect(await vertexUrl("gemini-4-argon", { accessToken: "t", providerSpecificData: { projectId: "p" } }))
      .toBe(`${BASE}/projects/p/locations/global/publishers/google/models/gemini-4-argon:generateContent`);
    expect(await vertexUrl("gemini-2.5-flash", { accessToken: "t", providerSpecificData: { projectId: "p" } }))
      .toBe(`${BASE}/projects/p/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent`);
    expect(await vertexUrl("gemini-4-argon", { accessToken: "t", providerSpecificData: { projectId: "p", location: "us" } }))
      .toBe(`${BASE}/projects/p/locations/us/publishers/google/models/gemini-4-argon:generateContent`);
  });
});

describe("Gemini 4 request rules on Gemini/Vertex translators", () => {
  const openaiBody = {
    temperature: 0.3, top_p: 0.8, top_k: 20, max_tokens: 500,
    messages: [
      { role: "user", content: "go" },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "read", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", content: "ok" },
    ],
  };

  it("OpenAI source drops sampling params for Gemini 4 only", () => {
    expect(openaiToGeminiRequest("gemini-4-argon", openaiBody, false).generationConfig).toEqual({ maxOutputTokens: 500 });
    expect(openaiToGeminiRequest("gemini-3.8-flash", openaiBody, false).generationConfig)
      .toMatchObject({ temperature: 0.3, topP: 0.8, topK: 20, maxOutputTokens: 500 });
  });

  const claudeBody = {
    temperature: 0.5, top_k: 10, max_tokens: 100,
    messages: [
      { role: "user", content: "go" },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read", input: {}, thoughtSignature: "sig" }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }, { type: "text", text: "next" }] },
    ],
  };
  const kinds = (content) => content.parts.map((p) => (p.functionResponse ? "fr" : p.text !== undefined ? "text" : "other"));

  it("Claude source drops sampling params and puts functionResponse last for Gemini 4", () => {
    const out = claudeToGeminiRequest("gemini-4-argon", claudeBody, false);
    expect(out.generationConfig).toEqual({ maxOutputTokens: 100 });
    expect(kinds(out.contents.at(-1))).toEqual(["text", "fr"]);
    expect(out._toolNameMap).toBeInstanceOf(Map);
  });

  it("Claude source leaves Gemini 3.x part order and sampling unchanged", () => {
    const out = claudeToGeminiRequest("gemini-3.8-flash", claudeBody, false);
    expect(out.generationConfig).toMatchObject({ temperature: 0.5, topK: 10 });
    expect(kinds(out.contents.at(-1))).toEqual(["fr", "text"]);
  });
});
