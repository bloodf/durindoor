import { useMemo, useSyncExternalStore } from "react";

const FALLBACK_ORIGIN = "http://storybook.local";

function currentNavigation() {
  const nav = globalThis.__STORYBOOK_NAV__;
  if (!nav) {
    throw new Error(
      "Storybook fixture next/navigation used before setupStoryFixture() — call setupStoryFixture in your story's loaders/play."
    );
  }
  return nav;
}

function useRouter() {
  return currentNavigation().useRouter();
}

function usePathname() {
  return currentNavigation().usePathname();
}

function useSearchParams() {
  return currentNavigation().useSearchParams();
}

function useParams() {
  return currentNavigation().useParams();
}

function useSelectedLayoutSegment(parallelRouteKey) {
  return currentNavigation().useSelectedLayoutSegment(parallelRouteKey);
}

function useSelectedLayoutSegments(parallelRouteKey) {
  return currentNavigation().useSelectedLayoutSegments(parallelRouteKey);
}

function redirect(href) {
  return currentNavigation().redirect(href);
}

function notFound() {
  return currentNavigation().notFound();
}

export {
  useRouter,
  usePathname,
  useSearchParams,
  useParams,
  useSelectedLayoutSegment,
  useSelectedLayoutSegments,
  redirect,
  notFound,
};

function storybookOrigin() {
  // The Storybook manager URL is the only host context we trust to derive the
  // fixed storybook.local origin. Host history is otherwise never written.
  return FALLBACK_ORIGIN;
}

function navigationUrl(href, base) {
  if (href instanceof URL) throw new Error("Storybook fixture navigation requires a relative URL");
  const value = String(href);
  if (!value.startsWith("/") && !value.startsWith("?") && !value.startsWith("#")) {
    throw new Error("Storybook fixture navigation requires a same-origin relative URL");
  }
  const baseUrl = new URL(base || `${storybookOrigin()}/`);
  const url = new URL(value, baseUrl);
  if (url.origin !== baseUrl.origin) {
    throw new Error("Storybook fixture navigation requires a same-origin relative URL");
  }
  return url;
}

function snapshotFrom(url) {
  return Object.freeze({
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    href: `${url.pathname}${url.search}${url.hash}`,
  });
}

function selectedSegmentsFor(selectedLayoutSegments, parallelRouteKey) {
  if (Array.isArray(selectedLayoutSegments)) return selectedLayoutSegments;
  return selectedLayoutSegments[parallelRouteKey || "children"] || [];
}

export function createStoryNavigation({
  pathname = "/",
  query = "",
  params = {},
  selectedLayoutSegments = [],
} = {}) {
  const initialUrl = navigationUrl(`${pathname}${query}`);
  const baseHref = initialUrl.href;
  // Virtual history stack — never touches host window.history. The current
  // snapshot is stack[index]; navigate mutates the stack and notifies; back
  // and forward move the index without bound checks beyond the recorded stack.
  const stack = [snapshotFrom(initialUrl)];
  let index = 0;
  const listeners = new Set();
  const segments = selectedSegmentsFor(selectedLayoutSegments, "children");
  const router = Object.freeze({
    push(href) {
      navigate(href, false);
      return Promise.resolve(true);
    },
    replace(href) {
      navigate(href, true);
      return Promise.resolve(true);
    },
    refresh() {
      notify();
      return Promise.resolve(true);
    },
    back() {
      moveHistory("back");
      return Promise.resolve(true);
    },
    forward() {
      moveHistory("forward");
      return Promise.resolve(true);
    },
    prefetch() {
      return Promise.resolve();
    },
  });

  function current() {
    return stack[index];
  }

  function notify() {
    for (const listener of listeners) listener();
  }

  function navigate(href, replace) {
    const url = navigationUrl(href, baseHref);
    if (replace) {
      stack[index] = snapshotFrom(url);
    } else {
      // Drop any forward history so push matches window.history semantics.
      stack.length = index + 1;
      stack.push(snapshotFrom(url));
      index = stack.length - 1;
    }
    notify();
  }

  function moveHistory(method) {
    if (method === "back") {
      if (index <= 0) {
        throw new Error("Storybook fixture navigation history.back() underflowed the virtual stack");
      }
      index -= 1;
    } else if (method === "forward") {
      if (index >= stack.length - 1) {
        throw new Error("Storybook fixture navigation history.forward() overflowed the virtual stack");
      }
      index += 1;
    } else {
      throw new Error(`Storybook fixture navigation history.${method}() is unsupported`);
    }
    notify();
  }

  return {
    useRouter() {
      return router;
    },
    usePathname() {
      return useSyncExternalStore(subscribe, current, current).pathname;
    },
    useSearchParams() {
      const search = useSyncExternalStore(subscribe, current, current).search;
      return useMemo(() => new URLSearchParams(search), [search]);
    },
    useParams() {
      useSyncExternalStore(subscribe, current, current);
      return params;
    },
    useSelectedLayoutSegment(parallelRouteKey) {
      useSyncExternalStore(subscribe, current, current);
      return selectedSegmentsFor(selectedLayoutSegments, parallelRouteKey)[0] ?? null;
    },
    useSelectedLayoutSegments(parallelRouteKey) {
      useSyncExternalStore(subscribe, current, current);
      return selectedSegmentsFor(selectedLayoutSegments, parallelRouteKey);
    },
    notFound() {
      const error = new Error("Storybook fixture: notFound() invoked");
      error.code = "NEXT_NOT_FOUND";
      throw error;
    },
    redirect(href) {
      const error = new Error(`Storybook fixture: redirect(${href})`);
      error.code = "NEXT_REDIRECT";
      error.destination = href;
      throw error;
    },
    onNavigate(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    cleanup() {
      listeners.clear();
    },
    __current: () => current().href,
    __stack: () => stack.map((entry) => entry.href),
    __index: () => index,
  };

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
}

export function installStoryNavigation(options = {}) {
  const nav = createStoryNavigation(options);
  const previous = globalThis.__STORYBOOK_NAV__;
  globalThis.__STORYBOOK_NAV__ = nav;
  return async function cleanupStoryNavigation() {
    nav.cleanup();
    if (previous) globalThis.__STORYBOOK_NAV__ = previous;
    else delete globalThis.__STORYBOOK_NAV__;
  };
}
