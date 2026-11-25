import { describe, expect, it } from "vitest";
import server from "../../src/mitm/server.js";
import config from "../../src/mitm/config.js";

const SANDBOX = "daily-cloudcode-pa.sandbox.googleapis.com";
const INTERCEPTED = ["cloudcode-pa.googleapis.com", "daily-cloudcode-pa.googleapis.com"];

describe("upstream #3064: Antigravity MITM forwards generation to the sandbox host", () => {
  it.each(INTERCEPTED)("classifies %s as Antigravity and rewrites its generation calls", (host) => {
    expect(config.getToolForHost(host)).toBe("antigravity");
    for (const url of ["/v1internal:generateContent", "/v1internal:streamGenerateContent?alt=sse"]) {
      expect(server.resolveUpstreamHost(host, url)).toBe(SANDBOX);
    }
  });

  it.each(INTERCEPTED)("keeps %s for auth and discovery calls", (host) => {
    expect(server.resolveUpstreamHost(host, "/v1internal:loadCodeAssist")).toBe(host);
  });

  it("leaves other tools' hosts alone", () => {
    expect(server.resolveUpstreamHost("api2.cursor.sh", "/v1internal:generateContent")).toBe("api2.cursor.sh");
  });
});
