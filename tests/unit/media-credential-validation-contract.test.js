// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/localDb", () => ({ getProviderNodeById: vi.fn(), getProviderConnectionById: vi.fn() }));
vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({ getKimchiUserAgent: () => "offline", updateKimchiUserAgent: vi.fn() }));
import { POST } from "@/app/api/providers/validate/route.js";
import AddApiKeyModal from "@/app/(dashboard)/dashboard/providers/[id]/AddApiKeyModal.js";
import EditConnectionModal from "@/shared/components/EditConnectionModal.js";
const request = (provider, apiKey = "selected-key", extra = {}, signal) => new Request("http://localhost/api/providers/validate", {
  method: "POST", body: JSON.stringify({ provider, apiKey, ...extra }), signal,
});
let host, root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected request"); }));
});
afterEach(async () => {
  if (root) { await act(async () => root.unmount()); host.remove(); root = null; }
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});
it.each([200, 401, 403, 429, 500, 302, 404])("deAPI uses only an authenticated identity read for HTTP %s", async (status) => {
  fetch.mockResolvedValue(new Response("private upstream body selected-key", { status, headers: { Location: "https://other.example/" } }));
  const data = await (await POST(request("deapi", "selected-key", { connectionId: "other-key", providerSpecificData: { baseUrl: "https://other.example/inference" } }))).json();
  expect(data.valid).toBe(status === 200);
  expect(data.unavailable === true).toBe(![200, 401, 403].includes(status));
  if ([401, 403].includes(status)) expect(data.error).toBe("Invalid API key");
  expect(JSON.stringify(data)).not.toMatch(/private upstream|selected-key/);
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe("https://api.deapi.ai/api/v2/key");
  expect(options).toMatchObject({ method: "GET", redirect: "manual", headers: { Authorization: "Bearer selected-key" } });
  expect(options.body).toBeUndefined();
  expect(options.signal).toBeInstanceOf(AbortSignal);
});
it("keeps concurrent keys isolated", async () => {
  fetch.mockImplementation(async (_url, options) => new Response("", { status: options.headers.Authorization === "Bearer good-key" ? 200 : 401 }));
  const results = await Promise.all(["good-key", "bad-key"].map(async (key) => (await POST(request("deapi", key))).json()));
  expect(results.map((data) => data.valid)).toEqual([true, false]);
});
it.each(["cancel", "deadline"])("deAPI reports %s as unavailable without transport details", async (mode) => {
  const controller = new AbortController();
  const deadline = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  fetch.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error("private transport selected-key")), { once: true });
    started();
  }));
  const pending = POST(request("deapi", "selected-key", {}, controller.signal));
  await ready;
  expect(AbortSignal.timeout).toHaveBeenCalledWith(10_000);
  (mode === "cancel" ? controller : deadline).abort();
  const data = await (await pending).json();
  expect(data).toMatchObject({ valid: false, unavailable: true });
  expect(JSON.stringify(data)).not.toMatch(/private transport|selected-key/);
});
it.each(["playht", "cartesia"])("%s never submits inference when verification is unsupported", async (provider) => {
  const data = await (await POST(request(provider))).json();
  expect(data).toMatchObject({ valid: false, skipped: true });
  expect(data.note).toContain("unverified");
  expect(fetch).not.toHaveBeenCalled();
});
it.each([["fal-ai", "https://api.fal.ai/v1/models?limit=1", "Key selected-key"], ["huggingface", "https://huggingface.co/api/whoami-v2", "Bearer selected-key"]])("%s retains its read-only check ahead of fallback", async (provider, url, authorization) => {
  fetch.mockResolvedValue(Response.json({}));
  expect(await (await POST(request(provider))).json()).toEqual({ valid: true, error: null });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe(url);
  expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "manual", headers: { Authorization: authorization } });
  expect(fetch.mock.calls[0][1].body).toBeUndefined();
});
it.each(["add", "edit"].flatMap((form) => [
  ...[200, 401, 403, 429, 500, null].map((status) => [form, "deapi", status]),
  [form, "playht", null],
  [form, "renderhour", null],
]))("%s %s displays the real route outcome for %s and saves the correct status", async (form, provider, status) => {
  const key = provider === "renderhour" ? "rh_selected-key" : "selected-key";
  const skipped = provider === "playht" || provider === "renderhour";
  const upstream = vi.fn(async () => {
    if (status === null) throw new Error("private transport");
    return new Response("private upstream", { status });
  });
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (url === "/api/providers/validate") return POST(new Request("http://localhost/api/providers/validate", options));
    return upstream(url, options);
  }));
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  const onSave = vi.fn();
  const props = { isOpen: true, proxyPools: [], onSave, onClose: vi.fn() };
  await act(async () => root.render(form === "add"
    ? React.createElement(AddApiKeyModal, { ...props, provider, providerName: provider })
    : React.createElement(EditConnectionModal, { ...props, connection: { id: "c1", provider, authType: "apikey", name: "Test", priority: 1, providerSpecificData: {} } })));
  const input = document.querySelector('input[type="password"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, key);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const click = async (text) => {
    const button = [...document.querySelectorAll("button")].find((node) => node.textContent.trim().endsWith(text));
    expect(button).toBeTruthy();
    await act(async () => button.click());
  };
  await click("Check");
  const label = skipped ? "unverified" : status === 200 ? "Valid" : [401, 403].includes(status) ? "Invalid" : "Unavailable";
  expect(document.body.textContent).toContain(label);
  expect(document.body.textContent).not.toMatch(/private upstream|private transport/);
  if (label === "Unavailable" || label === "unverified") expect(document.body.textContent).not.toContain("Invalid");
  await click("Save");
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSave.mock.calls[0][0].apiKey).toBe(key);
  if (status === 200) expect(onSave.mock.calls[0][0].testStatus).toBe("active");
  else expect(onSave.mock.calls[0][0].testStatus).not.toBe("active");
  if (skipped) {
    expect(onSave.mock.calls[0][0].testStatus).toBe("unknown");
    expect(upstream).not.toHaveBeenCalled();
  } else expect(upstream.mock.calls.every(([, options]) => options.method === "GET" && options.body === undefined)).toBe(true);
});

it.each([
  ["deepgram", "https://api.deepgram.com/v1/projects", { Authorization: "Token selected-key" }],
  ["elevenlabs", "https://api.elevenlabs.io/v1/user", { "xi-api-key": "selected-key" }],
].flatMap(([provider, url, headers]) => [200, 401, 403, 429, 500, 302].map((status) => [provider, url, headers, status])))
("%s authenticates only an account read at HTTP %s", async (provider, url, headers, status) => {
  fetch.mockResolvedValue(new Response("private account details", { status }));
  const data = await (await POST(request(provider))).json();
  expect(data.valid).toBe(status === 200);
  expect(data.unavailable === true).toBe(![200, 401, 403].includes(status));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe(url);
  expect(fetch.mock.calls[0][1]).toMatchObject({ method: "GET", redirect: "manual", headers });
  expect(fetch.mock.calls[0][1].body).toBeUndefined();
  expect(JSON.stringify(data)).not.toContain("private account");
});
