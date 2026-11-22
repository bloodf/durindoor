// #2190: JSON documents in tool results are never filtered. Fenced code in
// chat role:tool and Claude tool_result stays compressible under the plain
// RTK toggle (#1454). Responses and Gemini already skipped both.
// #2191: a JSON-RPC message with no id is a notification (HTTP 202, empty
// body). A missing method is -32600.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { compressMessages } from "../../open-sse/rtk/index.js";

const mocks = vi.hoisted(() => ({
  validateGatewayKey: vi.fn(),
  getGrantsForKeyDetailed: vi.fn(),
  getEnabledInstancesByIds: vi.fn(),
  saveRequestUsage: vi.fn(),
  getBillingEpoch: vi.fn(async () => null),
}));

vi.mock("@/lib/localDb", () => ({
  validateGatewayKey: mocks.validateGatewayKey,
  getGrantsForKeyDetailed: mocks.getGrantsForKeyDetailed,
  getEnabledInstancesByIds: mocks.getEnabledInstancesByIds,
  saveRequestUsage: mocks.saveRequestUsage,
}));
vi.mock("@/lib/db/repos/usageRepo.js", () => ({ getBillingEpoch: mocks.getBillingEpoch }));

const { handleJsonRpc } = await import("../../src/lib/mcp/gateway/handler.js");

function jsonArray() {
  return "[\n" + Array.from({ length: 300 }, () => "  0").join(",\n") + "\n]";
}

function longDiff() {
  const lines = ["diff --git a/foo.js b/foo.js", "index abc..def 100644", "--- a/foo.js", "+++ b/foo.js", "@@ -1,3 +1,200 @@"];
  for (let i = 0; i < 200; i++) lines.push(`+added line ${i} UNIQUE_PADDING_${i} ${"x".repeat(20)}`);
  return lines.join("\n");
}

function rpcRequest() {
  return new Request("http://localhost/api/mcp-gateway", {
    headers: { authorization: "Bearer test-key" },
  });
}

// The HTTP routes turn {kind:"notification"} into 202 with an empty body.
async function rpc(body) {
  return handleJsonRpc(rpcRequest(), body);
}

describe("RTK JSON tool results (#2190)", () => {
  it("keeps the reproduced JSON array intact in every tool-result shape", () => {
    const json = jsonArray();
    expect(json.length).toBe(1502);
    const cases = [
      {
        label: "chat role:tool string",
        body: { messages: [{ role: "tool", content: json }] },
        read: (b) => b.messages[0].content,
      },
      {
        label: "chat role:tool text part",
        body: { messages: [{ role: "tool", content: [{ type: "text", text: json }] }] },
        read: (b) => b.messages[0].content[0].text,
      },
      {
        label: "claude tool_result string",
        body: { messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: json }] }] },
        read: (b) => b.messages[0].content[0].content,
      },
      {
        label: "claude tool_result text part",
        body: { messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: [{ type: "text", text: json }] }] }] },
        read: (b) => b.messages[0].content[0].content[0].text,
      },
      {
        label: "responses function_call_output",
        body: { input: [{ type: "function_call_output", call_id: "c", output: json }] },
        read: (b) => b.input[0].output,
      },
      {
        label: "gemini functionResponse",
        body: { contents: [{ role: "user", parts: [{ functionResponse: { name: "fetch", response: { content: json } } }] }] },
        read: (b) => b.contents[0].parts[0].functionResponse.response.content,
      },
    ];
    for (const row of cases) {
      const stats = compressMessages(row.body, true);
      expect(row.read(row.body), row.label).toBe(json);
      expect(JSON.parse(row.read(row.body)), row.label).toHaveLength(300);
      expect(stats?.hits ?? [], row.label).toEqual([]);
    }
  });

  it("keeps a JSON document that contains fenced code", () => {
    const doc = JSON.stringify({
      snippet: "```js\n" + Array.from({ length: 40 }, () => "const value = 1;").join("\n") + "\n```",
      rows: Array.from({ length: 40 }, () => "repeat-me"),
    }, null, 2);
    expect(doc).toContain("```");
    const body = { messages: [{ role: "tool", content: doc }] };
    compressMessages(body, true);
    expect(body.messages[0].content).toBe(doc);
    expect(JSON.parse(body.messages[0].content).rows).toHaveLength(40);
  });

  it("keeps an oversized JSON array in a chat tool result", () => {
    const doc = JSON.stringify(Array.from({ length: 2500 }, () => "duplicate-large-json-entry-padding"), null, 2);
    expect(doc.length).toBeGreaterThan(64 * 1024);
    const body = { messages: [{ role: "tool", content: doc }] };
    const stats = compressMessages(body, true);
    expect(body.messages[0].content).toBe(doc);
    expect(stats.hits).toEqual([]);
  });

  it("still compresses a fenced diff in chat role:tool and Claude tool_result", () => {
    const fenced = "```diff\n" + longDiff() + "\n```";
    const chat = { messages: [{ role: "tool", content: fenced }] };
    compressMessages(chat, true);
    expect(chat.messages[0].content.length).toBeLessThan(fenced.length);

    const claude = { messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: fenced }] }] };
    compressMessages(claude, true);
    expect(claude.messages[0].content[0].content.length).toBeLessThan(fenced.length);
  });
});

describe("MCP gateway notifications (#2191)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBillingEpoch.mockResolvedValue(null);
    mocks.validateGatewayKey.mockResolvedValue({ id: "key-1" });
    mocks.getGrantsForKeyDetailed.mockResolvedValue([]);
    mocks.getEnabledInstancesByIds.mockResolvedValue([]);
    mocks.saveRequestUsage.mockResolvedValue(undefined);
  });

  it.each(["notifications/cancelled", "notifications/initialized", "ping"])(
    "treats id-less %s as a notification",
    async (method) => {
      await expect(rpc({ jsonrpc: "2.0", method })).resolves.toEqual({ kind: "notification" });
    },
  );

  it("returns -32600 when the method is missing, with or without an id", async () => {
    const bodies = [
      { jsonrpc: "2.0", id: 4 },
      { jsonrpc: "2.0" },
      { jsonrpc: "2.0", id: 5, method: null },
    ];
    for (const body of bodies) {
      const res = await rpc(body);
      expect(res, JSON.stringify(body)).toEqual({
        kind: "response",
        status: 400,
        body: {
          jsonrpc: "2.0",
          id: body.id ?? null,
          error: { code: -32600, message: "missing method" },
        },
      });
    }
  });

  it("still answers a ping that has an id, including id 0", async () => {
    await expect(rpc({ jsonrpc: "2.0", id: 0, method: "ping" })).resolves.toEqual({
      kind: "response",
      status: 200,
      body: { jsonrpc: "2.0", id: 0, result: {} },
    });
  });

  it("still returns -32601 for an unknown method that has an id", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 8, method: "notifications/cancelled" });
    expect(res.kind).toBe("response");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(8);
    expect(res.body.error.code).toBe(-32601);
  });

  it("still treats notifications/initialized as a notification when an id is attached", async () => {
    await expect(rpc({ jsonrpc: "2.0", id: 3, method: "notifications/initialized" })).resolves.toEqual({
      kind: "notification",
    });
  });
});
