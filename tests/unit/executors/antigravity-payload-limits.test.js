import { describe, expect, it, vi } from "vitest";
import { AntigravityExecutor } from "../../../open-sse/executors/antigravity.js";
import { BaseExecutor } from "../../../open-sse/executors/base.js";

const credentials = { projectId: "synthetic-project", connectionId: "synthetic-connection" };

function transform(request) {
  return new AntigravityExecutor().transformRequest(
    "gemini-2.5-pro",
    { request },
    false,
    credentials,
  ).request;
}

describe("Antigravity payload limits", () => {
  it("caps declarations at 40 while retaining native Antigravity tools", () => {
    const customTools = Array.from({ length: 40 }, (_, index) => ({
      name: `custom_${index}`,
      description: "x".repeat(201),
      parameters: {
        type: "object",
        properties: {
          first: {
            type: "object",
            properties: {
              second: {
                type: "object",
                properties: { third: { type: "string" } },
              },
            },
          },
        },
      },
    }));
    const request = transform({
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      tools: [{ functionDeclarations: [...customTools, { name: "read_url_content", description: "native" }] }],
    });
    const declarations = request.tools[0].functionDeclarations;

    expect(declarations).toHaveLength(40);
    expect(declarations[0].name).toBe("read_url_content");
    expect(declarations).not.toContainEqual(expect.objectContaining({ name: "custom_39" }));
    expect(declarations[1].description).toHaveLength(200);
    expect(declarations[1].parameters.properties.first.properties.second).toEqual({
      type: "string",
      description: "JSON object with properties: third",
    });
  });

  it("renormalizes native contents after dropping a thought-only model turn", () => {
    const request = transform({
      contents: [
        { role: "user", parts: [{ text: "before" }] },
        { role: "model", parts: [{ text: "private reasoning", thought: true }] },
        { role: "user", parts: [{ text: "after" }] },
      ],
    });
    const roles = request.contents.map(content => content.role);

    expect(roles.some((role, index) => role === roles[index - 1])).toBe(false);
    expect(request.contents).toEqual([
      { role: "user", parts: [{ text: "before" }, { text: "after" }] },
    ]);
  });

  it("keeps native terminal model turns without fabricating continuation content", () => {
    const terminalText = transform({
      contents: [
        { role: "user", parts: [{ text: "question" }] },
        { role: "model", parts: [{ text: "answer" }] },
      ],
    });
    const terminalCall = transform({
      contents: [
        { role: "user", parts: [{ text: "question" }] },
        { role: "model", parts: [{ functionCall: { name: "lookup", args: {} } }] },
      ],
    });

    expect(terminalText.contents.at(-1)).toEqual({ role: "model", parts: [{ text: "answer" }] });
    expect(terminalText.contents.flatMap(content => content.parts)).not.toContainEqual({ text: "Continue" });
    expect(terminalCall.contents.at(-1)).toEqual({
      role: "model",
      parts: [expect.objectContaining({ functionCall: { name: "lookup", args: {} } })],
    });
    expect(terminalCall.contents.flatMap(content => content.parts).some(part => part.functionResponse)).toBe(false);
  });

  it("keeps native content parts in order", () => {
    const request = transform({
      contents: [
        { role: "model", parts: [
          { functionCall: { name: "lookup", args: { query: "answer" } } },
          { inlineData: { mimeType: "image/png", data: "inline" } },
        ] },
        { role: "model", parts: [
          { functionResponse: { name: "lookup", response: { result: "found" } } },
          { fileData: { mimeType: "text/plain", fileUri: "gs://bucket/file" } },
          { text: "answer" },
        ] },
        { role: "user", parts: [{ text: "after" }] },
      ],
    });

    expect(request.contents.flatMap(content => content.parts.map(part =>
      part.functionCall?.name
      ?? part.inlineData?.data
      ?? part.functionResponse?.name
      ?? part.fileData?.fileUri
      ?? part.text
    ))).toEqual(["lookup", "inline", "lookup", "gs://bucket/file", "answer", "after"]);
  });
  it("rejects native contents emptied by thought filtering", async () => {
    const executor = new AntigravityExecutor();
    const dispatch = vi.spyOn(BaseExecutor.prototype, "execute");
    try {
      const result = await executor.execute({
        model: "gemini-2.5-pro",
        body: { request: { contents: [
          { role: "model", parts: [{ text: "private reasoning", thought: true }] },
        ] } },
        stream: false,
        credentials,
      });

      expect(result.response.status).toBe(400);
      expect(await result.response.json()).toEqual({
        error: expect.objectContaining({
          message: "Antigravity request has no contents after thought filtering",
          type: "invalid_request_error",
        }),
      });
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      dispatch.mockRestore();
    }
  });

  it("embeds an oversized system instruction into first user message", () => {
    const systemText = "s".repeat(4001);
    const request = transform({
      systemInstruction: { parts: [{ text: systemText }] },
      contents: [{ role: "user", parts: [{ text: "hello" }, { inlineData: { mimeType: "x", data: "y" } }] }],
    });

    expect(request.systemInstruction).toBeUndefined();
    expect(request.contents[0].parts).toEqual([
      { text: `[System Instructions]\n${systemText}\n\n[User Message]\nhello` },
      { inlineData: { mimeType: "x", data: "y" } },
    ]);
  });
});
