import { afterEach, describe, expect, it, vi } from "vitest";
import { selectV5Browser, v5BrowserLaunchOptions, v5ScreenshotDirectory } from "../utils/v5-browser-engine.mjs";

import { chromiumLaunchOptions } from "../utils/chromiumLaunch.mjs";

afterEach(() => vi.unstubAllEnvs());

describe("V5 browser engine selection", () => {
  it("defaults to Chromium and accepts each explicit engine", () => {
    expect(selectV5Browser()).toBe("chromium");
    for (const engine of ["chromium", "firefox", "webkit"]) expect(selectV5Browser(engine)).toBe(engine);
  });

  it("rejects unknown and empty names", () => {
    for (const name of ["", "Chrome", "chromium,firefox"]) expect(() => selectV5Browser(name)).toThrow(/V5_BROWSER_ENGINE/);
  });

  it("preserves the Chromium launch options", () => {
    vi.stubEnv("V5_CHROMIUM_EXECUTABLE", "/example/chromium");
    const browserType = { executablePath: vi.fn() };
    expect(v5BrowserLaunchOptions("chromium", browserType, "/nonexistent"))
      .toEqual(chromiumLaunchOptions(browserType, "/nonexistent"));
    expect(browserType.executablePath).not.toHaveBeenCalled();
  });

  it("uses each non-Chromium engine's executable override only for that engine", () => {
    vi.stubEnv("V5_CHROMIUM_EXECUTABLE", "/example/chromium");
    vi.stubEnv("V5_FIREFOX_EXECUTABLE", "/example/firefox");
    vi.stubEnv("V5_WEBKIT_EXECUTABLE", "/example/webkit");
    const browserType = { executablePath: vi.fn() };
    expect(v5BrowserLaunchOptions("firefox", browserType, "/nonexistent")).toEqual({ executablePath: "/example/firefox" });
    expect(v5BrowserLaunchOptions("webkit", browserType, "/nonexistent")).toEqual({ executablePath: "/example/webkit" });
    vi.stubEnv("V5_FIREFOX_EXECUTABLE", undefined);
    vi.stubEnv("V5_WEBKIT_EXECUTABLE", undefined);
    expect(v5BrowserLaunchOptions("firefox", browserType, "/nonexistent")).toEqual({});
    expect(v5BrowserLaunchOptions("webkit", browserType, "/nonexistent")).toEqual({});
    expect(browserType.executablePath).not.toHaveBeenCalled();
  });

  it("preserves Chromium paths and separates other engines", () => {
    expect(v5ScreenshotDirectory("/evidence", "chromium", "dashboard")).toBe("/evidence/dashboard");
    expect(v5ScreenshotDirectory("/evidence", "firefox", "dashboard")).toBe("/evidence/firefox/dashboard");
    expect(v5ScreenshotDirectory("/evidence", "webkit", "dashboard")).toBe("/evidence/webkit/dashboard");
  });
});
