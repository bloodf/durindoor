// @vitest-environment happy-dom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getByRole, queryByRole } from "@testing-library/dom";
import { describe, expect, it } from "vitest";
import QuotaProgressBar from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/QuotaProgressBar.js";
import QuotaTable from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/QuotaTable.js";

function render(Component, props) {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(React.createElement(Component, props));
  return container;
}

function expectMeter(container, name, value) {
  const meter = getByRole(container, "meter", { name });
  expect(meter.getAttribute("aria-valuemin")).toBe("0");
  expect(meter.getAttribute("aria-valuemax")).toBe("100");
  expect(meter.getAttribute("aria-valuenow")).toBe(String(value));
  expect(queryByRole(container, "progressbar")).toBeNull();
  return meter;
}

describe("remaining quota meters", () => {
  it.each([[-5, 0], [42, 42], [150, 100]])("bounds card percentage %s to %s", (percentage, value) => {
    const container = render(QuotaProgressBar, { label: "Daily", percentage, used: 3, total: 10 });
    expect(expectMeter(container, "Daily quota remaining", value).firstElementChild.style.width).toBe(`${value}%`);
  });

  it("omits the meter for unlimited cards", () => {
    const container = render(QuotaProgressBar, { label: "Daily", unlimited: true });
    expect(queryByRole(container, "meter")).toBeNull();
    expect(container.textContent).toContain("Unlimited");
  });

  it.each([[-5, 0], [42, 42], [150, 100]])("bounds table percentage %s to %s", (remaining, value) => {
    const container = render(QuotaTable, { quotas: [{ name: "Monthly", used: 3, total: 10, remaining }] });
    expect(expectMeter(container, "Monthly remaining", value).firstElementChild.style.width).toBe(`${value}%`);
  });

  it("omits meters for unreported, credit balance, and spend rows", () => {
    const quotas = [
      { name: "Unreported", notReported: true },
      { name: "Balance", isCreditBalance: true, total: 12, used: 0 },
      { name: "Spend", isSpend: true, total: 5, used: 0 },
    ];
    const container = render(QuotaTable, { quotas });
    expect(queryByRole(container, "meter")).toBeNull();
    expect(container.textContent).toContain("not reported");
    expect(container.textContent).toContain("Credit: 12.00");
    expect(container.textContent).toContain("5.00 USD spent");
  });
});
