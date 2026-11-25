import { isObject, isNumber, isString } from "../../../src/shared/utils/typeChecks.js";
import { RESPONSES_ITEM, ROLE, CLAUDE_STOP, MODEL_FALLBACK } from "../schema/index.js";
import { buildChunk } from "../concerns/chunk.js";
import { chargeRetained, releaseRetained } from "../../utils/streamRetainedBudget.js";

/**
 * Compatibility contract for Responses text recovery (#1073).
 *
 * - Source order: the text of an output item reaches the client in the
 *   upstream source order. A delta of a later item waits behind an earlier
 *   item that can still owe text, and the recovered suffix of that earlier
 *   item is emitted before the later item's text.
 * - Item identity: a rotated item_id on a known output position stays the same
 *   item, and a new item that reuses an output position stays a different item.
 * - Snapshots extend the tracked text of their item. A snapshot that does not
 *   extend it is not replayed, and the streamed text is kept.
 * - Held text is released once, in source order: when the item it waits behind
 *   finishes, on a terminal event, and on an error or a cancel.
 */

/**
 * Upper bound for the text held back to preserve source order. The hold exists
 * only to keep a later item behind an earlier one that can still contribute a
 * recovered suffix; it drains as soon as that earlier item finishes. The cap
 * keeps a malformed stream from growing the hold without bound: past it the
 * ordering guarantee is dropped and the held text is released in source order.
 */
const MAX_HELD_TEXT_CHARS = 256 * 1024;

/**
 * What an event says about its text, used to decide whether an unseen item_id on an
 * already-tracked output_index is the same item under a rotated id (GitHub Copilot
 * rotates item_id on every event) or a genuinely new item reusing the index.
 */
function tracker(state) {
  return (state.responsesTextSnapshots ??= {
    closed: false,
    sequence: 0,
    items: new Set(),
    byId: new Map(),
    byIndex: new Map(),
    // Creation counter: gives an item without a declared position a stable rank.
    created: 0,
    // Characters currently held back to preserve source order.
    heldChars: 0,
  });
}
function object(value) {
  return value && isObject(value) && !Array.isArray(value) ? value : null;
}
function index(value) {
  if (!isNumber(value) && (!isString(value) || !value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}
function mergeParts(target, source) {
  // Fragments from aliases may interleave before an item event links their IDs.
  for (const fragment of source.fragments) target.fragments.push(fragment);
  target.fragments.sort((a, b) => a.order - b.order);
  target.length += source.length;
  target.closed ||= source.closed;
}
function mergeItems(t, target, source) {
  for (const [key, part] of source.parts) {
    const existing = target.parts.get(key);
    if (existing) mergeParts(existing, part);
    else target.parts.set(key, part);
  }
  for (const [key, item] of t.byIndex) if (item === source) t.byIndex.set(key, target);
  for (const [key, item] of t.byId) if (item === source) t.byId.set(key, target);
  if (t.anonymous === source) t.anonymous = undefined;
  target.closed ||= source.closed;
  // The merged item keeps the source's source position and held text.
  if (target.index === undefined) target.index = source.index;
  if (source.held?.length) {
    (target.held ??= []).push(...source.held);
    source.held = [];
  }
  t.items.delete(source);
}
function trackedText(part) {
  return part.fragments.map((fragment) => fragment.text).join("");
}
function snapshotTextFor(texts, key, partCount) {
  const exact = texts.get(key);
  if (exact !== undefined) return exact;
  // An unindexed side can only pair with the other side's sole part.
  const unindexed = key === null || texts.has(null);
  return unindexed && texts.size === 1 && partCount === 1 ? [...texts.values()][0] : undefined;
}
/** A snapshot proves continuity only when it extends text already tracked for the item. */
function continuesTrackedText(item, texts) {
  let matched = false;
  for (const [key, part] of item.parts) {
    const text = snapshotTextFor(texts, key, item.parts.size);
    if (text === undefined) continue;
    if (!text.startsWith(trackedText(part))) return false;
    matched ||= part.length > 0;
  }
  return matched;
}
function isRotatedAlias(item, evidence) {
  if (!evidence) return false;
  if ("snapshot" in evidence) return continuesTrackedText(item, evidence.snapshot);
  // A delta continues the tracked item only while that item and part are still open.
  const part = item.parts.get(index(evidence.deltaContentIndex) ?? null);
  return !item.closed && !part?.closed;
}
function messageTexts(snapshot) {
  const texts = new Map();
  if (!Array.isArray(snapshot.content)) return texts;
  snapshot.content.forEach((value, contentIndex) => {
    const part = object(value);
    const text = part?.type === CLAUDE_STOP.REFUSAL ? part.refusal : part?.text;
    if ((part?.type === RESPONSES_ITEM.OUTPUT_TEXT || part?.type === CLAUDE_STOP.REFUSAL) && isString(text)) {
      texts.set(contentIndex, text);
    }
  });
  return texts;
}
function resolveItem(t, identity, allowAnonymous = false, evidence) {
  const id =
    isString(identity.item_id) && identity.item_id ? identity.item_id : undefined;
  const outputIndex = index(identity.output_index);
  if (!id && outputIndex === undefined && t.anonymous) return t.anonymous;
  const byId = id ? t.byId.get(id) : undefined;
  const byIndex = outputIndex !== undefined ? t.byIndex.get(outputIndex) : undefined;
  // Explicit IDs are authoritative; a malformed reused output index must not merge them.
  // An unseen id on a tracked index is adopted only when the event proves it continues
  // that item (a rotated id), never merely because the index matches (#19218, #19575).
  const sameId = byIndex && (!id || !byIndex.id || byIndex.id === id);
  const rotatedId = byIndex && !sameId && !byId && isRotatedAlias(byIndex, evidence);
  const compatibleIndex = sameId || rotatedId ? byIndex : undefined;
  let item = byId ?? compatibleIndex;
  if (byId && compatibleIndex && byId !== compatibleIndex) mergeItems(t, byId, compatibleIndex);
  // Only a complete, single-message snapshot can prove where anonymous deltas belong.
  if (allowAnonymous && t.anonymous && t.items.size === (item ? 2 : 1)) {
    if (item) mergeItems(t, item, t.anonymous);
    else {
      item = t.anonymous;
      t.anonymous = undefined;
    }
  }
  if (!item) {
    item = { parts: new Map(), created: t.created++ };
    t.items.add(item);
  }
  if (id) {
    item.id = id;
    t.byId.set(id, item);
  }
  if (outputIndex !== undefined) {
    item.index = outputIndex;
    t.byIndex.set(outputIndex, item);
  }
  if (!id && outputIndex === undefined) t.anonymous = item;
  return item;
}
function resolvePart(item, contentIndex, allowAnonymous, snapshot) {
  const key = index(contentIndex) ?? null;
  if (key === null && [...item.parts.keys()].some((partKey) => partKey !== null)) return null;
  const anonymous = item.parts.get(null);
  if (key !== null && anonymous) {
    const existing = item.parts.get(key);
    if (!allowAnonymous || item.parts.size > (existing ? 2 : 1)) return null;
    const fragments = [...(existing?.fragments ?? []), ...anonymous.fragments].sort(
      (a, b) => a.order - b.order
    );
    if (!snapshot.startsWith(fragments.map((fragment) => fragment.text).join(""))) return null;
    if (existing) mergeParts(existing, anonymous);
    item.parts.delete(null);
    if (!existing) item.parts.set(key, anonymous);
  }
  let part = item.parts.get(key);
  if (!part) {
    part = { fragments: [], length: 0 };
    item.parts.set(key, part);
  }
  return part;
}
function reconcile(state, t, part, snapshot) {
  if (snapshot.length < part.length) return "";
  let offset = 0;
  for (const fragment of part.fragments) {
    if (!snapshot.startsWith(fragment.text, offset)) return "";
    offset += fragment.text.length;
  }
  const suffix = snapshot.slice(part.length);
  chargeRetained(state, suffix.length);
  // Compact only at a snapshot, never on each streamed delta (linear retained text).
  part.fragments = snapshot ? [{ text: snapshot, order: t.sequence++ }] : [];
  part.length = snapshot.length;
  return suffix;
}

/**
 * Text held back for an item, in arrival order. A recovered snapshot suffix is
 * held after the deltas it extends, so an item always replays in its own order.
 */
function holdText(t, item, text, field) {
  if (!text) return;
  (item.held ??= []).push({ text, field });
  t.heldChars += text.length;
  // Bounded memory: past the cap the hold is no longer worth its ordering
  // guarantee, so the rest of the stream is released without it.
  if (t.heldChars > MAX_HELD_TEXT_CHARS) t.forceRelease = true;
}

/**
 * The earliest tracked item that can still contribute text and sits before
 * `item`. A later item waits for it: whatever that earlier item still owes
 * belongs before the later item's text.
 */
function blockerFor(t, item) {
  if (t.forceRelease) return undefined;
  if (item.index === undefined) return undefined;
  for (const other of t.items) {
    if (other === item) continue;
    if (other.index === undefined) continue;
    if (other.index >= item.index) continue;
    if (other.closed) continue;
    return other;
  }
  return undefined;
}

/** Source position of a tracked item; items without one keep their first-seen order. */
function position(item) {
  return item.index ?? item.created;
}

/**
 * Release the text held for every item whose earlier items are all finished,
 * in source order. Held text is released once: an item never replays.
 */
function releaseHeld(t, state) {
  const ready = [];
  for (const item of t.items) {
    if (!item.held?.length) continue;
    if (blockerFor(t, item)) continue;
    ready.push(item);
  }
  ready.sort((a, b) => position(a) - position(b));
  const chunks = [];
  for (const item of ready) {
    for (const entry of item.held) chunks.push(buildTextSnapshotChunk(state, entry.text, entry.field));
    for (const entry of item.held) t.heldChars -= entry.text.length;
    item.held = [];
  }
  return chunks;
}

export function buildTextSnapshotChunk(state, text, field = "content") {
  return buildChunk({ id: state.chatId, created: state.created, model: state.model || MODEL_FALLBACK }, { [field]: text });
}

/**
 * Record a streamed text delta. The delta is released immediately when no
 * earlier item can still owe text; otherwise it is held until that earlier
 * item finishes, so the recovered text keeps the upstream source order.
 */
export function recordResponsesTextDelta(state, identity, text) {
  const t = tracker(state);
  if (t.closed) return [];
  // Missing identity is provenance we do not know yet, not the sole item/part seen so far.
  const item = resolveItem(t, identity, false, { deltaContentIndex: identity.content_index });
  const key = index(identity.content_index) ?? null;
  let part = item.parts.get(key);
  if (!part) {
    part = { fragments: [], length: 0 };
    item.parts.set(key, part);
  }
  chargeRetained(state, text.length);
  part.fragments.push({ text, order: t.sequence++ });
  part.length += text.length;
  if (blockerFor(t, item)) {
    holdText(t, item, text, "content");
    // The hold may have hit its cap, which releases every held text.
    return releaseHeld(t, state);
  }
  return [buildTextSnapshotChunk(state, text, "content")];
}

/**
 * Reconcile a finished content part. The recovered suffix extends the text
 * already streamed for that part, so it is held behind the same item's own
 * deltas and released in source order.
 */
export function reconcileResponsesTextDone(state, identity, text) {
  const t = tracker(state);
  if (t.closed || !isString(text) || !text) return [];
  const snapshot = new Map([[index(identity.content_index) ?? null, text]]);
  const item = resolveItem(t, identity, false, { snapshot });
  if (t.anonymous && t.items.size > 1) return [];
  if (index(identity.content_index) === undefined && item.parts.size > 1) return [];
  const part = resolvePart(item, identity.content_index, false, text);
  if (!part) return [];
  part.closed = true;
  holdText(t, item, reconcile(state, t, part, text), "content");
  return releaseHeld(t, state);
}

/**
 * Bind an item event to its output position so later events without an item
 * id still resolve to the same item.
 */
export function bindResponsesTextItem(state, value, outputIndex) {
  const item = object(value);
  if (item?.type === RESPONSES_ITEM.MESSAGE && item.role === ROLE.ASSISTANT) {
    resolveItem(tracker(state), { item_id: item.id, output_index: outputIndex });
  }
}
function recoverItem(state, t, item, snapshot) {
  if (!Array.isArray(snapshot.content)) return [];
  const parts = snapshot.content
    .map((part, contentIndex) => ({ part: object(part), contentIndex }))
    .filter(
      ({ part }) =>
        (part?.type === RESPONSES_ITEM.OUTPUT_TEXT && isString(part.text)) ||
        (part?.type === CLAUDE_STOP.REFUSAL && isString(part.refusal))
    );
  const recovered = [];
  for (const { part, contentIndex } of parts) {
    const text = part.type === CLAUDE_STOP.REFUSAL ? part.refusal : part.text;
    const tracked = resolvePart(item, contentIndex, parts.length === 1, text);
    if (!tracked) continue;
    const suffix = reconcile(state, t, tracked, text);
    if (suffix)
      recovered.push({ text: suffix, field: part.type === CLAUDE_STOP.REFUSAL ? "refusal" : "content" });
  }
  return recovered;
}

/**
 * A finished item carries the whole text of that item. The suffix it adds is
 * held behind the item's own deltas and released in source order.
 */
export function synthesizeTextItemSnapshot(state, value, outputIndex) {
  const t = tracker(state);
  const snapshot = object(value);
  if (t.closed || snapshot?.type !== RESPONSES_ITEM.MESSAGE || snapshot.role !== ROLE.ASSISTANT) return [];
  const item = resolveItem(
    t,
    { item_id: snapshot.id, output_index: outputIndex },
    t.items.size === 1 && !!t.anonymous,
    { snapshot: messageTexts(snapshot) }
  );
  item.closed = true;
  if (t.anonymous && t.items.size > 1) return [];
  for (const { text, field } of recoverItem(state, t, item, snapshot)) holdText(t, item, text, field);
  return releaseHeld(t, state);
}

/**
 * Recover the text of a finished response and release it in source order. The
 * upstream `output` array is the authoritative source order, so every item is
 * resolved and recovered before any held text is released.
 */
export function finalizeResponsesTextSnapshots(state, output) {
  const t = tracker(state);
  if (t.closed) return [];
  const items = (Array.isArray(output) ? output : [])
    .map((value, position) => ({
      snapshot: object(value),
      outputIndex: position,
    }))
    .filter(({ snapshot }) => snapshot?.type === RESPONSES_ITEM.MESSAGE && snapshot.role === ROLE.ASSISTANT);
  // Bind all identities before recovering anything: an anonymous prefix cannot be
  // assigned to the first of multiple messages merely because it was visited first.
  const resolved = items.map(({ snapshot, outputIndex }) => ({
    snapshot,
    outputIndex,
    item: resolveItem(t, { item_id: snapshot.id, output_index: outputIndex }, items.length === 1, {
      snapshot: messageTexts(snapshot),
    }),
  }));
  // The stream is over: no tracked item can still contribute text.
  for (const item of t.items) item.closed = true;
  if (!(t.anonymous && t.items.size > 1)) {
    for (const { snapshot, item } of resolved) {
      for (const { text, field } of recoverItem(state, t, item, snapshot)) holdText(t, item, text, field);
    }
  }
  return releaseHeld(t, state);
}

/**
 * Release every held text in source order and stop tracking. Used when the
 * stream ends without a finished response: an error, a cancel, or a flush
 * sentinel. The held text is released, never dropped.
 */
export function flushResponsesTextSnapshots(state) {
  const t = tracker(state);
  if (t.closed) return [];
  for (const item of t.items) item.closed = true;
  const chunks = releaseHeld(t, state);
  closeResponsesTextSnapshots(state);
  return chunks;
}
export function closeResponsesTextSnapshots(state) {
  const t = tracker(state);
  t.closed = true;
  for (const item of t.items) {
    for (const part of item.parts.values()) releaseRetained(state, part.length);
  }
  t.items.clear();
  t.byId.clear();
  t.byIndex.clear();
  t.anonymous = undefined;
}
