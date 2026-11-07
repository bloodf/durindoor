import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseQuotaData } from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";
import QuotaTable from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/QuotaTable.js";

describe("xAI credit parser and table", () => {
  it.each([0, 85.5])("renders %s USD as credit without a percentage window", (total) => {
    const rows = parseQuotaData("xai", { quotas: { "Prepaid credit (USD)": { total, used: 0, isCreditBalance: true, currency: "USD" } } });
    expect(rows).toEqual([expect.objectContaining({ total, isCreditBalance: true, currency: "USD" })]);
    const html = renderToStaticMarkup(React.createElement(QuotaTable, { quotas: rows }));
    expect(html).toContain(total.toFixed(2));
    expect(html).not.toContain("0%");
    expect(html).not.toContain("100%");
    expect(html).not.toContain('role="progressbar"');
  });
});
