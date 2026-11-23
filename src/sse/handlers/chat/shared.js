export function requestAborted(request, signal = null) {
  return signal?.aborted === true || request?.signal?.aborted === true;
}

export function combineAbortSignals(parentSignal, childSignal) {
  if (!childSignal) return parentSignal || null;
  if (!parentSignal) return childSignal;
  return AbortSignal.any([parentSignal, childSignal]);
}

