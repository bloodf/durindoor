// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Modal, { ConfirmModal } from "@/shared/components/Modal";
import Tooltip from "@/shared/components/Tooltip";
import DateRangePicker from "@/shared/components/DateRangePicker";
import Pagination from "@/shared/components/Pagination";
import { usePagination } from "@/shared/hooks/usePagination";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = React.createElement;
const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;
const originalOverflowDescriptor = Object.getOwnPropertyDescriptor(document.body.style, "overflow");
const originalBodyOverflow = document.body.style.overflow;
const roots = [];

function render(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push([root, container]);
  act(() => root.render(element));
  return { update: (next) => act(() => root.render(next)) };
}

function setValue(input, value) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function shimShowModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function shimClose() {
    this.removeAttribute("open");
  };
});

afterEach(() => {
  while (roots.length) {
    const [root, container] = roots.pop();
    act(() => root.unmount());
    container.remove();
  }
  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalClose;
  document.body.innerHTML = "";
  document.body.style.overflow = originalBodyOverflow;
  if (originalOverflowDescriptor) {
    Object.defineProperty(document.body.style, "overflow", originalOverflowDescriptor);
  }
});

describe("Modal legacy compatibility", () => {
  it("mounts while open and closes when controlled state changes", () => {
    const { update } = render(h(Modal, { isOpen: true, onClose: () => {}, title: "Modal" }, h("p", null, "Body")));
    expect(document.querySelector("dialog[open]")?.textContent).toContain("Body");
    update(h(Modal, { isOpen: false, onClose: () => {} }));
    expect(document.querySelector("dialog[open]")).toBeNull();
  });

  it("fires onClose when escape dismissed and overlay clicked (closeOnOverlay)", async () => {
    const onClose = vi.fn();
    const { update } = render(h(Modal, { isOpen: true, onClose, title: "Dismiss me" }));
    const dialog = document.querySelector("dialog[open]");
    await act(async () => {
      dialog.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true }));
    });
    expect(onClose).toHaveBeenCalled();
    onClose.mockClear();
    const closeBtn = document.querySelector('button[aria-label="Close"]');
    await act(async () => { closeBtn.click(); });
    expect(onClose).toHaveBeenCalled();
    onClose.mockClear();
    update(h(Modal, { isOpen: true, onClose, closeOnOverlay: false, title: "Sticky" }));
    const dialog2 = document.querySelector("dialog[open]");
    await act(async () => {
      dialog2.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      dialog2.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ConfirmModal disables close, cancel, and confirm actions while pending", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(h(ConfirmModal, { isOpen: true, onClose, onConfirm, title: "Delete", message: "Sure?", loading: true }));
    const dialog = document.querySelector("dialog[open]");
    const buttons = Array.from(dialog.querySelectorAll("button"));
    expect(buttons.every((button) => button.disabled)).toBe(true);
    for (const button of buttons) button.click();
    expect(onClose).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});


describe("Tooltip legacy compatibility", () => {
  it("keeps non-focusable icon child keyboard reachable and labels it", () => {
    render(h(Tooltip, { text: "Capacity info" }, h("span", { className: "material-symbols-outlined" }, "info")));
    const labelled = document.querySelector('[aria-label="Capacity info"][role="img"][tabindex="0"]');
    expect(labelled).toBeTruthy();
    expect(labelled?.textContent).toBe("info");
  });

  it("preserves focusable child without overriding aria-label", () => {
    render(h(Tooltip, { text: "Close" }, h("button", { type: "button", "aria-label": "Close" }, "×")));
    const button = document.querySelector('button[aria-label="Close"]');
    expect(button).toBeTruthy();
    expect(button?.getAttribute("tabindex")).toBeNull();
  });
});

describe("DateRangePicker legacy behavior", () => {
  it("emits immediately on each control change and keeps max/min constraints", () => {
    const onChange = vi.fn();
    render(h(DateRangePicker, { startDate: "2026-08-01", endDate: "2026-09-05", onChange }));
    const start = document.querySelector('input[type="date"]');
    expect(start?.getAttribute("max")).toBe("2026-09-05");
    setValue(start, "2026-08-10");
    expect(onChange).toHaveBeenCalledWith({ startDate: "2026-08-10", endDate: "2026-09-05" });
  });

  it("emits empty end side on separate change", () => {
    const onChange = vi.fn();
    render(h(DateRangePicker, { startDate: "2026-08-01", endDate: "2026-09-05", onChange }));
    const [, end] = document.querySelectorAll('input[type="date"]');
    setValue(end, "");
    expect(onChange).toHaveBeenCalledWith({ startDate: "2026-08-01", endDate: "" });
  });
});


describe("usePagination all-mode semantics", () => {
  it("switches to all on page one with every item and handles empty items", () => {
    let value;
    function Harness({ items }) {
      value = usePagination({ items, pageSize: 25 });
      return null;
    }
    const mounted = render(h(Harness, { items: ["a", "b", "c"] }));
    act(() => value.setPageSize("all"));
    expect(value.pageSize).toBe("all");
    expect(value.page).toBe(1);
    expect(value.totalPages).toBe(1);
    expect(value.pageItems).toEqual(["a", "b", "c"]);
    mounted.update(h(Harness, { items: [] }));
    expect(value.pageSize).toBe("all");
    expect(value.page).toBe(1);
    expect(value.totalPages).toBe(1);
    expect(value.pageItems).toEqual([]);
  });
});
describe("Pagination legacy compatibility", () => {
  it("navigates pages and reports the current page with aria-current", () => {
    const onPageChange = vi.fn();
    render(h(Pagination, { currentPage: 3, pageSize: 20, totalItems: 200, onPageChange, onPageSizeChange: () => {} }));
    const current = document.querySelector('button[aria-current="page"]');
    expect(current?.textContent).toBe("3");
    const next = document.querySelector('button[aria-label="Next page"]');
    act(() => { next.click(); });
    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  it("canonical default renders rows-per-page options with all", () => {
    const onPageSizeChange = vi.fn();
    const onPageChange = vi.fn();
    render(h(Pagination, { currentPage: 1, pageSize: 25, totalItems: 200, onPageChange, onPageSizeChange }));
    const select = document.querySelector('select[aria-label="Rows per page"]');
    expect(select).toBeTruthy();
    const values = Array.from(select.options).map((option) => option.value);
    expect(values).toEqual(["10", "25", "50", "100", "all"]);
    expect(select.value).toBe("25");
  });

  it("injects current pageSize into options when caller remains on 20", () => {
    const onPageSizeChange = vi.fn();
    const onPageChange = vi.fn();
    render(h(Pagination, { currentPage: 1, pageSize: 20, totalItems: 200, onPageChange, onPageSizeChange }));
    const select = document.querySelector('select[aria-label="Rows per page"]');
    const values = Array.from(select.options).map((option) => option.value);
    expect(values).toEqual(["10", "20", "25", "50", "100", "all"]);
    expect(select.value).toBe("20");
  });

  it("emits all page size and recomputes single page", () => {
    const onPageSizeChange = vi.fn();
    const onPageChange = vi.fn();
    const { update } = render(h(Pagination, { currentPage: 1, pageSize: 20, totalItems: 200, onPageChange, onPageSizeChange }));
    const select = document.querySelector('select[aria-label="Rows per page"]');
    act(() => {
      select.value = "all";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onPageSizeChange).toHaveBeenCalledWith("all");
    update(h(Pagination, { currentPage: 1, pageSize: "all", totalItems: 200, onPageChange, onPageSizeChange }));
    const nav = document.querySelector('nav[aria-label="Pagination"]');
    const current = nav.querySelector('button[aria-current="page"]');
    expect(current?.textContent).toBe("1");
  });
});
