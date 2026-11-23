import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { getProbeHost, getDisplayUrl } = require("../../cli/src/cli/host.js");

describe("CLI host probe and display helpers", () => {
  it.each([
    ["127.0.0.1", "127.0.0.1", "http://127.0.0.1:20128/dashboard"],
    ["0.0.0.0", "127.0.0.1", "http://localhost:20128/dashboard"],
    ["::", "::1", "http://localhost:20128/dashboard"],
    ["::1", "::1", "http://[::1]:20128/dashboard"],
    ["192.168.1.42", "192.168.1.42", "http://192.168.1.42:20128/dashboard"],
  ])("handles --host %s", (host, expectedProbe, expectedUrl) => {
    expect(getProbeHost(host)).toBe(expectedProbe);
    expect(getDisplayUrl(host, 20128, "/dashboard")).toBe(expectedUrl);
  });
});
