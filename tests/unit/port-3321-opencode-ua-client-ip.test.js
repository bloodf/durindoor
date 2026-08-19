import { afterEach, describe, expect, it } from "vitest";

import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";

afterEach(() => {
  delete process.env.OPENCODE_SYNTHESIZE_CLI_HEADERS;
});

describe("port(upstream): #3321 - opencode forwards real client IP to stop shared-bucket 429s", () => {
  it("forwards public x-9r-real-ip as x-real-ip on free tier", () => {
    const headers = new OpenCodeExecutor().buildHeaders({}, true, {
      clientHeaders: { "x-9r-real-ip": "203.0.113.42", "user-agent": "curl/8.5.0" },
    });
    expect(headers["x-real-ip"]).toBe("203.0.113.42");
  });

  it("falls back to x-real-ip when x-9r-real-ip is absent", () => {
    const headers = new OpenCodeExecutor().buildHeaders({}, true, {
      clientHeaders: { "x-real-ip": "198.51.100.7", "user-agent": "curl/8.5.0" },
    });
    expect(headers["x-real-ip"]).toBe("198.51.100.7");
  });

  it("drops loopback x-9r-real-ip to avoid shared 127.0.0.1 bucket", () => {
    const headers = new OpenCodeExecutor().buildHeaders({}, true, {
      clientHeaders: { "x-9r-real-ip": "127.0.0.1", "user-agent": "curl/8.5.0" },
    });
    expect(headers["x-real-ip"]).toBeUndefined();
  });

  it("drops RFC1918 x-9r-real-ip to avoid shared LAN bucket", () => {
    const headers = new OpenCodeExecutor().buildHeaders({}, true, {
      clientHeaders: { "x-9r-real-ip": "192.168.1.5", "user-agent": "curl/8.5.0" },
    });
    expect(headers["x-real-ip"]).toBeUndefined();
  });

  it("drops 10.x and 172.16-31.x x-9r-real-ip", () => {
    const a = new OpenCodeExecutor().buildHeaders({}, true, {
      clientHeaders: { "x-9r-real-ip": "10.0.0.1", "user-agent": "curl/8.5.0" },
    });
    const b = new OpenCodeExecutor().buildHeaders({}, true, {
      clientHeaders: { "x-9r-real-ip": "172.20.3.4", "user-agent": "curl/8.5.0" },
    });
    expect(a["x-real-ip"]).toBeUndefined();
    expect(b["x-real-ip"]).toBeUndefined();
  });

  it("omits x-real-ip when no client IP header is present (matches D13 contract)", () => {
    const headers = new OpenCodeExecutor().buildHeaders({}, true, {
      clientHeaders: { "user-agent": "curl/8.5.0" },
    });
    expect(headers["x-real-ip"]).toBeUndefined();
  });
});
