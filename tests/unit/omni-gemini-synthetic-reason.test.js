import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { initState, translateRequest, translateResponse } from "../../open-sse/translator/index.js";
import { geminiToClaudeResponse } from "../../open-sse/translator/response/gemini-to-claude.js";
import { geminiToOpenAIResponse } from "../../open-sse/translator/response/gemini-to-openai.js";
import { createGeminiPlaceholderStripper } from "../../open-sse/translator/concerns/geminiPlaceholderArgs.js";
import { decodeToolCallId } from "../../open-sse/translator/concerns/signatureTransport.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { parseGeminiSSEToOpenAIResponse } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";

// Offline only. OmniRoute #18269 (head c955fe25, merge cfb61890) drops the
// cleaner's synthetic `reason` argument on the response side. These fixtures run
// the real request translators to build the declarations "sent upstream", then
// feed Gemini tool calls through each response flow.

const PLACEHOLDER = "Brief explanation of why you are calling this tool";

const claudeTools = [
  { name: "TaskList", description: "List tasks", input_schema: { type: "object", properties: {} } },
  {
    name: "AskUserQuestion",
    description: "Ask",
    input_schema: {
      type: "object",
      properties: {
        questions: { type: "array", items: { type: "object", properties: { question: { type: "string" } } } },
        answers: { type: "object", additionalProperties: { type: "string" } },
        batch: { type: "array", items: { type: "object", properties: {} } },
      },
      required: ["questions"],
    },
  },
  { name: "Bash", description: "Run", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
  { name: "Explain", description: "Declares its own reason", input_schema: { type: "object", properties: { reason: { type: "string", description: "Why" } }, required: ["reason"] } },
  {
    name: "LookalikeReason",
    description: "Declares reason with the exact placeholder shape",
    input_schema: { type: "object", properties: { reason: { type: "string", description: PLACEHOLDER } }, required: ["reason"] },
  },
];

const chatTools = claudeTools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.input_schema } }));
const responsesTools = claudeTools.map((tool) => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.input_schema }));
const geminiTools = [{ functionDeclarations: claudeTools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.input_schema })) }];

const callArgs = {
  TaskList: { reason: "listing" },
  AskUserQuestion: { questions: [{ question: "Proceed?" }], answers: { reason: "filled", extra: 1 }, batch: [{ reason: "a" }, {}, { reason: "b", keep: true }] },
  Bash: { command: "ls", reason: "model extra" },
  Explain: { reason: "because" },
  LookalikeReason: { reason: "because" },
};

const expectedArgs = {
  TaskList: {},
  AskUserQuestion: { questions: [{ question: "Proceed?" }], answers: { extra: 1 }, batch: [{}, {}, { keep: true }] },
  Bash: { command: "ls", reason: "model extra" },
  Explain: { reason: "because" },
  LookalikeReason: { reason: "because" },
};

function geminiChunk(name, args, extraPart = {}) {
  return { candidates: [{ content: { role: "model", parts: [{ functionCall: { name, args }, ...extraPart }] }, finishReason: "STOP" }] };
}

/** Run the real request translation; returns the provider body and the alias map chatCore would keep. */
function sendRequest(clientFormat, targetFormat, tools) {
  const body = { model: "gemini-2.5-pro", messages: [{ role: "user", content: "hi" }], tools };
  if (clientFormat === FORMATS.OPENAI_RESPONSES) {
    delete body.messages;
    body.input = [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }];
  }
  if (clientFormat === FORMATS.GEMINI) {
    delete body.messages;
    body.contents = [{ role: "user", parts: [{ text: "hi" }] }];
  }
  const providerBody = translateRequest(clientFormat, targetFormat, "gemini-2.5-pro", structuredClone(body), true, {}, targetFormat === FORMATS.GEMINI ? "gemini" : null);
  const toolNameMap = providerBody._toolNameMap || null;
  delete providerBody._toolNameMap;
  return { body, providerBody, toolNameMap };
}

const declarationsOf = (providerBody) => (providerBody.request?.tools || providerBody.tools)[0].functionDeclarations;

/** Stream state shaped like createSSETransformStreamWithLogger's translate-mode state. */
function streamState(clientFormat, { body, providerBody, toolNameMap }) {
  return { ...initState(clientFormat, body), toolNameMap, clientTools: body.tools, providerBody };
}

function openAIToolCall(chunks) {
  return chunks.flatMap((chunk) => chunk?.choices?.[0]?.delta?.tool_calls ?? [])[0];
}

function claudeToolInput(events) {
  const json = events.filter((event) => event?.delta?.type === "input_json_delta").map((event) => event.delta.partial_json).join("");
  return JSON.parse(json);
}

describe("request side keeps the placeholder (existing upstream schema)", () => {
  it("still sends a required reason for empty object schemas and nothing for populated ones", () => {
    const { providerBody } = sendRequest(FORMATS.OPENAI, FORMATS.GEMINI, chatTools);
    const byName = Object.fromEntries(declarationsOf(providerBody).map((fn) => [fn.name, fn.parameters]));
    expect(byName.TaskList).toMatchObject({ type: "object", properties: { reason: { type: "string", description: PLACEHOLDER } }, required: ["reason"] });
    expect(byName.Bash.properties).toEqual({ command: { type: "string" } });
    expect(byName.AskUserQuestion.properties.answers.properties.reason.description).toBe(PLACEHOLDER);
    expect(byName.AskUserQuestion.properties.batch.items.properties.reason.description).toBe(PLACEHOLDER);
  });
});

describe("pivot flows: placeholder removed only where it was inserted", () => {
  const cases = [
    ["Chat client -> gemini", FORMATS.OPENAI, FORMATS.GEMINI, chatTools],
    ["Chat client -> gemini-cli envelope", FORMATS.OPENAI, FORMATS.GEMINI_CLI, chatTools],
    ["Chat client -> antigravity envelope", FORMATS.OPENAI, FORMATS.ANTIGRAVITY, chatTools],
    ["Chat client -> vertex", FORMATS.OPENAI, FORMATS.VERTEX, chatTools],
    ["Responses client -> gemini", FORMATS.OPENAI_RESPONSES, FORMATS.GEMINI, responsesTools],
    ["Gemini client -> gemini-cli", FORMATS.GEMINI, FORMATS.GEMINI_CLI, geminiTools],
  ];

  for (const [label, clientFormat, targetFormat, tools] of cases) {
    it(`${label}: OpenAI-shaped stream`, () => {
      const sent = sendRequest(clientFormat, targetFormat, tools);
      for (const name of Object.keys(callArgs)) {
        const state = streamState(clientFormat, sent);
        const providerName = declarationsOf(sent.providerBody).find((fn) => fn.name.toLowerCase() === name.toLowerCase()).name;
        const chunks = geminiToOpenAIResponse(geminiChunk(providerName, structuredClone(callArgs[name])), state);
        const call = openAIToolCall(chunks);
        expect(JSON.parse(call.function.arguments)).toEqual(expectedArgs[name]);
      }
    });
  }

  it("Claude client -> antigravity: translateResponse pivots gemini -> openai -> claude", () => {
    const sent = sendRequest(FORMATS.CLAUDE, FORMATS.ANTIGRAVITY, claudeTools);
    for (const name of Object.keys(callArgs)) {
      const state = streamState(FORMATS.CLAUDE, sent);
      const events = translateResponse(FORMATS.ANTIGRAVITY, FORMATS.CLAUDE, { response: geminiChunk(name, structuredClone(callArgs[name])) }, state);
      expect(claudeToolInput(events)).toEqual(expectedArgs[name]);
    }
  });

  it("Claude client -> gemini-cli: translateResponse pivots gemini -> openai -> claude", () => {
    const sent = sendRequest(FORMATS.CLAUDE, FORMATS.GEMINI_CLI, claudeTools);
    const state = streamState(FORMATS.CLAUDE, sent);
    const events = translateResponse(FORMATS.GEMINI_CLI, FORMATS.CLAUDE, { response: geminiChunk("TaskList", { reason: "x" }) }, state);
    expect(claudeToolInput(events)).toEqual({});
  });

  it("restores through the alias map when the provider name was sanitized", () => {
    const tools = [{ type: "function", function: { name: "list tasks", description: "List", parameters: { type: "object", properties: {} } } }];
    const sent = sendRequest(FORMATS.OPENAI, FORMATS.GEMINI, tools);
    const providerName = declarationsOf(sent.providerBody)[0].name;
    expect(providerName).not.toBe("list tasks");
    const call = openAIToolCall(geminiToOpenAIResponse(geminiChunk(providerName, { reason: "x" }), streamState(FORMATS.OPENAI, sent)));
    expect(call.function.name).toBe("list tasks");
    expect(JSON.parse(call.function.arguments)).toEqual({});
  });
});

describe("direct gemini -> claude flow", () => {
  it("leaves reason alone on the real direct request path, which sends no placeholder", () => {
    const sent = sendRequest(FORMATS.CLAUDE, FORMATS.GEMINI, claudeTools);
    expect(declarationsOf(sent.providerBody).find((fn) => fn.name === "TaskList").parameters.properties).toEqual({});
    const events = geminiToClaudeResponse(geminiChunk("TaskList", { reason: "model text" }), streamState(FORMATS.CLAUDE, sent));
    expect(claudeToolInput(events)).toEqual({ reason: "model text" });
  });

  it("strips when the body sent upstream carries the placeholder (executor-cleaned declarations)", () => {
    const cleaned = sendRequest(FORMATS.OPENAI, FORMATS.GEMINI, chatTools).providerBody;
    const sent = { body: { tools: claudeTools }, providerBody: cleaned, toolNameMap: null };
    for (const name of Object.keys(callArgs)) {
      const events = geminiToClaudeResponse(geminiChunk(name, structuredClone(callArgs[name])), streamState(FORMATS.CLAUDE, sent));
      expect(claudeToolInput(events)).toEqual(expectedArgs[name]);
    }
  });

  it("keeps the thought signature stored for the call id", () => {
    const sent = { body: { tools: claudeTools }, providerBody: sendRequest(FORMATS.OPENAI, FORMATS.GEMINI, chatTools).providerBody, toolNameMap: null };
    const state = { ...streamState(FORMATS.CLAUDE, sent), signatureNamespace: "ns-1" };
    const events = geminiToClaudeResponse(geminiChunk("TaskList", { reason: "x" }, { thoughtSignature: "sig-direct" }), state);
    expect(events.find((event) => event.content_block?.type === "tool_use").content_block.name).toBe("TaskList");
    expect(claudeToolInput(events)).toEqual({});
  });
});

describe("OpenAI pivot keeps the thought signature in the tool-call id", () => {
  it("round-trips the signature while stripping the argument", () => {
    const sent = sendRequest(FORMATS.OPENAI, FORMATS.GEMINI, chatTools);
    const call = openAIToolCall(geminiToOpenAIResponse(geminiChunk("TaskList", { reason: "x" }, { thoughtSignature: "sig-pivot" }), streamState(FORMATS.OPENAI, sent)));
    expect(decodeToolCallId(call.id).signature).toBe("sig-pivot");
    expect(JSON.parse(call.function.arguments)).toEqual({});
  });
});

describe("buffered flows", () => {
  it("non-streaming gemini body projects an empty argument object", () => {
    const sent = sendRequest(FORMATS.OPENAI, FORMATS.GEMINI, chatTools);
    const result = translateNonStreamingResponse(geminiChunk("TaskList", { reason: "x" }), FORMATS.GEMINI, FORMATS.OPENAI, {
      requestBody: sent.body, providerBody: sent.providerBody, toolNameMap: sent.toolNameMap,
    });
    expect(JSON.parse(result.choices[0].message.tool_calls[0].function.arguments)).toEqual({});
    const explain = translateNonStreamingResponse(geminiChunk("Explain", { reason: "why" }), FORMATS.GEMINI, FORMATS.OPENAI, {
      requestBody: sent.body, providerBody: sent.providerBody, toolNameMap: sent.toolNameMap,
    });
    expect(JSON.parse(explain.choices[0].message.tool_calls[0].function.arguments)).toEqual({ reason: "why" });
  });

  it("forced SSE aggregation drops the placeholder and keeps a declared reason", () => {
    const sent = sendRequest(FORMATS.OPENAI, FORMATS.ANTIGRAVITY, chatTools);
    const parts = ["TaskList", "Explain"].map((name) => ({ functionCall: { name, args: { reason: "r" } } }));
    const sse = `data: ${JSON.stringify({ response: { candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }] } })}\n\n`;
    const parsed = parseGeminiSSEToOpenAIResponse(sse, "gemini", sent.providerBody, sent.toolNameMap, sent.body.tools);
    const calls = parsed.choices[0].message.tool_calls.map((call) => JSON.parse(call.function.arguments));
    expect(calls).toEqual([{}, { reason: "r" }]);
  });
});

describe("fail-closed resolution", () => {
  const sent = sendRequest(FORMATS.OPENAI, FORMATS.GEMINI, chatTools);
  const strip = (overrides, name = "TaskList") => createGeminiPlaceholderStripper({ clientTools: chatTools, providerBody: sent.providerBody, toolNameMap: sent.toolNameMap, ...overrides })(name, { reason: "x" });

  it("keeps arguments when the tool, client tools or provider body cannot be resolved", () => {
    expect(strip({}, "CronList")).toEqual({ reason: "x" });
    expect(strip({ clientTools: null })).toEqual({ reason: "x" });
    expect(strip({ clientTools: [] })).toEqual({ reason: "x" });
    expect(strip({ providerBody: null })).toEqual({ reason: "x" });
    expect(strip({ providerBody: { contents: [] } })).toEqual({ reason: "x" });
  });

  it("keeps arguments when two client tools share a name", () => {
    expect(strip({ clientTools: [...chatTools, chatTools[0]] })).toEqual({ reason: "x" });
  });

  it("keeps arguments when the sent declaration has no placeholder at that position", () => {
    const withoutPlaceholder = { tools: [{ functionDeclarations: [{ name: "TaskList", parameters: { type: "object", properties: {} } }] }] };
    expect(strip({ providerBody: withoutPlaceholder })).toEqual({ reason: "x" });
  });

  it("does not mutate the caller's argument object and returns it by identity when unchanged", () => {
    const stripper = createGeminiPlaceholderStripper({ clientTools: chatTools, providerBody: sent.providerBody });
    const args = { questions: [{ question: "q" }], answers: { reason: "r" } };
    const out = stripper("AskUserQuestion", args);
    expect(out).toEqual({ questions: [{ question: "q" }], answers: {} });
    expect(args.answers).toEqual({ reason: "r" });
    const untouched = { command: "ls" };
    expect(stripper("Bash", untouched)).toBe(untouched);
  });

  it("returns non-object arguments unchanged", () => {
    const stripper = createGeminiPlaceholderStripper({ clientTools: chatTools, providerBody: sent.providerBody });
    expect(stripper("TaskList", "text")).toBe("text");
    expect(stripper("TaskList", null)).toBe(null);
  });
});
