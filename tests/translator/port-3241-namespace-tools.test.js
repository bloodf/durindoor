import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";
import { translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const namespaceTool = (name, tools) => ({ type: "namespace", name, tools });
const responseBody = tools => ({ input: "hi", tools });
const responseEvents = (requestBody, toolName) => {
  const state = initState(FORMATS.OPENAI_RESPONSES, requestBody);
  const chunks = [
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: toolName, arguments: "{}" } }] }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
  ];
  return chunks.flatMap(chunk => translateResponse(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, chunk, state));
};

const functionCallItems = events => events
  .filter(event => event.event === "response.output_item.added" || event.event === "response.output_item.done")
  .map(event => event.data.item)
  .filter(item => item?.type === "function_call");

describe("Responses namespace tools (#3241)", () => {
  it("expands namespace tools to qualified Chat functions", () => {
    const translated = openaiResponsesToOpenAIRequest("m", responseBody([
      namespaceTool("collaboration", [
        { name: "spawn_agent", description: "Spawn", parameters: { type: "object" } },
        { name: "wait_agent", description: "Wait", parameters: { type: "object" } },
      ]),
    ]), true);

    expect(translated.tools).toEqual([
      { type: "function", function: { name: "collaboration.spawn_agent", description: "Spawn", parameters: { type: "object", properties: {} }, strict: undefined } },
      { type: "function", function: { name: "collaboration.wait_agent", description: "Wait", parameters: { type: "object", properties: {} }, strict: undefined } },
    ]);
  });

  it("splits qualified calls into Responses name and namespace", () => {
    const items = functionCallItems(responseEvents(responseBody([
      namespaceTool("collaboration", [{ name: "spawn_agent" }]),
    ]), "collaboration.spawn_agent"));

    expect(items).toHaveLength(2);
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "spawn_agent", namespace: "collaboration" }),
    ]));
  });

  it("routes declared flat subtool calls to their namespace", () => {
    const items = functionCallItems(responseEvents(responseBody([
      namespaceTool("collaboration", [{ name: "wait_agent" }]),
    ]), "wait_agent"));

    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "wait_agent", namespace: "collaboration" }),
    ]));
  });

  it("leaves ordinary functions unqualified", () => {
    const items = functionCallItems(responseEvents(responseBody([
      { type: "function", name: "get_weather", parameters: { type: "object" } },
    ]), "get_weather"));

    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "get_weather" }),
    ]));
    expect(items.every(item => !("namespace" in item))).toBe(true);
  });

  it("keeps namespace mappings isolated between interleaved request states", () => {
    const firstState = initState(FORMATS.OPENAI_RESPONSES, responseBody([
      namespaceTool("collaboration", [{ name: "wait_agent" }]),
    ]));
    const secondState = initState(FORMATS.OPENAI_RESPONSES, responseBody([
      namespaceTool("orchestration", [{ name: "wait_agent" }]),
    ]));
    const start = name => ({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name, arguments: "{}" } }] }, finish_reason: null }] });
    const finish = { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] };

    const firstEvents = translateResponse(
      FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, start("wait_agent"), firstState
    );
    const secondEvents = translateResponse(
      FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, start("wait_agent"), secondState
    );
    firstEvents.push(...translateResponse(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, finish, firstState));
    secondEvents.push(...translateResponse(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, finish, secondState));

    const firstItems = functionCallItems(firstEvents);
    const secondItems = functionCallItems(secondEvents);
    expect(firstItems.length).toBeGreaterThan(0);
    expect(secondItems.length).toBeGreaterThan(0);
    expect(firstItems.every(item => item.namespace === "collaboration")).toBe(true);
    expect(secondItems.every(item => item.namespace === "orchestration")).toBe(true);
  });
});
