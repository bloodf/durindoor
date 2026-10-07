// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "../../website/node_modules/react/index.js";
import { createRoot } from "../../website/node_modules/react-dom/client.js";

vi.mock("../../website/node_modules/next/dynamic.js", () => ({ default: () => function GatewayScene({ onFailure, onReady }) {
  return React.createElement("div", null, React.createElement("button", { onClick: onFailure }, "Simulate context loss"), React.createElement("button", { onClick: onReady }, "First frame ready"));
} }));
import HeroCanvas from "../../website/src/components/home/hero/HeroCanvas.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, host;
function render({ reduced = false, webgl = true } = {}) {
  const listeners = new Set();
  const query = { matches: reduced, addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) };
  vi.spyOn(window, "matchMedia").mockReturnValue(query);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(webgl ? {} : null);
  host = document.createElement("div"); document.body.appendChild(host);
  root = createRoot(host);
  const onAvailability = vi.fn();
  act(() => root.render(React.createElement(HeroCanvas, { onAvailability })));
  return { query, listeners, onAvailability };
}
afterEach(() => { act(() => root?.unmount()); host?.remove(); vi.restoreAllMocks(); });

describe("optional gateway animation", () => {
  it("swaps the poster after the first frame without scroll input", () => {
    const { onAvailability } = render();
    expect(host.querySelector(".gateway-stage").dataset.ready).toBe("false");
    expect(onAvailability).toHaveBeenLastCalledWith(false);
    act(() => [...host.querySelectorAll("button")].find((button) => button.textContent === "First frame ready").click());
    expect(host.querySelector(".gateway-stage").dataset.ready).toBe("true");
    expect(onAvailability).toHaveBeenLastCalledWith(true);
  });
  it("keeps the static gate visible without WebGL", () => {
    const { onAvailability } = render({ webgl: false });
    expect(onAvailability).toHaveBeenLastCalledWith(false);
    expect(host.querySelector("img").getAttribute("src")).toBe("/brand/durindoor-gateway.webp");
    expect(host.querySelector("button")).toBeNull();
  });
  it("respects reduced motion and responds to a changed preference", () => {
    const { query, listeners } = render({ reduced: true });
    expect(host.querySelector("button")).toBeNull();
    act(() => { query.matches = false; listeners.forEach((fn) => fn()); });
    expect(host.querySelector("button")).not.toBeNull();
    act(() => { query.matches = true; listeners.forEach((fn) => fn()); });
    expect(host.querySelector("button")).toBeNull();
    expect(host.querySelector("img")).not.toBeNull();
    act(() => root.unmount()); root = null;
    expect(listeners.size).toBe(0);
  });
  it("returns to static artwork when the canvas loses its context", () => {
    const { onAvailability } = render();
    expect(onAvailability).toHaveBeenLastCalledWith(false);
    act(() => [...host.querySelectorAll("button")].find((button) => button.textContent === "First frame ready").click());
    expect(onAvailability).toHaveBeenLastCalledWith(true);
    act(() => host.querySelector("button").click());
    expect(onAvailability).toHaveBeenLastCalledWith(false);
    expect(host.querySelector("button")).toBeNull();
    expect(host.querySelector("img")).not.toBeNull();
  });
});
