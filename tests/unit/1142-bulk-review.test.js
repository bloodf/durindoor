// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import BulkReviewModal from "@/app/(dashboard)/dashboard/providers/[id]/components/BulkReviewModal.js";
import PersistedTestResult from "@/app/(dashboard)/dashboard/providers/[id]/components/PersistedTestResult.js";
import { buildBulkReview, reviewedTargets } from "@/app/(dashboard)/dashboard/providers/[id]/components/bulkReview.js";
import {
  loadProviderTestResult,
  providerTestKey,
  saveProviderTestResult,
} from "@/app/(dashboard)/dashboard/providers/[id]/components/providerTestStore.js";
import { connectionPage } from "@/app/(dashboard)/dashboard/providers/[id]/connectionPagination.js";

const h = React.createElement;
const connections = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, name: `Account ${i}`, isActive: true }));

let root;
let host;
const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;
const button = (label) => [...document.querySelectorAll("button")].find((node) => node.textContent.trim() === label);

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    dump: () => Object.fromEntries(map),
  };
}

/** Mirrors the page flow: pick targets, review, then Confirm applies the reviewed ids only. */
function Harness({ selectedIds, onApply, visible }) {
  const [state, setState] = useState(null);
  const targets = connections.filter((conn) => selectedIds.includes(conn.id));
  return h("div", null,
    h("button", { onClick: () => setState({ review: buildBulkReview({ action: "disable", targets, visibleConnections: visible }) }) }, "open"),
    h(BulkReviewModal, {
      review: state?.review ?? null,
      onCancel: () => setState(null),
      onConfirm: () => {
        const reviewed = reviewedTargets(state.review, connections);
        setState(null);
        onApply(reviewed.map((conn) => conn.id));
      },
    }));
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalClose;
  vi.unstubAllGlobals();
});

describe("bulk review summary #1142", () => {
  it("names the action, count, connections and how many are hidden by the page", () => {
    const page = connectionPage(connections, 1).items;
    const review = buildBulkReview({ action: "delete", targets: [connections[0], connections[27], connections[28]], visibleConnections: page });
    expect(review).toMatchObject({ action: "delete", label: "Delete", count: 3, hiddenCount: 2 });
    expect(review.names).toEqual(["Account 0", "Account 27", "Account 28"]);
    expect(review.ids).toEqual(["c0", "c27", "c28"]);
  });

  it("renders the summary, the names and the hidden count in the review dialog", async () => {
    const review = buildBulkReview({ action: "proxy", detail: "unbind proxy", targets: connections.slice(0, 3), visibleConnections: connections.slice(0, 1) });
    await act(async () => root.render(h(BulkReviewModal, { review, onConfirm: () => {}, onCancel: () => {} })));
    const text = document.body.textContent;
    expect(text).toContain("Apply proxy 3 connections: unbind proxy.");
    expect(text).toContain("2 of these are hidden by the current filter or page.");
    for (const name of ["Account 0", "Account 1", "Account 2"]) expect(text).toContain(name);
  });

  it("omits the hidden note when every target is visible", async () => {
    const review = buildBulkReview({ action: "enable", targets: connections.slice(0, 2), visibleConnections: connections });
    await act(async () => root.render(h(BulkReviewModal, { review, onConfirm: () => {}, onCancel: () => {} })));
    expect(document.querySelector("[data-testid=bulk-review-hidden]")).toBeNull();
  });
});

describe("bulk review confirm and cancel #1142", () => {
  it("Cancel changes nothing", async () => {
    const onApply = vi.fn();
    await act(async () => root.render(h(Harness, { selectedIds: ["c1", "c2"], visible: connections, onApply })));
    await act(async () => button("open").click());
    expect(document.querySelector("[data-testid=bulk-review]")).not.toBeNull();
    await act(async () => button("Cancel").click());
    expect(onApply).not.toHaveBeenCalled();
    expect(document.querySelector("[data-testid=bulk-review]")).toBeNull();
  });

  it("Confirm applies only the reviewed selection, hidden rows included, nothing else", async () => {
    const onApply = vi.fn();
    await act(async () => root.render(h(Harness, { selectedIds: ["c1", "c29"], visible: connections.slice(0, 5), onApply })));
    await act(async () => button("open").click());
    expect(document.body.textContent).toContain("1 of these is hidden");
    await act(async () => button("Confirm").click());
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(["c1", "c29"]);
  });

  it("does not widen the change when a refetch adds connections or drops one", () => {
    const review = buildBulkReview({ action: "disable", targets: connections.slice(0, 2), visibleConnections: connections });
    const refetched = [...connections.slice(1), { id: "new", name: "New", isActive: true }];
    expect(reviewedTargets(review, refetched).map((conn) => conn.id)).toEqual(["c1"]);
  });
});

describe("persisted test results #1142", () => {
  const fixedNow = () => new Date("2026-05-01T10:00:00.000Z");

  it("stores status, safe message and timestamp under the per-connection key", () => {
    const storage = memoryStorage();
    const record = saveProviderTestResult("c1", { state: "failed", error: "401 invalid api key" }, { storage, now: fixedNow });
    expect(record).toMatchObject({ status: "failed", testedAt: "2026-05-01T10:00:00.000Z" });
    expect(Object.keys(storage.dump())).toEqual(["durindoor:provider-test:c1"]);
    expect(providerTestKey("c1")).toBe("durindoor:provider-test:c1");
  });

  it("shows the stored result after reload", async () => {
    const storage = memoryStorage();
    saveProviderTestResult("c1", { state: "success" }, { storage, now: fixedNow });
    const reloaded = loadProviderTestResult("c1", { storage });
    expect(reloaded).toMatchObject({ status: "success", message: "Connection check passed." });
    await act(async () => root.render(h(PersistedTestResult, { result: reloaded })));
    expect(document.querySelector("[data-testid=persisted-test-result]").textContent).toContain("Last test passed: Connection check passed.");
    expect(document.querySelector("time").getAttribute("datetime")).toBe("2026-05-01T10:00:00.000Z");
  });

  it("renders nothing when no result is stored", async () => {
    await act(async () => root.render(h(PersistedTestResult, { result: loadProviderTestResult("none", { storage: memoryStorage() }) })));
    expect(document.querySelector("[data-testid=persisted-test-result]")).toBeNull();
  });

  it("reads and writes through window.localStorage by default", () => {
    saveProviderTestResult("c9", { state: "unavailable", error: "private body" });
    expect(loadProviderTestResult("c9")).toMatchObject({ status: "unavailable", message: "The provider or network did not complete the check. Try again later." });
    expect(globalThis.localStorage.getItem("durindoor:provider-test:c9")).not.toBeNull();
    globalThis.localStorage.removeItem("durindoor:provider-test:c9");
  });

  it("ignores storage failures on write and read", () => {
    const broken = {
      getItem() { throw new Error("denied"); },
      setItem() { throw new Error("quota"); },
    };
    expect(saveProviderTestResult("c1", { state: "success" }, { storage: broken })).toBeNull();
    expect(loadProviderTestResult("c1", { storage: broken })).toBeNull();
    expect(saveProviderTestResult("c1", { state: "success" }, { storage: null })).toBeNull();
    expect(loadProviderTestResult("c1", { storage: null })).toBeNull();
  });

  it("never stores raw upstream error text", () => {
    const storage = memoryStorage();
    const secret = "401 invalid key sk-live-abc Cookie: session=private";
    saveProviderTestResult("c1", { state: "failed", error: secret }, { storage, now: fixedNow });
    saveProviderTestResult("c2", { state: "skipped", error: secret }, { storage, now: fixedNow });
    saveProviderTestResult("c3", { state: "unavailable", error: secret }, { storage, now: fixedNow });
    const raw = JSON.stringify(storage.dump());
    expect(raw).not.toContain("sk-live-abc");
    expect(raw).not.toContain("session=private");
    expect(raw).not.toContain(secret);
    expect(loadProviderTestResult("c1", { storage }).message).toContain("Check the saved key");
  });

  it("discards tampered, unknown or malformed stored values", () => {
    const base = { status: "failed", message: "Check the saved key, token, or account authorization. Reconnect if the credential has expired or been revoked.", testedAt: "2026-05-01T10:00:00.000Z" };
    const storage = memoryStorage({
      [providerTestKey("raw")]: JSON.stringify({ ...base, message: "upstream said sk-live-abc" }),
      [providerTestKey("status")]: JSON.stringify({ ...base, status: "queued" }),
      [providerTestKey("time")]: JSON.stringify({ ...base, testedAt: "not a date" }),
      [providerTestKey("json")]: "{nope",
      [providerTestKey("array")]: "[]",
      [providerTestKey("ok")]: JSON.stringify(base),
    });
    for (const id of ["raw", "status", "time", "json", "array", "missing"]) expect(loadProviderTestResult(id, { storage })).toBeNull();
    expect(loadProviderTestResult("ok", { storage })).toEqual(base);
  });

  it("does not persist in-progress states", () => {
    const storage = memoryStorage();
    expect(saveProviderTestResult("c1", { state: "testing" }, { storage })).toBeNull();
    expect(saveProviderTestResult("c1", { state: "queued" }, { storage })).toBeNull();
    expect(storage.dump()).toEqual({});
  });
});
