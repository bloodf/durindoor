import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearConsoleLogs: vi.fn(),
  getConsoleLogSnapshot: vi.fn(),
  initConsoleLogCapture: vi.fn(),
}));

vi.mock("@/lib/consoleLogBuffer", () => mocks);

import { GET } from "@/app/api/translator/console-logs/route.js";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config.js";

describe("console log REST snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConsoleLogSnapshot.mockReturnValue({
      logs: ["line"],
      revision: 7,
    });
  });

  it("returns an ETag with the current snapshot", async () => {
    const response = await GET(new Request("http://localhost/api/translator/console-logs"));

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('W/"console-7"');
    expect(await response.json()).toEqual({ success: true, logs: ["line"] });
  });

  it("returns 304 when snapshot revision is unchanged", async () => {
    const response = await GET(new Request("http://localhost/api/translator/console-logs", {
      headers: { "If-None-Match": 'W/"console-7"' },
    }));

    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
  });

  it("returns a full 2000-line buffer", async () => {
    const logs = Array.from({ length: CONSOLE_LOG_CONFIG.maxLines }, (_, index) => `line ${index}`);
    mocks.getConsoleLogSnapshot.mockReturnValue({ logs, revision: 9 });

    const response = await GET(new Request("http://localhost/api/translator/console-logs"));

    expect((await response.json()).logs).toHaveLength(2000);
  });
});

describe("console log ring buffer", () => {
  const levels = ["log", "info", "warn", "error", "debug"];
  const saved = {};

  beforeEach(() => {
    delete global._consoleLogBufferState;
    for (const level of levels) {
      saved[level] = console[level];
      console[level] = () => {};
    }
  });

  afterEach(() => {
    clearTimeout(global._consoleLogBufferState?.flushTimer);
    delete global._consoleLogBufferState;
    for (const level of levels) console[level] = saved[level];
  });

  it("keeps the latest CONSOLE_LOG_CONFIG.maxLines (2000) lines", async () => {
    expect(CONSOLE_LOG_CONFIG.maxLines).toBe(2000);
    vi.resetModules();
    const buffer = await vi.importActual("@/lib/consoleLogBuffer");
    buffer.initConsoleLogCapture();

    for (let index = 0; index < 2005; index += 1) console.log(`line ${index}`);

    const { logs, revision } = buffer.getConsoleLogSnapshot();
    expect(logs).toHaveLength(2000);
    expect(logs[0]).toBe("line 5");
    expect(logs.at(-1)).toBe("line 2004");
    expect(revision).toBe(2005);
    expect(buffer.getConsoleLogs()).toHaveLength(2000);
  });
});
