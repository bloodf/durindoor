import { describe, expect, it } from "vitest";
import { AntigravityExecutor } from "../../../open-sse/executors/antigravity.js";

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
