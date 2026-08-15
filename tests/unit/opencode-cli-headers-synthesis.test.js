import { afterEach, describe, expect, it } from "vitest";

import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";

const ENV = "OPENCODE_SYNTHESIZE_CLI_HEADERS";

afterEach(() => delete process.env[ENV]);

describe("OpenCodeExecutor CLI identity synthesis", () => {
  it("replaces generic UA only when synthesis is enabled", () => {
    process.env[ENV] = "true";
    const headers = new OpenCodeExecutor().buildHeaders({}, true, {
      clientHeaders: { "user-agent": "curl/8.5.0", "x-opencode-project": "client-project" },
    });
    expect(headers["User-Agent"]).toBe("opencode-cli/1.0.0");
    expect(headers["x-opencode-project"]).toBe("client-project");
  });

  it("preserves versioned CLI UA when synthesis is enabled", () => {
    process.env[ENV] = "yes";
    const headers = new OpenCodeExecutor().buildHeaders({}, true, {
      clientHeaders: { "User-Agent": "opencode-cli/2.5.0" },
    });
    expect(headers["User-Agent"]).toBe("opencode-cli/2.5.0");
  });

  it("preserves official OpenCode UA when synthesis is disabled (free-tier)", () => {
    const headers = new OpenCodeExecutor().buildHeaders({}, true, {
      clientHeaders: { "user-agent": "curl/8.5.0" },
    });
    expect(headers["User-Agent"]).toBe("opencode");
  });
});
