import { expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { encodeToolCallIdWithSignature } from "../../open-sse/translator/concerns/signatureTransport.js";

it("keeps generated Gemini call IDs unique and paired without changing overlap repair", () => {
  const call = (id, name) => ({
    role: "assistant",
    tool_calls: [{ id, type: "function", function: { name, arguments: "{}" } }],
  });
  const response = (id, n) => ({ role: "tool", tool_call_id: id, content: JSON.stringify({ n }) });
  const translate = (messages) => translateRequest(
    FORMATS.OPENAI, FORMATS.GEMINI, "gemini-2.5-pro", { messages }, false, null, null,
  ).contents.flatMap((turn) => turn.parts);

  for (const ids of [["x", "x", "x_1"], ["x_1", "x", "x"], ["x", "x", "x_1", "x_2", "x"]]) {
    const parts = translate(ids.flatMap((id, n) => [call(id, `tool_${n}`), response(id, n)]));
    const calls = parts.filter((part) => part.functionCall).map((part) => part.functionCall);
    const responses = parts.filter((part) => part.functionResponse).map((part) => part.functionResponse);
    expect(new Set(calls.map((entry) => entry.id)).size).toBe(ids.length);
    expect(responses).toEqual(calls.map((entry, n) => ({
      id: entry.id,
      name: `tool_${n}`,
      response: { result: { n } },
    })));
    expect(calls.map((entry) => entry.name)).toEqual(ids.map((_, n) => `tool_${n}`));
    ids.forEach((id, n) => {
      if (ids.indexOf(id) === n) expect(calls[n].id).toBe(id);
    });
  }

  const overlap = translate([
    call("x", "first"), { role: "user", content: "next" }, call("x", "second"), response("x", 2),
  ]);
  expect(overlap.filter((part) => part.functionResponse).map((part) => part.functionResponse)).toEqual([
    { id: "x", name: "first", response: { result: { result: "[No response received]" } } },
    { id: "x_1", name: "second", response: { result: { n: 2 } } },
  ]);
});

it("pairs Claude-backed Antigravity collisions using decoded original IDs and signatures", () => {
  for (const rawIds of [["x", "x", "x_1"], ["x_1", "x", "x"], ["x", "x", "x_1", "x_2", "x"]]) {
    for (const signed of [false, true]) {
      const messages = rawIds.flatMap((rawId, n) => {
        const id = signed ? encodeToolCallIdWithSignature(rawId, `signature_${n}`) : rawId;
        return [
          { role: "assistant", tool_calls: [{ id, type: "function", function: { name: `tool_${n}`, arguments: "{}" } }] },
          { role: "tool", tool_call_id: id, content: JSON.stringify({ n }) },
        ];
      });
      const out = translateRequest(FORMATS.OPENAI, FORMATS.ANTIGRAVITY, "claude-opus-4-6", { messages }, false, { projectId: "isolated" });
      const parts = out.request.contents.flatMap((turn) => turn.parts);
      const calls = parts.filter((part) => part.functionCall);
      const responses = parts.filter((part) => part.functionResponse).map((part) => part.functionResponse);
      expect(new Set(calls.map((part) => part.functionCall.id)).size).toBe(rawIds.length);
      rawIds.forEach((id, n) => {
        if (rawIds.indexOf(id) === n) expect(calls[n].functionCall.id).toBe(id);
      });
      expect(calls.map((part) => part.functionCall.name)).toEqual(rawIds.map((_, n) => `tool_${n}`));
      expect(responses).toEqual(calls.map((part, n) => ({
        id: part.functionCall.id, name: `tool_${n}`, response: { result: { n } },
      })));
      if (signed) expect(calls.map((part) => part.thoughtSignature)).toEqual(rawIds.map((_, n) => `signature_${n}`));
    }
  }
});
