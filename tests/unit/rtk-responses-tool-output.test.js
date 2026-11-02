// #1102: bounded RTK compression for OpenAI Responses tool outputs.
import { describe, expect, it } from "vitest";
import { compressMessages } from "../../open-sse/rtk/index.js";
import { adaptBodyForCompression } from "../../open-sse/services/compression/bodyAdapter.js";

const LOG = Array(60).fill("npm WARN deprecated left-pad@1.3.0: use String.prototype.padStart").join("\n");
const IMAGE = { type: "input_image", image_url: "data:image/png;base64,iVBORw0KGgo=" };

const body = (...items) => ({ model: "gpt-5", input: items });

describe("RTK Responses tool outputs", () => {
  it("compresses function_call_output and custom_tool_call_output text, keeping identities", () => {
    const b = body(
      { type: "function_call", call_id: "fc_1", name: "shell", arguments: "{}" },
      { type: "function_call_output", call_id: "fc_1", output: LOG },
      { type: "custom_tool_call", call_id: "ct_1", name: "apply_patch", input: "*** Begin Patch" },
      { type: "custom_tool_call_output", call_id: "ct_1", output: LOG },
    );
    const stats = compressMessages(b, true);
    expect(stats.hits.map((h) => h.layout)).toEqual(["openai-responses-string", "openai-responses-custom-string"]);
    expect(b.input[1].output.length).toBeLessThan(LOG.length);
    expect(b.input[3].output.length).toBeLessThan(LOG.length);
    expect(b.input.map((i) => [i.type, i.call_id])).toEqual([
      ["function_call", "fc_1"],
      ["function_call_output", "fc_1"],
      ["custom_tool_call", "ct_1"],
      ["custom_tool_call_output", "ct_1"],
    ]);
    expect(b.input[2].input).toBe("*** Begin Patch");
  });

  it("compresses only text parts of array outputs and leaves nested media untouched", () => {
    const b = body({ type: "custom_tool_call_output", call_id: "ct_2", output: [{ type: "input_text", text: LOG }, IMAGE] });
    const stats = compressMessages(b, true);
    expect(stats.hits.map((h) => h.layout)).toEqual(["openai-responses-custom-array"]);
    expect(b.input[0].output[1]).toEqual(IMAGE);
  });

  it("skips error outputs", () => {
    const failing = [
      { type: "function_call_output", call_id: "a", status: "incomplete", output: LOG },
      { type: "function_call_output", call_id: "b", success: false, output: LOG },
      { type: "custom_tool_call_output", call_id: "c", is_error: true, output: LOG },
      { type: "function_call_output", call_id: "d", output: `Exit code: 1\nWall time: 2.1 seconds\nOutput:\n${LOG}` },
      { type: "function_call_output", call_id: "e", output: [{ type: "input_text", text: `Exit code: 127\nOutput:\n${LOG}` }] },
    ];
    const b = body(...structuredClone(failing));
    const stats = compressMessages(b, true);
    expect(stats.hits).toEqual([]);
    expect(b.input).toEqual(failing);
  });

  it("recognizes other exit-status header formats", () => {
    for (const header of ["exit code: 2", "Exit status 1", "Process exited with code 137", "exited with code=3"]) {
      const b = body({ type: "function_call_output", call_id: "e", output: `${header}\n${LOG}` });
      expect(compressMessages(b, true).hits, header).toEqual([]);
    }
    const ok = body({ type: "function_call_output", call_id: "ok2", output: `Process exited with code 0\n${LOG}` });
    expect(compressMessages(ok, true).hits).toHaveLength(1);
  });

  it("still compresses a successful Codex exec output", () => {
    const b = body({ type: "function_call_output", call_id: "ok", output: `Exit code: 0\nWall time: 1 seconds\nOutput:\n${LOG}` });
    expect(compressMessages(b, true).hits).toHaveLength(1);
  });

  it("protects JSON and fenced-code payloads", () => {
    const json = JSON.stringify({ lines: LOG.split("\n") }, null, 2);
    const fenced = "```\n" + LOG + "\n```";
    const items = [
      { type: "function_call_output", call_id: "j", output: json },
      { type: "custom_tool_call_output", call_id: "f", output: fenced },
      { type: "function_call_output", call_id: "ja", output: [{ type: "input_text", text: json }] },
    ];
    const b = body(...structuredClone(items));
    expect(compressMessages(b, true).hits).toEqual([]);
    expect(b.input).toEqual(items);
  });

  it("does not compress a second time across pivots (idempotent)", () => {
    const b = body({ type: "custom_tool_call_output", call_id: "x", output: LOG });
    compressMessages(b, true);
    const once = structuredClone(b);
    const second = compressMessages(b, true);
    expect(second.hits).toEqual([]);
    expect(b).toEqual(once);
  });

  it("stack body adapter exposes custom_tool_call_output as a tool message and restores it", () => {
    const b = body(
      { type: "message", role: "user", content: [{ type: "input_text", text: "go" }] },
      { type: "custom_tool_call_output", call_id: "ct_3", output: "hello" },
    );
    const adapter = adaptBodyForCompression(b);
    expect(adapter.adapted).toBe(true);
    const tool = adapter.body.messages.find((m) => m.role === "tool");
    expect(tool.content).toBe("hello");
    const restored = adapter.restore({ ...adapter.body, messages: adapter.body.messages.map((m) => m.role === "tool" ? { ...m, content: "hi" } : m) });
    expect(restored.input[1]).toEqual({ type: "custom_tool_call_output", call_id: "ct_3", output: "hi" });
  });
});
