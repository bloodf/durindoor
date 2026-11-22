// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ handlers: null, stop: vi.fn(), invalidate: vi.fn() }));
vi.mock("../../src/app/(dashboard)/dashboard/console-log/transport.js", () => ({
  startConsoleLogTransport: (handlers) => {
    transport.handlers = handlers;
    return { ready: Promise.resolve(), stop: transport.stop, invalidate: transport.invalidate };
  },
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@monaco-editor/react", () => ({ loader: { config: () => {} }, default: () => null }));

import ConsoleLogClient from "../../src/app/(dashboard)/dashboard/console-log/ConsoleLogClient.js";
import { TranslatorWorkspace } from "../../src/app/(dashboard)/dashboard/translator/TranslatorWorkspace.jsx";
import SkillsPage from "../../src/app/(dashboard)/dashboard/skills/page.js";

const ok = (body = {}) => ({ ok: true, status: 200, json: async () => body });
const flush = () => new Promise((resolve) => setTimeout(resolve, 40));
let host, root;

const button = (name) => [...host.querySelectorAll("button")].find((el) => el.textContent.includes(name));
const click = async (el) => { expect(el).toBeTruthy(); await act(async () => { el.click(); await flush(); }); };

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  transport.handlers = null;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.documentElement.removeAttribute("data-ui");
  vi.unstubAllGlobals();
});

async function render(node, v5) {
  if (v5) document.documentElement.dataset.ui = "v5";
  else document.documentElement.removeAttribute("data-ui");
  await act(async () => { root.render(node); await flush(); });
}

describe.each([false, true])("console-log V5=%s", (v5) => {
  it("keeps Clear DELETE parity and retains output on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: "Clear rejected" }) })));
    await render(React.createElement(ConsoleLogClient), v5);
    await act(async () => {
      transport.handlers.onStatus({ state: "streaming" });
      transport.handlers.onEvent({ type: "init", logs: ["[17:48:00] ℹ️  [BOOT] up", "[17:48:09] 🔵 📊 CANCELLED 1200ms · IN 96 · OUT 12"] });
      await flush();
    });
    expect(host.textContent).toMatch(/Streaming|Paused/);
    expect(host.querySelector('[role="log"]')?.getAttribute("aria-live")).toBe(v5 ? "polite" : "off");
    expect(button("Pause")?.getAttribute("aria-pressed")).toBe("false");
    await click(button("Clear"));
    const write = fetch.mock.calls.find(([, options]) => options?.method === "DELETE");
    expect(write?.[0]).toBe("/api/translator/console-logs");
    expect(write?.[1]?.method).toBe("DELETE");
    expect(host.textContent).toContain("Console logs were not cleared");
    expect(host.textContent).toContain("CANCELLED 1200ms");
  });

  it("labels Streaming then Polling from the transport", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ success: true })));
    await render(React.createElement(ConsoleLogClient), v5);
    await act(async () => { transport.handlers.onStatus({ state: "streaming" }); await flush(); });
    expect(host.textContent).toContain("Streaming");
    await act(async () => { transport.handlers.onStatus({ state: "polling" }); await flush(); });
    expect(host.textContent).toContain("Polling");
  });
});

describe.each([false, true])("translator V5=%s", (v5) => {
  const target = JSON.stringify({ provider: "codex", model: "gpt-5.2-codex", body: { prompt: "hi" } }, null, 2);

  it("keeps Send request parity and retains the draft after capture save failure", async () => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
      calls.push([url, options.method || "GET", options.body]);
      if (url === "/api/translator/send") {
        const reader = {
          read: async () => ({ done: true, value: undefined }),
          cancel: async () => {},
          releaseLock: () => {},
        };
        return {
          ok: true,
          status: 200,
          headers: { get: () => "text/event-stream" },
          body: { getReader: () => reader },
        };
      }
      if (url === "/api/translator/save" && options.method === "POST") {
        const body = JSON.parse(options.body || "{}");
        if (body.file === "5_res_provider.txt") return { ok: false, status: 500, json: async () => ({ error: "Capture storage unavailable" }) };
        return ok({ success: true });
      }
      return ok({ success: true });
    }));
    await render(React.createElement(TranslatorWorkspace, { initialContents: { 4: target }, initialMeta: { provider: "codex", model: "gpt-5.2-codex" } }), v5);
    const expand = [...host.querySelectorAll("button")].find((el) => el.getAttribute("aria-label") === "Expand Target Request" || el.getAttribute("aria-label") === "Collapse Target Request");
    if (expand?.getAttribute("aria-label")?.startsWith("Expand")) await click(expand);
    if (v5) {
      const toggle = [...host.querySelectorAll("button")].find((el) => el.getAttribute("aria-label")?.includes("Target Request"));
      expect(toggle?.hasAttribute("aria-expanded")).toBe(true);
    }
    await click(button("Send"));
    const send = calls.find(([url, method]) => url === "/api/translator/send" && method === "POST");
    expect(send).toBeTruthy();
    expect(JSON.parse(send[2])).toEqual({ provider: "codex", model: "gpt-5.2-codex", body: { prompt: "hi" } });
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/saving the capture failed/i);
    expect(host.textContent).toMatch(/Failed\. Received content retained/);
    expect(host.textContent).toContain("89 chars");
  });

  it("announces dismissible load errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ success: false, error: "Fixture capture missing" })));
    await render(React.createElement(TranslatorWorkspace, { initialContents: { 1: "{}" } }), v5);
    await click(button("Load"));
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Fixture capture missing");
    await click([...alert.querySelectorAll("button")].find((el) => el.getAttribute("aria-label") === "Dismiss error"));
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});

describe.each([false, true])("skills V5=%s", (v5) => {
  it("keeps reveal fetch parity for Copy instruction", async () => {
    const written = [];
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async (text) => { written.push(text); }) },
    });
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (url === "/api/keys") return ok({ keys: [{ id: "key-1", name: "Fixture", maskedKey: "sk-••••", isActive: true }] });
      if (String(url).includes("/api/tunnel/status")) return ok({ tunnel: { enabled: false }, tailscale: { enabled: false } });
      if (url === "/api/keys/key-1/reveal") return ok({ key: "sk-live-secret" });
      return ok({});
    }));
    await render(React.createElement(SkillsPage), v5);
    const keyTrigger = host.querySelector('[aria-label="API key"]');
    await click(keyTrigger);
    const option = [...document.body.querySelectorAll('[role="option"]')].find((el) => el.textContent.includes("Fixture"));
    await click(option);
    const before = fetch.mock.calls.length;
    await click(button("Copy instruction"));
    const reveal = fetch.mock.calls.slice(before).find(([url]) => url === "/api/keys/key-1/reveal");
    expect(reveal).toEqual(["/api/keys/key-1/reveal"]);
    expect(written[0]).toContain("sk-live-secret");
    expect(button("Copy instruction") || button("Copied")).toBeTruthy();
  });
});

describe("skills V5 clipboard and layout", () => {
  it("uses basis-full sm:basis-0 and shows clipboard rejection", async () => {
    document.documentElement.dataset.ui = "v5";
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => { throw new DOMException("denied", "NotAllowedError"); }) },
    });
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (url === "/api/keys") return ok({ keys: [] });
      if (String(url).includes("/api/tunnel/status")) return ok({ tunnel: { enabled: false }, tailscale: { enabled: false } });
      return ok({});
    }));
    await render(React.createElement(SkillsPage), true);
    const instruction = host.querySelector("code");
    expect(instruction?.className).toContain("basis-full");
    expect(instruction?.className).toContain("sm:basis-0");
    await click(button("Copy instruction"));
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/Copy unavailable/i);
  });
});
