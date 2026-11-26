import { afterEach, expect, it, vi } from "vitest";
import { parseCfToolReply, prepareCfToolRequest } from "../../open-sse/translator/cloudflarePlaygroundTools.js";

const tool = { name: "read", parameters: { type: "object" } };
const context = { tools: [tool], nonce: "test" };
const tag = (nonce = "") => `<tool_call>{"name":"read","arguments":{}${nonce}}</tool_call>`;

afterEach(() => vi.restoreAllMocks());

it("keeps prose and an unbound tagged call as text", () => {
  const text = `Example: ${tag()}`;
  expect(parseCfToolReply(text, context)).toEqual({ content: text, toolCalls: null });
});

it("accepts a tagged call beside prose when bound to the request", () => {
  const result = parseCfToolReply(`Reading. ${tag(',"_nonce":"test"')}`, context);
  expect(result.content).toBe("Reading.");
  expect(result.toolCalls).toHaveLength(1);
});

it("accepts a tag-only reply without a nonce", () => {
  expect(parseCfToolReply(tag(), context).toolCalls).toHaveLength(1);
});

it("warns once with the number of omitted tools", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const tools = Array.from({ length: 1000 }, (_, i) => ({ function: { ...tool, name: `tool_${i}`, description: "x".repeat(160) } }));
  const { messages } = prepareCfToolRequest({ tools, messages: [{ role: "user", content: "hello" }] });
  const included = messages.map((message) => message.content).join("\n").match(/- tool_\d+\(/g)?.length ?? 0;
  expect(included).toBeLessThan(tools.length);
  expect(warn).toHaveBeenCalledOnce();
  expect(warn.mock.calls[0][0]).toContain(String(tools.length - included));
});
