import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Avatar from "../../src/shared/components/Avatar.js";
import Badge from "../../src/shared/components/Badge.js";
import CapacityBadges from "../../src/shared/components/CapacityBadges.js";
import Card from "../../src/shared/components/Card.js";
import Loading, { CardSkeleton, PageLoading, Spinner } from "../../src/shared/components/Loading.js";

const render = (element) => renderToStaticMarkup(element);

describe("shared production surfaces", () => {
  it("derives Avatar initials inside role=img and renders src as background-image", () => {
    const initials = render(React.createElement(Avatar, { name: "Gandalf Grey", alt: "Gandalf" }));
    const image = render(React.createElement(Avatar, { src: "/x.png", alt: "Gandalf image" }));

    expect(initials).toContain('role="img"');
    expect(initials).toContain('aria-label="Gandalf"');
    expect(initials).toContain(">GG<");
    expect(image).toContain('role="img"');
    expect(image).toContain('aria-label="Gandalf image"');
    expect(image).toContain("background-image:url(/x.png)");
  });

  it("keeps Badge variants, dot, and icon as observable status content", () => {
    const badge = render(React.createElement(Badge, { variant: "success", dot: true, icon: "check_circle" }, "Healthy"));

    expect(badge).toContain("Healthy");
    expect(badge).toContain(">check_circle<");
    expect(badge).toContain('aria-hidden="true"');
  });

  it("preserves Card's compound content and caller-provided action", () => {
    const card = render(
      React.createElement(
        Card,
        { title: "Combos", subtitle: "fallback", icon: "layers", action: React.createElement("button", {}, "Add") },
        React.createElement(Card.Section, {}, "section"),
        React.createElement(Card.Row, {}, "row"),
        React.createElement(Card.ListItem, { actions: React.createElement("button", {}, "Remove") }, "item")
      )
    );

    expect(card).toContain("Combos");
    expect(card).toContain("fallback");
    expect(card).toContain(">layers<");
    expect(card).toContain(">Add<");
    expect(card).toContain("section");
    expect(card).toContain("row");
    expect(card).toContain("item");
    expect(card).toContain(">Remove<");
  });

  it("dispatches Loading types to semantically distinct status surfaces", () => {
    const spinner = render(React.createElement(Loading, { type: "spinner", label: "Refreshing" }));
    const card = render(React.createElement(Loading, { type: "card" }));
    const page = render(React.createElement(PageLoading, { message: "Almost there" }));

    expect(spinner).toContain('role="status"');
    expect(spinner).toContain('aria-label="Refreshing"');
    expect(card).toContain('aria-label="Loading card"');
    expect(page).toContain('aria-live="polite"');
    expect(page).toContain("Almost there");
  });

  it("keeps a standalone Spinner named unless explicitly decorative", () => {
    const spinner = render(React.createElement(Spinner, { label: "Syncing" }));
    const decorative = render(React.createElement(Spinner, { "aria-hidden": true }));

    expect(spinner).toContain('aria-label="Syncing"');
    expect(decorative).toContain('aria-hidden="true"');
    expect(decorative).not.toContain('role="status"');
  });

  it("renders only explicitly enabled, known CapacityBadges", () => {
    const enabled = render(React.createElement(CapacityBadges, { caps: { vision: true, reasoning: false, tools: true } }));
    const empty = render(React.createElement(CapacityBadges, { caps: { search: true } }));

    expect(enabled).toContain(">visibility<");
    expect(enabled).toContain(">build<");
    expect(enabled).not.toContain(">neurology<");
    expect(empty).toBe("");
  });
});
