// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import Pagination from "../../src/shared/ui/components/Pagination.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
it("shows a compact page indicator on mobile and keeps navigation usable", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onPage = vi.fn();
  await act(async () => root.render(React.createElement(Pagination, { page: 3, pageCount: 20, onPage })));
  expect(host.querySelector('[aria-label="Page 3 of 20"]').textContent).toBe("3 / 20");
  expect(host.querySelector('[aria-label="Page 3"]').parentElement.className).toContain("sm:flex");
  await act(async () => host.querySelector('[aria-label="Next page"]').click());
  expect(onPage).toHaveBeenCalledWith(4);
  await act(async () => root.unmount());
  host.remove();
});
