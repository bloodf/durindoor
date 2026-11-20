import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatGptWebExecutor } from "../../open-sse/executors/chatgpt-web.js";
import registry from "../../open-sse/providers/registry/chatgpt-web.js";
import { probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";

const cookie = "__Secure-next-auth.session-token";
const turn = { text: "mock answer", conversationId: "private-conversation", status: "finished_successfully", endTurn: true };
afterEach(() => vi.unstubAllGlobals());

describe("ChatGPT Web session parity", () => {
  it("validates only the supplied session and does not return the access token", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ accessToken: "fake-access-token" }) }));
    const result = await probeRegistryProvider("chatgpt-web", `${cookie}.1=second; ${cookie}.0=first`, fetcher);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1].headers.Cookie).toBe(`${cookie}.0=first; ${cookie}.1=second`);
    expect(result.valid).toBe(true);
    expect(JSON.stringify(result)).not.toContain("fake-access-token");
  });

  it("discovers and runs the pinned OmniRoute GPT-6 browser lanes with isolated credentials and SSE", async () => {
    vi.stubGlobal("fetch", () => { throw new Error("unexpected outbound request"); });
    expect(registry.models.map((model) => model.id)).toEqual(expect.arrayContaining(["gpt-6", "gpt-6-thinking", "gpt-6-pro"]));
    const observed = [];
    const executor = new ChatGptWebExecutor({ browser: {
      createSession: async (input) => { observed.push(input); return {}; },
      runTurn: async () => turn,
      readSessionCookies: async () => [],
    } });
    for (const [model, effortIndex] of [["gpt-6", 0], ["gpt-6-thinking", 2], ["gpt-6-pro", 4]]) {
      const response = await executor.execute({ model, body: { messages: [{ role: "user", content: "hello" }], reasoning_effort: "high" }, stream: true, credentials: { apiKey: `${cookie}=${model}-secret`, connectionId: model, providerSpecificData: { transport: "browser" } } });
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain('"content":"mock answer"');
      expect(body).toContain("data: [DONE]");
      expect(body).not.toContain("secret");
      expect(body).not.toContain("private-conversation");
      expect(observed.at(-1).selection).toEqual({ kind: "picker", modelLabel: "GPT-6 Sol", effortIndex });
      expect(observed.at(-1).storageState.cookies[0].value).toBe(`${model}-secret`);
    }
    expect(observed.map((item) => item.connectionId)).toEqual(["gpt-6", "gpt-6-thinking", "gpt-6-pro"]);
  });
});

it("passes the GPT-6 picker lane to the first-party conversation request", async () => {
  const { executeChatGptWebFirstPartyTurn } = await import("../../open-sse/utils/chatgptWebFirstParty.js");
  let sent;
  vi.stubGlobal("__durindoorChatGptFirstPartyV1", {
    finalizeRequirements: async () => ({}),
    proofManager: { getEnforcementToken: async () => "fake" },
    turnstileManager: { getEnforcementToken: async () => "fake" },
    buildSentinelHeaders: () => ({}),
    requestClient: { safePost: async (_path, options) => { sent = options.requestBody; return new Response("data: [DONE]\n\n"); } },
  });
  const page = { evaluate: async (fn, arg) => fn(arg) };
  await executeChatGptWebFirstPartyTurn(page, { prompt: "hello", attachments: [], selection: { kind: "picker", modelLabel: "GPT-6 Sol", effortIndex: 4 } });
  expect(sent.model).toBe("gpt-6-pro");
});

it("persists rotation only for the originating connection and rejects foreign storage origins", async () => {
  vi.stubGlobal("fetch", () => { throw new Error("unexpected outbound request"); });
  const refreshed = vi.fn();
  const createSession = vi.fn(async () => ({}));
  const executor = new ChatGptWebExecutor({ browser: {
    createSession, runTurn: async () => turn,
    readSessionCookies: async () => [{ name: cookie, value: "new-fake-session" }],
  } });
  const input = { model: "gpt-6", body: { messages: [{ role: "user", content: "hi" }] }, stream: false,
    credentials: { apiKey: `${cookie}=old-fake-session`, connectionId: "first", providerSpecificData: { transport: "browser" } }, onCredentialsRefreshed: refreshed };
  const result = await executor.execute(input);
  expect(result.status).toBe(200);
  expect(refreshed).toHaveBeenCalledOnce();
  expect(refreshed.mock.calls[0][0]).toMatchObject({ connectionId: "first", apiKey: `${cookie}=new-fake-session` });
  expect(await result.text()).not.toContain("fake-session");
  const bad = await executor.execute({ ...input, credentials: { ...input.credentials, connectionId: "second", providerSpecificData: { transport: "browser", storageState: { cookies: [], origins: [{ origin: "https://example.com", localStorage: [] }] } } } });
  expect(bad.response.status).toBe(401);
  expect(createSession).toHaveBeenCalledOnce();
  expect(refreshed).toHaveBeenCalledOnce();
});
