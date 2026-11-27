import { expect, it } from "vitest";
import { parseCodexSearchSse, CodexSearchError, CODEX_SEARCH_MAX_BYTES } from "../../open-sse/services/providerParity/native-codex-search-search/adapter.js";
import { drainSseEvents } from "../../open-sse/services/providerParity/native-zai-search-search/adapter.js";

const frame = (event, data) => `: comment\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const call = frame("response.output_item.done", { item: { type: "web_search_call", action: { sources: [{ url: "https://example.com/" }, { url: "http://127.0.0.1/" }] } } });
const completed = frame("response.completed", { response: { status: "completed", tool_usage: { web_search: { num_requests: 3 } }, usage: { input_tokens: 7 } } });
const rpc = { jsonrpc: "2.0", id: 1, result: "  leading" };

it.each(["\n", "\r\n", "\r"])("handles comments, coalesced frames and final tails with %j", (newline) => {
  expect(parseCodexSearchSse((call + completed).trimEnd().replaceAll("\n", newline), 5)).toEqual({
    results: [{ url: "https://example.com/", title: "example.com", snippet: "" }], searches: 3, usage: { input_tokens: 7 },
  });
  const wire = (frame("message", rpc) + frame("message", { ...rpc, id: 2 })).trimEnd().replaceAll("\n", newline);
  const first = drainSseEvents(wire);
  expect(first.messages).toEqual([rpc]);
  expect(drainSseEvents(first.rest, true)).toEqual({ messages: [{ ...rpc, id: 2 }], rest: "", malformed: false });
});

it("joins data lines and preserves leading spaces", () => {
  const wire = 'event: response.output_item.done\ndata: {"item":{"type":"web_search_call",\ndata: "action":{"sources":[]}}}\n\n';
  expect(parseCodexSearchSse(wire + completed, 5).results).toEqual([]);
  expect(drainSseEvents('data: {"jsonrpc":"2.0",\ndata:  "id":1,"result":"  leading"}\n\n').messages).toEqual([rpc]);
  expect(() => parseCodexSearchSse(call + completed.replace("event: response.completed", "event:  response.completed"), 5)).toThrow(CodexSearchError);
});

it("buffers without replay and ignores metadata", () => {
  const first = drainSseEvents(frame("message", rpc).slice(0, -2));
  expect(first.messages).toEqual([]);
  const second = drainSseEvents(first.rest + "\n\n");
  expect(second.messages).toEqual([rpc]);
  expect(drainSseEvents(second.rest, true).messages).toEqual([]);
  expect(drainSseEvents(": heartbeat\nevent: message\n\n").messages).toEqual([]);
});

it.each(["[DONE]", "{broken", "null"])("does not fabricate results or billing from %s", (data) => {
  expect(() => parseCodexSearchSse(`data: ${data}\n\n`, 5)).toThrow(CodexSearchError);
});

it("preserves provider errors, malformed failures and the byte bound", () => {
  expect(() => parseCodexSearchSse(call + completed + frame("error", { error: { code: "insufficient_quota" } }), 5)).toThrow(expect.objectContaining({ statusHint: 429 }));
  expect(() => parseCodexSearchSse(call + completed + "data: {broken\n\n", 5)).toThrow(CodexSearchError);
  expect(drainSseEvents("data: [DONE]\n\ndata: {broken\n\n").malformed).toBe(true);
  const error = { jsonrpc: "2.0", id: 1, error: { code: -32000, message: "quota" } };
  expect(drainSseEvents(frame("error", error)).messages).toEqual([error]);
  expect(() => parseCodexSearchSse(" ".repeat(CODEX_SEARCH_MAX_BYTES + 1), 5)).toThrow(CodexSearchError);
});
