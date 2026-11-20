import { describe, expect, it } from "vitest";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";

const header = "x-anthropic-billing-header: example=value;";
const convert = (messages, provider = "claude") =>
  openaiToClaudeRequest("example", { messages }, false, null, { provider });

describe("Claude system metadata translation", () => {
  it("removes a leading metadata line and retains instructions and cache marker", () => {
    const messages = [
      { role: "system", content: `${header}\r\nKeep answers concise.` },
      { role: "user", content: `${header}\nExplain this text.` },
    ];
    const original = structuredClone(messages);
    const result = convert(messages);
    expect(result.system.at(-1)).toEqual({ type: "text", text: "Keep answers concise.", cache_control: { type: "ephemeral", ttl: "1h" } });
    expect(result.messages[0].content[0].text).toBe(messages[1].content);
    expect(messages).toEqual(original);
  });

  it("omits a metadata-only system message while retaining other instructions", () => {
    const result = convert([
      { role: "system", content: header.toUpperCase() },
      { role: "system", content: [{ type: "text", text: "Follow the project instructions." }] },
      { role: "developer", content: "Keep the format." },
    ]);
    expect(result.system.at(-1).text).toBe("Follow the project instructions.\nKeep the format.");
  });

  it("preserves ordinary text, non-leading mentions, developer text and other providers", () => {
    const text = `Document this line:\n${header}`;
    expect(convert([{ role: "system", content: text }]).system.at(-1).text).toBe(text);
    expect(convert([{ role: "developer", content: header }]).system.at(-1).text).toBe(header);
    expect(convert([{ role: "system", content: header }], "other").system.at(-1).text).toBe(header);
    expect(convert([{ role: "system", content: header }], null).system.at(-1).text).toBe(header);
  });
});
