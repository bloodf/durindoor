import { afterEach, describe, expect, it } from "vitest";

import { OpenCodeExecutor, OPENCODE_UA } from "../../open-sse/executors/opencode.js";

const ENV = "OPENCODE_SYNTHESIZE_CLI_HEADERS";

afterEach(() => delete process.env[ENV]);

describe("OpenCodeExecutor CLI identity synthesis", () => {
  it("replaces generic UA only when synthesis is enabled", () => {
    process.env[ENV] = "true";
    const headers = new OpenCodeExecutor().buildHeaders({}, true, {
      clientHeaders: { "user-agent": "curl/8.5.0", "x-opencode-project": "client-project" },
    });
    expect(headers["User-Agent"]).toBe("opencode-cli/1.0.0");
    expect(headers["x-opencode-project"]).toBe("global");
  });

  it("preserves versioned CLI UA when synthesis is enabled", () => {
    process.env[ENV] = "yes";
    const headers = new OpenCodeExecutor().buildHeaders({}, true, {
      clientHeaders: { "User-Agent": "opencode-cli/2.5.0" },
    });
    expect(headers["User-Agent"]).toBe("opencode-cli/2.5.0");
  });

  it("defaults to the versioned free-tier UA when synthesis is disabled", () => {
    const headers = new OpenCodeExecutor().buildHeaders({}, true, {
      clientHeaders: { "user-agent": "curl/8.5.0" },
    });
    // The v2 free tier 403s anything but the v2 UA shape (FreeTierError).
    expect(headers["User-Agent"]).toBe(OPENCODE_UA);
  });

  it("preserves a valid v2 opencode/<channel>/<x.y.z>/<client> UA as-is", () => {
    const headers = new OpenCodeExecutor().buildHeaders({}, true, {
      clientHeaders: { "user-agent": "opencode/latest/2.0.26/desktop" },
    });
    expect(headers["User-Agent"]).toBe("opencode/latest/2.0.26/desktop");
  });

  it("overrides a v1 opencode/<version> client UA", () => {
    const headers = new OpenCodeExecutor().buildHeaders({}, true, {
      clientHeaders: { "user-agent": "opencode/1.18.31 ai-sdk/provider-utils/4.0.40" },
    });
    expect(headers["User-Agent"]).toBe(OPENCODE_UA);
  });
});
