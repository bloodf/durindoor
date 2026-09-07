/**
 * axe reports two surfaces this dashboard owns as `incomplete` rather than
 * failing them, because it cannot resolve either: text inside an SVG, which it
 * treats as an image (dequelabs/axe-core#1819), and Monaco's input proxy, which
 * is transparent and painted behind the editor. The coverage contract counts an
 * incomplete as a failure, so those nodes stay red for a verdict axe never
 * reached.
 *
 * This is the policy that separates "could not measure" from "measured and
 * failed". It is deliberately narrow and fail-closed: a node is only dropped
 * when it is one of those two surfaces AND the proof for it still holds. It
 * runs inside the page during the evidence sweep and is exercised directly by
 * tests/unit/storybook-unmeasurable.test.js.
 */

/** Rules whose incomplete results may be audited; nothing else is touched. */
const CONTRAST_RULES = new Set(["color-contrast", "color-contrast-enhanced"]);

/**
 * Why this node cannot be measured, or null when it must keep failing.
 *
 * @param {Element} element node axe reported
 * @param {string} storyId story currently rendering
 * @param {readonly string[]} chartStories stories whose chart contrast is proved
 * @param {(element: Element) => CSSStyleDeclaration} computeStyle style reader
 */
export function exemptionFor(element, storyId, chartStories, computeStyle) {
  // Recharts labels the tick group `-tick` and the text inside it
  // `-tick-label`; axe reports the `tspan`, whose nearest labelled ancestor
  // can be either. Match both so nesting cannot silently defeat the policy.
  if (element.closest(".recharts-cartesian-axis-tick, .recharts-cartesian-axis-tick-label")) {
    // A DOM walk cannot see the area fill drawn between the surface and the
    // glyph, so the ratio is proved out of band, per chart source, by
    // tests/unit/durin-ds-contrast.test.js. Honour that proof only for the
    // stories it covers; any other chart keeps failing.
    return chartStories.includes(storyId) ? "chart-axis-aaa-v1" : null;
  }
  if (element.matches("textarea.inputarea:not(.ime-input)")) {
    // Monaco parks this at the caret to receive keystrokes and IME
    // composition. Re-check that it really is invisible right now, so the
    // `.ime-input` state a person composing CJK text sees stays checked.
    const style = computeStyle(element);
    const invisible = Number(style.zIndex) < 0
      && style.color === "rgba(0, 0, 0, 0)"
      && style.backgroundColor === "rgba(0, 0, 0, 0)";
    return invisible ? "monaco-input-proxy" : null;
  }
  return null;
}

/**
 * Drop unmeasurable nodes from incomplete results, keeping every other node.
 * An entry survives with its remaining nodes, so a mixed entry still fails.
 *
 * @returns {{ entries: object[], unmeasurable: object[] }}
 */
export function auditIncomplete(entries, { storyId, chartStories, resolve, computeStyle }) {
  const unmeasurable = [];
  const audited = entries.flatMap((entry) => {
    if (!CONTRAST_RULES.has(entry.id)) return [entry];
    const remaining = entry.nodes.filter((node) => {
      const element = resolve(node);
      if (!element) return true;
      const reason = exemptionFor(element, storyId, chartStories, computeStyle);
      if (!reason) return true;
      unmeasurable.push({ storyId, target: node.target, rule: entry.id, reason });
      return false;
    });
    return remaining.length ? [{ ...entry, nodes: remaining }] : [];
  });
  return { entries: audited, unmeasurable };
}

/** Resolve an axe node, refusing targets that cross a frame or shadow root. */
export function resolveNode(node, root) {
  if (!Array.isArray(node.target) || node.target.length !== 1) return null;
  const [selector] = node.target;
  if (typeof selector !== "string") return null;
  try {
    return root.querySelector(selector);
  } catch {
    return null;
  }
}
