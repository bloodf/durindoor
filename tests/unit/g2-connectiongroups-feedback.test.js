// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { within } from "@testing-library/dom";
import ConnectionGroupsPanel from "../../src/app/(dashboard)/dashboard/combos/ConnectionGroupsPanel.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const json = (body, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body });
const click = async (element) => { await act(async () => element.click()); };

describe("connection group failure feedback and retry", () => {
  let host;
  let root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });


  it("retains a later mutation failure when an earlier refresh completes", async () => {
    const connections = [{ id: "conn-a", name: "Connection A" }, { id: "conn-b", name: "Connection B" }];
    const original = [{ id: "group-a", name: "Group A", connectionIds: ["conn-a"] }, { id: "group-b", name: "Group B", connectionIds: ["conn-b"] }];
    const afterA = [{ ...original[0], connectionIds: [] }, original[1]];
    let reads = 0;
    let bWrites = 0;
    let finishARefresh;
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      if (!init?.method) {
        reads += 1;
        if (reads === 1) return json({ groups: original });
        if (reads === 2) return new Promise((resolve) => { finishARefresh = resolve; });
        return json({ groups: afterA.map((group) => ({ ...group, connectionIds: [] })) });
      }
      if (url.endsWith("group-b") && ++bWrites === 1) return json({ error: "Group B update failed" }, false);
      return json({ success: true });
    }));
    await act(async () => root.render(React.createElement(ConnectionGroupsPanel, { connections })));
    await click(within(host).getByRole("button", { name: "Remove Connection A (conn-a)" }));
    await click(within(host).getByRole("button", { name: "Remove Connection B (conn-b)" }));
    expect(within(host).getByRole("alert").textContent).toBe("Group B update failed");
    await act(async () => finishARefresh(json({ groups: afterA })));
    expect(within(host).getByRole("alert").textContent).toBe("Group B update failed");
    expect(within(host).getByText("Connection B (conn-b)").textContent).toBe("Connection B (conn-b)");
    await click(within(host).getByRole("button", { name: "Remove Connection B (conn-b)" }));
    expect(within(host).queryByRole("alert")).toBeNull();
    expect(within(host).queryByText("Connection B (conn-b)")).toBeNull();
  });

  it.each(["PUT", "DELETE"])("retains failed %s state, then clears feedback after confirmed retry", async (method) => {
    const original = [{ id: "group-1", name: "Fixture group", connectionIds: ["fixture-connection"] }];
    const updated = method === "DELETE" ? [] : [{ ...original[0], connectionIds: [] }];
    let groups = original;
    let finish;
    const onGroupsChange = vi.fn();
    const fetchMock = vi.fn(async (url, init) => {
      if (!init?.method) return json({ groups });
      return new Promise((resolve) => { finish = resolve; });
    });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(React.createElement(ConnectionGroupsPanel, {
      connections: [{ id: "fixture-connection", name: "Fixture connection" }], onGroupsChange,
    })));
    const action = () => method === "PUT"
      ? within(host).getByRole("button", { name: "Remove Fixture connection (fixture-)" })
      : within(document.body.querySelector("dialog")).getByRole("button", { name: "Delete", exact: true });
    if (method === "DELETE") await click(within(host).getByRole("button", { name: "Delete", exact: true }));
    await click(action());
    await act(async () => finish(json({ error: "Fixture group update failed" }, false)));
    expect(within(host).getByRole("alert").textContent).toBe("Fixture group update failed");
    expect(within(host).getByText("Fixture group").textContent).toBe("Fixture group");
    expect(within(host).getByText("Fixture connection (fixture-)").textContent).toBe("Fixture connection (fixture-)");
    expect(onGroupsChange.mock.calls).toEqual([[original]]);
    if (method === "DELETE") expect(document.body.querySelector("dialog").open).toBe(true);
    await click(action());
    // Pending retry must retain the failed data until the server confirms success.
    expect(onGroupsChange.mock.calls).toEqual([[original]]);
    expect(within(host).getByRole("alert").textContent).toBe("Fixture group update failed");
    groups = updated;
    await act(async () => finish(json({ success: true })));
    expect(within(host).queryByRole("alert")).toBeNull();
    expect(onGroupsChange.mock.calls).toEqual([[original], [updated]]);
    expect(within(host).queryByText("Fixture connection (fixture-)")).toBeNull();
    if (method === "DELETE") {
      expect(document.body.querySelector("dialog")).toBeNull();
      expect(within(host).getByText("No connection groups yet").textContent).toBe("No connection groups yet");
    } else {
      expect(within(host).getByText("No members").textContent).toBe("No members");
    }
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method).map(([url, init]) => [url, init.method]))
      .toEqual([["/api/connection-groups/group-1", method], ["/api/connection-groups/group-1", method]]);
  });
});
