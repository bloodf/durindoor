import { expect, it } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

it("forwards a Claude tool screenshot through the Gemini translation", () => {
  const body = { messages: [
    { role: "assistant", content: [{ type: "tool_use", id: "shot", name: "capture", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "shot", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } }] }] }
  ] };
  const pivot = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "m", body, false, null, null);
  const out = translateRequest(FORMATS.OPENAI, FORMATS.GEMINI, "m", pivot, false, null, null);
  expect(JSON.stringify(out)).toContain('"inlineData":{"mimeType":"image/png","data":"AQID"}');
});
