// @vitest-environment happy-dom
// Visitors cannot sign in to the demo unless the accepted password is legible
// on the login page itself. These contracts pin that the notice shows the
// password the mocked backend actually checks, and that Copy puts that exact
// value on the clipboard.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import DemoPasswordNotice from "../../website/src/components/demo/DemoPasswordNotice.jsx";
import { DEMO_PASSWORD } from "../../website/src/mock/demoPassword.js";
import { createRouter } from "../../website/src/mock/router.js";
import { registerAll } from "../../website/src/mock/handlers/index.js";
import { store } from "../../website/src/mock/store.js";
import { toResponse } from "../../website/src/mock/http.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots = [];

function render(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push([root, container]);
  act(() => root.render(element));
  return container;
}

function copyButton(container) {
  return [...container.querySelectorAll("button")].find((node) => /copy|copied/i.test(node.textContent));
}

async function login(password) {
  const router = createRouter();
  registerAll(router, { store, external: () => {} });
  const url = new URL("/api/auth/login", "http://demo.local");
  const found = router.match("POST", url.pathname);
  const result = await found.route.handler({ method: "POST", url, params: {}, query: {}, searchParams: url.searchParams, body: { password } });
  return toResponse(result).status;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  act(() => roots.forEach(([root]) => root.unmount()));
  roots.forEach(([, container]) => container.remove());
  roots.length = 0;
  vi.restoreAllMocks();
});

describe("demo password notice", () => {
  it("shows the password the mocked backend accepts", async () => {
    const container = render(React.createElement(DemoPasswordNotice));

    expect(container.textContent).toContain(DEMO_PASSWORD);
    await expect(login(container.querySelector("code").textContent)).resolves.toBe(200);
  });

  it("rejects any other password, so the displayed value is load-bearing", async () => {
    await expect(login(`${DEMO_PASSWORD}-wrong`)).resolves.toBe(401);
  });

  it("copies the exact password and confirms the copy", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const container = render(React.createElement(DemoPasswordNotice));

    await act(async () => copyButton(container).click());

    expect(writeText).toHaveBeenCalledWith(DEMO_PASSWORD);
    expect(copyButton(container).textContent).toContain("Copied");
  });

  it("keeps the password readable when the clipboard is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async () => { throw new Error("denied"); } },
      configurable: true,
    });
    const container = render(React.createElement(DemoPasswordNotice));

    await act(async () => copyButton(container).click());

    expect(container.textContent).toContain(DEMO_PASSWORD);
    expect(copyButton(container).textContent).toContain("Copy");
  });
});
