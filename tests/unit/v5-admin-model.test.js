import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { REVIEW_SURFACES } from "../../src/shared/ui/v5/review-manifest.js";
import { PAGES } from "../../src/shared/ui/v5/catalog.js";
import {
  WIDGETS,
  filterRows,
  moveWidget,
  updateWidget,
  validateConnection,
} from "../../src/shared/ui/v5/model.js";

describe("v5 dashboard layouts", () => {
  it("moves a widget without losing hidden widgets or mutating the saved layout", () => {
    const draft = moveWidget(WIDGETS, "traffic", "budget");
    expect(draft.map((widget) => widget.id)).toEqual([
      "providers",
      "requests",
      "budget",
      "traffic",
      "latency",
      "health",
    ]);
    expect(WIDGETS[0].id).toBe("traffic");
    expect(draft.filter((widget) => !widget.visible)).toHaveLength(2);
  });
  it("ignores a drop outside the layout", () => {
    expect(moveWidget(WIDGETS, "traffic", "unknown")).toBe(WIDGETS);
  });
  it("edits presentation while preserving widget identity and the saved layout", () => {
    const draft = updateWidget(WIDGETS, "budget", {
      title: "Monthly spend",
      visible: false,
      wide: true,
      id: "other",
      type: "traffic",
    });
    expect(draft.find((widget) => widget.id === "budget")).toMatchObject({
      title: "Monthly spend",
      visible: false,
      wide: true,
      type: "budget",
    });
    expect(WIDGETS.find((widget) => widget.id === "budget").visible).toBe(true);
  });
});
describe("v5 form validation and inventory", () => {
  it("requires a name and key and rejects invalid endpoints", () => {
    expect(
      validateConnection({
        name: " ",
        secret: "",
        endpoint: "javascript:alert(1)",
      }),
    ).toHaveProperty("endpoint");
    expect(
      Object.keys(
        validateConnection({ name: "", secret: "", endpoint: "not a url" }),
      ),
    ).toEqual(["name", "secret", "endpoint"]);
    expect(
      validateConnection({
        name: "Review",
        secret: "sample",
        endpoint: "http://localhost:8080/v1",
      }),
    ).toEqual({});
  });
  it("combines free text and status filters without mutating rows", () => {
    const rows = [
      { id: "a", name: "OpenAI", status: "Connected" },
      { id: "b", name: "OpenAI", status: "Disabled" },
    ];
    expect(filterRows(rows, "  OPENAI  ", "Connected")).toEqual([rows[0]]);
    expect(filterRows(rows, "missing", "all")).toEqual([]);
    expect(rows).toHaveLength(2);
  });
});
describe("v5 review coverage", () => {
  it("has unique page identities and resolvable parent navigation", () => {
    expect(new Set(PAGES.map((page) => page.id)).size).toBe(PAGES.length);
    for (const page of PAGES)
      if (page.parent)
        expect(PAGES.some((parent) => parent.id === page.parent)).toBe(true);
  });
  it("maps every active review surface to its original named scenarios", () => {
    expect(REVIEW_SURFACES.length).toBeGreaterThan(0);
    for (const surface of REVIEW_SURFACES) {
      const source = readFileSync(new URL(`../../${surface.source}`, import.meta.url), "utf8");
      expect(surface.states.length).toBeGreaterThan(0);
      for (const state of surface.states) expect(source).toMatch(new RegExp(`export (?:const|function) ${state}\\b`));
    }
  });
  it("is not imported into production pages or the production component barrel", () => {
    const layout = readFileSync(
      new URL("../../src/app/(dashboard)/layout.js", import.meta.url),
      "utf8",
    );
    expect(layout).not.toContain("/v5/");
  });
});
