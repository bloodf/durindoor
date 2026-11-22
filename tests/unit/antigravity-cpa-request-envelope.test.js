import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", async (original) => ({
  ...(await original()), proxyAwareFetch: send
}));
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";

beforeEach(() => send.mockReset());

async function outgoing(model, request, credentials = { accessToken: "synthetic", projectId: "project-test", connectionId: "account-test" }, extra = {}) {
  send.mockResolvedValueOnce(Response.json({ response: {} }));
  await new AntigravityExecutor().execute({ model, stream: false, credentials, body: { request, ...extra } });
  return JSON.parse(send.mock.calls.at(-1)[1].body);
}

describe("Antigravity CLIProxyAPI request envelope", () => {
  it("serializes media and thinking level as Cloud Code proto-JSON", async () => {
    send.mockResolvedValueOnce(Response.json({ response: {} }));
    await new AntigravityExecutor().execute({
      model: "gemini-3-flash", stream: false,
      credentials: { accessToken: "synthetic", projectId: "project-test", connectionId: "account-test" },
      body: { request: {
        contents: [{ role: "user", parts: [
          { text: "hello" },
          { inline_data: { mime_type: "audio/wav", data: "YWJj" } },
          { file_data: { mime_type: "application/pdf", file_uri: "https://example.test/file" } },
          { functionResponse: { name: "read", response: { result: "ok" }, parts: [{ inline_data: { mime_type: "image/png", data: "YWJj" } }] } }
        ] }],
        generationConfig: { thinkingConfig: { thinkingLevel: " high " } }
      } }
    });
    expect(send).toHaveBeenCalledTimes(1);
    const outgoing = JSON.parse(send.mock.calls[0][1].body);
    expect(outgoing.request.contents[0].parts.slice(1, 3)).toEqual([
      { inlineData: { mimeType: "audio/wav", data: "YWJj" } },
      { fileData: { mimeType: "application/pdf", fileUri: "https://example.test/file" } }
    ]);
    expect(outgoing.request.contents[0].parts[3].functionResponse.parts[0]).toEqual({ inlineData: { mimeType: "image/png", data: "YWJj" } });
    expect(outgoing.request.generationConfig.thinkingConfig.thinkingLevel).toBe("HIGH");
    expect(send.mock.calls[0][1].headers["X-Goog-User-Project"]).toBeUndefined();
  });

  it("preserves NONE and strips invalid Claude thinking budgets without orphan thoughts", async () => {
    const result = await outgoing("claude-sonnet-4-6", {
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
      tools: [{ functionDeclarations: [{ name: "read", parameters: { type: "object", properties: {} } }] }],
      tool_config: { function_calling_config: { mode: " none " } },
      generationConfig: { maxOutputTokens: 500, thinkingConfig: { thinkingBudget: 1024, includeThoughts: true }, thinking_config: { includeThoughts: true } }
    });
    expect(result.request.toolConfig.functionCallingConfig.mode).toBe("NONE");
    expect(result.request.generationConfig.thinkingConfig).toBeUndefined();
    expect(result.request.generationConfig.thinking_config).toBeUndefined();
    const translated = translateRequest(FORMATS.OPENAI, FORMATS.ANTIGRAVITY, "claude-sonnet-4-6", {
      messages: [{ role: "user", content: "hello" }], tool_choice: "none",
      tools: [{ type: "function", function: { name: "read", parameters: { type: "object", properties: {} } } }]
    }, false, {}, "antigravity");
    expect((await outgoing("claude-sonnet-4-6", translated.request)).request.toolConfig.functionCallingConfig.mode).toBe("NONE");
  });

  it("scopes explicit session IDs to credentials and subagents in signed int64 form", async () => {
    const request = { sessionId: "123", contents: [{ role: "user", parts: [{ text: "hello" }] }] };
    const credentials = (id) => ({ accessToken: "synthetic", projectId: "project-test", connectionId: id });
    const one = (await outgoing("gemini-3-flash", request, credentials("one"), { metadata: { subagent_id: "a" } })).request.sessionId;
    const again = (await outgoing("gemini-3-flash", request, credentials("one"), { metadata: { subagent_id: "a" } })).request.sessionId;
    const otherChild = (await outgoing("gemini-3-flash", request, credentials("one"), { metadata: { subagent_id: "b" } })).request.sessionId;
    const otherAccount = (await outgoing("gemini-3-flash", request, credentials("two"), { metadata: { subagent_id: "a" } })).request.sessionId;
    expect(one).toBe(again);
    expect(new Set([one, otherChild, otherAccount]).size).toBe(3);
    expect(BigInt.asIntN(64, BigInt(one)).toString()).toBe(one);
    expect((await outgoing("gemini-3-flash", request, { accessToken: "synthetic", projectId: "project-test" })).request.sessionId).toBe("123");
    const ids = [];
    for (let index = 0; index < 16; index++) ids.push(await outgoing("gemini-3-flash", { ...request, sessionId: `session-${index}` }, credentials("one")));
    expect(ids.some((entry) => BigInt(entry.request.sessionId) < 0n)).toBe(true);
    expect(ids.some((entry) => BigInt(entry.request.sessionId) > 0n)).toBe(true);
    const image = await outgoing("gemini-image", { contents: request.contents }, { ...credentials("one"), _clientSessionId: "generated", _clientSessionIsGenerated: true });
    expect(image.request.sessionId).toBeUndefined();
    const imageWithSession = await outgoing("gemini-image", request, credentials("one"));
    expect(imageWithSession.request.sessionId).not.toBe("123");
    const translatedChild = async (child) => {
      const auth = credentials("one");
      const translated = translateRequest(FORMATS.OPENAI, FORMATS.ANTIGRAVITY, "gemini-3-flash", {
        session_id: "session", metadata: { subagent_id: child }, messages: [{ role: "user", content: "hello" }]
      }, false, auth, "antigravity", null, [], "one");
      return (await outgoing("gemini-3-flash", translated.request, auth)).request.sessionId;
    };
    expect(await translatedChild("alpha")).not.toBe(await translatedChild("beta"));
  });

  it("routes search-only capable chat separately and keeps mixed function tools on chat", async () => {
    const body = { messages: [{ role: "user", content: "find a page" }], tools: [{ google_search: {} }] };
    const translated = translateRequest(FORMATS.OPENAI, FORMATS.ANTIGRAVITY, "gemini-3.8-flash", body, false, {}, "antigravity");
    const result = await outgoing("gemini-3.8-flash", translated.request, undefined, { requestType: translated.requestType });
    expect(result.requestType).toBe("web_search");
    expect(result.request.tools[0].googleSearch).toBeDefined();
    expect(result.request.toolConfig).toBeUndefined();
    const mixed = translateRequest(FORMATS.OPENAI, FORMATS.ANTIGRAVITY, "gemini-3.8-flash", { ...body, tools: [...body.tools, { type: "function", function: { name: "read", parameters: { type: "object", properties: {} } } }] }, false, {}, "antigravity");
    const mixedResult = await outgoing("gemini-3.8-flash", mixed.request);
    expect(mixedResult.requestType).toBeUndefined();
    expect(mixedResult.request.tools[0].functionDeclarations[0].name).toBe("read");
    const vetoed = translateRequest(FORMATS.OPENAI, FORMATS.ANTIGRAVITY, "gemini-3.8-flash", { ...body, tool_choice: "none" }, false, {}, "antigravity");
    expect((await outgoing("gemini-3.8-flash", vetoed.request, undefined, { requestType: vetoed.requestType })).requestType).toBeUndefined();
    const unavailable = translateRequest(FORMATS.OPENAI, FORMATS.ANTIGRAVITY, "gemini-3.8-flash", body, false, {}, "antigravity", null, [], null, null, { modelCapabilities: { search: false } });
    expect(unavailable.requestType).toBeUndefined();
  });
});
