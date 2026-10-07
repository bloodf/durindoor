// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "../../website/node_modules/react/index.js";
import { createRoot } from "../../website/node_modules/react-dom/client.js";

vi.mock("../../website/node_modules/next/dynamic.js", () => ({ default: () => function GatewayScene({ onFailure }) {
  return React.createElement("button", { onClick: onFailure }, "Simulate context loss");
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
    expect(onAvailability).toHaveBeenLastCalledWith(true);
    act(() => host.querySelector("button").click());
    expect(onAvailability).toHaveBeenLastCalledWith(false);
    expect(host.querySelector("button")).toBeNull();
    expect(host.querySelector("img")).not.toBeNull();
  });
});
