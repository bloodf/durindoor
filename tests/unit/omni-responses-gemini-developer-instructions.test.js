import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";

// OmniRoute #18704 (head 69de44be99635144086c07e5b68964ad313bd059): Responses developer
// items must reach the Gemini systemInstruction instead of being skipped by the converter.
const PNG = "data:image/png;base64,AAAA";
const lookupTool = { type: "function", name: "lookup", description: "Look up", parameters: { type: "object", properties: { key: { type: "string" } } } };
const texts = (parts) => parts.map((part) => part.text);
const markers = (value) => JSON.stringify(value).match(/I1073_[A-Z_]+/g);

const responsesBody = () => ({
  instructions: "I1073_TOP",
  input: [
    { type: "message", role: "developer", content: "I1073_DEV_FIRST" },
    { type: "message", role: "user", content: [{ type: "input_text", text: "ENV1073_CONTEXT" }, { type: "input_image", image_url: PNG }] },
    { type: "message", role: "system", content: [{ type: "input_text", text: "I1073_SYS_A " }, { type: "input_text", text: "I1073_SYS_B" }] },
    { type: "message", role: "assistant", content: "HIST1073_ANSWER" },
    { type: "message", role: "developer", content: [{ type: "input_text", text: "I1073_DEV_LATE" }] },
    { type: "message", role: "user", content: "USER1073_QUESTION" },
    { type: "function_call", call_id: "call_1073", name: "lookup", arguments: "{\"key\":\"value\"}" },
    { type: "function_call_output", call_id: "call_1073", output: "TOOL1073_RESULT" },
    { type: "message", role: "system", content: "I1073_SYS_LAST" },
    { type: "message", role: "user", content: "USER1073_FOLLOWUP" },
  ],
  tools: [lookupTool],
});

const translate = (body, target, source = "openai-responses") => {
  const wire = translateRequest(source, target, "gemini-2.5-flash", body, false, { projectId: "offline-project" }, target);
  return wire.request && target !== "gemini" && target !== "vertex" ? wire.request : wire;
};

const EXPECTED_INSTRUCTIONS = ["I1073_TOP", "I1073_DEV_FIRST", "I1073_SYS_A I1073_SYS_B", "I1073_DEV_LATE", "I1073_SYS_LAST"];

describe("Responses to Gemini developer instructions", () => {
  for (const target of ["gemini", "gemini-cli", "antigravity", "vertex"]) {
    it(`${target}: developer and system items keep order in systemInstruction exactly once`, () => {
      const body = responsesBody();
      const original = structuredClone(body);
      const wire = translate(body, target);

      expect(texts(wire.systemInstruction.parts)).toEqual(EXPECTED_INSTRUCTIONS);
      // No instruction text leaks into conversation turns and none is injected twice.
      expect(markers(wire)).toEqual(["I1073_TOP", "I1073_DEV_FIRST", "I1073_SYS_A", "I1073_SYS_B", "I1073_DEV_LATE", "I1073_SYS_LAST"]);
      expect(markers(wire.contents)).toBeNull();
      expect(body).toEqual(original);
    });

    it(`${target}: keeps non-text user parts, history and tool exchange`, () => {
      const wire = translate(responsesBody(), target);
      const parts = wire.contents.flatMap((content) => content.parts);

      expect(wire.contents[0]).toEqual({ role: "user", parts: [{ text: "ENV1073_CONTEXT" }, { inlineData: { mimeType: "image/png", data: "AAAA" } }] });
      expect(wire.contents.some((content) => content.role === "model" && content.parts.some((part) => part.text === "HIST1073_ANSWER"))).toBe(true);
      expect(JSON.stringify(wire.contents).match(/(?:ENV|HIST|USER|TOOL)1073_[A-Z]+/g)).toEqual(["ENV1073_CONTEXT", "HIST1073_ANSWER", "USER1073_QUESTION", "TOOL1073_RESULT", "USER1073_FOLLOWUP"]);
      expect(parts.find((part) => part.functionCall).functionCall).toMatchObject({ name: "lookup", args: { key: "value" } });
      const functionResponse = parts.find((part) => part.functionResponse).functionResponse;
      expect(functionResponse.name).toBe("lookup");
      expect(JSON.stringify(functionResponse.response)).toContain("TOOL1073_RESULT");
    });

    it(`${target}: top-level instructions with string input stay a single instruction`, () => {
      const wire = translate({ instructions: "I1073_TOP", input: "USER1073_QUESTION" }, target);
      expect(texts(wire.systemInstruction.parts)).toEqual(["I1073_TOP"]);
      expect(wire.contents.at(-1).parts.at(-1).text).toBe("USER1073_QUESTION");
    });

    it(`${target}: developer item without top-level instructions populates systemInstruction`, () => {
      const wire = translate({ input: [
        { type: "message", role: "developer", content: [{ type: "input_text", text: "I1073_DEV_ONLY" }] },
        { type: "message", role: "user", content: "USER1073_QUESTION" },
      ] }, target);
      expect(texts(wire.systemInstruction.parts)).toEqual(["I1073_DEV_ONLY"]);
      expect(markers(wire.contents)).toBeNull();
    });
  }

  it("keeps Chat Completions system carriers unchanged for Gemini", () => {
    const wire = translate({ messages: [
      { role: "system", content: "I1073_TOP" },
      { role: "user", content: "USER1073_QUESTION" },
      { role: "system", content: "I1073_SYS_LAST" },
    ] }, "gemini", "openai");
    expect(texts(wire.systemInstruction.parts)).toEqual(["I1073_TOP", "I1073_SYS_LAST"]);
    expect(wire.contents).toEqual([{ role: "user", parts: [{ text: "USER1073_QUESTION" }] }]);
  });

  it("does not change Responses to OpenAI or Claude translation", () => {
    const openai = translateRequest("openai-responses", "openai", "gpt-4o", responsesBody(), false, null, "openai");
    expect(openai.messages.filter((m) => m.role === "system").map((m) => m.content)).toEqual(["I1073_TOP", "I1073_DEV_FIRST", "I1073_SYS_A \nI1073_SYS_B", "I1073_DEV_LATE", "I1073_SYS_LAST"]);
    expect(openai.messages.some((m) => m.role === "developer")).toBe(false);

    const claude = translateRequest("openai-responses", "claude", "claude-sonnet-4-6", responsesBody(), false, null, "claude");
    const system = JSON.stringify(claude.system);
    expect(system.match(/I1073_[A-Z_]+/g)).toEqual(["I1073_TOP", "I1073_DEV_FIRST", "I1073_SYS_A", "I1073_SYS_B", "I1073_DEV_LATE", "I1073_SYS_LAST"]);
  });

  it("passes native Responses requests through untouched", () => {
    const body = { instructions: "I1073_TOP", input: [
      { type: "message", role: "developer", content: [{ type: "input_text", text: "I1073_DEV_FIRST" }] },
      { type: "message", role: "user", content: [{ type: "input_text", text: "USER1073_QUESTION" }] },
    ] };
    const original = structuredClone(body);
    expect(translateRequest("openai-responses", "openai-responses", "gpt-4o", body, false, null, "openai")).toEqual(original);
    expect(body).toEqual(original);
  });
});
