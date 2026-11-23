import { describe, expect, it } from "vitest";
import { CursorExecutor } from "../../open-sse/executors/cursor.js";
import { encodeField, wrapConnectRPCFrame } from "../../open-sse/utils/cursorProtobuf.js";

const frame = (field, value) => Buffer.from(wrapConnectRPCFrame(encodeField(2, 2, encodeField(field, 2, value))));
const toolFrame = () => Buffer.from(wrapConnectRPCFrame(encodeField(1, 2, Buffer.concat([
  Buffer.from(encodeField(3, 2, "call_1")),
  Buffer.from(encodeField(9, 2, "weather")),
  Buffer.from(encodeField(10, 2, "{}")),
  Buffer.from(encodeField(11, 0, 1)),
]))));

describe.each(["transformProtobufToJSON", "transformProtobufToSSE"])("Cursor legacy %s", (method) => {
  const run = (buffer) => new CursorExecutor()[method](buffer, "cu/default", { messages: [] });
  it.each([
    ["empty", frame(1, "")],
    ["reasoning only", frame(25, encodeField(1, 2, "private</think>secret"))],
  ])("rejects a framed %s turn without exposing reasoning", async (_label, buffer) => {
    const response = run(buffer);
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(JSON.parse(text).error.code).toBe("empty_completion");
    expect(text).not.toContain("secret");
  });
  it("preserves visible content", async () => {
    const response = run(frame(1, "Hello"));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Hello");
  });
  it("preserves tool-only calls even with private reasoning", async () => {
    const response = run(Buffer.concat([frame(25, encodeField(1, 2, "private")), toolFrame()]));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("weather");
    expect(text).toContain("tool_calls");
    expect(text).not.toContain("private");
  });
});
