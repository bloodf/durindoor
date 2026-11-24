import { describe, expect, it, vi } from "vitest";
import { selectV5Browser, v5BrowserLaunchOptions, v5ScreenshotDirectory } from "../utils/v5-browser-engine.mjs";

describe("V5 browser engine selection", () => {
  it("defaults to Chromium and accepts each explicit engine", () => {
    expect(selectV5Browser()).toBe("chromium");
    for (const engine of ["chromium", "firefox", "webkit"]) expect(selectV5Browser(engine)).toBe(engine);
  });

  it("rejects unknown and empty names", () => {
    for (const name of ["", "Chrome", "chromium,firefox"]) expect(() => selectV5Browser(name)).toThrow(/V5_BROWSER_ENGINE/);
  });

  it("uses Chromium launch options only for Chromium", () => {
    const browserType = { executablePath: vi.fn(() => "/nonexistent") };
    expect(v5BrowserLaunchOptions("firefox", browserType, "/nonexistent")).toEqual({});
    expect(v5BrowserLaunchOptions("webkit", browserType, "/nonexistent")).toEqual({});
    expect(browserType.executablePath).not.toHaveBeenCalled();
    v5BrowserLaunchOptions("chromium", browserType, "/nonexistent");
    expect(browserType.executablePath).toHaveBeenCalledOnce();
  });

  it("preserves Chromium paths and separates other engines", () => {
    expect(v5ScreenshotDirectory("/evidence", "chromium", "dashboard")).toBe("/evidence/dashboard");
    expect(v5ScreenshotDirectory("/evidence", "firefox", "dashboard")).toBe("/evidence/firefox/dashboard");
    expect(v5ScreenshotDirectory("/evidence", "webkit", "dashboard")).toBe("/evidence/webkit/dashboard");
  });
});
