// Local submit correlations for the staged Firefly web UI flow (#2034).
//
// A correlation is recorded before the single submit click, so a request
// whose outcome is unknown stays visible here, apart from usage, instead of
// being treated as free or replayed. In memory and bounded: this is a local
// record, not an Adobe job id, and it holds no prompt, path, URL or session
// data.
import { randomUUID } from "node:crypto";

export const JOURNAL_LIMIT = 500;

export function createFireflyWebUiJournal({ limit = JOURNAL_LIMIT, randomId = randomUUID } = {}) {
  const entries = new Map();
  return {
    /** Record a submit about to happen; returns its frozen correlation. */
    record({ connectionId, model, kind }) {
      const correlationId = randomId();
      const at = new Date().toISOString();
      entries.set(correlationId, { correlationId, connectionId, model, kind, state: "submitting", reason: null, recordedAt: at, updatedAt: at });
      while (entries.size > limit) entries.delete(entries.keys().next().value);
      return Object.freeze({ correlationId });
    },
    update(correlationId, state, reason = null) {
      const entry = entries.get(correlationId);
      if (!entry) return;
      Object.assign(entry, { state, reason, updatedAt: new Date().toISOString() });
    },
    get: (correlationId) => (entries.has(correlationId) ? { ...entries.get(correlationId) } : null),
    list: () => [...entries.values()].map((entry) => ({ ...entry })),
    /** Unknown outcomes, kept apart from usage for operator review. */
    unknownOutcomes: () => [...entries.values()].filter((entry) => entry.state === "outcome_unknown").map((entry) => ({ ...entry })),
  };
}

export const defaultFireflyWebUiJournal = createFireflyWebUiJournal();
