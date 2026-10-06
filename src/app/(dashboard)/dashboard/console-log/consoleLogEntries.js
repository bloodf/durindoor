import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";
import { parseConsoleLine } from "./parseConsoleLine";

/**
 * Client-side mirror of the server console ring. Entries are parsed lines
 * with a monotonically increasing `id`; ids survive appends, trims and
 * snapshot reconciliation so the viewer can count lines that arrived after a
 * given point (the paused "N new" pill) and key rows stably.
 *
 * State shape: `{ entries: Entry[], nextId: number }`.
 */

export const EMPTY_CONSOLE_LOG = Object.freeze({ entries: [], nextId: 0 });

function withLines(kept, lines, nextId, maxLines) {
  const added = lines.map((line, index) => ({ id: nextId + index, ...parseConsoleLine(line) }));
  const entries = kept.concat(added);
  return {
    entries: entries.length > maxLines ? entries.slice(-maxLines) : entries,
    nextId: nextId + added.length,
  };
}

export function appendConsoleLines(state, lines, maxLines = CONSOLE_LOG_CONFIG.maxLines) {
  if (!Array.isArray(lines) || lines.length === 0) return state;
  return withLines(state.entries, lines, state.nextId, maxLines);
}

/**
 * Applies a full buffer snapshot (SSE `init` or the polling fallback). The
 * server ring only drops lines from the front and appends at the back, so the
 * longest suffix of the current entries that prefixes the snapshot is kept
 * with its ids and only the remainder is appended. No overlap means the
 * buffer was replaced, and every snapshot line becomes a new entry.
 */
export function reconcileConsoleSnapshot(state, lines, maxLines = CONSOLE_LOG_CONFIG.maxLines) {
  if (!Array.isArray(lines)) return state;
  const previous = state.entries;
  for (let offset = 0; offset <= previous.length; offset += 1) {
    const overlap = previous.length - offset;
    if (overlap > lines.length) continue;
    let matches = true;
    for (let index = 0; index < overlap; index += 1) {
      if (previous[offset + index].raw !== String(lines[index] ?? "")) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    if (overlap === lines.length && offset === 0) return state;
    return withLines(previous.slice(offset), lines.slice(overlap), state.nextId, maxLines);
  }
  return state;
}

export function clearConsoleEntries(state) {
  return { entries: [], nextId: state.nextId };
}

/** Number of entries whose id is at least `sinceId` (entries are id-ordered). */
export function countConsoleEntriesSince(state, sinceId) {
  const { entries } = state;
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (entries[mid].id < sinceId) low = mid + 1;
    else high = mid;
  }
  return entries.length - low;
}
