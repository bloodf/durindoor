// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RootReact, { act as rootAct } from "../../node_modules/react/index.js";
import { createRoot as createDashboardRoot } from "../../node_modules/react-dom/client.js";
import MonitoringStrip from "../../src/app/(dashboard)/dashboard/endpoint/components/MonitoringStrip.js";
import React, { act } from "../../website/node_modules/react/index.js";
import { createRoot } from "../../website/node_modules/react-dom/client.js";
import { HomeLocaleProvider, HomeLocaleSelect } from "../../website/src/i18n/HomeLocaleProvider.jsx";
import DemoPasswordNotice from "../../website/src/components/demo/DemoPasswordNotice.jsx";
import { renderToStaticMarkup } from "../../website/node_modules/react-dom/server.js";
import { CopyButton, CountUp } from "../../website/src/components/home/ui/primitives.jsx";
import { DocsReadingPreferences } from "../../website/src/components/docs/ThemeToggle.jsx";
import { providerCoverage } from "../../website/src/lib/provider-coverage.js";
import { DEPLOYMENTS, NATIVE_SETUP, SERVICE_KINDS } from "../../website/src/components/home/content.js";

vi.mock("@/shared/hooks/useTheme", () => ({ useTheme: () => ({ isDark: false, toggleTheme: vi.fn() }) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const roots = [];
function render(element) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push([root, host]);
  act(() => root.render(React.createElement(HomeLocaleProvider, { locale: "en" }, element)));
  return host;
}
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  act(() => roots.splice(0).forEach(([root, host]) => { root.unmount(); host.remove(); }));
  vi.useRealTimers(); vi.restoreAllMocks();
});

describe("Visant marketing repairs", () => {
  it("announces clipboard failure, preserves the command, and allows a successful retry", async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error("denied")).mockResolvedValueOnce(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const host = render(React.createElement(CopyButton, { text: "npx durindoor", label: "Copy" }));
    await act(async () => host.querySelector("button").click());
    expect(host.querySelector('[role="status"]').textContent).toBe("Copy failed. Select the command and copy it manually.");
    expect(host.querySelector("button").dataset.copyState).toBe("error");
    await act(async () => host.querySelector("button").click());
    expect(writeText).toHaveBeenLastCalledWith("npx durindoor");
    expect(host.querySelector("button").textContent).toBe("Copied");
    act(() => vi.advanceTimersByTime(1600));
    expect(host.querySelector("button").textContent).toBe("Copy");
  });

  it("keeps copy feedback for the latest click and clears its timer on unmount", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const host = render(React.createElement(CopyButton, { text: "command" }));
    await act(async () => host.querySelector("button").click());
    act(() => vi.advanceTimersByTime(1000));
    await act(async () => host.querySelector("button").click());
    act(() => vi.advanceTimersByTime(700));
    expect(host.querySelector("button").textContent).toBe("Copied");
    const [root] = roots.pop(); act(() => root.unmount()); host.remove();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not let an older clipboard promise overwrite a newer failed attempt", async () => {
    let finishFirst;
    const first = new Promise((resolve) => { finishFirst = resolve; });
    const writeText = vi.fn().mockReturnValueOnce(first).mockRejectedValueOnce(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const host = render(React.createElement(CopyButton, { text: "command" }));
    act(() => host.querySelector("button").click());
    await act(async () => host.querySelector("button").click());
    expect(host.querySelector("button").dataset.copyState).toBe("error");
    await act(async () => finishFirst());
    expect(host.querySelector("button").dataset.copyState).toBe("error");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears a previous sample-password copy confirmation when another copy fails", async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const host = render(React.createElement(DemoPasswordNotice));
    await act(async () => host.querySelector("button").click());
    expect(host.querySelector("button").textContent).toContain("Copied");
    await act(async () => host.querySelector("button").click());
    expect(host.querySelector("button").textContent).not.toContain("Copied");
    expect(host.querySelector('[aria-live="polite"]').textContent).toBe("Copy failed. Select the visible password and copy it manually.");
  });

  it("closes the language list when keyboard focus leaves it", () => {
    const host = render(React.createElement(HomeLocaleSelect));
    const outside = document.createElement("button"); document.body.append(outside);
    act(() => host.querySelector("button").click());
    expect(host.querySelector('[role="listbox"]')).not.toBeNull();
    act(() => outside.focus());
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    expect(host.querySelector("button").getAttribute("aria-expanded")).toBe("false");
    outside.remove();
  });

  it("reads English docs with the correct document language and restores the marketing locale", () => {
    document.documentElement.lang = "ja";
    const host = render(React.createElement(DocsReadingPreferences));
    expect(document.documentElement.lang).toBe("en");
    const [root] = roots.pop(); act(() => root.unmount()); host.remove();
    expect(document.documentElement.lang).toBe("ja");
  });

  it("keeps the reused provider health table keyboard-focusable in the mobile demo", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      health: [{ id: "test-provider", name: "Test provider", requests: 3, errors: 0, successRate: 100, lastUsed: null }],
    }) });
    const host = document.createElement("div"); document.body.append(host);
    const root = createDashboardRoot(host);
    try {
      await rootAct(async () => root.render(RootReact.createElement(MonitoringStrip)));
      const region = host.querySelector('[role="region"][aria-label="Provider health"]');
      expect(region).not.toBeNull();
      expect(region.textContent).toContain("Test provider");
      expect(region.tabIndex).toBe(0);
      region.focus();
      expect(document.activeElement).toBe(region);
    } finally {
      rootAct(() => root.unmount()); host.remove(); globalThis.fetch = originalFetch;
    }
  });

  it("renders truthful server and accessible metric values before decorative animation begins", () => {
    const markup = renderToStaticMarkup(React.createElement(HomeLocaleProvider, { locale: "en" }, React.createElement(CountUp, { to: 270 })));
    const host = document.createElement("div"); host.innerHTML = markup;
    expect(host.querySelector('[aria-hidden="true"]').textContent).toBe("270");
    expect(host.querySelector(".sr-only").textContent).toBe("270");
  });

  it("counts visible registry entries, includes media combinations and defaults missing kinds to chat", () => {
    const coverage = providerCoverage([
      { id: "one" }, { id: "two", serviceKinds: ["llm", "image"] },
      { id: "three", media: { serviceKinds: ["image", "tts"] } }, { id: "hidden", hidden: true },
    ], SERVICE_KINDS);
    expect(coverage.total).toBe(3);
    expect(Object.fromEntries(coverage.kinds.map((kind) => [kind.id, kind.count]))).toEqual({
      chat: 2, embedding: 0, tts: 1, stt: 0, image: 2, vision: 0, video: 0, search: 0, fetch: 0,
    });
  });

  it("provides dashboard credentials and a loopback bind in each native startup example", () => {
    for (const id of ["npm", "npx", "source"]) {
      const command = DEPLOYMENTS.find((entry) => entry.id === id).command;
      expect(command).toContain(NATIVE_SETUP);
      expect(command.indexOf("export JWT_SECRET=")).toBeLessThan(command.lastIndexOf(id === "source" ? "npm start" : "durindoor --host 127.0.0.1"));
    }
    const docker = DEPLOYMENTS.find((entry) => entry.id === "docker").command;
    expect(docker).toContain('-e INITIAL_PASSWORD="$INITIAL_PASSWORD"');
    expect(docker).toContain("127.0.0.1:20128:20128");
  });
});
