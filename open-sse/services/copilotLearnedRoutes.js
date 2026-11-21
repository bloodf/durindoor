/**
 * Learned Copilot route hints.
 *
 * A hint is a route the gateway guessed from Copilot's own "not accessible
 * via the /chat/completions endpoint" error: that model has to be served by
 * /responses. The guess is only as good as the metadata it was made under —
 * when the account's routing metadata is refreshed, the guess can be wrong
 * again, so a hint is only usable while the routing-metadata generation it
 * was learned under is still the current one.
 *
 * The store keeps that generation next to the hint, keys it by account and
 * API host (a hint never crosses an account or a host), and bounds itself:
 * a long-lived executor must not accumulate accounts or models forever.
 *
 * Pure in-memory state, no I/O and no provider traffic.
 */

import { COPILOT_ROUTE_GENERATION_ABSENT } from "./copilotEndpointContract.js";

/** Accounts (and hosts) whose hints are remembered at the same time. */
export const COPILOT_LEARNED_ROUTE_MAX_ACCOUNTS = 64;

/** Models remembered for one account and host. */
export const COPILOT_LEARNED_ROUTE_MAX_MODELS = 64;

export class CopilotLearnedRoutes {
  constructor({
    maxAccounts = COPILOT_LEARNED_ROUTE_MAX_ACCOUNTS,
    maxModels = COPILOT_LEARNED_ROUTE_MAX_MODELS,
  } = {}) {
    this.maxAccounts = maxAccounts;
    this.maxModels = maxModels;
    /** @type {Map<string, { generation: string, models: Set<string> }>} */
    this.entries = new Map();
  }

  /** Number of accounts (and hosts) currently remembered. */
  get size() {
    return this.entries.size;
  }

  /**
   * The generation a hint was learned under, or null when nothing is
   * recorded for this key.
   *
   * A bare model set (a hint stored without a generation) counts as learned
   * under the no-metadata generation: that is the only state in which a
   * generation could go unrecorded.
   *
   * @param {string} key
   * @returns {string|null}
   */
  generationOf(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry instanceof Set) return COPILOT_ROUTE_GENERATION_ABSENT;
    return entry.generation ?? null;
  }

  /**
   * Whether a live hint exists for this model under the current generation.
   *
   * A hint learned under another generation is expired: it is dropped and
   * not used, so a refreshed catalog cannot keep a stale route alive. An
   * unknown generation (null) is never trusted.
   *
   * @param {string|null} key - account and host key, null for anonymous calls
   * @param {string} model
   * @param {string|null} generation - the current routing-metadata generation
   * @returns {boolean}
   */
  has(key, model, generation) {
    if (!key || !generation) return false;
    const entry = this.entries.get(key);
    if (!entry) return false;
    const models = entry instanceof Set ? entry : entry.models;
    const recorded = entry instanceof Set ? COPILOT_ROUTE_GENERATION_ABSENT : entry.generation;
    if (recorded !== generation) {
      // The metadata moved on: this hint describes a catalog that is gone.
      this.entries.delete(key);
      return false;
    }
    if (!models?.has(model)) return false;
    this.touch(key);
    return true;
  }

  /**
   * Remember that a model needs the /responses route, under the routing
   * metadata generation that is current right now.
   *
   * Learning under a new generation replaces the hints of the old one: the
   * refreshed catalog is the only catalog the hint may speak for.
   *
   * @param {string|null} key - account and host key, null for anonymous calls
   * @param {string} model
   * @param {string|null} generation - the current routing-metadata generation
   */
  learn(key, model, generation) {
    if (!key || !generation) return;
    const existing = this.entries.get(key);
    const entry = existing && !(existing instanceof Set) && existing.generation === generation ?
      existing :
      { generation, models: new Set() };
    entry.models.add(model);
    while (entry.models.size > this.maxModels) {
      const oldest = entry.models.values().next().value;
      entry.models.delete(oldest);
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.maxAccounts) {
      const oldestKey = this.entries.keys().next().value;
      this.entries.delete(oldestKey);
    }
  }

  /**
   * Drop every hint of one key.
   * @param {string} key
   */
  forget(key) {
    this.entries.delete(key);
  }

  /**
   * Keep the most recently used key last, so the oldest one is evicted
   * first when the account bound is reached.
   * @param {string} key
   */
  touch(key) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.entries.set(key, entry);
  }
}

export default CopilotLearnedRoutes;
