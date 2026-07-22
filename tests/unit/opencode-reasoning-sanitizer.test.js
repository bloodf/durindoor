import { describe, expect, it } from "vitest";
import {
  isOpencodeGoProvider,
  stripBooleanReasoning,
} from "../../open-sse/services/opencodeReasoningSanitizer.js";

// Port of OmniRoute #7891: opencode-go providers reject a boolean `reasoning`
// field (their Go struct types it as a structured object) with a 400. Strip the
// boolean before forwarding; leave object/string forms untouched.
describe("opencode-go reasoning sanitizer", () => {
  it("recognizes the opencode-go backed providers", () => {
    for (const p of ["opencode-go", "opencode", "opencode-zen", "ollama-cloud"]) {
      expect(isOpencodeGoProvider(p)).toBe(true);
    }
    for (const p of ["openai", "claude", "ollama", "ollama-local", "gemini"]) {
      expect(isOpencodeGoProvider(p)).toBe(false);
    }
  });

  it("strips a boolean reasoning field", () => {
    const t = { model: "x", reasoning: true, messages: [] };
    stripBooleanReasoning(t);
    expect("reasoning" in t).toBe(false);

    const f = { model: "x", reasoning: false };
    stripBooleanReasoning(f);
    expect("reasoning" in f).toBe(false);
  });

  it("leaves object/string reasoning forms untouched (valid for the Go struct)", () => {
    const obj = { reasoning: { effort: "high" } };
    stripBooleanReasoning(obj);
    expect(obj.reasoning).toEqual({ effort: "high" });

    const str = { reasoning: "high" };
    stripBooleanReasoning(str);
    expect(str.reasoning).toBe("high");
  });

  it("is a no-op when reasoning is absent or body is not an object", () => {
    const none = { model: "x" };
    stripBooleanReasoning(none);
    expect(none).toEqual({ model: "x" });
    expect(stripBooleanReasoning(null)).toBeNull();
    expect(stripBooleanReasoning(undefined)).toBeUndefined();
  });
});
