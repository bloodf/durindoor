const ABORT_CHAIN = Symbol("durindoor.abortChain");

/**
 * Call on `new Request(…, { signal: source.signal })`. A Request follows its init
 * signal through weak references, and its own signal does not hold the Request.
 * Code that keeps only `rebuilt.signal` can therefore lose the client abort once
 * either Request is collected. This ties both to that signal. The signal itself
 * is unchanged, so `clone()` still follows it. (OmniRoute #21275)
 */
export function keepAbortChain(rebuilt, source) {
  Object.defineProperty(rebuilt.signal, ABORT_CHAIN, { value: { source, rebuilt } });
  return rebuilt;
}
