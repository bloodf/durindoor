import { afterEach, describe, expect, it, vi } from "vitest";
import { createStreamController } from "../../open-sse/utils/streamHandler.js";
import { colorStreamStatus } from "../../open-sse/utils/streamStatusColor.js";

const originalTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
afterEach(() => {
  vi.unstubAllEnvs();
  if (originalTTY) Object.defineProperty(process.stdout, "isTTY", originalTTY);
  else delete process.stdout.isTTY;
  vi.restoreAllMocks();
});

function tty(value) {
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value });
}

describe("stream status colors", () => {
  it.each(["true", " 1 ", "YES", "on"])("forces color with %s, even with NO_COLOR", (value) => {
    vi.stubEnv("APP_LOG_COLORS", value);
    vi.stubEnv("NO_COLOR", "1");
    tty(false);
    expect(colorStreamStatus("ERROR", "red")).toBe("\x1b[31mERROR\x1b[0m");
  });

  it.each(["false", "0", "NO", "off"])("disables color with %s", (value) => {
    vi.stubEnv("APP_LOG_COLORS", value);
    tty(true);
    expect(colorStreamStatus("ABORTED", "yellow")).toBe("ABORTED");
  });

  it("uses TTY and NO_COLOR for unset and unrecognized values", () => {
    vi.stubEnv("APP_LOG_COLORS", "unknown");
    vi.stubEnv("NO_COLOR", undefined);
    tty(true);
    expect(colorStreamStatus("ABORTED", "yellow")).toBe("\x1b[33mABORTED\x1b[0m");
    vi.stubEnv("NO_COLOR", "");
    expect(colorStreamStatus("ABORTED", "yellow")).toBe("ABORTED");
    vi.stubEnv("APP_LOG_COLORS", undefined);
    vi.stubEnv("NO_COLOR", undefined);
    tty(false);
    expect(colorStreamStatus("ABORTED", "yellow")).toBe("ABORTED");
  });

  it("colors only the status while preserving callbacks, severity, and completion", () => {
    vi.stubEnv("APP_LOG_COLORS", "true");
    const log = { line: vi.fn(), errorLine: vi.fn() };
    const onDisconnect = vi.fn(), onError = vi.fn(), onComplete = vi.fn();
    const options = { log, provider: "provider", model: "model", reqTag: "tag", onDisconnect, onError, onComplete };
    const disconnect = createStreamController(options);
    disconnect.handleDisconnect("client_closed");
    expect(log.line).toHaveBeenCalledWith("tag", "⚡", expect.stringMatching(/^\x1b\[33mDISCONNECT\x1b\[0m: client_closed · provider\/model · \d+ms$/));
    expect(disconnect.signal.aborted).toBe(true);
    expect(onDisconnect).toHaveBeenCalledOnce();
    const abort = new Error("cancelled"); abort.name = "AbortError";
    createStreamController(options).handleError(abort);
    expect(log.line).toHaveBeenLastCalledWith("tag", "⚡", expect.stringMatching(/^\x1b\[33mABORTED\x1b\[0m · provider\/model · \d+ms$/));
    const error = new Error("failure");
    createStreamController(options).handleError(error);
    expect(log.errorLine).toHaveBeenCalledWith("tag", "✗", expect.stringMatching(/^\x1b\[31mERROR\x1b\[0m: failure · provider\/model · \d+ms$/));
    expect(onError).toHaveBeenCalledTimes(2);
    createStreamController(options).handleComplete();
    expect(onComplete).toHaveBeenCalledOnce();
    expect(log.line).toHaveBeenCalledTimes(2);
    expect(log.errorLine).toHaveBeenCalledTimes(1);
  });

  it("preserves the fallback console line", () => {
    vi.stubEnv("APP_LOG_COLORS", "true");
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    createStreamController({ provider: "p", model: "m" }).handleDisconnect("closed");
    expect(output).toHaveBeenCalledWith(expect.stringMatching(/p\/m · \x1b\[33mDISCONNECT\x1b\[0m: closed · \d+ms$/));
  });
});
