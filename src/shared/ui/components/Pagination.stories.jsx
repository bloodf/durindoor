import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import Pagination from "./Pagination.jsx";

/** Stateful wrapper keeps the pager controls interactive on the canvas. */
function StatefulPagination({ page: initialPage, ...props }) {
  const [page, setPage] = useState(initialPage);
  return <Pagination {...props} page={page} onPage={setPage} />;
}

const mockRows = Array.from({ length: 137 }, (_, index) => ({ id: index + 1 }));

function RowsPerPagePagination() {
  const [page, setPage] = useState(3);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const pageCount = rowsPerPage === "all" ? 1 : Math.ceil(mockRows.length / rowsPerPage);
  const start = rowsPerPage === "all" ? 1 : (page - 1) * rowsPerPage + 1;
  const end = rowsPerPage === "all" ? mockRows.length : Math.min(page * rowsPerPage, mockRows.length);

  return (
    <Pagination
      page={page}
      pageCount={pageCount}
      rowsPerPage={rowsPerPage}
      rowsLabel={`Showing ${start} to ${end} of ${mockRows.length} results`}
      onPage={setPage}
      onRowsPerPageChange={(value) => {
        setRowsPerPage(value);
        setPage(1);
      }}
    />
  );
}

const meta = {
  title: "Durin DS/Data/Pagination",
  component: Pagination,
  parameters: { layout: "padded" },
};

export default meta;

export const FirstPage = {
  render: (args) => <StatefulPagination {...args} />,
  args: {
    page: 1,
    pageCount: 12,
    rowsLabel: "Showing 1 to 20 of 240 results",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Previous page" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Next page" })).not.toBeDisabled();
  },
};

export const MiddlePage = {
  render: (args) => <StatefulPagination {...args} />,
  args: {
    page: 6,
    pageCount: 12,
    rowsLabel: "Showing 101 to 120 of 240 results",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Page 6" })).toHaveAttribute("aria-current", "page");
  },
};

export const LastPage = {
  render: (args) => <StatefulPagination {...args} />,
  args: {
    page: 12,
    pageCount: 12,
    rowsLabel: "Showing 221 to 240 of 240 results",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Next page" })).toBeDisabled();
  },
};

export const TotalFallback = {
  render: (args) => <StatefulPagination {...args} />,
  args: {
    page: 3,
    pageCount: 5,
    total: 96,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("96 results")).toBeInTheDocument();
  },
};

export const WithRowsPerPage = {
  render: () => <RowsPerPagePagination />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const select = canvas.getByRole("combobox", { name: "Rows per page" });
    await expect(select).toHaveValue("25");
    await userEvent.selectOptions(select, "50");
    await expect(select).toHaveValue("50");
  },
};

export const SinglePage = {
  render: (args) => <StatefulPagination {...args} />,
  args: { page: 1, pageCount: 1, total: 4 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Previous page" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Next page" })).toBeDisabled();
  },
};
