import { it, expect } from "vitest";
import { geminiToOpenAIResponse } from "../../open-sse/translator/response/gemini-to-openai.js";

it("emits each provider call ID once while retaining distinct and anonymous calls", () => {
  const state = {};
  const chunk = (id, value, signature) => ({ candidates: [{ content: { parts: [{
    functionCall: { ...(id ? { id } : {}), name: "edit", args: { value } },
    ...(signature ? { thoughtSignature: signature } : {}),
  }] } }] });
  const calls = [chunk("one", 1, "sig"), chunk("one", 2), chunk("two", 3), chunk(null, 4), chunk(null, 5)]
    .flatMap((event) => geminiToOpenAIResponse(event, state) || [])
    .flatMap((event) => event.choices?.[0]?.delta?.tool_calls || []);
  expect(calls).toHaveLength(4);
  expect(calls.map((call) => call.index)).toEqual([0, 1, 2, 3]);
  expect(JSON.parse(calls[0].function.arguments)).toEqual({ value: 1 });
});
