import { describe, expect, it, vi } from "vitest";

const cleaner = vi.hoisted(() => vi.fn(() => {
  throw new Error("unsupported cyclic schema");
}));

vi.mock("../../../open-sse/translator/formats/gemini.js", () => ({
  cleanJSONSchemaForAntigravity: cleaner,
}));

import { AntigravityExecutor } from "../../../open-sse/executors/antigravity.js";

describe("Antigravity schema cleaning fallback", () => {
  it("logs schema cleaning failures and sends a safe minimal schema", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const request = new AntigravityExecutor().transformRequest(
      "gemini-2.5-pro",
      {
        request: {
          contents: [{ role: "user", parts: [{ text: "hi" }] }],
          tools: [{ functionDeclarations: [{
            name: "broken_schema",
            parameters: {
              type: "object",
              properties: { answer: { type: "number", description: "numeric answer" } },
              required: ["answer", "missing"],
            },
          }] }],
        },
      },
      false,
      { projectId: "synthetic-project", connectionId: "synthetic-connection" },
    ).request;

    expect(cleaner).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('Schema conversion failed for tool "broken_schema": unsupported cyclic schema. Using fallback schema.'));
    expect(request.tools[0].functionDeclarations[0].parameters).toEqual({
      type: "object",
      properties: { answer: { type: "number", description: "numeric answer" } },
      required: ["answer"],
    });
    warning.mockRestore();
  });
});
