/**
 * Smart Scoring (#2266): health score (0-100) per model per combo. The scores
 * are process-local (runtimeState.js) and reset on restart, which is intended.
 */

import { getComboRuntimeState } from "./runtimeState.js";

/** @type {Map<string, Map<string, { score: number, lastSuccessMs: number|null, lastErrorMs: number|null }>>} */
const comboScoringState = getComboRuntimeState().scoring;

export const SCORE_CFG = Object.freeze({
  initial: 100,
  max: 100,
  min: 10,
  onSuccess: 5,
  onTransient: -10, // 5xx / timeout
  onQuota: -30, // 429
  onForbidden: -50, // 403 / 401 (banned / suspended)
  recoveryPerMinute: 3 // passive recovery after errors
});

/** Get current effective score for a model (includes passive recovery). */
export function getComboModelScore(comboName, modelStr) {
  const entry = comboScoringState.get(comboName)?.get(modelStr);
  if (!entry) return SCORE_CFG.initial;
  if (entry.lastErrorMs) {
    const elapsedMin = (Date.now() - entry.lastErrorMs) / 60000;
    const recovered = entry.score + elapsedMin * SCORE_CFG.recoveryPerMinute;
    return Math.min(Math.max(recovered, SCORE_CFG.min), SCORE_CFG.max);
  }
  return entry.score;
}

/** Map legacy smart-scoring evidence into the shared quota scorer's health band. */
export function getComboModelQuotaHealth(comboName, modelStr) {
  const score = getComboModelScore(comboName, modelStr);
  if (score <= 50) return "unhealthy";
  if (score < 95) return "degraded";
  return "healthy";
}

/** Update a model's score after a request attempt. */
export function updateComboModelScore(comboName, modelStr, success, httpStatus) {
  if (!comboScoringState.has(comboName)) comboScoringState.set(comboName, new Map());
  const scores = comboScoringState.get(comboName);
  const current = getComboModelScore(comboName, modelStr);
  const existing = scores.get(modelStr);
  const now = Date.now();
  let delta;
  if (success) {
    delta = SCORE_CFG.onSuccess;
  } else if (httpStatus === 403 || httpStatus === 401) {
    delta = SCORE_CFG.onForbidden;
  } else if (httpStatus === 429 || httpStatus === 402) {
    delta = SCORE_CFG.onQuota;
  } else {
    delta = SCORE_CFG.onTransient;
  }
  scores.set(modelStr, {
    score: Math.min(Math.max(current + delta, SCORE_CFG.min), SCORE_CFG.max),
    lastSuccessMs: success ? now : existing?.lastSuccessMs ?? null,
    lastErrorMs: success ? existing?.lastErrorMs ?? null : now
  });
}

/**
 * Return models sorted for Smart Scoring:
 * - Primary: score descending (healthier models first)
 * - Tie-break: LRU (least recently succeeded first) → natural round-robin when all healthy
 */
export function getSmartScoredModels(models, comboName) {
  if (!models || models.length <= 1) return models;
  const scores = comboScoringState.get(comboName);
  return [...models].
  map((m) => ({
    m,
    score: getComboModelScore(comboName, m),
    lastSuccessMs: scores?.get(m)?.lastSuccessMs ?? 0
  })).
  sort((a, b) => {
    const diff = b.score - a.score;
    if (Math.abs(diff) >= 5) return diff; // significant score gap → sort by score
    return a.lastSuccessMs - b.lastSuccessMs; // equal scores → LRU (round-robin)
  }).
  map((x) => x.m);
}

/**
 * Reset Smart Scoring state when combo/settings change
 * @param {string} [comboName] - Combo name to reset; omit to clear all
 */
export function resetComboScoring(comboName) {
  if (comboName) comboScoringState.delete(comboName);
  else comboScoringState.clear();
}
