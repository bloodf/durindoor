// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import ProviderLogo from "../../src/shared/ui/components/ProviderLogo.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function render(provider) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(ProviderLogo, { provider, size: 32 })));
  return { container, root };
}

async function dispose(root, container) {
  await act(async () => root.unmount());
  container.remove();
}

describe("Durin DS ProviderLogo", () => {
  it("uses existing marks for case-insensitive aliases", async () => {
    const { container, root } = await render("CC");

    expect(container.querySelector("img").getAttribute("src")).toBe("/providers/claude.svg");
    expect(container.querySelector("img").getAttribute("alt")).toBe("claude");

    await dispose(root, container);
  });

  it("renders unknown providers as a letter tile without an image request", async () => {
    const { container, root } = await render("totally-unknown-provider");

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("span").textContent).toBe("T");

    await dispose(root, container);
  });

  it("falls back after an unexpected mark load error", async () => {
    const { container, root } = await render("claude");
    const image = container.querySelector("img");

    await act(async () => image.dispatchEvent(new Event("error")));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("span").textContent).toBe("C");

    await dispose(root, container);
  });
});
