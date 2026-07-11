import { describe, expect, it } from "vitest";
import { cavemanEngine } from "../../../open-sse/services/compression/engines/cavemanAdapter.js";
import { cavemanCompress, applyRulesToText } from "../../../open-sse/services/compression/caveman.js";

const TRIGGER =
  "Please kindly make sure to provide a detailed explanation of the algorithm, " +
  "thank you so much. Basically this is important to remember.";

describe("caveman engine", () => {
  it("applyRulesToText removes filler/pleasantry rules", () => {
    const out = applyRulesToText("Please kindly explain in detail, thank you so much.", "user", "full");
    expect(out).not.toMatch(/please/i);
    expect(out).not.toMatch(/kindly/i);
    expect(out).not.toMatch(/thank you so much/i);
    expect(out.length).toBeLessThan("Please kindly explain in detail, thank you so much.".length);
  });

  it("cavemanCompress compresses messages and reports stats", () => {
    const result = cavemanCompress(
      { model: "gpt-4", messages: [{ role: "user", content: TRIGGER }] },
      { enabled: true, intensity: "full" }
    );
    expect(result.compressed).toBe(true);
    expect(result.stats.savingsPercent).toBeGreaterThan(0);
    expect(result.body.messages[0].content).not.toContain("Please kindly");
  });

  it("cavemanCompress is a no-op when disabled (DEFAULT config path guarded by caller)", () => {
    const result = cavemanCompress(
      { model: "gpt-4", messages: [{ role: "user", content: TRIGGER }] },
      { enabled: false, intensity: "full" }
    );
    expect(result.compressed).toBe(false);
    expect(result.body.messages[0].content).toBe(TRIGGER);
  });

  it("cavemanEngine.apply defaults enabled=true (issue #6425)", () => {
    // No explicit enabled on stepConfig/config -> engine must still run.
    const result = cavemanEngine.apply(
      { model: "gpt-4", messages: [{ role: "user", content: TRIGGER }] },
      { stepConfig: { intensity: "full" } }
    );
    expect(result.compressed).toBe(true);
    expect(result.body.messages[0].content).not.toContain("Please kindly");
  });

  it("cavemanEngine.apply adapts + restores an OpenAI Responses envelope", () => {
    const body = {
      model: "gpt-4",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: TRIGGER }],
        },
      ],
    };
    const result = cavemanEngine.apply(body, { stepConfig: { enabled: true, intensity: "full" } });
    expect(result.compressed).toBe(true);
    // Envelope shape preserved (input[], not messages[]).
    expect(Array.isArray(result.body.input)).toBe(true);
    expect(result.body.messages).toBeUndefined();
    const text = result.body.input[0].content[0].text;
    expect(text).not.toContain("Please kindly");
  });

  it("cavemanEngine.apply does not mutate the caller's body", () => {
    const body = { model: "gpt-4", messages: [{ role: "user", content: TRIGGER }] };
    const snapshot = JSON.stringify(body);
    cavemanEngine.apply(body, { stepConfig: { enabled: true, intensity: "full" } });
    expect(JSON.stringify(body)).toBe(snapshot);
  });

  it("validateConfig accepts valid and rejects invalid", () => {
    expect(cavemanEngine.validateConfig({ intensity: "full", minMessageLength: 10 }).valid).toBe(true);
    expect(cavemanEngine.validateConfig({ intensity: "bogus" }).valid).toBe(false);
    expect(cavemanEngine.validateConfig({ minMessageLength: -1 }).valid).toBe(false);
    expect(cavemanEngine.validateConfig({ enabled: "yes" }).valid).toBe(false);
  });
});
