/**
 * Combo rotation strategies (#2266): fallback order, round-robin with sticky
 * limits and conversation affinity, smooth weighted round-robin, and the
 * Efraimidis-Spirakis weighted permutation. State is process-local (see
 * runtimeState.js).
 */

import { isNumber } from "../../../src/shared/utils/typeChecks.js";
import { getComboRuntimeState } from "./runtimeState.js";
import {
  affinityKeyFor,
  getConversationAffinity,
  resetConversationAffinity,
  setConversationAffinity,
} from "./affinity.js";

const state = getComboRuntimeState();
/** @type {Map<string, { index: number, consecutiveUseCount: number }>} */
const comboRotationState = state.rotation;
const comboWeightedRotationState = state.weightedRotation;

export function rotationKeyFor(comboName) {
  return comboName || "__default__";
}

export function normalizeStickyLimit(stickyLimit) {
  const parsed = Number.parseInt(stickyLimit, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function rotateModelsFromIndex(models, currentIndex) {
  return [...models.slice(currentIndex), ...models.slice(0, currentIndex)];
}

function getRotationState(rotationKey) {
  const existingState = comboRotationState.get(rotationKey);
  return isNumber(existingState) ?
  { index: existingState, consecutiveUseCount: 0 } :
  existingState || { index: 0, consecutiveUseCount: 0 };
}

function advanceRotationState(rotationKey, currentIndex, modelCount, normalizedStickyLimit, consecutiveUseCount) {
  const nextUseCount = consecutiveUseCount + 1;
  comboRotationState.set(rotationKey, nextUseCount >= normalizedStickyLimit ?
    { index: (currentIndex + 1) % modelCount, consecutiveUseCount: 0 } :
    { index: currentIndex, consecutiveUseCount: nextUseCount });
}

// Match member occurrences so duplicate model entries retain their weights.
function memberWeights(models, members) {
  const remaining = Array.isArray(members) ? [...members] : [];
  return models.map((model) => {
    const index = remaining.findIndex((member) => member?.id === model);
    const value = index < 0 ? 1 : remaining.splice(index, 1)[0]?.weight;
    return Number.isFinite(value) && value >= 0 ? value : 1;
  });
}

/** True while a combo's round-robin uses smooth weighted rotation. */
export function hasWeightedRotation(comboName) {
  return comboWeightedRotationState.has(rotationKeyFor(comboName));
}

// Efraimidis-Spirakis weighted random permutation. Every member remains in the
// fallback list, so a terminal 400 still returns immediately through the normal
// `checkFallbackError` branch; weight changes selection only, never eligibility.
// Weight-0 members keep fallback eligibility but always sort after positive-weight
// members so they are never picked first when a positive-weight member exists.
export function getWeightedModels(models, members = [], random = Math.random) {
  if (!Array.isArray(models) || models.length < 2) return models;
  const weights = memberWeights(models, members);
  return models.map((model, index) => {
    const weight = weights[index];
    const key = weight > 0 ? Math.pow(random(), 1 / weight) : -1;
    return { model, index, weight, key };
  }).sort((a, b) => (b.weight > 0) - (a.weight > 0) || b.key - a.key || a.index - b.index).map(({ model }) => model);
}

function smoothWeightedOrder(models, weights, rotationKey, stickyLimit) {
  const signature = JSON.stringify([models, weights]);
  let entry = comboWeightedRotationState.get(rotationKey);
  if (!entry || entry.signature !== signature) entry = { signature, current: weights.map(() => 0), head: -1, count: 0 };
  if (entry.head < 0 || entry.count >= normalizeStickyLimit(stickyLimit)) {
    weights.forEach((weight, i) => { entry.current[i] += weight; });
    entry.head = weights.findIndex((weight) => weight > 0);
    weights.forEach((weight, i) => { if (weight > 0 && entry.current[i] > entry.current[entry.head]) entry.head = i; });
    entry.current[entry.head] -= weights.reduce((sum, weight) => sum + weight, 0);
    entry.count = 0;
  }
  entry.count++;
  comboWeightedRotationState.set(rotationKey, entry);
  const order = models.map((model, i) => ({ model, i }));
  order.sort((a, b) => (a.i === entry.head ? -1 : b.i === entry.head ? 1 :
    (weights[b.i] > 0) - (weights[a.i] > 0) || (entry.current[b.i] + weights[b.i]) - (entry.current[a.i] + weights[a.i]) || a.i - b.i));
  return order.map(({ model }) => model);
}

/**
 * Get rotated model list based on strategy
 * @param {string[]} models - Array of model strings
 * @param {string} comboName - Name of the combo
 * @param {string} strategy - "fallback", "round-robin", or "weighted"
 * @param {number|string} [stickyLimit=1] - Requests per combo model before switching
 * @param {string|null} [conversationCacheKey=null] - Stable key used to keep a conversation on one model
 * @param {{id: string, weight: number}[]} [members=[]] - Persisted weights for weighted selection
 * @param {string|null} [apiKeyId=null] - Isolates conversation pins and their LRU budget
 * @returns {string[]} Rotated models array
 */
export function getRotatedModels(models, comboName, strategy, stickyLimit = 1, conversationCacheKey = null, members = [], apiKeyId = null) {
  if (strategy === "weighted") return getWeightedModels(models, members);
  if (!models || models.length <= 1 || strategy !== "round-robin") {
    return models;
  }

  const rotationKey = rotationKeyFor(comboName);
  const weights = memberWeights(models, members);
  if (weights.some((weight) => weight > 0) && weights.some((weight) => weight !== weights[0])) {
    return smoothWeightedOrder(models, weights, rotationKey, stickyLimit);
  }
  comboWeightedRotationState.delete(rotationKey);

  const normalizedStickyLimit = normalizeStickyLimit(stickyLimit);
  const rotation = getRotationState(rotationKey);
  const currentIndex = rotation.index % models.length;
  // stickyLimit=1 means pure per-request round robin. Conversation affinity is
  // only active when sticky rotation is explicitly configured above 1.
  if (normalizedStickyLimit > 1 && conversationCacheKey) {
    const now = Date.now();
    const affinityKey = affinityKeyFor(rotationKey, conversationCacheKey, apiKeyId);
    const affinity = getConversationAffinity(affinityKey, now);
    if (affinity) {
      const pinnedIndex = affinity.index % models.length;
      setConversationAffinity(affinityKey, { index: pinnedIndex, lastUsed: now, scope: apiKeyId }, now);
      return rotateModelsFromIndex(models, pinnedIndex);
    }
    setConversationAffinity(affinityKey, { index: currentIndex, lastUsed: now, scope: apiKeyId }, now);
  }

  const rotatedModels = rotateModelsFromIndex(models, currentIndex);
  advanceRotationState(rotationKey, currentIndex, models.length, normalizedStickyLimit, rotation.consecutiveUseCount);
  return rotatedModels;
}

/**
 * After a fallback member served a round-robin request, move the pointer so the
 * next request continues from the served model instead of the failed head.
 * Smooth weighted rotation keeps its own state and is left alone.
 */
export function recordRoundRobinServed({ models, rotatedModels, comboName, stickyLimit, servedModel }) {
  if (servedModel === rotatedModels?.[0] || hasWeightedRotation(comboName)) return;
  if (!Array.isArray(models) || models.length <= 1 || !servedModel) return;
  const servedIndex = models.indexOf(servedModel);
  if (servedIndex < 0) return;
  // For sticky round-robin, pin the served model as the current rotation and
  // start its sticky counter so subsequent requests continue from it.
  comboRotationState.set(rotationKeyFor(comboName), normalizeStickyLimit(stickyLimit) > 1 ?
    { index: servedIndex, consecutiveUseCount: 1 } :
    { index: (servedIndex + 1) % models.length, consecutiveUseCount: 0 });
}

/**
 * Reset in-memory rotation state when combo/settings change
 * @param {string} [comboName] - Combo name to reset; omit to clear all
 */
export function resetComboRotation(comboName) {
  if (comboName) {
    comboWeightedRotationState.delete(comboName);
    comboRotationState.delete(comboName);
  } else {
    comboWeightedRotationState.clear();
    comboRotationState.clear();
  }
  resetConversationAffinity(comboName);
}
