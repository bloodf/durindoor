import { describe, expect, it } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { ANTIGRAVITY_DEFAULT_SYSTEM } from "../../open-sse/config/appConstants.js";

describe("Antigravity OMP request normalization", () => {
  it("normalizes harness markers only in system instructions and removes harness metadata", () => {
    const body = {
      requestType: "agent",
      used_claude: true,
      labels: { used_claude: true, keep: "yes" },
      request: {
        systemInstruction: { parts: [{ text: "<system-conventions>MUST</system-conventions> <critical>keep</critical> Oh My Pi coding harness /tmp/opencode-file" }] },
        contents: [{ role: "user", parts: [{ text: "Oh My Pi /tmp/opencode-file" }] }]
      }
    };
    const original = structuredClone(body);
    const output = new AntigravityExecutor().transformRequest("gemini-3.8-flash-medium", body, true, {});
    expect(output.request.systemInstruction.parts[0].text).toBe(ANTIGRAVITY_DEFAULT_SYSTEM);
    const system = output.request.systemInstruction.parts[1].text;
    expect(system).toContain("<conventions>MUST</conventions>");
    expect(system).toContain("<important>keep</important>");
    expect(system).toContain("AI coding assistant");
    expect(system).toContain("/tmp/opencode-file");
    expect(output.request.contents[0].parts[0].text).toBe("Oh My Pi /tmp/opencode-file");
    expect(output).not.toHaveProperty("used_claude");
    expect(output.labels).toEqual({ keep: "yes" });
    expect(body).toEqual(original);
  });
});
