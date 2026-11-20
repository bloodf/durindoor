// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import ProviderIcon from "../../src/shared/components/ProviderIcon.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("compatible provider icon fallback", () => {
  it("tries the node icon, then the generic icon, then text and resets on change", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const render = (src) => React.createElement(ProviderIcon, {
      src, fallbackSrc: "/providers/oai-cc.png", alt: "Custom", fallbackText: "CU",
    });
    await act(() => root.render(render("/providers/openai-compatible-one.png")));
    expect(container.querySelector("img").getAttribute("src")).toBe("/providers/openai-compatible-one.png");
    await act(() => container.querySelector("img").dispatchEvent(new Event("error")));
    expect(container.querySelector("img").getAttribute("src")).toBe("/providers/oai-cc.png");
    await act(() => container.querySelector("img").dispatchEvent(new Event("error")));
    expect(container.textContent).toBe("CU");
    await act(() => root.render(render("/providers/openai-compatible-two.png")));
    expect(container.querySelector("img").getAttribute("src")).toBe("/providers/openai-compatible-two.png");
    await act(() => root.unmount());
  });
});
