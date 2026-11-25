// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import ConnectionsCard from "../../src/app/(dashboard)/dashboard/providers/components/ConnectionsCard.js";
import { persistConnectionOrder } from "@/shared/utils/connectionReorder";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const rows = (...ids) => ids.map((id) => ({ id }));
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A fetch whose requests stay open until the test answers them. */
function heldFetch() {
  const requests = [];
  const fetchMock = vi.fn((url, init) => new Promise((resolve) => {
    requests.push({ url, body: init?.body && JSON.parse(init.body), answer: (status = 200) => resolve(Response.json({}, { status })) });
  }));
  vi.stubGlobal("fetch", fetchMock);
  return requests;
}

afterEach(() => vi.unstubAllGlobals());

describe("9router#4280: account reorder is persisted in click order", () => {
  it("holds a later move until the earlier write finishes", async () => {
    const requests = heldFetch();
    const first = persistConnectionOrder("openai", rows("b", "a", "c"));
    const second = persistConnectionOrder("openai", rows("b", "c", "a"));
    await flush();
    expect(requests).toHaveLength(1);

    requests[0].answer();
    await first;
    await flush();
    expect(requests.map((r) => r.body.orderedIds)).toEqual([["b", "a", "c"], ["b", "c", "a"]]);
    requests[1].answer();
    await second;
  });

  it("drops moves queued behind a failed write, then accepts new ones", async () => {
    const requests = heldFetch();
    const first = persistConnectionOrder("openai", rows("b", "a"));
    const second = persistConnectionOrder("openai", rows("a", "b"));
    const settled = Promise.allSettled([first, second]);
    await flush();
    requests[0].answer(500);
    expect((await settled).map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(requests).toHaveLength(1);

    const third = persistConnectionOrder("openai", rows("b", "a"));
    await flush();
    expect(requests).toHaveLength(2);
    requests[1].answer();
    await third;
  });

  it("does not queue one provider behind another", async () => {
    const requests = heldFetch();
    const writes = [persistConnectionOrder("openai", rows("a")), persistConnectionOrder("anthropic", rows("z"))];
    await flush();
    expect(requests.map((r) => r.body.providerId)).toEqual(["openai", "anthropic"]);
    requests.forEach((r) => r.answer());
    await Promise.all(writes);
  });

  it("moves a ConnectionsCard account with one atomic write and reloads when it is rejected", async () => {
    const connections = ["First", "Second", "Third"].map((name, i) => ({ id: `c${i}`, name, provider: "openai", priority: i + 1, isActive: true }));
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
      calls.push([init.method || "GET", String(url), init.body]);
      if (url === "/api/providers/reorder") return Response.json({ error: "nope" }, { status: 409 });
      if (url === "/api/providers") return Response.json({ connections });
      return Response.json({});
    }));
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    try {
      await act(async () => root.render(React.createElement(ConnectionsCard, { providerId: "openai", isOAuth: false })));
      await act(async () => {
        container.querySelector("button[aria-label='Move Second up']").click();
        await flush();
      });

      expect(calls.filter(([method]) => method === "PUT")).toEqual([
        ["PUT", "/api/providers/reorder", JSON.stringify({ providerId: "openai", orderedIds: ["c1", "c0", "c2"] })],
      ]);
      expect(calls.filter(([, url]) => url === "/api/providers")).toHaveLength(2);
      expect(container.textContent.indexOf("First")).toBeLessThan(container.textContent.indexOf("Second"));
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
