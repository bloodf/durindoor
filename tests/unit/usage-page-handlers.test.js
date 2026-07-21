import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ponytail: source-level regression guard — the repo has no jsdom/react-testing-library
// harness, so handler wiring is asserted against source text instead of rendered
// components. Upgrade to a rendered-component test when/if a DOM test harness lands.
const root = resolve(__dirname, "../..");
const pageSrc = readFileSync(resolve(root, "src/app/(dashboard)/dashboard/usage/page.js"), "utf8");
const statsSrc = readFileSync(resolve(root, "src/shared/components/UsageStats.js"), "utf8");
const loggerSrc = readFileSync(resolve(root, "src/shared/components/RequestLogger.js"), "utf8");
const detailsSrc = readFileSync(
  resolve(root, "src/app/(dashboard)/dashboard/usage/components/RequestDetailsTab.js"),
  "utf8"
);

describe("usage page handleReset (CR-D-2)", () => {
  it("handleReset bumps a resetNonce counter instead of toggling the period", () => {
    expect(pageSrc).toMatch(/setResetNonce\(\(n\) => n \+ 1\)/);
    // Old hack: clobbered the user's selected period to force a re-render.
    expect(pageSrc).not.toContain('setPeriod((p) => p === "today" ? "24h" : "today")');
  });

  it("handleReset never calls setPeriod", () => {
    // Extract only the handleReset function body (up to its closing brace).
    const start = pageSrc.indexOf("const handleReset");
    const end = pageSrc.indexOf("};", start);
    const handleReset = pageSrc.slice(start, end);
    expect(handleReset).toContain("setResetNonce");
    // "setPeriod" as a standalone call ("resetPeriod" must not match).
    expect(handleReset).not.toMatch(/\bsetPeriod\(/);
  });

  it("passes resetNonce to UsageStats, RequestLogger and RequestDetailsTab", () => {
    expect(pageSrc).toMatch(/<UsageStats\b[^>]*\bresetNonce=\{resetNonce\}[^>]*\/>/);
    expect(pageSrc).toContain("<RequestLogger resetNonce={resetNonce} />");
    expect(pageSrc).toContain("<RequestDetailsTab resetNonce={resetNonce} />");
  });

  it("UsageStats accepts resetNonce and refetches stats on change", () => {
    expect(statsSrc).toMatch(/resetNonce = 0/);
    expect(statsSrc).toMatch(/\}, \[period,[^\]]*resetNonce\]\);/);
  });

  it("RequestLogger accepts resetNonce and refetches logs on change", () => {
    expect(loggerSrc).toMatch(/function RequestLogger\(\{ resetNonce = 0 \} = \{\}\)/);
    expect(loggerSrc).toMatch(/fetchLogs\(\);\s*\}, \[resetNonce\]\);/);
  });

  it("RequestDetailsTab accepts resetNonce and refetches details on change", () => {
    expect(detailsSrc).toMatch(/function RequestDetailsTab\(\{ resetNonce = 0 \} = \{\}\)/);
    expect(detailsSrc).toMatch(/\}, \[fetchDetails, resetNonce\]\);/);
  });
});
