// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import NetworkNodeStatus, { toNodeHealth, normalizeModelNames } from "@/app/(dashboard)/dashboard/providers/[id]/NetworkNodeStatus.js";

let root;
let host;
const connection = { id: "c1", name: "Lab Ollama", provider: "ollama-local" };
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const health = (state, error = null) => json({
  timestamp: "2026-11-19T10:00:00.000Z",
  providers: [{ id: "c1", provider: "ollama-local", name: "Lab Ollama", state, error }],
});
const byLabel = (label) => host.querySelector(`[aria-label="${label}"]`);
const buttonText = (label) => [...host.querySelectorAll("button")].find((node) => node.textContent.trim() === label);
const flush = () => act(async () => { await Promise.resolve(); });

/** Route table keyed by "METHOD path"; the value is a response or a function returning one. */
function stubRoutes(routes) {
  const fetch = vi.fn(async (url, init = {}) => {
    const key = `${init.method || "GET"} ${String(url).split("?")[0]}`;
    const route = routes[key];
    if (!route) throw new Error(`Unexpected request: ${key}`);
    return typeof route === "function" ? route(url, init) : route;
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

async function render(props = {}) {
  await act(async () => root.render(React.createElement(NetworkNodeStatus, { connection, ...props })));
  await flush();
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("network node health mapping", () => {
  it("collapses monitor states onto healthy, unreachable and error", () => {
    expect(toNodeHealth("healthy")).toBe("healthy");
    expect(toNodeHealth("down")).toBe("unreachable");
    expect(toNodeHealth("blocked")).toBe("unreachable");
    expect(toNodeHealth("degraded")).toBe("error");
    expect(toNodeHealth("unconfigured")).toBe("error");
    expect(toNodeHealth("unknown")).toBe("unknown");
  });

  it("normalizes string and object model lists without duplicates", () => {
    expect(normalizeModelNames(["a", { id: "b" }, { name: "c" }, "a", "", null])).toEqual(["a", "b", "c"]);
    expect(normalizeModelNames(undefined)).toEqual([]);
  });
});

describe("NetworkNodeStatus", () => {
  it("shows a loading state while models and health are pending", async () => {
    stubRoutes({
      "GET /api/providers/c1/models": () => new Promise(() => {}),
      "GET /api/health/providers": () => new Promise(() => {}),
    });
    await render();
    expect(host.textContent).toContain("Loading models");
    expect(host.textContent).toContain("Health: checking");
  });

  it("lists models and a healthy status with the last-checked time", async () => {
    stubRoutes({
      "GET /api/providers/c1/models": json({ models: [{ id: "llama3" }, { id: "qwen3" }] }),
      "GET /api/health/providers": health("healthy"),
    });
    await render();
    expect(host.textContent).toContain("Health: healthy");
    expect(host.textContent).toContain("Last checked");
    expect(host.querySelector("time").getAttribute("datetime")).toBe("2026-11-19T10:00:00.000Z");
    const items = [...byLabel("Models on Lab Ollama").querySelectorAll("li")].map((li) => li.textContent);
    expect(items).toEqual(["llama3", "qwen3"]);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows an empty state when the node reports no models", async () => {
    stubRoutes({
      "GET /api/providers/c1/models": json({ models: [] }),
      "GET /api/health/providers": health("healthy"),
    });
    await render();
    expect(host.textContent).toContain("No models found on this node.");
  });

  it("shows an unreachable node and its error", async () => {
    stubRoutes({
      "GET /api/providers/c1/models": json({ error: "connect ECONNREFUSED" }, 502),
      "GET /api/health/providers": health("down", "connect ECONNREFUSED"),
    });
    await render();
    expect(host.textContent).toContain("Health: unreachable");
    const alert = host.querySelector('[role="alert"]');
    expect(alert.textContent).toContain("connect ECONNREFUSED");
    expect(buttonText("Retry")).toBeTruthy();
  });

  it("shows an error state for a node that answers but rejects the request", async () => {
    stubRoutes({
      "GET /api/providers/c1/models": json({ models: ["m"] }),
      "GET /api/health/providers": health("degraded", "API key unauthorized"),
    });
    await render();
    expect(host.textContent).toContain("Health: error");
    expect(host.textContent).toContain("API key unauthorized");
  });

  it("reports when the health payload cannot be loaded", async () => {
    stubRoutes({
      "GET /api/providers/c1/models": json({ models: ["m"] }),
      "GET /api/health/providers": json({ error: "Unable to compute provider health" }, 500),
    });
    await render();
    expect(host.textContent).toContain("Health: not checked");
    expect(host.querySelector('[role="alert"]').textContent).toContain("Unable to compute provider health");
  });

  it("Retry reloads models after a load failure", async () => {
    let calls = 0;
    stubRoutes({
      "GET /api/providers/c1/models": () => (++calls === 1 ? json({ error: "boom" }, 500) : json({ models: ["llama3"] })),
      "GET /api/health/providers": health("healthy"),
    });
    await render();
    await act(async () => buttonText("Retry").click());
    await flush();
    expect(host.textContent).toContain("llama3");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("Test posts to the connection test route and refreshes health with force", async () => {
    let healthState = "down";
    const fetch = stubRoutes({
      "GET /api/providers/c1/models": json({ models: ["llama3"] }),
      "GET /api/health/providers": () => health(healthState),
      "POST /api/providers/c1/test": () => { healthState = "healthy"; return json({ valid: true }); },
    });
    await render();
    expect(host.textContent).toContain("Health: unreachable");
    await act(async () => byLabel("Test Lab Ollama").click());
    await flush();
    expect(fetch.mock.calls.some(([url, init]) => url === "/api/providers/c1/test" && init.method === "POST")).toBe(true);
    expect(fetch.mock.calls.some(([url]) => url === "/api/health/providers?force=1")).toBe(true);
    expect(host.textContent).toContain("Test passed");
    expect(host.textContent).toContain("Health: healthy");
  });

  it("Test reports a failed check", async () => {
    stubRoutes({
      "GET /api/providers/c1/models": json({ models: [] }),
      "GET /api/health/providers": health("down", "timeout"),
      "POST /api/providers/c1/test": json({ valid: false, error: "Connection timed out" }),
    });
    await render();
    await act(async () => byLabel("Test Lab Ollama").click());
    await flush();
    const alert = host.querySelector('[role="alert"]');
    expect(alert.textContent).toBe("Connection timed out");
  });

  it("Remove asks for confirmation, deletes the connection and notifies the parent", async () => {
    const onRemoved = vi.fn();
    const fetch = stubRoutes({
      "GET /api/providers/c1/models": json({ models: ["llama3"] }),
      "GET /api/health/providers": health("healthy"),
      "DELETE /api/providers/c1": json({ message: "Connection deleted successfully" }),
    });
    await render({ onRemoved });
    await act(async () => byLabel("Remove Lab Ollama").click());
    expect(onRemoved).not.toHaveBeenCalled();
    expect(fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    await act(async () => byLabel("Confirm remove Lab Ollama").click());
    await flush();
    expect(fetch.mock.calls.some(([url, init]) => url === "/api/providers/c1" && init.method === "DELETE")).toBe(true);
    expect(onRemoved).toHaveBeenCalledWith("c1");
  });

  it("keeps the node and shows the reason when Remove fails", async () => {
    const onRemoved = vi.fn();
    stubRoutes({
      "GET /api/providers/c1/models": json({ models: ["llama3"] }),
      "GET /api/health/providers": health("healthy"),
      "DELETE /api/providers/c1": json({ error: "Cannot delete the last account" }, 409),
    });
    await render({ onRemoved });
    await act(async () => byLabel("Remove Lab Ollama").click());
    await act(async () => byLabel("Confirm remove Lab Ollama").click());
    await flush();
    expect(onRemoved).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]').textContent).toBe("Cannot delete the last account");
  });
});
