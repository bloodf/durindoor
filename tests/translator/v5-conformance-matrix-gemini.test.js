import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { initState, translateRequest, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const { GEMINI, OPENAI: CHAT, CLAUDE, OPENAI_RESPONSES: RESPONSES } = FORMATS;

const schema = {
  type: "object",
  properties: { type: { type: "string" }, properties: { type: "array", items: { type: "string" } } },
  required: ["type"],
};

const geminiBody = (toolConfig) => ({
  contents: [
    { role: "user", parts: [{ text: "hi" }] },
    { role: "model", parts: [{ functionCall: { name: "ns.search", args: { type: "a" } } }] },
    { role: "user", parts: [{ functionResponse: { name: "ns.search", response: { result: "ok" } } }] },
  ],
  tools: [{ functionDeclarations: [{ name: "ns.search", description: "S", parameters: schema }] }],
  ...(toolConfig && { toolConfig }),
});

const request = (target, toolConfig) =>
  translateRequest(GEMINI, target, "m", structuredClone(geminiBody(toolConfig)), false);

const NAME = /^[a-zA-Z0-9_-]{1,64}$/;
const anyNs = { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["ns.search"] } };

describe("#1089 Gemini client conformance — requests", () => {
  it("aliases the namespaced tool for Chat and keeps keyword-named properties", () => {
    const out = request(CHAT);
    const fn = out.tools[0].function;
    expect(fn.name).toMatch(NAME);
    expect(fn.parameters).toEqual(schema);
    expect(out.messages[1].tool_calls[0].function.name).toBe(fn.name);
    expect(out._toolNameMap?.[fn.name] ?? out._toolNameMap?.get?.(fn.name)).toBe("ns.search");
  });

  it("aliases the namespaced tool for Claude and keeps keyword-named properties", () => {
    const out = request(CLAUDE);
    expect(out.tools[0].name).toMatch(NAME);
    expect(out.tools[0].input_schema).toMatchObject({ properties: schema.properties, required: ["type"] });
    expect(out.messages[1].content[0].name).toBe(out.tools[0].name);
  });

  it("aliases the namespaced tool for Responses", () => {
    const out = request(RESPONSES);
    expect(out.tools[0].name).toMatch(NAME);
    expect(out.input.find((i) => i.type === "function_call").name).toBe(out.tools[0].name);
  });

  it("pairs functionResponse with its functionCall for Chat, Claude and Responses", () => {
    const chat = request(CHAT);
    expect(chat.messages[2].tool_call_id).toBe(chat.messages[1].tool_calls[0].id);
    const claude = request(CLAUDE);
    expect(claude.messages[2].content[0].tool_use_id).toBe(claude.messages[1].content[0].id);
    const resp = request(RESPONSES);
    const call = resp.input.find((i) => i.type === "function_call");
    expect(resp.input.find((i) => i.type === "function_call_output").call_id).toBe(call.call_id);
  });

  it.each([
    ["AUTO", undefined, "auto"],
    ["NONE", undefined, "none"],
    ["ANY", undefined, "required"],
  ])("maps toolConfig mode %s to Chat tool_choice", (mode, names, expected) => {
    expect(request(CHAT, { functionCallingConfig: { mode, allowedFunctionNames: names } }).tool_choice).toBe(expected);
  });

  it("maps a single allowedFunctionNames entry to a named Chat tool_choice", () => {
    const out = request(CHAT, anyNs);
    expect(out.tool_choice).toEqual({ type: "function", function: { name: out.tools[0].function.name } });
  });

  it("carries toolConfig forced choice to Claude and Responses", () => {
    expect(request(CLAUDE, anyNs).tool_choice).toMatchObject({ type: "tool", name: request(CLAUDE).tools[0].name });
    expect(request(RESPONSES, anyNs).tool_choice).toMatchObject({ type: "function", name: request(RESPONSES).tools[0].name });
  });
});

describe("#1089 Gemini client conformance — replies", () => {
  const reply = (finish) => ({
    id: "c1", model: "m", object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { content: "partial" }, finish_reason: finish }],
  });
  const stream = (finish) => {
    const state = initState(GEMINI, {});
    return [reply(null), reply(finish)].flatMap((c) => translateResponse(CHAT, GEMINI, c, state) || []);
  };

  it.each([
    ["length", "MAX_TOKENS"],
    ["content_filter", "SAFETY"],
    ["stop", "STOP"],
  ])("streams Chat %s as Gemini %s", (finish, expected) => {
    const last = stream(finish).at(-1);
    expect((last.response ?? last).candidates[0].finishReason).toBe(expected);
  });
});

describe("#1089 Gemini client conformance — review fixes", () => {
  it("sanitizes generated call ids so Claude tool_use ids stay legal", () => {
    const out = request(CLAUDE);
    expect(out.messages[1].content[0].id).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(out.messages[2].content[0].tool_use_id).toBe(out.messages[1].content[0].id);
  });

  it("declares only allowed tools when ANY lists several names", () => {
    const body = geminiBody({ functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["a", "b"] } });
    body.tools[0].functionDeclarations = ["a", "b", "c"].map((name) => ({ name, parameters: schema }));
    const out = translateRequest(GEMINI, CHAT, "m", body, false);
    expect(out.tools.map((t) => t.function.name)).toEqual(["a", "b"]);
    expect(out.tool_choice).toBe("required");
  });

  it("maps VALIDATED to auto", () => {
    expect(request(CHAT, { functionCallingConfig: { mode: "VALIDATED" } }).tool_choice).toBe("auto");
  });

  it("aliases dotted names for gemini-cli sources too", () => {
    const out = translateRequest(FORMATS.GEMINI_CLI, CHAT, "m", structuredClone(geminiBody()), false);
    expect(out.tools[0].function.name).toMatch(NAME);
  });
});

describe("#1089 Gemini client conformance — call id pairing", () => {
  const ids = (name, id) => {
    const body = geminiBody();
    body.contents[1].parts[0].functionCall = { name, ...(id && { id }) , args: {} };
    body.contents[2].parts[0].functionResponse = { name, ...(id && { id }), response: { result: "ok" } };
    const out = translateRequest(GEMINI, CLAUDE, "m", body, false);
    return [out.messages[1].content[0].id, out.messages[2].content[0].tool_use_id];
  };

  it("keeps ns.search and ns_search ids distinct and legal", () => {
    const [a] = ids("ns.search");
    const [b] = ids("ns_search");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(b).toMatch(/^[a-zA-Z0-9_-]+$/);
  });

  it("sanitizes explicit client ids on both sides of the pair", () => {
    const [use, result] = ids("f", "a.b");
    expect(use).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(result).toBe(use);
  });
});

describe("#1089 Gemini client conformance — translator low items", () => {
  it("keeps every tool and required when ANY names match no declared tool", () => {
    const out = request(CHAT, { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["missing"] } });
    expect(out.tools).toHaveLength(1);
    expect(out.tool_choice).toBe("required");
  });

  it("gives two idless same-turn calls to one function distinct paired ids", () => {
    const body = {
      contents: [
        { role: "user", parts: [{ text: "hi" }] },
        { role: "model", parts: [{ functionCall: { name: "w", args: { c: 1 } } }, { functionCall: { name: "w", args: { c: 2 } } }] },
        { role: "user", parts: [{ functionResponse: { name: "w", response: { result: 1 } } }] },
        { role: "user", parts: [{ functionResponse: { name: "w", response: { result: 2 } } }] },
      ],
    };
    const out = translateRequest(GEMINI, CHAT, "m", body, false);
    const callIds = out.messages.find((m) => m.tool_calls).tool_calls.map((c) => c.id);
    expect(new Set(callIds).size).toBe(2);
    expect(out.messages.filter((m) => m.role === "tool").map((m) => m.tool_call_id)).toEqual(callIds);
  });
});
