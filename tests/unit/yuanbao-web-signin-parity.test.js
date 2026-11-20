import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getExecutor } from "open-sse/executors/index.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import { POST as validate } from "../../src/app/api/providers/validate/route.js";
import registry from "open-sse/providers/registry/yuanbao-web.js";
vi.mock("open-sse/utils/proxyFetch.js", async (original) => ({ ...await original(), proxyAwareFetch: (url, options) => globalThis.fetch(url, options) }));
beforeEach(() => vi.stubGlobal("fetch", vi.fn(async (url) => { throw new Error(`Unexpected outbound: ${url}`); })));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const input = (apiKey, stream = true) => ({ model: "deepseek-r1-search", body: { messages: [{ role: "user", content: "hello" }] }, stream, credentials: { apiKey } });
const validateInput = (provider, apiKey) => validate(new Request("http://localhost/api/providers/validate", { method: "POST", body: JSON.stringify({ provider, apiKey }) }));
describe("Yuanbao web session", () => {
  it("rejects incomplete session input without network", async () => {
    for (const cookie of ["hy_token=fake-token", "hy_user=fake-user", "hy_user=; hy_token=fake-token"]) {
      expect((await (await validateInput("yuanbao-web", cookie)).json()).valid).toBe(false);
      expect((await getExecutor("yuanbao-web").execute(input(cookie))).response.status).toBe(401);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("returns the static catalog without network", async () => {
    const result = await fetchConnectionModels({ id: "fake", provider: "yuanbao-web", apiKey: "hy_user=u; hy_token=t" });
    expect(result.models.map((m) => m.id)).toEqual(registry.models.map((m) => m.id));
    expect(fetch).not.toHaveBeenCalled();
  });
  it("routes the alias with only the Yuanbao cookie and translates streamed content", async () => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      calls.push([String(url), options]);
      if (String(url) === "https://yuanbao.tencent.com/api/user/agent/conversation/create") return Response.json({ id: "fake-conversation" });
      if (String(url) === "https://yuanbao.tencent.com/api/chat/fake-conversation") return new Response('data: {"type":"think","content":"reason"}\n\ndata: {"type":"text","msg":"answer"}\n\ndata: [DONE]\n\n');
      throw new Error(`Unexpected outbound: ${url}`);
    }));
    const result = await getExecutor("ybw").execute(input("Cookie: hy_user=fake-user; hy_token=fake-token; unrelated=secret"));
    expect(result.response.status).toBe(200);
    const text = await result.response.text();
    expect(text).toContain('"reasoning_content":"reason"');
    expect(text).toContain('"content":"answer"');
    expect(text).toContain("data: [DONE]");
    expect(calls).toHaveLength(2);
    for (const [, options] of calls) {
      expect(options.headers.Cookie).toBe("hy_source=web; hy_user=fake-user; hy_token=fake-token");
      expect(options.headers.Authorization).toBeUndefined();
    }
    expect(JSON.parse(calls[1][1].body)).toMatchObject({ chatModelId: "deep_seek", supportFunctions: ["supportInternetSearch"] });
  });
  it.each([401, 403])("preserves expired session status %i", async (status) => {
    fetch.mockResolvedValue(new Response("expired", { status }));
    const result = await getExecutor("yuanbao-web").execute(input("hy_user=u; hy_token=t"));
    expect(result.response.status).toBe(status);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

it("keeps Yuanbao validation and credentials separate from Tencent API providers", async () => {
  const valid = await (await validateInput("yuanbao-web", "hy_user=u; hy_token=t")).json();
  expect(valid).toMatchObject({ valid: false, skipped: true });
  expect((await getExecutor("yuanbao-web").execute(input("fake-tencent-api-key"))).response.status).toBe(401);
  expect(getExecutor("tencent")).not.toBe(getExecutor("yuanbao-web"));
  expect(() => getExecutor("yuanbao-web").buildHeaders({ apiKey: "fake-session" })).toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

it("collects a non-streaming completion and refuses redirect forwarding", async () => {
  fetch.mockImplementation(async (url, options) => {
    expect(options.redirect).toBe("error");
    if (String(url).endsWith("/create")) return Response.json({ id: "fake-id" });
    if (String(url).endsWith("/fake-id")) return new Response('data: {"type":"think","content":"why"}\n\ndata: {"type":"text","msg":"hello"}\n\n');
    throw new Error(`Unexpected outbound: ${url}`);
  });
  const result = await getExecutor("yuanbao-web").execute(input("hy_user=u; hy_token=t", false));
  expect((await result.response.json()).choices[0].message).toMatchObject({ content: "hello", reasoning_content: "why" });
  expect(fetch).toHaveBeenCalledTimes(2);
});
