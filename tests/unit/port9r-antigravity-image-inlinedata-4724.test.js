import { describe, expect, it } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";

const credentials = { projectId: "synthetic-project", connectionId: "synthetic-connection" };

function run(body) {
  return new AntigravityExecutor().transformRequest("gemini-3.1-flash-image", body, false, credentials);
}

describe("antigravity image_gen preserves inline image parts (decolua/9router#4724)", () => {
  it("keeps text-only parts", () => {
    const out = run({ request: { contents: [{ role: "user", parts: [{ text: "mountain" }] }] } });
    expect(out.requestType).toBe("image_gen");
    expect(out.request.contents).toEqual([{ role: "user", parts: [{ text: "mountain" }] }]);
  });

  it("keeps camelCase inlineData next to text for image editing", () => {
    const inlineData = { mimeType: "image/jpeg", data: "abc" };
    const out = run({ request: { contents: [{ role: "user", parts: [{ inlineData }, { text: "edit" }] }] } });
    expect(out.request.contents[0].parts).toEqual([{ inlineData }, { text: "edit" }]);
  });

  it("normalizes snake_case inline_data to inlineData", () => {
    const inline = { mime_type: "image/png", data: "snake" };
    const out = run({ contents: [{ parts: [{ inline_data: inline }, { text: "edit" }] }] });
    expect(out.request.contents[0].role).toBe("user");
    expect(out.request.contents[0].parts).toEqual([{ inlineData: { mimeType: "image/png", data: "snake" } }, { text: "edit" }]);
    expect(JSON.stringify(out.request.contents)).not.toContain("inline_data");
  });
});
