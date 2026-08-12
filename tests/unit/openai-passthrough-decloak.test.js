import { describe, expect, it } from "vitest";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

async function runPassthrough(toolNameMap, chunk) {
  const stream = createPassthroughStreamWithLogger(
    "openai", null, toolNameMap, "gpt-4.1", "conn-1", {}, null, "sk-test", FORMATS.OPENAI
  );
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const readAll = (async () => {
    let output = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return output;
      output += decoder.decode(value);
    }
  })();
  await writer.write(encoder.encode(chunk));
  await writer.close();
  return readAll;
}

describe("openai passthrough tool-name decloaking", () => {
  it("restores normalized tool-call names", async () => {
    const output = await runPassthrough(
      new Map([["find_files_abc123", "find-files"]]),
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ function: { name: "find_files_abc123" } }] } }] })}\n\n`
    );

    expect(output).toContain('"name":"find-files"');
    expect(output).not.toContain("find_files_abc123");
  });

  it("restores names in bare JSON passthrough chunks without changing framing", async () => {
    const output = await runPassthrough(
      new Map([["find_files_abc123", "find-files"]]),
      `${JSON.stringify({ choices: [{ delta: { tool_calls: [{ function: { name: "find_files_abc123" } }] } }] })}\n`
    );

    expect(output).toContain('"name":"find-files"');
    expect(output).not.toContain("find_files_abc123");
    expect(output.split("\n", 1)[0]).toMatch(/^\{\s*"choices"/);
  });

  it("leaves OpenAI chunks untouched without a tool-name map", async () => {
    const output = await runPassthrough(
      null,
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ function: { name: "find_files_abc123" } }] } }] })}\n\n`
    );

    expect(output).toContain('"name":"find_files_abc123"');
  });
});
