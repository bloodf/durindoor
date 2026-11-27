// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Modal from "@/app/(dashboard)/dashboard/providers/[id]/CookieImportModal.js";
import { FREE_PROVIDERS, WEB_COOKIE_PROVIDERS } from "@/shared/constants/providers.js";
let root;
afterEach(async () => { if (root) await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });
it.each([["veoaifree-web", FREE_PROVIDERS["veoaifree-web"].cookieImport, "apikey"], ["grok-web", WEB_COOKIE_PROVIDERS?.["grok-web"]?.cookieImport, "cookie"]])("pairs only eligible %s updates", async (provider, supplied, authType) => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const contract = supplied ?? { origin: "https://grok.com", cookieNames: ["sso"], cookiePrefixes: [] };
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ pairing: { token: "fixture" } }) }));
  vi.stubGlobal("fetch", fetch);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(React.createElement(Modal, { isOpen: true, provider, providerName: "Fixture", importContract: contract, connections: [{ id: "yes", name: "eligible", provider, authType }, ...["none", "oauth"].map((type) => ({ id: type, provider, authType: type })), { id: "foreign", provider: "other", authType }], onClose: vi.fn() })));
  const click = async (text) => act(async () => [...document.querySelectorAll("button")].find((node) => node.textContent.trim() === text).click());
  await click("Replace cookies");
  const select = document.querySelector("select");
  expect([...select.options].map((option) => option.value)).toEqual(["", "yes"]);
  await act(async () => { select.value = "yes"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  const extension = [...document.querySelectorAll("button")].find((node) => /extension/i.test(node.textContent));
  await act(async () => extension.click());
  const pair = [...document.querySelectorAll("button")].find((node) => /pairing/i.test(node.textContent));
  await act(async () => pair.click());
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ provider, action: "update", connectionId: "yes" });
});
