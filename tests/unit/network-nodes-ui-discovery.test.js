// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import LanDiscoveryPanel, { buildDiscoveryRequest } from "@/app/(dashboard)/dashboard/providers/components/LanDiscoveryPanel.js";

let root;
let host;
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const buttonText = (label) => [...host.querySelectorAll("button")].find((node) => node.textContent.trim() === label);
const flush = () => act(async () => { await Promise.resolve(); });
const setValue = (input, value) => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
const inputByLabel = (label) => {
  const labelNode = [...host.querySelectorAll("label")].find((node) => node.textContent.includes(label));
  return labelNode.control || host.querySelector(`#${labelNode.htmlFor}`);
};

const OLLAMA = { baseUrl: "http://192.168.1.20:11434", host: "192.168.1.20", port: 11434, kind: "ollama", models: ["llama3", "qwen3"] };
const OPENAI = { baseUrl: "http://192.168.1.30:1234/v1", host: "192.168.1.30", port: 1234, kind: "openai-compatible", models: ["local-model"] };

function stubFetch(handler) {
  const fetch = vi.fn(async (url, init = {}) => handler(String(url), init));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

async function render(props = {}) {
  await act(async () => root.render(React.createElement(LanDiscoveryPanel, props)));
}

async function discover(text) {
  await act(async () => setValue(inputByLabel("Hosts or CIDR"), text));
  await act(async () => buttonText("Discover").click());
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

describe("buildDiscoveryRequest", () => {
  it("sends hosts, a CIDR, or reports bad input", () => {
    expect(buildDiscoveryRequest("10.0.0.5, nas.local 10.0.0.6", "")).toEqual({ body: { hosts: ["10.0.0.5", "nas.local", "10.0.0.6"] } });
    expect(buildDiscoveryRequest("192.168.1.0/24", "11434, 1234")).toEqual({ body: { cidr: "192.168.1.0/24", ports: [11434, 1234] } });
    expect(buildDiscoveryRequest("  ", "").error).toMatch(/hosts/i);
    expect(buildDiscoveryRequest("10.0.0.5", "99999").error).toMatch(/ports/i);
  });
});

describe("LanDiscoveryPanel", () => {
  it("scans nothing until the operator presses Discover", async () => {
    const fetch = stubFetch(() => { throw new Error("no request expected"); });
    await render();
    expect(fetch).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Discover on LAN");
  });

  it("asks for input before sending a request", async () => {
    const fetch = stubFetch(() => { throw new Error("no request expected"); });
    await render();
    await act(async () => buttonText("Discover").click());
    expect(fetch).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]').textContent).toMatch(/hosts/i);
  });

  it("shows a loading state while the scan is running", async () => {
    stubFetch(() => new Promise(() => {}));
    await render();
    await discover("192.168.1.20");
    expect(host.querySelector('[role="status"]').textContent).toContain("Scanning");
    const scanning = [...host.querySelectorAll("button")].find((node) => node.textContent.includes("Scanning"));
    expect(scanning.disabled).toBe(true);
  });

  it("explains how to turn discovery on when the server answers 403 lan_discovery_disabled", async () => {
    stubFetch(() => json({ error: "lan_discovery_disabled" }, 403));
    await render();
    await discover("192.168.1.20");
    const notice = host.querySelector('[data-testid="lan-discovery-disabled"]');
    expect(notice.textContent).toContain("LAN discovery is turned off");
    expect(notice.textContent).toContain("lanDiscoveryEnabled");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows an empty state when nothing answers", async () => {
    stubFetch(() => json({ candidates: [] }));
    await render();
    await discover("192.168.1.0/24");
    expect(host.querySelector('[data-testid="lan-discovery-empty"]')).not.toBeNull();
    expect(host.querySelector("ul")).toBeNull();
  });

  it("shows the server error for other failures", async () => {
    stubFetch(() => json({ error: "CIDR range too large" }, 400));
    await render();
    await discover("10.0.0.0/8");
    expect(host.querySelector('[role="alert"]').textContent).toBe("CIDR range too large");
  });

  it("shows a network failure", async () => {
    stubFetch(() => { throw new Error("offline"); });
    await render();
    await discover("192.168.1.20");
    expect(host.querySelector('[role="alert"]').textContent).toBe("offline");
  });

  it("posts hosts and lists candidates with their models", async () => {
    const fetch = stubFetch(() => json({ candidates: [OLLAMA, OPENAI] }));
    await render();
    await discover("192.168.1.20, 192.168.1.30");
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/api/providers/lan-discovery");
    expect(JSON.parse(init.body)).toEqual({ hosts: ["192.168.1.20", "192.168.1.30"] });
    const items = host.querySelectorAll("ul li");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("http://192.168.1.20:11434");
    expect(items[0].textContent).toContain("llama3, qwen3");
    expect(items[1].textContent).toContain("OpenAI-compatible");
  });

  it("adds an Ollama candidate as a connection with its host base URL", async () => {
    const onAdded = vi.fn();
    const fetch = stubFetch((url) => (url === "/api/providers/lan-discovery" ? json({ candidates: [OLLAMA] }) : json({ connection: { id: "c1" } }, 201)));
    await render({ onAdded });
    await discover("192.168.1.20");
    await act(async () => host.querySelector('[aria-label="Add http://192.168.1.20:11434"]').click());
    await flush();
    const [url, init] = fetch.mock.calls[1];
    expect(url).toBe("/api/providers");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ provider: "ollama-local", apiKey: "", providerSpecificData: { baseUrl: "http://192.168.1.20:11434" } });
    expect(onAdded).toHaveBeenCalledWith(OLLAMA);
    expect(host.textContent).toContain("Added");
  });

  it("adds an OpenAI-compatible candidate as a node without an API key", async () => {
    const fetch = stubFetch((url) => (url === "/api/providers/lan-discovery" ? json({ candidates: [OPENAI] }) : json({ node: { id: "n1" } }, 201)));
    await render();
    await discover("192.168.1.30");
    await act(async () => host.querySelector('[aria-label="Add http://192.168.1.30:1234/v1"]').click());
    await flush();
    const [url, init] = fetch.mock.calls[1];
    expect(url).toBe("/api/provider-nodes");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ type: "openai-compatible", baseUrl: "http://192.168.1.30:1234/v1", prefix: "lan-192-168-1-30-1234" });
    expect(body).not.toHaveProperty("apiKey");
  });

  it("keeps the candidate and shows the reason when adding fails", async () => {
    const onAdded = vi.fn();
    stubFetch((url) => (url === "/api/providers/lan-discovery" ? json({ candidates: [OPENAI] }) : json({ error: "Prefix already in use" }, 409)));
    await render({ onAdded });
    await discover("192.168.1.30");
    await act(async () => host.querySelector('[aria-label="Add http://192.168.1.30:1234/v1"]').click());
    await flush();
    expect(onAdded).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]').textContent).toBe("Prefix already in use");
    expect(host.querySelector('[aria-label="Add http://192.168.1.30:1234/v1"]')).not.toBeNull();
  });
});
