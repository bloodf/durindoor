import { beforeEach, describe, expect, it } from "vitest";
import { CLI_TOOLS } from "../../src/shared/constants/cliTools.js";
import {
  formatEndpointPresetLabel,
  readLastCustomUrl,
  writeLastCustomUrl,
} from "../../src/app/(dashboard)/dashboard/cli-tools/components/cliEndpointPresets.js";

describe("Oh My Pi CLI integration (#3272)", () => {
  it("generates extension-compatible environment setup", () => {
    expect(CLI_TOOLS.omp).toMatchObject({
      id: "omp",
      configType: "guide",
      envVars: {
        baseUrl: "DURINDOOR_BASE_URL",
        apiKey: "DURINDOOR_API_KEY",
      },
    });
    expect(CLI_TOOLS.omp.codeBlock.code).toContain("DURINDOOR_BASE_URL={{baseUrl}}");
    expect(CLI_TOOLS.omp.codeBlock.code).toContain("DURINDOOR_API_KEY={{apiKey}}");
    expect(CLI_TOOLS.omp.guideSteps.map(({ step, title, type }) => ({ step, title, type }))).toEqual([
      { step: 1, title: "Install the shipped extension", type: undefined },
      { step: 2, title: "API Key", type: "apiKeySelector" },
      { step: 3, title: "Base URL", type: "baseUrlSelector" },
      { step: 4, title: "Configure environment", type: undefined },
      { step: 5, title: "Start omp", type: undefined },
    ]);
    expect(CLI_TOOLS.omp.guideSteps[0].value).toContain("omp-extension");
  });
});

describe("CLI custom URL presets (#3273)", () => {
  beforeEach(() => {
    const values = new Map();
    global.window = {
      localStorage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
      },
    };
  });

  it("labels named presets and remembers the last custom URL", () => {
    expect(formatEndpointPresetLabel({ name: "Office", baseUrl: "https://router.example/v1" }))
      .toBe("Office — https://router.example/v1");
    writeLastCustomUrl("https://router.example/v1");
    expect(readLastCustomUrl()).toBe("https://router.example/v1");
  });
});
