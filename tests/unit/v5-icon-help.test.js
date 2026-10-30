// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import ReviewIconHelp from "../../src/shared/ui/v5/motion/ReviewIconHelp.jsx";
import MotionIcon from "../../src/shared/ui/v5/motion/MotionIcon.jsx";
import ReviewGlyph from "../../src/shared/ui/v5/motion/ReviewGlyph.jsx";
import ReviewNativeButton, { allowsIconTooltip, inferredButtonIcon } from "../../src/shared/ui/v5/motion/ReviewNativeButton.jsx";
import { actionIcon, explainIcon } from "../../src/shared/ui/v5/motion/iconHelp.js";
import { ANIMATED_ICONS, getAnimatedIcon } from "../../src/shared/ui/v5/motion/animatedIconCatalog.js";
import { reviewNativeButtons } from "../../.storybook/review-button-boundary.mjs";
import { reviewGlyphs } from "../../.storybook/review-glyph-boundary.mjs";
import { reviewSidebarSections } from "../../src/shared/ui/v5/review-navigation.js";
import { NAV_SECTIONS, PROFILE_NAV_ITEM } from "../../src/shared/components/SidebarNavIcons.js";

const iconAnimation = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), reduced: false, lastProps: null }));
vi.mock("motion/react", async (importOriginal) => ({ ...await importOriginal(), useReducedMotion: () => iconAnimation.reduced }));
vi.mock("@animateicons/react/lucide/plus-icon", async () => {
  const { createElement, forwardRef, useImperativeHandle } = await import("react");
  const PlusIcon = forwardRef(function PlusIcon(props, ref) {
    iconAnimation.lastProps = props;
    useImperativeHandle(ref, () => ({ startAnimation: iconAnimation.start, stopAnimation: iconAnimation.stop }), []);
    return createElement("svg", { "data-animation-test": "plus", width: props.size, height: props.size });
  });
  PlusIcon.displayName = "PlusIcon";
  return { PlusIcon };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const h = React.createElement;
let root;
let container;
const portalNodes = [];
async function mount(node, review = true) {
  if (review) document.documentElement.dataset.v5Review = "true";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(node));
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  container?.remove();
  for (const node of portalNodes.splice(0)) node.remove();
  container = null;
  document.documentElement.removeAttribute("data-v5-review");
  iconAnimation.start.mockClear();
  iconAnimation.stop.mockClear();
  iconAnimation.reduced = false;
  iconAnimation.lastProps = null;
  vi.useRealTimers();
});
function element(markup) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = markup;
  return wrapper.querySelector(".material-symbols-outlined,img,svg,[role=img]");
}
const glyph = (name, props = {}) => h("span", { className: "material-symbols-outlined", ...props }, name);

describe("meaningful review icon explanations", () => {
  it.each([
    ["dns", "Provider servers"], ["bar_chart", "Usage statistics"],
    ["speed", "Latency and throughput"], ["storage", "Storage usage"],
  ])("explains %s without inheriting a page landmark label", (name, meaning) => {
    expect(explainIcon(element(`<section role="region" aria-label="Page content"><span class="material-symbols-outlined">${name}</span></section>`))).toBe(meaning);
  });
  it.each([
    ["Vision", "visibility", "Accepts images as input"],
    ["PDF reading", "picture_as_pdf", "Reads PDF documents"],
    ["Audio input", "mic", "Accepts audio as input"],
    ["Video input", "videocam", "Accepts video as input"],
    ["Image output", "image", "Generates images"],
    ["Audio output", "volume_up", "Generates audio"],
    ["Video output", "movie", "Generates video"],
    ["Web search", "travel_explore", "Searches the web"],
    ["Tool calls", "build", "Calls tools and functions"],
    ["Reasoning", "psychology", "Supports reasoning"],
  ])("explains %s by its capability, rather than its glyph", (label, name, description) => {
    expect(explainIcon(element(`<span class="v5-capability-mark" aria-label="${label}"><span class="material-symbols-outlined">${name}</span></span>`))).toBe(description);
  });
  it.each([
    ["Context window: 128,000 tokens", "data_object"],
    ["Maximum output: 16,384 tokens", "output"],
  ])("retains the exact token limit in %s", (label, name) => {
    expect(explainIcon(element(`<span class="v5-capability-limit" aria-label="${label}"><span class="material-symbols-outlined">${name}</span></span>`))).toBe(label);
  });
  it.each([
    ["openai", "OpenAI provider"], ["cx", "OpenAI Codex provider"], ["auggie", "Augment Auggie CLI provider"],
    ["combo", "Nested combo groups models under one routing name"],
  ])("uses a readable provider identity for %s", (name, description) => {
    expect(explainIcon(element(`<img src="/providers/${name}.svg" alt="${name}" width="18" height="18">`))).toBe(description);
  });
  it("uses the action label for a raw SVG control and the icon meaning for a standalone glyph", () => {
    const flag = document.createElement("button");
    flag.setAttribute("aria-label", "Change language");
    flag.innerHTML = '<span data-icon-name="language">🇺🇸</span>';
    expect(explainIcon(flag.firstElementChild)).toBe("Change language");
    const brand = element('<img src="/favicon.svg" alt="DurinDoor" width="24" height="24">');
    expect(brand.matches("img[src*='/favicon.']")).toBe(true);
    expect(explainIcon(brand)).toBe("DurinDoor logo");
    expect(explainIcon(element('<div class="v5-login-scene"><button><span class="material-symbols-outlined">pause</span>Pause animation</button></div>'))).toBe("Pause animation");
    expect(explainIcon(element('<button aria-label="Move GPT-4o up"><svg width="18" height="18" aria-hidden="true"><path d="M0 0"/></svg></button>'))).toBe("Move GPT-4o up");
    expect(explainIcon(element('<span class="material-symbols-outlined">sync</span>'))).toBe("Synchronize provider data");
    expect(explainIcon(element('<button><span class="material-symbols-outlined">refresh</span>Retry provider sync</button>'))).toBe("Retry provider sync");
  });
  it("exempts close/save icons and excludes charts, illustrations and the login scene", () => {
    expect(explainIcon(element('<button aria-label="Close dialog"><svg width="18" height="18"></svg></button>'))).toBeNull();
    expect(explainIcon(element('<button><svg width="18" height="18"></svg>Save changes</button>'))).toBeNull();
    for (const name of ["close", "cancel", "save", "save_as", "save_alt"]) expect(explainIcon(element(`<span class="material-symbols-outlined">${name}</span>`))).toBeNull();
    expect(explainIcon(element('<div class="recharts-wrapper"><svg width="18" height="18"></svg></div>'))).toBeNull();
    expect(explainIcon(element('<div class="v5-login-scene"><span class="material-symbols-outlined">layers</span></div>'))).toBeNull();
    expect(explainIcon(element('<svg width="300" height="160" aria-label="Usage chart"></svg>'))).toBeNull();
  });
});

describe("native review action buttons", () => {
  it.each([
    ["Add model", "add"], ["Create dashboard", "add"], ["Edit widget", "edit"], ["Retry sync", "refresh"],
    ["Done", "check"], ["Cancel", "close"], ["Save changes", "save"], ["Delete connection", "delete"],
    ["Copy API key", "content_copy"], ["Customize dashboard", "dashboard_customize"],
    ["Pause animation", "pause"], ["Resume animation", "play_arrow"],
    ["Show all 8 models", "expand_more"], ["Show fewer models", "expand_less"],
    ["Manage", "settings"], ["Setup", "settings"], ["I've saved my backup codes", "check"],
    ["24 chunks", "expand_more"], ["Collapse 24 chunks", "expand_less"], ["Update now", "system_update"],
    ["Reopen login window", "login"], ["Prefer manual install instead?", "download"],
    ["Stuck? Switch to manual install", "download"], ["Try automatic update instead", "system_update"],
  ])("assigns the action glyph for %s", (label, name) => {
    expect(actionIcon(label)).toBe(name);
    expect(inferredButtonIcon(label)).toBe(name);
  });
  it.each(["1", "20", "30 days", "7D", "Today", "Yesterday", "All time", "All", "None", "Default"])("keeps %s as a selection value", (label) => {
    expect(actionIcon(label)).toBeNull();
  });
  it("preserves existing icons and semantic choices without adding duplicates", () => {
    expect(inferredButtonIcon(h(React.Fragment, {}, "Add model"))).toBe("add");
    expect(inferredButtonIcon(h(React.Fragment, {}, glyph("layers"), "Add model"))).toBeNull();
    expect(allowsIconTooltip(h(React.Fragment, {}, glyph("save")))).toBe(false);
    expect(inferredButtonIcon([glyph("layers"), "Add model"])).toBeNull();
    expect(inferredButtonIcon([h("svg", { key: "svg" }), "Edit model"])).toBeNull();
    expect(inferredButtonIcon("Edit model", { icon: "edit" })).toBeNull();
    expect(inferredButtonIcon("Retry", { loading: true })).toBeNull();
    expect(inferredButtonIcon("Retry", { "aria-busy": true })).toBeNull();
    for (const role of ["tab", "option", "switch", "radio", "checkbox"]) expect(inferredButtonIcon("Add model", { role })).toBeNull();
  });
  it("recognizes a forwarded MotionIcon without inferring another action glyph", async () => {
    const close = h(MotionIcon, { name: "close" });
    expect(inferredButtonIcon(close, { "aria-label": "Remove item" })).toBeNull();
    await mount(h(ReviewNativeButton, { "aria-label": "Remove item" }, close));
    const icons = container.querySelectorAll(".v5-motion-icon");
    expect(icons).toHaveLength(1);
    expect(icons[0].dataset.iconName).toBe("close");
    expect(container.querySelector("[data-icon-name='delete']")).toBeNull();
  });
  it("only excludes close and save icon descendants from help", () => {
    expect(allowsIconTooltip(glyph("close"))).toBe(false);
    expect(allowsIconTooltip(h("span", {}, glyph("save")))).toBe(false);
    expect(allowsIconTooltip(h("span", { name: "save" }))).toBe(false);
    expect(allowsIconTooltip(glyph("delete"))).toBe(true);
    expect(allowsIconTooltip(glyph("check"))).toBe(true);
  });
  it("adds an icon to the same native button while preserving refs, handlers and form behavior", async () => {
    const ref = React.createRef();
    const click = vi.fn();
    await mount(h("form", { id: "edit-form" }, h(ReviewNativeButton, { ref, type: "button", name: "action", value: "retry", className: "original-control", onClick: click }, "Retry provider sync")));
    const button = container.querySelector("button");
    expect(ref.current).toBe(button);
    expect(button.parentElement.tagName).toBe("FORM");
    expect(button.type).toBe("button");
    expect(button.name).toBe("action");
    expect(button.value).toBe("retry");
    expect(button.classList.contains("original-control")).toBe(true);
    expect(button.querySelectorAll(".v5-motion-icon")).toHaveLength(1);
    expect(button.querySelector(".v5-motion-icon").dataset.iconName).toBe("refresh");
    await act(async () => button.click());
    expect(click).toHaveBeenCalledOnce();
  });
  it("preserves a native button outside review scope", async () => {
    await mount(h(ReviewNativeButton, { className: "production-button", type: "submit" }, "Create combo"), false);
    const button = container.querySelector("button");
    expect(button.className).toBe("production-button");
    expect(button.textContent).toBe("Create combo");
    expect(button.children).toHaveLength(0);
  });
});

describe("animated review glyphs", () => {
  it("preserves native span refs, styles, accessible metadata and events while rendering an animated SVG", async () => {
    const ref = React.createRef();
    const click = vi.fn();
    await mount(h(ReviewGlyph, { ref, className: "text-xl original-icon", style: { color: "red" },
      "aria-label": "Add connection", "aria-hidden": "false", onClick: click }, "add"));
    const host = container.firstElementChild;
    expect(ref.current).toBe(host);
    expect(host.tagName).toBe("SPAN");
    expect(host.classList.contains("original-icon")).toBe(true);
    expect(host.style.color).toBe("red");
    expect(host.getAttribute("aria-label")).toBe("Add connection");
    expect(host.getAttribute("aria-hidden")).toBe("false");
    expect(host.querySelector("[data-icon-name='add'] svg")).not.toBeNull();
    expect(host.querySelector(".material-symbols-outlined")).toBeNull();
    expect(host.textContent).toBe("");
    await act(async () => host.click());
    expect(click).toHaveBeenCalledOnce();
  });

  it("preserves the original Material glyph outside the Storybook review", async () => {
    const ref = React.createRef();
    await mount(h(ReviewGlyph, { ref, className: "material-symbols-outlined original-icon", style: { fontSize: "24px" } }, "sync"), false);
    expect(ref.current).toBe(container.firstElementChild);
    expect(container.firstElementChild.className).toBe("material-symbols-outlined original-icon");
    expect(container.firstElementChild.style.fontSize).toBe("24px");
    expect(container.firstElementChild.textContent).toBe("sync");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders an animated SVG for unmapped glyphs rather than a static font fallback", async () => {
    await mount(h(MotionIcon, { name: "future_provider_state", size: "1em" }));
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector(".material-symbols-outlined")).toBeNull();
    expect(container.querySelector(".v5-motion-icon").dataset.v5AnimatedIcon).toBeTruthy();
    expect(getAnimatedIcon("future_provider_state")).toBe(getAnimatedIcon("unknown"));
  });

  it("keeps distinct navigation pages recognizable through distinct animated glyphs", () => {
    document.documentElement.dataset.v5Review = "true";
    const entries = [...reviewSidebarSections(NAV_SECTIONS).flatMap((section) => section.entries.flatMap((entry) => [entry, ...(entry.children || [])])), PROFILE_NAV_ITEM];
    const firstOwner = new Map();
    for (const entry of entries) {
      expect(ANIMATED_ICONS[entry.icon], `${entry.label} has a concrete animated icon`).toBeTruthy();
      const icon = getAnimatedIcon(entry.icon);
      expect(firstOwner.get(icon), `${entry.href || entry.key} shares its icon with ${firstOwner.get(icon) || "no other page"}`).toBeUndefined();
      firstOwner.set(icon, entry.href || entry.key);
    }
  });

  it("animates standalone icons on direct hover, keyboard focus and touch", async () => {
    await mount(h(MotionIcon, { name: "add", tabIndex: 0 }));
    const icon = container.firstElementChild;
    vi.useFakeTimers();
    await pointer(icon, "pointerenter");
    expect(iconAnimation.start).toHaveBeenCalledOnce();
    await pointer(icon, "pointerleave");
    expect(iconAnimation.stop).toHaveBeenCalledOnce();
    await act(async () => icon.focus());
    expect(iconAnimation.start).toHaveBeenCalledTimes(2);
    await act(async () => icon.blur());
    expect(iconAnimation.stop).toHaveBeenCalledTimes(2);
    await pointer(icon, "pointerdown", { pointerType: "touch" });
    expect(iconAnimation.start).toHaveBeenCalledTimes(3);
    await advance(650);
    expect(iconAnimation.stop).toHaveBeenCalledTimes(3);
  });

  it("removes gesture listeners and pending touch timers when an icon is unmounted", async () => {
    await mount(h(MotionIcon, { name: "add" }));
    const icon = container.firstElementChild;
    vi.useFakeTimers();
    await pointer(icon, "pointerdown", { pointerType: "touch" });
    await act(async () => root.render(null));
    const stoppedDuringUnmount = iconAnimation.stop.mock.calls.length;
    await pointer(icon, "pointerenter");
    await advance(650);
    expect(iconAnimation.start).toHaveBeenCalledOnce();
    expect(iconAnimation.stop).toHaveBeenCalledTimes(stoppedDuringUnmount);
  });

  it("respects reduced motion while retaining the visible SVG and tooltip identity", async () => {
    iconAnimation.reduced = true;
    await mount(h(MotionIcon, { name: "add", tabIndex: 0 }));
    const icon = container.firstElementChild;
    expect(iconAnimation.lastProps.isAnimated).toBe(false);
    expect(icon.querySelector("svg")).not.toBeNull();
    expect(icon.dataset.iconName).toBe("add");
    await pointer(icon, "pointerenter");
    await act(async () => icon.focus());
    await pointer(icon, "pointerdown", { pointerType: "touch" });
    expect(iconAnimation.start).not.toHaveBeenCalled();
  });
});

describe("Storybook-only native button source boundary", () => {
  it("changes JSX native buttons while leaving strings, copied HTML, comments and other tags literal", () => {
    const source = `const copied = "<button type='button'>Copy me</button>";\n// <button>Leave comment</button>\nexport default function Example() { return <div><button type="submit" onClick={save}>Save</button><button aria-label="Add item" /><Button>Add</Button><input type="button" /></div>; }`;
    const result = reviewNativeButtons(source, "/absolute/ReviewNativeButton.jsx");
    expect(result).toContain(`const copied = "<button type='button'>Copy me</button>";`);
    expect(result).toContain("// <button>Leave comment</button>");
    expect(result).toContain('<V5ReviewNativeButton type="submit" onClick={save}>Save</V5ReviewNativeButton>');
    expect(result).toContain('<V5ReviewNativeButton aria-label="Add item" />');
    expect(result).toContain('<Button>Add</Button><input type="button" />');
    expect(result).toContain('import V5ReviewNativeButton from "/absolute/ReviewNativeButton.jsx";');
  });
  it("leaves modules without JSX native buttons unchanged", () => {
    for (const source of ['export const html = "<button>Copied</button>";', 'export default () => <Button>Save</Button>;']) expect(reviewNativeButtons(source, "wrapper.jsx")).toBe(source);
  });
});

describe("Storybook-only animated glyph source boundary", () => {
  it("adapts JSX glyph spans while leaving copied HTML, comments, text and other tags untouched", () => {
    const source = `const copied = '<span class="material-symbols-outlined">sync</span>';\n// <span className="material-symbols-outlined">warning</span>\nexport default () => <div><span className="material-symbols-outlined text-xl" aria-hidden="true">sync</span><i className="material-symbols-outlined">edit</i><span className="plain">Model</span></div>;`;
    const result = reviewGlyphs(source, "/absolute/ReviewGlyph.jsx");
    expect(result).toContain(`const copied = '<span class="material-symbols-outlined">sync</span>';`);
    expect(result).toContain('// <span className="material-symbols-outlined">warning</span>');
    expect(result).toContain('<V5ReviewGlyph className="material-symbols-outlined text-xl" aria-hidden="true">sync</V5ReviewGlyph>');
    expect(result).toContain('<i className="material-symbols-outlined">edit</i><span className="plain">Model</span>');
    expect(result).toContain('import V5ReviewGlyph from "/absolute/ReviewGlyph.jsx";');
  });

  it("preserves dynamic glyphs and class expressions around adapted JSX spans", () => {
    const source = 'export default ({ icon, active }) => <span className={`material-symbols-outlined ${active ? "fill-1" : ""}`} onClick={toggle}>{icon}</span>;';
    expect(reviewGlyphs(source, "ReviewGlyph.jsx")).toContain('<V5ReviewGlyph className={`material-symbols-outlined ${active ? "fill-1" : ""}`} onClick={toggle}>{icon}</V5ReviewGlyph>');
  });

  it("adapts explicitly marked language icons without changing their children or native properties", () => {
    const source = 'export default () => <span data-icon-name="language" className="text-lg" aria-label="Change language">🇺🇸</span>;';
    expect(reviewGlyphs(source, "ReviewGlyph.jsx")).toContain('<V5ReviewGlyph data-icon-name="language" className="text-lg" aria-label="Change language">🇺🇸</V5ReviewGlyph>');
  });

  it("leaves modules without actual JSX glyph spans unchanged", () => {
    for (const source of ['export const text = "material-symbols-outlined";', 'export const html = \'<span class="material-symbols-outlined">sync</span>\';', 'export default () => <span>Model</span>;']) {
      expect(reviewGlyphs(source, "ReviewGlyph.jsx")).toBe(source);
    }
  });
});

const tooltip = () => document.querySelector("[data-v5-icon-tooltip]");
async function pointer(target, type, props = {}) {
  const next = new Event(type, { bubbles: true });
  for (const [key, value] of Object.entries(props)) Object.defineProperty(next, key, { value });
  await act(async () => target.dispatchEvent(next));
}
async function observeChanges() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
}
async function key(keyName) {
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: keyName, bubbles: true })));
}
async function advance(ms) { await act(async () => vi.advanceTimersByTime(ms)); }

describe("global review icon help lifecycle", () => {
  it.each(["button", "option", "checkbox"])("keeps pointer help on the icon rather than the %s row or its text", async (role) => {
    await mount(h(React.Fragment, {}, h(ReviewIconHelp), h("button", { role, "aria-label": "Select Augment Prism" },
      h("img", { src: "/providers/auggie.svg", alt: "auggie", width: 18, height: 18 }),
      h("span", { className: "model-name" }, "Augment Prism"))));
    const row = container.querySelector("button");
    const icon = row.querySelector("img");
    const text = row.querySelector(".model-name");
    vi.useFakeTimers();
    for (const target of [row, text]) {
      await pointer(target, "pointerover");
      await advance(120);
      expect(tooltip().style.visibility).toBe("hidden");
      expect(row.hasAttribute("aria-describedby")).toBe(false);
    }
    await pointer(icon, "pointerover");
    expect(tooltip().style.visibility).toBe("visible");
    expect(tooltip().textContent).toBe("Augment Auggie CLI provider");
    await pointer(icon, "pointerout", { relatedTarget: text });
    await advance(120);
    expect(tooltip().style.visibility).toBe("hidden");
    expect(row.hasAttribute("aria-describedby")).toBe(false);
    await act(async () => row.focus());
    expect(tooltip().style.visibility).toBe("visible");
    expect(row.getAttribute("aria-describedby")).toBe(tooltip().id);
  });

  it("recognizes SVG path hits without widening the pointer target to its action button", async () => {
    await mount(h(React.Fragment, {}, h(ReviewIconHelp), h("button", { "aria-label": "Edit model" },
      h("svg", { width: 18, height: 18, "aria-hidden": "true" }, h("path", { d: "M0 0" })),
      h("span", {}, "Edit model"))));
    const button = container.querySelector("button");
    const path = button.querySelector("path");
    vi.useFakeTimers();
    await pointer(path, "pointerover");
    expect(tooltip().textContent).toBe("Edit model");
    expect(tooltip().style.visibility).toBe("visible");
    await pointer(path, "pointerout", { relatedTarget: button });
    await advance(120);
    expect(tooltip().style.visibility).toBe("hidden");
    await pointer(button, "pointerover");
    await advance(120);
    expect(tooltip().style.visibility).toBe("hidden");
  });

  it("does not reveal an icon explanation when touching row space or text", async () => {
    const select = vi.fn();
    await mount(h(React.Fragment, {}, h(ReviewIconHelp), h("button", { role: "option", onClick: select },
      glyph("layers"), h("span", { className: "row-label" }, "Production fallback"))));
    const row = container.querySelector("button");
    vi.useFakeTimers();
    for (const target of [row, row.querySelector(".row-label")]) {
      await pointer(target, "pointerdown", { pointerType: "touch" });
      await advance(120);
      expect(tooltip().style.visibility).toBe("hidden");
    }
    await act(async () => row.click());
    expect(select).toHaveBeenCalledOnce();
    await pointer(row.querySelector(".material-symbols-outlined"), "pointerdown", { pointerType: "touch" });
    expect(tooltip().style.visibility).toBe("visible");
  });

  it.each(["mouse", "touch"])("does not mistake %s row-click focus for keyboard help", async (pointerType) => {
    await mount(h(React.Fragment, {}, h(ReviewIconHelp), h("button", { role: "option" },
      glyph("layers"), h("span", { className: "row-label" }, "Production fallback"))));
    const row = container.querySelector("button");
    const text = row.querySelector(".row-label");
    vi.useFakeTimers();
    await pointer(text, "pointerover", { pointerType });
    await pointer(text, "pointerdown", { pointerType });
    await act(async () => { row.focus(); row.click(); });
    await advance(120);
    expect(document.activeElement).toBe(row);
    expect(tooltip().style.visibility).toBe("hidden");
    expect(row.hasAttribute("aria-describedby")).toBe(false);
    await act(async () => row.blur());
    await key("Tab");
    await act(async () => row.focus());
    expect(tooltip().style.visibility).toBe("visible");
    expect(row.getAttribute("aria-describedby")).toBe(tooltip().id);
  });

  it("keeps capability-limit help on its glyph instead of the label or token-count text", async () => {
    await mount(h(React.Fragment, {}, h(ReviewIconHelp),
      h("span", { className: "v5-capability-limit", "aria-label": "Context window: 128,000 tokens" },
        glyph("data_object"), h("span", { className: "limit-label" }, "Context"), h("strong", {}, "128k"))));
    const limit = container.querySelector(".v5-capability-limit");
    vi.useFakeTimers();
    for (const target of [limit, limit.querySelector(".limit-label"), limit.querySelector("strong")]) {
      await pointer(target, "pointerover");
      await advance(120);
      expect(tooltip().style.visibility).toBe("hidden");
    }
    await pointer(limit.querySelector(".material-symbols-outlined"), "pointerover");
    expect(tooltip().style.visibility).toBe("visible");
    expect(tooltip().textContent).toBe("Context window: 128,000 tokens");
    await pointer(limit.querySelector(".material-symbols-outlined"), "pointerout", { relatedTarget: limit.querySelector("strong") });
    await advance(120);
    expect(tooltip().style.visibility).toBe("hidden");
  });

  it("explains action icons on hover and focused controls, preserving authored descriptions", async () => {
    await mount(h(React.Fragment, {}, h(ReviewIconHelp),
      h("span", { id: "field-help" }, "Connection settings"),
      h("button", { "aria-describedby": "field-help" }, glyph("refresh"), "Retry sync")));
    const button = container.querySelector("button");
    const icon = button.querySelector("span");
    await pointer(icon, "pointerover");
    expect(tooltip().style.visibility).toBe("visible");
    expect(tooltip().textContent).toBe("Retry sync");
    expect(button.getAttribute("aria-describedby").split(" ")).toEqual(["field-help", tooltip().id]);
    await pointer(icon, "pointerout", { relatedTarget: document.body });
    await act(async () => button.focus());
    expect(document.activeElement).toBe(button);
    expect(tooltip().textContent).toBe("Retry sync");
    vi.useFakeTimers();
    await act(async () => button.blur());
    await advance(120);
    expect(tooltip().style.visibility).toBe("hidden");
    expect(button.getAttribute("aria-describedby")).toBe("field-help");
  });

  it("makes a standalone informational icon keyboard reachable without changing its layout parent", async () => {
    await mount(h("section", {}, h(ReviewIconHelp), glyph("sync", { "aria-hidden": "true" })));
    const icon = container.querySelector("span");
    expect(icon.parentElement).toBe(container.querySelector("section"));
    expect(icon.getAttribute("tabindex")).toBe("0");
    expect(icon.getAttribute("aria-hidden")).toBeNull();
    expect(icon.dataset.v5IconHelp).toBe("Synchronize provider data");
    await act(async () => icon.focus());
    expect(tooltip().textContent).toBe("Synchronize provider data");
    expect(tooltip().style.visibility).toBe("visible");
  });

  it("suppresses Escape-dismissed help until the pointer leaves, then permits re-entry", async () => {
    await mount(h(React.Fragment, {}, h(ReviewIconHelp), h("button", { "aria-label": "Edit widget" }, glyph("edit"))));
    const icon = container.querySelector(".material-symbols-outlined");
    vi.useFakeTimers();
    await pointer(icon, "pointerover");
    await key("Escape");
    await advance(0);
    expect(tooltip().style.visibility).toBe("hidden");
    await pointer(icon, "pointerover");
    expect(tooltip().style.visibility).toBe("hidden");
    await pointer(icon, "pointerout", { relatedTarget: document.body });
    await pointer(icon, "pointerover");
    expect(tooltip().style.visibility).toBe("visible");
  });

  it("shows another control's explanation after dismissing the current one with Escape", async () => {
    await mount(h(React.Fragment, {}, h(ReviewIconHelp),
      h("button", { "aria-label": "Edit widget" }, glyph("edit")),
      h("button", { "aria-label": "Delete widget" }, glyph("delete"))));
    const [edit, remove] = container.querySelectorAll("button");
    vi.useFakeTimers();
    await act(async () => edit.focus());
    await key("Escape");
    await advance(0);
    expect(tooltip().style.visibility).toBe("hidden");
    await act(async () => remove.focus());
    expect(tooltip().textContent).toBe("Delete widget");
    expect(tooltip().style.visibility).toBe("visible");
  });

  it("dismisses help without consuming Escape owned by an open combobox", async () => {
    const close = vi.fn();
    await mount(h(React.Fragment, {}, h(ReviewIconHelp), h("button", {
      role: "combobox", "aria-expanded": "true", "aria-label": "Filter provider", onKeyDown: close,
    }, glyph("expand_more"))));
    const select = container.querySelector("button");
    vi.useFakeTimers();
    await act(async () => select.focus());
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => select.dispatchEvent(event));
    await advance(0);
    expect(close).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(false);
    expect(tooltip().style.visibility).toBe("hidden");
  });

  it("keeps help open while moving onto the tooltip, then hides it on departure", async () => {
    await mount(h(React.Fragment, {}, h(ReviewIconHelp), h("button", {}, glyph("edit"), "Edit model")));
    const icon = container.querySelector(".material-symbols-outlined");
    vi.useFakeTimers();
    await pointer(icon, "pointerover");
    await pointer(icon, "pointerout", { relatedTarget: tooltip() });
    await advance(120);
    expect(tooltip().style.visibility).toBe("visible");
    await pointer(tooltip(), "pointerout", { relatedTarget: document.body });
    await advance(120);
    expect(tooltip().style.visibility).toBe("hidden");
  });

  it("explains a touched icon temporarily without intercepting its button action", async () => {
    const click = vi.fn();
    await mount(h(React.Fragment, {}, h(ReviewIconHelp), h("button", { onClick: click }, glyph("delete"), "Delete connection")));
    const button = container.querySelector("button");
    const icon = button.querySelector("span");
    vi.useFakeTimers();
    await pointer(icon, "pointerdown", { pointerType: "touch" });
    await act(async () => button.click());
    expect(click).toHaveBeenCalledOnce();
    expect(tooltip().textContent).toBe("Delete connection");
    expect(tooltip().style.visibility).toBe("visible");
    await advance(2499);
    expect(tooltip().style.visibility).toBe("visible");
    await advance(121);
    expect(tooltip().style.visibility).toBe("hidden");
  });

  it("does not duplicate an existing described tooltip or annotate close and save exceptions", async () => {
    await mount(h(React.Fragment, {}, h(ReviewIconHelp), h("span", { id: "authored-tip", role: "tooltip" }, "Original edit explanation"),
      h("button", { "aria-describedby": "authored-tip" }, glyph("edit")),
      h("button", { "aria-label": "Close dialog" }, glyph("close")),
      h("button", { "aria-label": "Save combo" }, glyph("save"))));
    const icons = container.querySelectorAll(".material-symbols-outlined");
    for (const icon of icons) {
      await pointer(icon, "pointerover");
      expect(tooltip().style.visibility).toBe("hidden");
    }
    expect(icons[1].hasAttribute("data-v5-icon-help")).toBe(false);
    expect(icons[2].hasAttribute("data-v5-icon-help")).toBe(false);
    expect(container.querySelector("button").getAttribute("aria-describedby")).toBe("authored-tip");
  });

  it("annotates newly mounted icons and refreshes dynamic glyph meanings", async () => {
    await mount(h(React.Fragment, {}, h(ReviewIconHelp), glyph("sync")));
    const icon = container.querySelector(".material-symbols-outlined");
    await act(async () => { icon.textContent = "warning"; });
    await observeChanges();
    expect(icon.dataset.v5IconHelp).toBe("A warning needs attention");
    await act(async () => icon.focus());
    expect(tooltip().textContent).toBe("A warning needs attention");
    const late = document.createElement("button");
    late.setAttribute("aria-label", "Copy model ID");
    late.innerHTML = '<svg width="18" height="18"><path d="M0 0" /></svg>';
    document.body.append(late);
    portalNodes.push(late);
    await observeChanges();
    expect(late.querySelector("svg").dataset.v5IconHelp).toBe("Copy model ID");
    await pointer(late.querySelector("svg"), "pointerover");
    expect(tooltip().textContent).toBe("Copy model ID");
  });

  it("refreshes animated icon metadata when only its glyph attribute changes", async () => {
    await mount(h(React.Fragment, {}, h(ReviewIconHelp), h("span", { className: "v5-motion-icon", "data-icon-name": "sync", "aria-hidden": "true" }, h("svg", { width: 18, height: 18 }))));
    const icon = container.querySelector(".v5-motion-icon");
    await act(async () => { icon.setAttribute("data-icon-name", "warning"); });
    await observeChanges();
    expect(icon.dataset.v5IconHelp).toBe("A warning needs attention");
    await act(async () => icon.focus());
    expect(tooltip().textContent).toBe("A warning needs attention");
  });

  it("respects a new authored label and preserves newer metadata when help unmounts", async () => {
    await mount(h(React.Fragment, {}, h(ReviewIconHelp), glyph("warning", { "aria-hidden": "true" })));
    const icon = container.querySelector(".material-symbols-outlined");
    await act(async () => { icon.setAttribute("aria-label", "Warning for expired OpenAI credentials"); });
    await observeChanges();
    expect(icon.getAttribute("aria-label")).toBe("Warning for expired OpenAI credentials");
    expect(icon.dataset.v5IconHelp).toBe("Warning for expired OpenAI credentials");
    expect(icon.hasAttribute("data-v5-icon-generated-label")).toBe(false);
    await act(async () => icon.focus());
    expect(tooltip().textContent).toBe("Warning for expired OpenAI credentials");
    await act(async () => {
      icon.setAttribute("tabindex", "4");
      icon.setAttribute("role", "presentation");
      icon.setAttribute("title", "Latest authored title");
    });
    await observeChanges();
    await act(async () => root.render(h(React.Fragment, {}, null, glyph("warning", { "aria-hidden": "true" }))));
    expect(icon.getAttribute("aria-label")).toBe("Warning for expired OpenAI credentials");
    expect(icon.getAttribute("title")).toBe("Latest authored title");
    expect(icon.getAttribute("tabindex")).toBe("4");
    expect(icon.getAttribute("role")).toBe("presentation");
  });

  it("refreshes an open explanation when a focused glyph changes, and removes help for close/save exceptions", async () => {
    await mount(h(React.Fragment, {}, h(ReviewIconHelp), glyph("sync", { "aria-hidden": "true" })));
    const icon = container.querySelector(".material-symbols-outlined");
    await act(async () => icon.focus());
    expect(tooltip().textContent).toBe("Synchronize provider data");
    await act(async () => { icon.textContent = "warning"; });
    await observeChanges();
    expect(tooltip().textContent).toBe("A warning needs attention");
    await act(async () => { icon.textContent = "close"; });
    await observeChanges();
    expect(icon.hasAttribute("data-v5-icon-help")).toBe(false);
    expect(icon.hasAttribute("aria-label")).toBe(false);
    expect(icon.hasAttribute("tabindex")).toBe(false);
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 130)); });
    expect(tooltip().style.visibility).toBe("hidden");
  });

  it("restores authored attributes and descriptions when the review help is unmounted", async () => {
    await mount(h(React.Fragment, {}, h(ReviewIconHelp), h("span", { id: "detail" }, "Existing details"),
      h("button", { "aria-describedby": "detail", title: "Retry the failed synchronization" }, glyph("refresh")),
      glyph("sync", { "aria-hidden": "true", title: "Provider synchronization status" })));
    const button = container.querySelector("button");
    const standalone = container.querySelector(":scope > .material-symbols-outlined");
    const icon = button.querySelector("span");
    expect(button.hasAttribute("title")).toBe(false);
    await pointer(icon, "pointerover");
    expect(tooltip().textContent).toBe("Retry the failed synchronization");
    await act(async () => root.render(h(React.Fragment, {}, null, h("span", { id: "detail" }, "Existing details"),
      h("button", { "aria-describedby": "detail", title: "Retry the failed synchronization" }, glyph("refresh")),
      glyph("sync", { "aria-hidden": "true", title: "Provider synchronization status" }))));
    expect(tooltip()).toBeNull();
    expect(container.querySelector("button")).toBe(button);
    expect(button.getAttribute("aria-describedby")).toBe("detail");
    expect(button.getAttribute("title")).toBe("Retry the failed synchronization");
    expect(standalone.getAttribute("aria-hidden")).toBe("true");
    expect(standalone.getAttribute("title")).toBe("Provider synchronization status");
    expect(standalone.hasAttribute("tabindex")).toBe(false);
    expect(standalone.hasAttribute("role")).toBe(false);
    expect(standalone.hasAttribute("data-v5-icon-help")).toBe(false);
  });

  it("does not change or activate icons outside review scope", async () => {
    await mount(h(React.Fragment, {}, h(ReviewIconHelp), glyph("sync", { "aria-hidden": "true", title: "Sync status" })), false);
    const icon = container.querySelector(".material-symbols-outlined");
    await pointer(icon, "pointerover");
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(icon.getAttribute("title")).toBe("Sync status");
    expect(icon.hasAttribute("tabindex")).toBe(false);
    expect(icon.hasAttribute("data-v5-icon-help")).toBe(false);
    expect(tooltip().style.visibility).toBe("hidden");
  });
});


it("adapts native anchor JSX while preserving literal copied HTML", () => {
  const copied = `const html = ${JSON.stringify('<a href="/dashboard">copied</a>')};`;
  const source = `${copied} export default () => <a href="/dashboard/headroom">Open</a>;`;
  const result = reviewNativeButtons(source, "wrapper.jsx");
  expect(result).toContain('<V5ReviewNativeLink href="/dashboard/headroom">Open</V5ReviewNativeLink>');
  expect(result).toContain(copied);
});
