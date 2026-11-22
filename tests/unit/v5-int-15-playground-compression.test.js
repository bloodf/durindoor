// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Playground from "../../src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.js";
import Compression from "../../src/app/(dashboard)/dashboard/compression-studio/page.js";
import Headroom from "../../src/app/(dashboard)/dashboard/headroom/HeadroomClient.js";
import Pxpipe from "../../src/app/(dashboard)/dashboard/pxpipe/PxpipeClient.js";

vi.mock("recharts", () => Object.fromEntries(["AreaChart", "Area", "XAxis", "YAxis", "CartesianGrid", "Tooltip", "ResponsiveContainer"].map((name) => [name, () => null])));
const ok = (data) => ({ ok: true, json: async () => data });
const flush = () => new Promise((resolve) => setTimeout(resolve, 40));
let host, root;
const render = async (Component) => act(async () => { root.render(React.createElement(Component)); await flush(); });
const click = async (node) => { expect(node).toBeTruthy(); await act(async () => { node.click(); await flush(); }); };
const button = (name) => [...host.querySelectorAll("button")].find((n) => n.textContent.includes(name));
const input = async (node, value) => act(async () => { Object.getOwnPropertyDescriptor(node.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value").set.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); await flush(); });
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.documentElement.removeAttribute("data-ui"); vi.unstubAllGlobals(); });

async function requestFor(v5, Component, action, responder) {
  if (v5) document.documentElement.dataset.ui = "v5"; else document.documentElement.removeAttribute("data-ui");
  vi.stubGlobal("fetch", vi.fn(responder));
  await render(Component); await action();
  const call = fetch.mock.calls.find(([, options]) => options?.method === "POST" || options?.method === "PATCH");
  expect(call).toBeTruthy();
  const result = [call[0], call[1].method, call[1].body];
  await act(async () => { root.unmount(); await flush(); }); root = createRoot(host); localStorage.clear();
  return result;
}

describe("S15 request parity", () => {
  it("preserves the compression preview request and keeps input on failure", async () => {
    const run = (v5) => requestFor(v5, Compression, async () => { await input(host.querySelector('textarea'), "hello"); await click(button("Run preview")); expect(host.querySelector('textarea').value).toBe("hello"); }, async (url) => url === "/api/providers" ? ok({ connections: [] }) : { ok: false, status: 400, json: async () => ({ error: { message: "Preview failed" } }) });
    expect(await run(true)).toEqual(await run(false));
  });
  it("preserves the headroom settings write", async () => {
    const run = (v5) => requestFor(v5, Headroom, async () => click(host.querySelectorAll('[role="switch"]')[1]), async (url) => ok(url === "/api/settings" ? {} : url === "/api/headroom/status" ? { running: true } : { windows: {}, recent: [], timeline: [] }));
    expect(await run(true)).toEqual(await run(false));
  });
  it("preserves canonical playground completion addressing", async () => {
    const run = (v5) => requestFor(v5, Playground, async () => { await input(host.querySelector('[aria-label="Message input"]'), "hello"); await click(host.querySelector('[aria-label="Send message"]')); }, async (url) => url === "/api/providers" ? ok({ connections: [{ id: "codex-primary", provider: "codex", isActive: true }] }) : url.includes("/models") ? ok({ data: [{ id: "gpt-5.2-codex", name: "GPT" }] }) : { ok: false, status: 503, json: async () => ({ error: "failed" }) });
    const on = await run(true); const off = await run(false); expect(on).toEqual(off); expect(JSON.parse(on[2]).model).toContain("codex");
  });
});

it("keeps savings visible when pxpipe events fail and retries", async () => {
  document.documentElement.dataset.ui = "v5";
  vi.stubGlobal("fetch", vi.fn(async (url) => url.includes("logs") ? { ok: false } : ok(url.includes("stats") ? { windows: { last7d: { requests: 1, compressed: 1, bypassed: 0, tokensBeforeEst: 20, tokensAfterEst: 10, tokensSavedEst: 10, savedPct: 50, imagesGenerated: 1, avgCompressionMs: 2, errors: 0 } }, recent: [], timeline: [] } : {})));
  await render(Pxpipe); expect(host.textContent).toContain("50%"); expect(host.textContent).toContain("Transform events could not be loaded"); await click(button("Retry")); expect(fetch.mock.calls.filter(([url]) => url.includes("logs"))).toHaveLength(2);
});

it("labels the V5 engine selector and disables unshipped engines", async () => {
  document.documentElement.dataset.ui = "v5";
  vi.stubGlobal("fetch", vi.fn(async () => ok({ connections: [] })));
  await render(Compression);
  expect(host.querySelector('[aria-label="Engine"]')).toBeTruthy();
  const unavailable = [...host.querySelectorAll('option:disabled')].find((option) => option.textContent.includes("not included in this build"));
  expect(unavailable).toBeTruthy();
});

it("shows an accessible transcript and retry after a failed completion", async () => {
  document.documentElement.dataset.ui = "v5";
  vi.stubGlobal("fetch", vi.fn(async (url) => url === "/api/providers" ? ok({ connections: [{ id: "codex-primary", provider: "codex", isActive: true }] }) : url.includes("/models") ? ok({ data: [{ id: "gpt-5.2-codex", name: "GPT" }] }) : { ok: false, status: 503, json: async () => ({ error: "failed" }) }));
  await render(Playground); expect(host.querySelector('[role="log"][aria-label="Conversation messages"]')).toBeTruthy();
  await input(host.querySelector('[aria-label="Message input"]'), "hello"); await click(host.querySelector('[aria-label="Send message"]')); await click(button("Retry"));
  const calls = fetch.mock.calls.filter(([url]) => url === "/v1/chat/completions");
  expect(calls).toHaveLength(2); expect(calls[1][1].body).toBe(calls[0][1].body);
});

it("keeps Stop reachable while a playground response is streaming", async () => {
  document.documentElement.dataset.ui = "v5";
  vi.stubGlobal("fetch", vi.fn((url, options) => {
    if (url === "/api/providers") return Promise.resolve(ok({ connections: [{ id: "codex-primary", provider: "codex", isActive: true }] }));
    if (url.includes("/models")) return Promise.resolve(ok({ data: [{ id: "gpt-5.2-codex", name: "GPT" }] }));
    return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(Object.assign(new Error("stopped"), { name: "AbortError" }))));
  }));
  await render(Playground); await input(host.querySelector('[aria-label="Message input"]'), "hello"); await click(host.querySelector('[aria-label="Send message"]'));
  expect(button("Stop")).toBeTruthy(); await click(button("Stop")); expect(button("Stop")).toBeFalsy();
});
