import { describe, expect, it } from "vitest";
import { MAX_RESPONSES_OUTPUT_ITEMS } from "../../open-sse/config/runtimeConfig.js";
import { convertResponsesStreamToJson } from "../../open-sse/transformer/streamToJsonConverter.js";

const metadata = { id: "resp_terminal", created_at: 1730000000 };
const usage = { input_tokens: 7, output_tokens: 3, total_tokens: 10 };
const output = [{
  id: "msg_partial",
  type: "message",
  role: "assistant",
  status: "incomplete",
  content: [{ type: "output_text", text: "Partial answer", annotations: [] }],
}];
const frame = (type, fields) => `event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`;
const created = (response) => frame("response.created", { response });
const completed = frame("response.completed", {
  response: { ...metadata, status: "completed", output: [], usage },
});
const convert = (raw) => convertResponsesStreamToJson(new Response(raw).body);

describe("buffered Responses terminal metadata and output", () => {
  it("uses terminal-only metadata and retains output and usage", async () => {
    const terminalOutput = [{ ...output[0], status: "completed" }];
    const raw = frame("response.completed", {
      response: { ...metadata, status: "completed", output: terminalOutput, usage },
    });
    expect(await convert(raw)).toMatchObject({ ...metadata, status: "completed", output: terminalOutput, usage });
  });

  it.each([
    [{ id: "resp_created", created_at: 1720000000 }, { id: "resp_created", created_at: 1720000000 }],
    [{ id: "resp_created", created_at: "invalid" }, { ...metadata, id: "resp_created" }],
    [{ id: {}, created_at: 1720000000 }, { ...metadata, created_at: 1720000000 }],
  ])("prefers valid created fields independently", async (response, expected) => {
    expect(await convert(created(response) + completed)).toMatchObject({ ...expected, status: "completed" });
  });

  it("keeps partial text and usage on a coherent incomplete terminal", async () => {
    const raw = frame("response.incomplete", {
      response: {
        ...metadata,
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output,
        usage,
      },
    });
    expect(await convert(raw)).toMatchObject({ ...metadata, status: "incomplete", output, usage });
  });

  it.each([
    "event: keepalive\n\n",
    "event:keepalive\r\ndata: \r\n\r\n",
    frame("keepalive", { detail: "provider payload" }),
    frame("keepalive-status", { detail: "provider payload" }),
  ])("accepts the ordinary prefix %j before completion", async (prefix) => {
    expect(await convert(prefix + completed)).toMatchObject({ ...metadata, status: "completed", usage });
  });

  it.each([
    "event: keepalive-status\ndata:\n\n",
    "event: keepalive\ndata: {\n\n",
    "event: keepalive \ndata:\n\n",
    frame("response.failed", { response: { status: "failed" } }),
  ])("retains failure for %j before completion", async (prefix) => {
    expect((await convert(prefix + completed)).status).toBe("failed");
  });

  it.each(["completed", "incomplete"])("rejects malformed %s terminal snapshots", async (status) => {
    for (const items of [{}, [null], Array(MAX_RESPONSES_OUTPUT_ITEMS + 1).fill(output[0])]) {
      const raw = frame(`response.${status}`, { response: { status, output: items } });
      expect((await convert(raw)).status).toBe("failed");
    }
  });

  it("requires an application terminal after a keepalive", async () => {
    expect((await convert("event: keepalive\n\n" + created(metadata))).status).toBe("failed");
  });
});
