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

/** Parse a fully opaque CSS colour into RGB, or null when it is translucent. */
export function solidRgb(value) {
  const parts = String(value).match(/-?[\d.]+/g);
  if (!parts || parts.length < 3) return null;
  if (parts.length > 3 && Number(parts[3]) !== 1) return null;
  return parts.slice(0, 3).map(Number);
}

/** WCAG contrast ratio between two opaque RGB triples. */
export function contrastRatio(foreground, background) {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  const [hi, lo] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

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
  // Monaco names its input proxy `inputarea` or `ime-text-area` depending on
  // version; both are declared `color: transparent; background-color:
  // transparent; z-index: -10`, and both gain `ime-input` when composition
  // makes them visible. Match either, exclude the visible state, and still
  // re-check the paint below so a renamed class alone never clears a node.
  if (element.matches("textarea.inputarea:not(.ime-input), textarea.ime-text-area:not(.ime-input)")) {
    const style = computeStyle(element);
    const invisible = Number(style.zIndex) < 0
      && style.color === "rgba(0, 0, 0, 0)"
      && style.backgroundColor === "rgba(0, 0, 0, 0)";
    return invisible ? "monaco-input-proxy" : null;
  }
  // Ordinary DOM text axe declined to judge. Unlike SVG or the editor proxy,
  // a plain element's pair is computable here. Text usually sits on an
  // ancestor's surface rather than its own, so walk up for the nearest opaque
  // background, stopping at anything that makes the stack unreadable: an
  // image, a translucent fill, or a hidden or faded subtree. Clear the node
  // only when the resulting pair meets its own threshold.
  if (!(element instanceof SVGElement)) {
    const style = computeStyle(element);
    const foreground = solidRgb(style.color);
    if (!foreground) return null;
    let background = null;
    for (let node = element; node instanceof Element; node = node.parentElement) {
      const nodeStyle = computeStyle(node);
      if (nodeStyle.backgroundImage !== "none" || nodeStyle.visibility !== "visible" || nodeStyle.opacity !== "1") return null;
      // Only a fully transparent layer is see-through enough to keep walking.
      // Anything partly translucent makes the stack unreadable here, and a
      // prefix test would misread `rgba(0, 0, 0, 0.5)` as clear.
      const parts = String(nodeStyle.backgroundColor).match(/-?[\d.]+/g);
      if (!parts || parts.length < 3) return null;
      const alpha = parts.length > 3 ? Number(parts[3]) : 1;
      if (alpha === 0) continue;
      if (alpha !== 1) return null;
      background = parts.slice(0, 3).map(Number);
      break;
    }
    if (!background) return null;
    const size = Number.parseFloat(style.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    const ratio = contrastRatio(foreground, background);
    if (!Number.isFinite(ratio) || ratio < (large ? 4.5 : 7)) return null;
    return `measured-aaa ${ratio.toFixed(2)}:1`;
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
  const refused = [];
  const audited = entries.flatMap((entry) => {
    if (!CONTRAST_RULES.has(entry.id)) return [entry];
    const remaining = entry.nodes.filter((node) => {
      const element = resolve(node);
      if (!element) return true;
      const reason = exemptionFor(element, storyId, chartStories, computeStyle);
      if (!reason) {
        // Record why a candidate surface was NOT cleared, so a refusal is
        // diagnosable without another instrumented run.
        if (element.matches?.("textarea") || element.closest?.(".monaco-editor") || entry.id.startsWith("color-contrast")) {
          const style = computeStyle(element);
          refused.push({ storyId, target: node.target, rule: entry.id, tag: element.tagName, className: element.getAttribute?.("class") ?? null, text: element.textContent?.trim().slice(0, 40) ?? null, zIndex: style.zIndex, color: style.color, backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage, opacity: style.opacity, visibility: style.visibility, animationName: style.animationName, outerHTML: element.outerHTML?.slice(0, 300) ?? null });
        }
        return true;
      }
      unmeasurable.push({ storyId, target: node.target, rule: entry.id, reason });
      return false;
    });
    return remaining.length ? [{ ...entry, nodes: remaining }] : [];
  });
  return { entries: audited, unmeasurable, refused };
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
