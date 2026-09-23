// Pure ChatGPT-web citation-marker parsing/rendering, extracted verbatim from
// chatgpt-web-http.js (no module state — safe to unit test in isolation).
//
// Strip ChatGPT's internal entity/citation markup. The browser renders these
// private-use markers (for example `citeturn0search0`) with metadata from
// `message.metadata.content_references`; API clients need plain Markdown with
// real links instead of raw ChatGPT UI tokens.
//   entity["city","Paris","capital of France"]  →  Paris
//   entity["…","value", …]                       →  value

import { isNumber, isObject, isString } from "../../../src/shared/utils/typeChecks.js";

const ENTITY_RE = /entity\["[^"]*","([^"]*)"[^\]]*\]/g;
const CHATGPT_MARKER_START = "\uE200";
const CHATGPT_MARKER_SEP = "\uE202";
const CHATGPT_MARKER_END = "\uE201";
const CHATGPT_REF_TOKEN_RE = /turn\d+(?:search|product|news|image|webpage)\d+/g;

function asRecord(value) {
  return value && isObject(value) ? value : null;
}

function asString(value) {
  return isString(value) && value.trim() ? value : null;
}

function asNumber(value) {
  return isNumber(value) && Number.isFinite(value) ? value : null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function markdownLinkText(value) {
  // Escape the backslash first — otherwise a label ending in (or containing) a
  // backslash leaks past the `[…]` escaping and breaks the generated link, e.g.
  // `[Path C:\](url)` where the trailing `\` escapes the closing bracket.
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\n/g, " ")
    .trim();
}

function markdownUrl(value) {
  return value.replace(/\(/g, "%28").replace(/\)/g, "%29");
}

function canonicalCitationUrl(value) {
  try {
    const url = new URL(value);
    url.searchParams.delete("utm_source");
    return url.toString();
  } catch {
    return value;
  }
}

function referenceUrls(ref) {
  const urls = [];
  for (const key of ["url", "safe_url", "link"]) {
    const url = asString(ref[key]);
    if (url) urls.push(url);
  }
  for (const url of asArray(ref.safe_urls)) {
    if (isString(url) && url.trim()) urls.push(url);
  }
  return [...new Set(urls)];
}

function refTokenFromStructuredRef(ref) {
  const turn = asNumber(ref.turn_index);
  const refType = asString(ref.ref_type);
  const refIndex = asNumber(ref.ref_index);
  if (turn == null || refIndex == null || !refType) return null;
  return `turn${turn}${refType}${refIndex}`;
}

function mapStructuredRefs(refs, sourceNumber, refTokenToSourceNumber) {
  for (const refValue of asArray(refs)) {
    const ref = asRecord(refValue);
    if (!ref) continue;
    const token = refTokenFromStructuredRef(ref);
    if (token && !refTokenToSourceNumber.has(token)) {
      refTokenToSourceNumber.set(token, sourceNumber);
    }
  }
}

function formatCitationLinks(numbers, sources) {
  return [...new Set(numbers)]
    .sort((a, b) => a - b)
    .map((num) => {
      const source = sources[num - 1];
      return source ? `[${num}](${markdownUrl(source.url)})` : "";
    })
    .filter(Boolean)
    .join("");
}

function urlMarkerLabel(markerText) {
  if (!markerText) return null;
  const privateMatch = markerText.match(/\uE200url\uE202([^\uE201\uE202]+)/u);
  if (privateMatch?.[1]) return privateMatch[1].trim();
  const plainMatch = markerText.match(/^url[:\s]+(.+)$/i);
  return plainMatch?.[1]?.trim() || null;
}

function citationMarkerCandidates(markerText) {
  if (!markerText) return [];
  const candidates = [markerText];
  const tokens = markerText.match(CHATGPT_REF_TOKEN_RE) ?? [];
  if (tokens.length > 0 && markerText.includes("cite")) {
    candidates.push(
      `${CHATGPT_MARKER_START}cite${tokens.map((token) => CHATGPT_MARKER_SEP + token).join("")}${CHATGPT_MARKER_END}`
    );
  }
  return [...new Set(candidates)];
}

/** Supporting-website sources nested under one `grouped_webpages` item. */
function collectSupportingWebsiteNumbers(item, addSource, refTokenToSourceNumber) {
  const numbers = [];
  for (const supportingValue of asArray(item.supporting_websites)) {
    const supporting = asRecord(supportingValue);
    if (!supporting) continue;
    const supportingNumber = addSource(supporting.title, supporting.url, supporting.attribution);
    if (supportingNumber) {
      numbers.push(supportingNumber);
      mapStructuredRefs(supporting.refs, supportingNumber, refTokenToSourceNumber);
    }
  }
  return numbers;
}

/** One `grouped_webpages` item — its own primary source plus any supporting-website
 * sources nested under it. */
function collectGroupedWebpageItemNumbers(itemValue, addSource, refTokenToSourceNumber) {
  const item = asRecord(itemValue);
  if (!item) return [];
  const numbers = [];
  const mainNumber = addSource(item.title, item.url, item.attribution);
  if (mainNumber) {
    numbers.push(mainNumber);
    mapStructuredRefs(item.refs, mainNumber, refTokenToSourceNumber);
  }
  numbers.push(...collectSupportingWebsiteNumbers(item, addSource, refTokenToSourceNumber));
  return numbers;
}

/** Fallback when no `grouped_webpages` item yielded a usable source — fall back to
 * the ref's own URLs directly. */
function collectGroupedWebpagesFallbackNumbers(ref, addSource) {
  const numbers = [];
  for (const url of referenceUrls(ref)) {
    const fallbackNumber = addSource(ref.title, url, ref.attribution);
    if (fallbackNumber) numbers.push(fallbackNumber);
  }
  return numbers;
}

/** `content_references[].type === "grouped_webpages"` — a primary source per item,
 * each optionally paired with supporting-website sources; falls back to the ref's
 * own URLs when no item yielded a usable source. */
function collectGroupedWebpagesRef(ref, sources, addSource, addMention, refTokenToSourceNumber) {
  let numbers = [];
  for (const itemValue of asArray(ref.items)) {
    numbers.push(...collectGroupedWebpageItemNumbers(itemValue, addSource, refTokenToSourceNumber));
  }

  if (numbers.length === 0) {
    numbers = collectGroupedWebpagesFallbackNumbers(ref, addSource);
  }

  addMention(ref, formatCitationLinks(numbers, sources));
}

/** `content_references[].type === "sources_footnote"` — a flat list of sources with
 * no inline mention to replace (the footnote itself carries no marker text). */
function collectSourcesFootnoteRef(ref, addSource) {
  for (const sourceValue of asArray(ref.sources)) {
    const source = asRecord(sourceValue);
    if (source) addSource(source.title, source.url, source.attribution);
  }
}

/** Any other reference type — a direct `webpage`/`url` marker with an inline label
 * renders as `[label](url)`; everything else falls back to numbered source links. */
function collectDefaultRef(ref, type, sources, addSource, addMention, refTokenToSourceNumber) {
  const urls = referenceUrls(ref);
  const label = urlMarkerLabel(asString(ref.matched_text));
  if ((type === "webpage" || type === "url") && label && urls[0]) {
    addMention(ref, `[${markdownLinkText(label)}](${markdownUrl(urls[0])})`);
    return;
  }

  const numbers = urls
    .map((url) => addSource(ref.title ?? ref.alt, url, ref.attribution))
    .filter((num) => num > 0);
  if (numbers.length === 0) return;

  mapStructuredRefs(ref.refs, numbers[0], refTokenToSourceNumber);
  addMention(ref, formatCitationLinks(numbers, sources));
}

function collectChatGptCitationData(metadata) {
  const refs = asArray(metadata?.content_references);
  const sources = [];
  const mentions = [];
  const sourceIndexByCanonicalUrl = new Map();
  const refTokenToSourceNumber = new Map();

  const addSource = (titleValue, urlValue, attributionValue) => {
    const url = asString(urlValue);
    if (!url) return 0;
    const canonical = canonicalCitationUrl(url);
    const existing = sourceIndexByCanonicalUrl.get(canonical);
    if (existing) return existing;

    const title = asString(titleValue) ?? url;
    const attribution = asString(attributionValue) ?? "";
    const idx = sources.length + 1;
    sources.push({ title: title.replace(/\n/g, " ").trim(), url, attribution });
    sourceIndexByCanonicalUrl.set(canonical, idx);
    return idx;
  };

  const addMention = (ref, replacement) => {
    if (!replacement) return;
    const start = asNumber(ref.start_idx);
    const end = asNumber(ref.end_idx);
    const markerText = asString(ref.matched_text) ?? undefined;
    if (markerText || (start != null && end != null)) {
      const mention = { replacement };
      if (start != null) mention.start = start;
      if (end != null) mention.end = end;
      if (markerText) mention.markerText = markerText;
      mentions.push(mention);
    }
  };

  for (const refValue of refs) {
    const ref = asRecord(refValue);
    if (!ref) continue;
    const type = asString(ref.type) ?? "";

    if (type === "grouped_webpages") {
      collectGroupedWebpagesRef(ref, sources, addSource, addMention, refTokenToSourceNumber);
      continue;
    }
    if (type === "sources_footnote") {
      collectSourcesFootnoteRef(ref, addSource);
      continue;
    }
    collectDefaultRef(ref, type, sources, addSource, addMention, refTokenToSourceNumber);
  }

  return { sources, mentions, refTokenToSourceNumber };
}

function replacePrivateCitationMarkers(text, citationData) {
  const replaceTokens = (tokens) => {
    const numbers = tokens
      .map((token) => citationData.refTokenToSourceNumber.get(token))
      .filter((num) => isNumber(num));
    return numbers.length > 0 ? formatCitationLinks(numbers, citationData.sources) : "";
  };

  return text
    .replace(/\uE200cite((?:\uE202[^\uE201\uE202]+)+)\uE201/gu, (_all, body) => {
      const tokens = [...body.matchAll(/\uE202([^\uE201\uE202]+)/gu)].map((match) => match[1]);
      return replaceTokens(tokens);
    })
    .replace(/\bcite((?:turn\d+(?:search|product|news|image|webpage)\d+)+)\b/g, (_all, body) => {
      return replaceTokens(body.match(CHATGPT_REF_TOKEN_RE) ?? []);
    });
}

function stripDanglingChatGptMarkers(text, citationData) {
  return replacePrivateCitationMarkers(text, citationData)
    .replace(
      /\uE200url\uE202([^\uE201\uE202]+)\uE202(https?:\/\/[^\uE201]+)\uE201/gu,
      (_all, label, url) => {
        return `[${markdownLinkText(label)}](${markdownUrl(url)})`;
      }
    )
    .replace(/\uE200url\uE202([^\uE201\uE202]+)\uE202(?:[^\uE201]*\uE201)?/gu, (_all, label) => {
      return label.trim();
    })
    .replace(/\uE200cite(?:\uE202[^\uE201\uE202]*)*$/gu, "")
    .replace(/\uE200[a-z_]+(?:\uE202[^\uE201\uE202]*)*\uE201/giu, "")
    .replace(/\uE200[a-z_]+(?:\uE202[^\uE201\uE202]*)*$/giu, "")
    .replace(/\uE202?turn\d+(?:search|product|news|image|webpage)\d+\uE201?/gu, "")
    .replace(/[\uE200\uE201\uE202]/gu, "");
}

function applyChatGptCitations(text, metadata) {
  const citationData = collectChatGptCitationData(metadata);
  let rendered = text;

  for (const mention of [...citationData.mentions].sort(
    (a, b) => (b.start ?? -1) - (a.start ?? -1)
  )) {
    let replaced = false;
    for (const markerText of citationMarkerCandidates(mention.markerText)) {
      const limit =
        mention.start != null
          ? Math.min(rendered.length, mention.start + markerText.length)
          : rendered.length;
      let pos = rendered.lastIndexOf(markerText, limit);
      if (pos < 0) pos = rendered.indexOf(markerText);
      if (pos >= 0) {
        rendered =
          rendered.slice(0, pos) + mention.replacement + rendered.slice(pos + markerText.length);
        replaced = true;
        break;
      }
    }

    if (!replaced && mention.start != null && mention.end != null) {
      const start = Math.max(0, Math.min(mention.start, rendered.length));
      const end = Math.max(start, Math.min(mention.end, rendered.length));
      rendered = rendered.slice(0, start) + mention.replacement + rendered.slice(end);
    }
  }

  return stripDanglingChatGptMarkers(rendered, citationData);
}

export function cleanChatGptText(text, metadata) {
  return applyChatGptCitations(text.replace(ENTITY_RE, "$1"), metadata);
}
