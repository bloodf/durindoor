// Retained dd3a3fbcf1 scenarios, separately from the byte-identical 4b17373399 suite.
// CPA dbe641f: 13e0642 grouping, 54ed2ba enums, 249ea68 raw RPC errors.
// Current helpers and real route rejection replace the removed private pairing API.
// DurinDoor #5529 preserves result; CPA 66f3ad1's wire rewrite is not applicable.
import "../translator/registerAll.js";
import { beforeEach, expect, it, vi } from "vitest";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";

const call = (id, name) => ({ functionCall: { id, name, args: {} }, thoughtSignature: "fixture-signature" });
const resultPart = (id, name) => ({ functionResponse: { id, name, response: { result: id } } });
const translate = (contents) => groupGeminiFunctionResponses(contents);

it("groups split responses in call order and backfills blank names without losing signatures or IDs", async () => {
  const contents = [{ role: "model", parts: [call("a", "first"), call("b", "second")] },
    { role: "function", parts: [resultPart("b", "second")] }, { role: "user", parts: [resultPart("a", "  ")] }];
  const saved = structuredClone(contents);
  const out = translate(contents);
  expect(contents).toEqual(saved);
  expect(out).toHaveLength(2);
  expect(out[1].role).toBe("user");
  expect(out[1].parts.map(p => p.functionResponse.id)).toEqual(["a", "b"]);
  await (await post(contents)).text();
  const sent = mocks.execute.mock.calls[0][0].body.request.contents;
  expect(sent[1].parts.map(p => p.functionResponse.name)).toEqual(["first", "second"]);
  expect(sent[0].parts.map(p => p.thoughtSignature)).toEqual(["fixture-signature", "fixture-signature"]);
  expect(out[0]).toEqual(contents[0]);
  expect(contents).toHaveLength(3);
});

it("cleans whitespace enums only in Gemini schema nodes", () => {
  const schema = { type: "object", properties: { enum: { type: "string", enum: [null, "", " \t", " keep ", "ok"] } } };
  expect(cleanJSONSchemaForAntigravity(schema).properties.enum.enum).toEqual([" keep ", "ok"]);
});

// Public route + real chat core; only execution and persistence are mocked.
const mocks = vi.hoisted(() => ({ execute: vi.fn(), handleChat: vi.fn() }));
vi.mock("../../open-sse/executors/index.js", () => ({ getExecutor: () => ({ noAuth: true, execute: mocks.execute }) }));
vi.mock("../../open-sse/utils/clientDetector.js", () => ({ detectClientTool: () => null, isNativePassthrough: () => false, isCodexOriginatedHeaders: () => false }));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({ createRequestLogger: async () => ({ logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(), logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn() }) }));
vi.mock("@/lib/usageDb.js", () => ({ trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}), saveUsageStats: vi.fn(async () => {}) }));
vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: mocks.handleChat }));
const { POST } = await import("../../src/app/api/v1beta/models/[...path]/route.js");
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { groupGeminiFunctionResponses } = await import("../../open-sse/translator/formats/gemini.js");
const { googleRpcErrorBody: googleRpcError } = await import("../../open-sse/utils/antigravityGeminiNative.js");
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const streamResponse = (frames) => new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
const post = (contents = [{ role: "user", parts: [{ text: "hello" }] }]) => POST(new Request("https://router.test/api/v1beta/models/antigravity/test:streamGenerateContent?alt=sse", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contents }),
}), { params: Promise.resolve({ path: ["antigravity", "test:streamGenerateContent"] }) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockImplementation(async ({ body }) => ({ transformedBody: body, headers: {}, url: "https://upstream.test", response: streamResponse([
    { response: { candidates: [{ content: { role: "model", parts: [{ text: "done" }] }, finishReason: "STOP" }] } },
  ]) }));
  mocks.handleChat.mockImplementation(async (request, raw) => (await handleChatCore({
    body: await request.json(), modelInfo: { provider: "antigravity", model: "test" },
    credentials: { accessToken: "synthetic-private-token", projectId: "fixture" }, clientRawRequest: raw, log,
  })).response);
});

it("prefers exact id+name matches for duplicate IDs and handles both wire spellings", async () => {
  const contents = [{ role: "model", parts: [call("same", "first"), { function_call: { id: "same", name: "second", args: {} } }] },
    { role: "function", parts: [{ function_response: { id: "same", name: "second", response: { ok: 2 } } }] },
    { role: "user", parts: [resultPart("same", "first")] }];
  const saved = structuredClone(contents);
  const out = translate(contents);
  expect(contents).toEqual(saved);
  expect(out[1].parts.map(p => (p.functionResponse || p.function_response).name)).toEqual(["first", "second"]);
  expect((await post(out)).status).toBe(200);
});

it("moves mixed text and intervening valid user turns after the response group", () => {
  const contents = [{ role: "model", parts: [call("a", "first"), call("b", "second")] },
    { role: "user", parts: [resultPart("b", "second"), { text: "extra" }] },
    { role: "user", parts: [{ text: "between" }] }, { role: "user", parts: [resultPart("a", "first")] }];
  const saved = structuredClone(contents);
  const out = groupGeminiFunctionResponses(contents);
  expect(contents).toEqual(saved);
  expect(out[1].parts.map(p => p.functionResponse.id)).toEqual(["a", "b"]);
  expect(out.slice(2).map(c => c.parts[0].text)).toEqual(["extra", "between"]);
});

it.each([null, { role: "user", parts: [] }, { role: "user" }, { role: "user", parts: {} },
  { role: "user", parts: [call("x", "other")] }])("preserves invalid boundary %j for pairing rejection", async (boundary) => {
  const contents = [{ role: "model", parts: [call("a", "first")] }, boundary,
    { role: "user", parts: [resultPart("a", "first")] }];
  const saved = structuredClone(contents);
  const out = groupGeminiFunctionResponses(contents);
  expect(contents).toEqual(saved);
  expect(out).toEqual(contents);
  expect((await post(out)).status).toBe(400);
  expect(mocks.execute).not.toHaveBeenCalled();
});

it.each([[], [resultPart("a", "first")], [resultPart("a", "first"), resultPart("b", "second"), resultPart("extra", "other")],
  [resultPart("wrong", "first"), resultPart("b", "second")], [resultPart("a", "wrong"), resultPart("b", "second")]].map(parts => [parts]))("retains mismatched results %j", async (parts) => {
  const contents = [{ role: "model", parts: [call("a", "first"), call("b", "second")] }, { role: "user", parts }];
  const saved = structuredClone(contents);
  const out = groupGeminiFunctionResponses(contents);
  expect(contents).toEqual(saved);
  expect(out.flatMap(turn => turn.parts).filter(p => p.functionResponse)).toHaveLength(parts.length);
  expect((await post(out)).status).toBe(400);
  expect(mocks.execute).not.toHaveBeenCalled();
});

it.each(["MALFORMED_FUNCTION_CALL", "UNEXPECTED_TOOL_CALL"])("emits RPC errors after thoughts without replay for %s", async (finishReason) => {
  mocks.execute.mockImplementation(async ({ body }) => ({ transformedBody: body, headers: {}, url: "https://upstream.test", response: streamResponse([
    { response: { candidates: [{ content: { role: "model", parts: [{ thought: true, text: "considering", thoughtSignature: "signed" }] } }] } },
    { response: { candidates: [{ finishReason }] } },
  ]) }));
  const response = await post();
  const wire = await response.text();
  expect(response.status).toBe(200);
  expect(wire).toContain("considering");
  const blocks = wire.trim().split(/\r?\n\r?\n/);
  const errors = blocks.filter(block => !block.startsWith("data:")).map(block => JSON.parse(block).error);
  expect(errors).toEqual([{ code: 502, message: `upstream returned zero output with finishReason ${finishReason}`, status: "UNAVAILABLE" }]);
  expect(wire).not.toContain("[DONE]");
  expect(mocks.execute).toHaveBeenCalledTimes(1);
});

it("preserves safe RPC details and redacts selected credentials on the real route", async () => {
  mocks.execute.mockImplementation(async ({ body }) => ({ transformedBody: body, headers: {}, url: "https://upstream.test", response: streamResponse([
    { response: { candidates: [{ content: { role: "model", parts: [{ text: "started" }] } }] } },
    { error: { code: 429, message: "quota synthetic-private-token", status: "RESOURCE_EXHAUSTED", details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "3s", access_token: "synthetic-private-token" }] } },
  ]) }));
  const wire = await (await post()).text();
  expect(wire).toContain('"code":429');
  expect(wire).toContain('"status":"RESOURCE_EXHAUSTED"');
  expect(wire).toContain('"retryDelay":"3s"');
  expect(wire).not.toContain("synthetic-private-token");
  expect(mocks.execute).toHaveBeenCalledTimes(1);
});

it("normalizes OpenAI and plain-text error payloads into RPC errors", () => {
  expect(googleRpcError({ code: "rate_limit", message: "slow down" }, 429)).toEqual({ error: { code: 429, message: "slow down", status: "RESOURCE_EXHAUSTED" } });
  expect(googleRpcError("backend failed", 503).error).toEqual({ code: 503, message: "backend failed", status: "UNAVAILABLE" });
});

it("rejects incomplete native history before dispatch", async () => {
  const response = await post([{ role: "model", parts: [call("a", "first"), call("b", "second")] }, { role: "user", parts: [resultPart("a", "first")] }]);
  expect(response.status).toBe(400);
  expect((await response.json()).error.status).toBe("INVALID_ARGUMENT");
  expect(mocks.execute).not.toHaveBeenCalled();
});

it("preserves signatures and tool IDs through a split snake/camel history on the public route", async () => {
  mocks.execute.mockImplementation(async ({ body }) => ({ transformedBody: body, headers: {}, url: "https://upstream.test", response: streamResponse([
    { response: { candidates: [{ content: { role: "model", parts: [{ text: "done" }] }, finishReason: "STOP" }] } },
  ]) }));
  const contents = [{ role: "model", parts: [call("a", "first"), { function_call: { id: "b", name: "second", args: {} }, thought_signature: "second-signature" }] },
    { role: "function", parts: [{ function_response: { id: "b", name: "second", response: { error: "failed" } } }] },
    { role: "user", parts: [resultPart("a", " ")] }];
  const reply = await post(contents);
  expect(reply.status).toBe(200);
  await reply.text();
  const outgoing = mocks.execute.mock.calls[0][0].body.request.contents;
  const calls = outgoing.flatMap(turn => turn.parts).filter(part => part.functionCall);
  expect(calls.map(part => part.functionCall.id)).toEqual(["a", "b"]);
  expect(calls.map(part => part.thoughtSignature)).toEqual(["fixture-signature", "second-signature"]);
  const results = outgoing.flatMap(turn => turn.parts).filter(part => part.functionResponse);
  expect(results.map(part => part.functionResponse.id)).toEqual(["a", "b"]);
  expect(results[1].functionResponse.response).toMatchObject({ result: { error: "failed" } });
});

it("cleans enums through both real Gemini translators without changing OpenAI schemas", () => {
  const schema = { type: "object", properties: { value: { type: "string", enum: [null, "", " \n", "keep"] }, number: { type: "integer", enum: [0, 1] } } };
  const openai = { messages: [{ role: "user", content: "hello" }], tools: [{ type: "function", function: { name: "choose", parameters: schema } }] };
  const claude = { messages: [{ role: "user", content: "hello" }], tools: [{ name: "choose", input_schema: schema }] };
  for (const [format, body] of [[FORMATS.OPENAI, openai], [FORMATS.CLAUDE, claude]]) {
    const saved = structuredClone(body);
    const out = translateRequest(format, FORMATS.GEMINI, "gemini-3-flash", body, false);
    expect(body).toEqual(saved);
    const properties = out.tools[0].functionDeclarations[0].parameters.properties;
    expect(properties.value.enum).toEqual(["keep"]);
    expect(properties.number.type).toBe("integer");
  }
  const unchanged = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "test", openai, false);
  expect(unchanged.tools[0].function.parameters).toEqual(schema);
});

it.each(["functionResponse", "function_response"])("preserves all result and output payload variants for Antigravity (%s)", async (field) => {
  const { AntigravityExecutor } = await import("../../open-sse/executors/antigravity.js");
  const payloads = [{ result: "escaped \"quote\"\nline" }, { result: { nested: true } }, { result: "text", other: false }, { output: "existing" }, { output: { nested: true } }, { result: "text", output: "existing" }, { result: [0, null] }, { result: null }];
  const body = { request: { contents: [{ role: "user", parts: payloads.map(response => ({ [field]: { name: "read", response } })) }] } };
  const saved = structuredClone(body);
  const out = new AntigravityExecutor().transformRequest("gemini-3-flash", body, false, { projectId: "fixture" });
  expect(out.request.contents[0].parts.map(part => part.functionResponse.response)).toEqual(payloads);
  expect(body).toEqual(saved);
});

it("does not mutate native input bodies during translation", () => {
  const body = { contents: [{ role: "model", parts: [call("a", "first")] }, { role: "function", parts: [resultPart("a", " ")] }] };
  const saved = structuredClone(body);
  translateRequest(FORMATS.GEMINI, FORMATS.GEMINI, "gemini-3-flash", body, false);
  expect(body).toEqual(saved);
});

it.each(["same", ""])("reserves ID matches before idless slots (%j) and consumes explicit results before later idless ones", async (name) => {
  const contents = [{ role: "model", parts: [{ functionCall: { name: "same", args: {} } }, call("explicit", "same")] },
    { role: "user", parts: [resultPart("explicit", "same")] },
    { role: "function", parts: [{ functionResponse: { name, response: { result: "idless" } } }] }];
  const saved = structuredClone(contents);
  const out = translate(contents);
  expect(contents).toEqual(saved);
  expect(out[1].parts.map(part => part.functionResponse.id)).toEqual([undefined, "explicit"]);
  expect((await post(out)).status).toBe(200);
  const { convertGeminiToInternal } = await import("../../src/app/api/v1beta/models/[...path]/geminiBridge.js");
  const internal = convertGeminiToInternal({ contents: [{ role: "model", parts: [call("one", "same"), call("two", "same")] },
    { role: "user", parts: [resultPart("one", "same"), { functionResponse: { name: "same", response: {} } }] }] }, "test", false, true);
  expect(internal.messages.slice(1).map(message => message.tool_call_id)).toEqual(internal.messages[0].tool_calls.map(call => call.id));
});

it("preserves separate excess response turns so native pairing rejects them", async () => {
  const contents = [{ role: "model", parts: [call("a", "first")] },
    { role: "user", parts: [resultPart("a", "first")] }, { role: "function", parts: [resultPart("extra", "other")] }];
  const saved = structuredClone(contents);
  const out = translate(contents);
  expect(contents).toEqual(saved);
  expect(out[1].parts).toHaveLength(2);
  expect((await post(out)).status).toBe(400);
  expect(mocks.execute).not.toHaveBeenCalled();
  expect((await post(contents)).status).toBe(400);
  expect(mocks.execute).not.toHaveBeenCalled();
});

it("normalizes post-commit bridge errors from an OpenAI upstream", async () => {
  mocks.handleChat.mockResolvedValue(streamResponse([
    { choices: [{ delta: { content: "started" } }] },
    { error: { code: "stream_error", message: "provider failed" } },
  ]));
  const wire = await (await post()).text();
  expect(wire).toContain("started");
  expect(wire).toContain('"error":{"code":500,"message":"provider failed","status":"INTERNAL"}');
});

it("normalizes split snake-case calls before Antigravity filters signatures", async () => {
  const { AntigravityExecutor } = await import("../../open-sse/executors/antigravity.js");
  const body = { request: { contents: [{ role: "model", parts: [
    { function_call: { id: "a", name: "first", args: {} }, thoughtSignature: "signed-first" },
    { function_call: { id: "b", name: "second", args: {} } },
  ] }, { role: "function", parts: [{ function_response: { id: "b", name: "second", response: { result: "b" } } }] },
    { role: "user", parts: [resultPart("a", "first")] }] } };
  const saved = structuredClone(body);
  const out = new AntigravityExecutor().transformRequest("gemini-3-flash", body, false, { projectId: "fixture" });
  expect(body).toEqual(saved);
  expect(out.request.contents[0].parts[0]).toMatchObject({ thoughtSignature: "signed-first", functionCall: { id: "a", name: "first" } });
  expect(out.request.contents[1].parts.map(part => part.functionResponse.id)).toEqual(["a", "b"]);
});
