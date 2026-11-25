import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const PAYLOAD = "QUJD".repeat(2000);

const toolContent = (content) => translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "gpt-4o", {
  messages: [
    { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "capture", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content }] },
  ],
}, false).messages.find((message) => message.role === "tool").content;

describe("upstream 9router #3772: binary tool_result blocks of any shape", () => {
  it.each([
    ["an MCP-shaped image", { type: "image", data: PAYLOAD, mimeType: "image/png" }, "[tool result omitted image: image/png]"],
    ["an MCP-shaped audio block", { type: "audio", data: PAYLOAD, mimeType: "audio/wav" }, "[tool result omitted audio: audio/wav]"],
    ["a base64 source of another type", { type: "video", source: { type: "base64", media_type: "video/mp4", data: PAYLOAD } }, "[tool result omitted video: video/mp4]"],
    ["an embedded resource blob", { type: "resource", resource: { uri: "file:///a", mimeType: "application/pdf", blob: PAYLOAD } }, "[tool result omitted resource: application/pdf]"],
  ])("replaces %s with a bounded placeholder", (_label, block, placeholder) => {
    expect(toolContent([block])).toBe(placeholder);
    expect(toolContent([{ type: "text", text: "saved" }, block])).toBe(`saved\n${placeholder}`);
  });

  it("keeps a block without binary bytes readable", () => {
    expect(toolContent([{ type: "tool_reference", tool_name: "Read" }])).toContain("Read");
  });
});
