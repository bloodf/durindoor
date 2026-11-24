/**
 * Shares one usage-stats computation between every subscriber of the same scope.
 *
 * A scope is whatever the computation depends on (the stats period). Usage change
 * events from the emitter mark the scope dirty and arm one trailing timer; when it
 * fires the stats are recomputed once and the same payload is fanned out to every
 * subscriber of that scope. Admission limits stay with the caller.
 */
export const STATS_BROADCAST_INTERVAL_MS = 1000;
const EVENTS = ["update", "pending"];

export function createStatsBroadcaster({ emitter, compute, intervalMs = STATS_BROADCAST_INTERVAL_MS, now = Date.now }) {
  const channels = new Map();
  let attached = false;

  function scheduleRecompute(scope, channel) {
    if (channel.timer || channel.computing) return;
    channel.timer = setTimeout(() => {
      channel.timer = null;
      broadcast(scope, channel);
    }, intervalMs);
    channel.timer.unref?.();
  }

  function onChange() {
    for (const [scope, channel] of channels) {
      channel.dirty = true;
      scheduleRecompute(scope, channel);
    }
  }

  function attach() {
    if (attached) return;
    attached = true;
    for (const event of EVENTS) emitter.on(event, onChange);
  }

  function detach() {
    if (!attached) return;
    attached = false;
    for (const event of EVENTS) emitter.off(event, onChange);
  }

  /** Recompute (or join the in-flight computation) for one scope. */
  function load(scope, channel) {
    if (channel.computing) return channel.computing;
    channel.dirty = false;
    const promise = Promise.resolve().then(() => compute(scope)).then((stats) => {
      channel.stats = stats;
      channel.at = now();
      return stats;
    });
    channel.computing = promise;
    const settle = () => {
      if (channel.computing === promise) channel.computing = null;
      if (channel.dirty && channels.get(scope) === channel) scheduleRecompute(scope, channel);
    };
    promise.then(settle, settle);
    return promise;
  }

  function broadcast(scope, channel) {
    load(scope, channel).then(
      (stats) => {
        for (const subscriber of [...channel.subscribers]) {
          try {
            subscriber.onStats(stats);
          } catch (error) {
            subscriber.onError?.(error);
          }
        }
      },
      (error) => {
        for (const subscriber of [...channel.subscribers]) subscriber.onError?.(error);
      },
    );
  }

  /** Current stats for a scope, reusing a still-fresh shared computation. */
  function snapshot(scope) {
    const channel = channels.get(scope);
    if (!channel) return Promise.resolve().then(() => compute(scope));
    if (!channel.computing && channel.stats && !channel.dirty && now() - channel.at < intervalMs) {
      return Promise.resolve(channel.stats);
    }
    return load(scope, channel);
  }

  /**
   * Register a subscriber. It is called with later broadcasts only; fetch the first
   * payload with `snapshot`. Returns an idempotent unsubscribe function.
   */
  function subscribe(scope, subscriber) {
    let channel = channels.get(scope);
    if (!channel) {
      channel = { subscribers: new Set(), timer: null, computing: null, stats: null, at: 0, dirty: false };
      channels.set(scope, channel);
    }
    channel.subscribers.add(subscriber);
    attach();
    return () => {
      if (!channel.subscribers.delete(subscriber)) return;
      if (channel.subscribers.size) return;
      clearTimeout(channel.timer);
      channel.timer = null;
      if (channels.get(scope) === channel) channels.delete(scope);
      if (!channels.size) detach();
    };
  }

  return { subscribe, snapshot };
}
