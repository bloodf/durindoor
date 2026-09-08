// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import RequestLogger from "@/shared/components/RequestLogger.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const roots = [];

async function render(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push([root, container]);
  await act(async () => root.render(element));
  return container;
}
const sampleLogs = [
  "2026-01-01 00:00:00 | gpt-4 | openai | acct-A | 12 | 34 | OK",
  "2026-01-01 00:00:01 | claude-3 | anthropic | acct-B | 8 | 22 | PENDING",
  "2026-01-01 00:00:02 | gemini | google | acct-C | 4 | 9 | FAILED",
  "junk line with too few parts",
];

describe("shared/components/RequestLogger", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(async () => {
    while (roots.length) {
      const [root, container] = roots.pop();
      await act(async () => root.unmount());
      container.remove();
    }
    vi.unstubAllGlobals();
  });

  it("renders an empty accessible request-log region", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    const container = await render(React.createElement(RequestLogger));
    const region = container.querySelector('[role="region"][aria-label="Request logs streamed from the request history database. rows"]');
    expect(region).toBeTruthy();
    expect(region.querySelector("tbody tr")).toBeTruthy();
    expect(region.querySelector("tbody th")).toBeNull();
  });

  it("surfaces failure alert when request log fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const container = await render(React.createElement(RequestLogger));
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/Failed to load request logs/i);
  });

  it("renders parseable logs with accessible statuses and excludes malformed records", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => sampleLogs }));
    const container = await render(React.createElement(RequestLogger));
    expect(container.textContent).toContain("gpt-4");
    // The pill announces itself with a visually-hidden prefix rather than an
    // aria-label, which axe forbids on a generic span. Assert what is read
    // out, not the attribute that used to carry it.
    expect(container.textContent).toContain("Status: OK");
    expect(container.textContent).toContain("Status: PENDING");
    expect(container.textContent).toContain("Status: FAILED");
    expect(container.textContent).not.toContain("junk line with too few parts");
  });

  it("toggles auto-refresh through switch", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => sampleLogs }));
    const container = await render(React.createElement(RequestLogger));
    const toggle = container.querySelector('[role="switch"][aria-label="Auto refresh every 3 seconds"]');
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    await act(async () => toggle.click());
    expect(toggle?.getAttribute("aria-checked")).toBe("false");
  });
});
