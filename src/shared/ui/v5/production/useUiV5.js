"use client";

import { useSyncExternalStore } from "react";

const ATTRIBUTE = "data-ui";
const ON_VALUE = "v5";

function readAttribute() {
  const root = globalThis.document?.documentElement;
  return root?.dataset?.ui === ON_VALUE;
}

function subscribe(notify) {
  const root = globalThis.document?.documentElement;
  const Observer = globalThis.MutationObserver;
  if (!root || !Observer) return () => {};
  const observer = new Observer(notify);
  observer.observe(root, { attributes: true, attributeFilter: [ATTRIBUTE] });
  return () => observer.disconnect();
}

/**
 * Client hook: true when the root element carries `data-ui="v5"`.
 * Returns false during SSR and for the hydration pass, then follows the
 * attribute, so Storybook can toggle it without a remount.
 */
export function useUiV5() {
  return useSyncExternalStore(subscribe, readAttribute, () => false);
}
