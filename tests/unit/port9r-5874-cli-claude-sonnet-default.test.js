import { describe, expect, it } from "vitest";
import cliTools from "../../cli/src/cli/menus/cliTools.js";
import claude from "../../open-sse/providers/registry/claude.js";

describe("9router #5874 46e2e05c3b33 CLI Claude Code Sonnet default", () => {
  const sonnet = cliTools.__test__.CLAUDE_MODEL_TYPES.find((type) => type.id === "sonnet");

  it("writes Sonnet 5.5 during Quick Setup", () => {
    expect(sonnet.envKey).toBe("ANTHROPIC_DEFAULT_SONNET_MODEL");
    expect(sonnet.defaultValue).toBe("cc/claude-sonnet-5-5");
  });

  it("names a current model in the claude catalog", () => {
    const model = claude.models.find((entry) => `cc/${entry.id}` === sonnet.defaultValue);
    expect(model).toBeDefined();
    expect(model.lifecycle).toBeUndefined();
  });
});
