"use client";

import { Card, CardContent } from "@/shared/ui/components/Card.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Pagination from "@/shared/ui/components/Pagination.jsx";
import { ACCOUNT_PAGE_SIZE_OPTIONS, ACCOUNT_PAGE_SIZE_MAX } from "./utils";

/** Page summary, accounts-per-page picker (with custom size) and page navigation. */
export default function ConnectionsPager({
  connectionsPageSummary,
  customPageSizeMode,
  pageSize,
  setCustomPageSizeMode,
  updatePageSize,
  customPageSizeInput,
  setCustomPageSizeInput,
  pagination,
  updatePage
}) {
  return (
    <Card padding={false}>
      <CardContent className="flex flex-wrap items-center gap-3 p-3">
        <span className="text-xs text-dd-muted">{connectionsPageSummary}</span>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Select
            aria-label="Accounts per page"
            value={customPageSizeMode ? "custom" : String(pageSize)}
            onChange={(nextValue) => {
              if (nextValue === "custom") { setCustomPageSizeMode(true); return; }
              setCustomPageSizeMode(false);
              updatePageSize(nextValue);
            }}
            options={[...ACCOUNT_PAGE_SIZE_OPTIONS.map((option) => ({ value: String(option), label: `${option} / page` })), { value: "custom", label: "Custom" }]}
          />
          {customPageSizeMode ? <Input
            type="number"
            min="1"
            max={ACCOUNT_PAGE_SIZE_MAX}
            inputMode="numeric"
            value={customPageSizeInput}
            onChange={(event) => setCustomPageSizeInput(event.target.value)}
            onBlur={() => updatePageSize(customPageSizeInput)}
            onKeyDown={(event) => { if (event.key === "Enter") updatePageSize(customPageSizeInput); }}
            aria-label="Custom accounts per page"
            className="w-24"
          /> : null}
        </div>
        <Pagination
          page={pagination.page}
          pageCount={pagination.totalPages}
          total={pagination.total}
          rowsLabel={`Page ${pagination.page} / ${pagination.totalPages}`}
          onPage={updatePage}
        />
      </CardContent>
    </Card>
  );
}
