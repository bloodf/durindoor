// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import {
  installStoryNavigation,
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
  useSelectedLayoutSegment,
  useSelectedLayoutSegments,
} from "../../.storybook/next-navigation.js";
import StorybookImage from "../../.storybook/next-image.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let cleanup;
const roots = [];

function NavigationConsumer({ parallelRouteKey, onReady }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const params = useParams();
  const segment = useSelectedLayoutSegment(parallelRouteKey);
  const segments = useSelectedLayoutSegments(parallelRouteKey);
  React.useEffect(() => {
    onReady?.(router);
  }, [onReady, router]);
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      "button",
      { type: "button", onClick: () => router.push("/dashboard/usage?filter=a%2Bb&value=x%3Dy#details") },
      `${pathname}|${search.get("filter")}|${search.get("value")}|${params.team}|${segment}|${segments.join(",")}`,
    ),
    React.createElement("button", { type: "button", onClick: () => router.back() }, "Back"),
    React.createElement("button", { type: "button", onClick: () => router.forward() }, "Forward"),
  );
}

async function render(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push({ container, root });
  await act(async () => { root.render(element); });
  return { container };
}

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
  while (roots.length) {
    const { container, root } = roots.pop();
    await act(async () => { root.unmount(); });
    container.remove();
  }
});

describe("Storybook next/navigation fixture", () => {
  it("does not retrigger query effects when only local state changes", async () => {
    cleanup = installStoryNavigation({ pathname: "/dashboard/timeline", query: "?pageSize=all" });
    let effects = 0;
    function QueryConsumer() {
      const query = useSearchParams();
      const [count, setCount] = React.useState(0);
      React.useEffect(() => { effects += 1; }, [query]);
      return React.createElement("button", { onClick: () => setCount(count + 1) }, `${query.get("pageSize")}:${count}`);
    }
    const { container } = await render(React.createElement(QueryConsumer));
    await act(async () => container.querySelector("button").click());
    expect(container.textContent).toBe("all:1");
    expect(effects).toBe(1);
  });
  it("rerenders real React consumers after push and preserves native URL query and hash semantics", async () => {
    const hostHref = globalThis.location.href;
    cleanup = installStoryNavigation({
      pathname: "/dashboard/usage",
      query: "?period=24h",
      params: { team: "ops" },
      selectedLayoutSegments: { children: ["usage", "details"] },
    });
    const { container } = await render(React.createElement(NavigationConsumer));
    expect(container.querySelector("button").textContent).toBe("/dashboard/usage|null|null|ops|usage|usage,details");

    await act(async () => container.querySelector("button").click());
    expect(container.querySelector("button").textContent).toBe("/dashboard/usage|a+b|x=y|ops|usage|usage,details");
    // Virtual stack carries the hash; host window.location is untouched.
    expect(globalThis.__STORYBOOK_NAV__.__current()).toBe("/dashboard/usage?filter=a%2Bb&value=x%3Dy#details");
    expect(globalThis.location.href).toBe(hostHref);
  });

  it("selects explicit parallel-route segments per key and rejects non-relative navigation", async () => {
    const hostHref = globalThis.location.href;
    cleanup = installStoryNavigation({
      pathname: "/dashboard",
      selectedLayoutSegments: { children: ["dashboard"], modal: ["settings"] },
    });
    let router;
    const { container } = await render(
      React.createElement(NavigationConsumer, { parallelRouteKey: "modal", onReady: (value) => { router = value; } }),
    );
    expect(container.querySelector("button").textContent).toBe("/dashboard|null|null|undefined|settings|settings");
    expect(() => router.push("https://example.com/leak")).toThrow(/same-origin relative/);
    expect(() => router.push("//cdn.example.com/leak")).toThrow(/same-origin relative/);
    expect(globalThis.location.href).toBe(hostHref);
  });

  it("walks the virtual history stack through back and forward from a mounted consumer (A-B-A cleanup)", async () => {
    const hostHref = globalThis.location.href;
    cleanup = installStoryNavigation({ pathname: "/", params: { team: "ops" } });
    const { container } = await render(React.createElement(NavigationConsumer));
    expect(container.querySelector("button").textContent).toBe("/|null|null|ops|null|");

    // A → B: push to /dashboard/usage
    await act(async () => container.querySelector("button").click());
    expect(container.querySelector("button").textContent).toBe("/dashboard/usage|a+b|x=y|ops|null|");
    expect(globalThis.__STORYBOOK_NAV__.__current()).toBe("/dashboard/usage?filter=a%2Bb&value=x%3Dy#details");

    // B → A: back returns to /
    await act(async () => container.querySelectorAll("button")[1].click());
    expect(container.querySelector("button").textContent).toBe("/|null|null|ops|null|");
    expect(globalThis.__STORYBOOK_NAV__.__current()).toBe("/");

    // A → B: forward returns to /dashboard/usage
    await act(async () => container.querySelectorAll("button")[2].click());
    expect(container.querySelector("button").textContent).toBe("/dashboard/usage|a+b|x=y|ops|null|");

    // Host URL never moved.
    expect(globalThis.location.href).toBe(hostHref);
  });

  it("accepts static-import and local image sources, rejects object and protocol-relative remote variants", () => {
    const staticImage = StorybookImage({ src: { src: "/assets/logo.png" }, alt: "Logo" });
    const localImage = StorybookImage({ src: "/_next/image.png", alt: "Preview" });
    const dataImage = StorybookImage({ src: "data:image/png;base64,AAAA", alt: "Inline" });
    expect(staticImage.props.src).toBe("/assets/logo.png");
    expect(localImage.props.src).toBe("/_next/image.png");
    expect(StorybookImage({ src: "/durindoor-wordmark.png", alt: "DurinDoor" }).props.src).toBe("/durindoor-wordmark.png");
    expect(dataImage.props.src).toBe("data:image/png;base64,AAAA");
    expect(() => StorybookImage({ src: { src: "https://cdn.example.com/logo.png" }, alt: "Logo" })).toThrow(/remote or non-asset/);
    expect(() => StorybookImage({ src: "//cdn.example.com/logo.png", alt: "Logo" })).toThrow(/remote or non-asset/);
    expect(() => StorybookImage({ src: "/assets/logo.png" })).toThrow(/requires alt/);
  });
});
