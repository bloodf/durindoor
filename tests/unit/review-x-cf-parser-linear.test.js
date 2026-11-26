import { expect, it } from "vitest";
import { parseCfToolReply } from "../../open-sse/translator/cloudflarePlaygroundTools.js";

const context = { tools: [{ name: "read", parameters: { type: "object" } }], nonce: "test" };

it("bounds work on balanced invalid nested brackets", () => {
  const text = `a ${"[".repeat(20000)}x${"]".repeat(20000)}`;
  const started = performance.now();
  expect(parseCfToolReply(text, context)).toEqual({ content: text, toolCalls: null });
  expect(performance.now() - started).toBeLessThan(1000);
});

it("finds a tagged call after many balanced brackets", () => {
  const text = `${"[]".repeat(5000)} <tool>{"name":"read","arguments":{},"_nonce":"test"}</tool>`;
  const result = parseCfToolReply(text, context);
  expect(result.content).toBe("[]".repeat(5000));
  expect(result.toolCalls).toHaveLength(1);
  expect(result.toolCalls[0].function).toEqual({ name: "read", arguments: "{}" });
});
