import React, { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import Pagination from "./Pagination";

const meta = { title: "Production/shared-overlays/Pagination", component: Pagination };
export default meta;

function PaginationScenario() {
  const [page, setPage] = useState(2);
  const [pageSize, setPageSize] = useState(25);
  return <Pagination currentPage={page} pageSize={pageSize} totalItems={180} onPageChange={setPage} onPageSizeChange={setPageSize} />;
}

export const Interactive = {
  render: () => <PaginationScenario />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Next page" }));
    await expect(canvas.getByRole("button", { current: "page" })).toHaveTextContent("3");
    await userEvent.selectOptions(canvas.getByRole("combobox", { name: "Rows per page" }), canvas.getByRole("option", { name: "50" }));
    await expect(canvas.getByRole("combobox", { name: "Rows per page" })).toHaveValue("50");
  },
};

function TransitionalTwentyScenario() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  return <Pagination currentPage={page} pageSize={pageSize} totalItems={180} onPageChange={setPage} onPageSizeChange={setPageSize} />;
}

export const TransitionalPageSizeTwenty = {
  render: () => <TransitionalTwentyScenario />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("combobox", { name: "Rows per page" })).toHaveValue("20");
  },
};

function AllRowsScenario() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState("all");
  return <Pagination currentPage={page} pageSize={pageSize} totalItems={180} onPageChange={setPage} onPageSizeChange={setPageSize} />;
}

export const AllRows = {
  render: () => <AllRowsScenario />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("combobox", { name: "Rows per page" })).toHaveValue("all");
    await expect(canvas.getByText(/Showing 1 to 180 of 180 results/)).toBeVisible();
  },
};

export const Empty = { args: { currentPage: 1, pageSize: 25, totalItems: 0, onPageChange: () => {} } };
