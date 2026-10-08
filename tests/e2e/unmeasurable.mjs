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
/** Resolve the solid token/paint forms used by the guarded chart sources. */
function proofRgb(value) {
  const text = String(value).trim();
  if (/^#[\da-f]{6}$/i.test(text)) {
    return [1, 3, 5].map((offset) => Number.parseInt(text.slice(offset, offset + 2), 16));
  }
  if (!/^rgba?\([\d.,\s]+\)$/.test(text)) return null;
  const rgb = solidRgb(text);
  return rgb?.every((channel) => Number.isFinite(channel) && channel >= 0 && channel <= 255) ? rgb : null;
}

/** Composite CSS background layers, without inventing an opaque backdrop. */
function paintedBackground(element, computeStyle, inspectOuterAncestors = false) {
  const stack = [];
  let background = null;
  for (let node = element; node instanceof Element; node = node.parentElement) {
    const style = computeStyle(node);
    if (style.backgroundImage !== "none" || style.visibility !== "visible" || style.opacity !== "1") return null;
    if (inspectOuterAncestors && (
      style.display === "none" || style.filter !== "none" || style.mixBlendMode !== "normal"
    )) return null;
    if (background) continue;
    if (inspectOuterAncestors && !/^rgba?\([\d.,\s]+\)$/.test(String(style.backgroundColor))) return null;
    const parts = String(style.backgroundColor).match(/-?[\d.]+/g);
    if (!parts || parts.length < 3) return null;
    const alpha = parts.length > 3 ? Number(parts[3]) : 1;
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) return null;
    const rgb = parts.slice(0, 3).map(Number);
    if (!rgb.every((channel) => Number.isFinite(channel) && channel >= 0 && channel <= 255)) return null;
    if (alpha === 0) continue;
    if (alpha === 1) {
      background = rgb;
      if (!inspectOuterAncestors) break;
    } else stack.push({ rgb, alpha });
  }
  if (!background) return null;
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const { rgb, alpha } = stack[i];
    background = background.map((channel, c) => rgb[c] * alpha + channel * (1 - alpha));
  }
  return background;
}
// Paint tokens from the seven sources covered by the chart contrast proof.
// The story allowlist is still required; these families do not add stories.
const CHART_FILL_TOKENS = [
  ["durin-ds-pages-console-log--", ["--dd-info"]],
  ["production-usage-usage-surfaces--", ["--dd-accent", "--dd-accent-2"]],
  ["durin-ds-pages-headroom--", ["--dd-accent"]],
  ["durin-ds-pages-timeline--", ["--dd-accent"]],
  ["durin-ds-pages-token-saver-statistics--", ["--dd-accent"]],
  ["production-pxpipe-pxpipeclient--", ["--dd-accent"]],
  ["production-pxpipe-pxpipepage--", ["--dd-accent"]],
  ["production-savers-tokensaveroverview--", ["--dd-accent"]],
  ["production-savers-tokensaverclient--", ["--dd-accent"]],
];

/** Prove separation using live vector bounds, including caps/joins/transform. */
function strokeMissesGlyph(paint, glyph, style, computeStyle) {
  const width = String(style.strokeWidth).match(/^([\d.]+)px$/);
  if (!width || !["butt", "round", "square"].includes(style.strokeLinecap)
    || !["miter", "round", "bevel"].includes(style.strokeLinejoin)) return false;
  const strokeWidth = Number(width[1]);
  const miterLimit = Number(style.strokeMiterlimit);
  if (!Number.isFinite(strokeWidth) || strokeWidth < 0
    || !Number.isFinite(miterLimit) || miterLimit < 1) return false;
  for (let ancestor = paint; ancestor; ancestor = ancestor.parentElement) {
    const ancestorStyle = computeStyle(ancestor);
    if (ancestorStyle.perspective !== "none" || String(ancestorStyle.transform).startsWith("matrix3d(")) return false;
  }
  if (!["none", "non-scaling-stroke"].includes(style.vectorEffect)) return false;
  const matrix = paint.getScreenCTM?.();
  if (!matrix || ![matrix.a, matrix.b, matrix.c, matrix.d].every(Number.isFinite)) return false;
  let scaleX = Math.hypot(matrix.a, matrix.c);
  let scaleY = Math.hypot(matrix.b, matrix.d);
  if (style.vectorEffect === "non-scaling-stroke") {
    // Cover both host/CSS scaling and an unscaled SVG stroke conservatively.
    scaleX = Math.max(1, scaleX);
    scaleY = Math.max(1, scaleY);
  }
  const rect = paint.getBoundingClientRect();
  const tick = glyph.getBoundingClientRect();
  if (![rect.left, rect.right, rect.top, rect.bottom, tick.left, tick.right, tick.top, tick.bottom].every(Number.isFinite)
    || tick.right <= tick.left || tick.bottom <= tick.top) return false;
  const extent = strokeWidth / 2 * Math.max(
    !paint.matches("line, circle, ellipse") && style.strokeLinejoin === "miter" ? miterLimit : 1,
    style.strokeLinecap === "square" ? Math.SQRT2 : 1,
  );
  // Keep touching bounds unresolved; include a conservative fringe, not a
  // claim about raster pixels or the glyph's exact outline.
  const x = extent * scaleX + 1;
  const y = extent * scaleY + 1;
  return rect.right + x < tick.left || rect.left - x > tick.right
    || rect.bottom + y < tick.top || rect.top - y > tick.bottom;
}


/**
 * Re-prove the source guard against this SVG's live paint, not an old capture.
 * Guarded sources use muted/subtle glyphs, an opaque surface and source-specific
 * area gradients capped at 0.14. Unrecognised paints remain unresolved. Bound
 * possible fill/stroke overlaps; exclude a stroke only with live conservative
 * nonintersection proof. Historical captures establish no passing pair.
 */
function chartPaintProved(element, storyId, computeStyle) {
  if (!(element instanceof SVGElement) || !element.matches("text, tspan")) return false;
  const svg = element.closest("svg");
  if (!svg) return false;
  const style = computeStyle(element);
  const same = (a, b) => a && b && a.every((channel, c) => channel === b[c]);
  const token = (name) => proofRgb(style.getPropertyValue?.(name));
  const foreground = proofRgb(style.fill);
  const surface = token("--dd-surface");
  if (!foreground || !surface || style.fillOpacity !== "1" || style.stroke !== "none") return false;
  if (![token("--dd-text-muted"), token("--dd-text-subtle")].some((rgb) => same(foreground, rgb))) return false;
  const background = paintedBackground(element, computeStyle, true);
  if (!same(background, surface)) return false;
  const paintTokens = CHART_FILL_TOKENS.find(([prefix]) => storyId.startsWith(prefix))?.[1];
  if (!paintTokens) return false;
  const fills = paintTokens.map(token).filter(Boolean);
  let darkest = [...background];
  let lightest = [...background];
  const bound = (rgb, alpha) => {
    darkest = darkest.map((channel, c) => Math.min(channel, rgb[c] * alpha + channel * (1 - alpha)));
    lightest = lightest.map((channel, c) => Math.max(channel, rgb[c] * alpha + channel * (1 - alpha)));
  };
  for (const paint of svg.querySelectorAll("path, line, rect, circle, ellipse, polygon, polyline, image, foreignObject, use")) {
    if (paint.closest("defs")) continue;
    if (paint.matches("image, foreignObject, use")) return false;
    // A faded/filter/blended area is outside the guarded source paint model.
    for (let ancestor = paint; ancestor && ancestor !== svg.parentElement; ancestor = ancestor.parentElement) {
      const ancestorStyle = computeStyle(ancestor);
      if (ancestorStyle.opacity !== "1" || ancestorStyle.visibility !== "visible"
        || ancestorStyle.display === "none" || ancestorStyle.filter !== "none"
        || ancestorStyle.mixBlendMode !== "normal" || ancestorStyle.backgroundImage !== "none") return false;
    }
    const paintStyle = computeStyle(paint);
    if ([paintStyle.markerStart, paintStyle.markerMid, paintStyle.markerEnd].some((marker) => marker !== "none")) return false;
    // No fill does not mean no paint. Only proved separation can remove a
    // stroke from this audit. Potential intersection/unknown bounds remain
    // incomplete; do not assume paint order or an unchanged glyph foreground.
    if (paintStyle.stroke !== "none" && !strokeMissesGlyph(paint, element, paintStyle, computeStyle)) return false;
    // SVG lines have no fillable interior; their stroke was audited above.
    if (paint.matches("line") || paintStyle.fill === "none") continue;
    // Some guarded charts explicitly paint the same opaque surface in SVG.
    if (paint.matches("rect") && same(proofRgb(paintStyle.fill), surface) && paintStyle.fillOpacity === "1") continue;
    const reference = String(paintStyle.fill).match(/^url\(["']?([^"')]+)["']?\)$/)?.[1];
    if (!reference) return false;
    let url;
    try { url = new URL(reference, svg.ownerDocument.baseURI); } catch { return false; }
    if (url.href.split("#")[0] !== new URL(svg.ownerDocument.baseURI).href.split("#")[0] || !url.hash) return false;
    const gradient = svg.ownerDocument.getElementById(url.hash.slice(1));
    if (!gradient || !svg.contains(gradient) || gradient.localName !== "linearGradient"
      || gradient.hasAttribute("href") || gradient.hasAttribute("xlink:href")) return false;
    const stops = [...gradient.children];
    if (stops.length < 2 || stops.some((stop) => stop.localName !== "stop")) return false;
    let fill = null;
    let alpha = 0;
    for (const stop of stops) {
      const stopStyle = computeStyle(stop);
      if (typeof stopStyle.stopOpacity !== "string" || !stopStyle.stopOpacity.trim()
        || stopStyle.opacity !== "1" || stopStyle.filter !== "none"
        || stopStyle.mixBlendMode !== "normal") return false;
      const rgb = proofRgb(stopStyle.stopColor);
      const opacity = Number(stopStyle.stopOpacity);
      if (!rgb || !fills.some((fillToken) => same(rgb, fillToken)) || (fill && !same(fill, rgb))
        || !Number.isFinite(opacity) || opacity < 0 || opacity > 0.14) return false;
      fill = rgb;
      alpha = Math.max(alpha, opacity);
    }
    if (typeof paintStyle.fillOpacity !== "string" || !paintStyle.fillOpacity.trim()) return false;
    const fillOpacity = Number(paintStyle.fillOpacity);
    if (!Number.isFinite(fillOpacity) || fillOpacity < 0 || fillOpacity > 1) return false;
    alpha *= fillOpacity;
    bound(fill, alpha);
  }
  return [darkest, lightest].every((backdrop) => {
    const ratio = contrastRatio(foreground, backdrop);
    return Number.isFinite(ratio) && ratio >= 7;
  });
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
    // The allowlist identifies guarded sources, not an exemption by itself.
    // Live glyphs, ancestor paint and SVG fills must still match that proof.
    return chartStories.includes(storyId) && chartPaintProved(element, storyId, computeStyle)
      ? "chart-axis-aaa-v1" : null;
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
  // ancestor's surface rather than its own, so walk up compositing each
  // layer onto the next until an opaque one is reached. A translucent tint
  // (a `bg-dd-*-soft` chip, a `/10` danger wash) is exactly what axe gives
  // up on, yet it is ordinary alpha compositing over a known backdrop, so
  // the resulting pair is exact rather than assumed. Stop at anything that
  // genuinely makes the stack unreadable: an image or gradient, or a hidden
  // or faded subtree. Clear the node only when the composited pair meets its
  // own threshold.
  if (!(element instanceof SVGElement)) {
    const style = computeStyle(element);
    const foreground = solidRgb(style.color);
    if (!foreground) return null;
    const background = paintedBackground(element, computeStyle);
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
