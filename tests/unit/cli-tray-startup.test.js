import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { trackTrayStartup } = require("../../cli/src/cli/tray/tray.js");

afterEach(() => vi.useRealTimers());

describe("tray startup reporting", () => {
  it("reports readiness once when the process acknowledges startup", () => {
    vi.useFakeTimers();
    const onReady = vi.fn();
    const onError = vi.fn();
    const startup = trackTrayStartup({ onReady, onError }, 10);
    startup.onReady();
    vi.advanceTimersByTime(11);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("times out a missing handshake and ignores late readiness", () => {
    vi.useFakeTimers();
    const onReady = vi.fn();
    const onError = vi.fn();
    const startup = trackTrayStartup({ onReady, onError }, 10);
    vi.advanceTimersByTime(11);
    startup.onReady();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("confirm startup") }));
    expect(onReady).not.toHaveBeenCalled();
  });
});
