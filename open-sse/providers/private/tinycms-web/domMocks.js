// Vendored from OmniRoute (cheaper-inference/OmniRoute, MIT License)
// release/v3.8.55 @ 4265bb2ad5477450a07d3a43ea33a62c6c874878, open-sse/executors/tinycmsDomMocks.ts.
// Converted from TypeScript to plain ESM JavaScript. One deviation: the stub objects are
// stable singletons (see getSharedStubs); the signer logic itself is unchanged.
// Runtime DOM shims for the TinyCMS wasm-bindgen glue (browser-targeted Rust).
// These are NOT test-only mocks — the WASM module reaches canvas APIs through
// generated JS that expects `window`, `document`, `HTMLCanvasElement`, and
// `CanvasRenderingContext2D` in Node.
//
// Deliberately NOT a module-load side effect: importing this file must not leak
// `global.window` into unrelated tests or Next.js SSR. Call `setupDomMocks()`
// (or the with-* wrappers) around WASM init / payload generation.
//
// Why this is load-bearing for the OmniRoute process:
// Next.js SSR uses `typeof window !== "undefined"` as a browser check and then
// `getLocationOrigin()` does `const { protocol, hostname, port } = window.location`.
// The previous shim did `g.window = g` (alias window to the Node global) without
// installing `location`. After TinyCMS ran once, every route crashed with
// `TypeError: Cannot destructure property 'protocol' of 'window.location' as it
// is undefined` until the process restarted.
//
// Belt-and-suspenders:
// 1. Never alias `window` to the Node global. Use a dedicated stub object.
// 2. Always attach a Location-shaped object (`protocol`, `hostname`, `port`,
//    `href`, `origin`, …) so even a leftover `window` cannot poison Next.
// 3. Production callers restore via `withTinyCmsDomMocks*` so a successful
//    TinyCMS request does not leave `window` installed for the process lifetime.

import { isFunction, isObject, isString, isUndefined } from "../../../../src/shared/utils/typeChecks.js";

function isRecord(value) {
  return isObject(value) && value !== null;
}

function locationIsUsable(value) {
  if (!isRecord(value)) return false;
  return isString(value.protocol) && isString(value.hostname);
}

function createSafeLocation() {
  const location = {
    href: "http://localhost/",
    origin: "http://localhost",
    protocol: "http:",
    host: "localhost",
    hostname: "localhost",
    port: "",
    pathname: "/",
    search: "",
    hash: "",
    assign() {},
    reload() {},
    replace() {},
    toString() {
      return location.href;
    },
  };
  return location;
}

function ensureUsableLocation(target, key) {
  if (!locationIsUsable(target[key])) {
    target[key] = createSafeLocation();
  }
}

let sharedStubs = null;
function getSharedStubs() {
  if (sharedStubs) return sharedStubs;
  const Window = function Window() {};
  const HTMLCanvasElement = function HTMLCanvasElement() {};
  const CanvasRenderingContext2D = function CanvasRenderingContext2D() {};
  const document = {
    createElement(tag) {
      if (tag !== "canvas") return null;
      const canvas = {
        width: 100,
        height: 100,
        getContext(type) {
          if (type !== "2d") return null;
          const ctx = {
            fillStyle: "",
            font: "",
            fillRect() {},
            fillText() {},
            toDataURL() {
              return "data:image/png;base64,MOCK_DATA";
            },
          };
          Object.setPrototypeOf(ctx, CanvasRenderingContext2D.prototype);
          return ctx;
        },
        toDataURL() {
          return "data:image/png;base64,MOCK_DATA";
        },
      };
      Object.setPrototypeOf(canvas, HTMLCanvasElement.prototype);
      return canvas;
    },
  };
  const window = { location: createSafeLocation(), document };
  window.window = window;
  window.self = window;
  Object.setPrototypeOf(window, Window.prototype);
  sharedStubs = { Window, HTMLCanvasElement, CanvasRenderingContext2D, document, window };
  return sharedStubs;
}

export function setupDomMocks() {
  if (isUndefined(globalThis.global)) return () => {};

  // A loose record on purpose: intersecting with the globalThis type pulls the
  // DOM lib types in (Window, HTMLCanvasElement, document...) so every stub
  // assignment below fails against the real constructor signatures, and the
  // `delete g.window` narrows `g` to `never` (13 diagnostics under the api
  // typecheck, which loads lib.dom). This function exists to overwrite those
  // globals with stubs; it must not be typed as if they were the real ones.
  const g = global;
  const hadWindow = "window" in g;
  const hadWindowCtor = "Window" in g;
  const hadCanvasElement = "HTMLCanvasElement" in g;
  const hadCanvasContext = "CanvasRenderingContext2D" in g;
  const hadDocument = "document" in g;
  const hadGlobalLocation = "location" in g;
  const existingWindow = isRecord(g.window) ? g.window : undefined;
  // Historical toxic alias from older OmniRoute builds: `g.window = g`.
  // Never keep that alias — Next SSR treats any `window` as a browser and
  // then destructures `window.location`.
  const windowWasGlobalAlias = g.window === g;

  // DurinDoor deviation: the stub classes, document and window are process-wide
  // singletons that are installed and removed around each synchronous call. The
  // WASM fingerprint caches the first canvas/window it sees; fresh stubs on a
  // later call make it report `fp_error`, which the server treats as a bot.
  const shared = getSharedStubs();
  if (!g.Window) g.Window = shared.Window;
  if (!g.HTMLCanvasElement) g.HTMLCanvasElement = shared.HTMLCanvasElement;
  if (!g.CanvasRenderingContext2D) g.CanvasRenderingContext2D = shared.CanvasRenderingContext2D;
  if (!g.document) g.document = shared.document;

  if (windowWasGlobalAlias) {
    delete g.window;
  }

  if (!g.window) {
    g.window = shared.window;
  } else if (existingWindow && existingWindow !== g) {
    // Heal a leftover dedicated window so Next `getLocationOrigin` can
    // destructure even if this process already had a stub.
    ensureUsableLocation(existingWindow, "location");
    if (g.document && existingWindow.document == null) {
      existingWindow.document = g.document;
    }
  }

  return () => {
    if (!hadWindow || windowWasGlobalAlias) {
      delete g.window;
    } else if (isRecord(g.window)) {
      // A leftover `window` stays installed: never strip `location` off it.
      ensureUsableLocation(g.window, "location");
    }
    if (!hadGlobalLocation) delete g.location;
    if (!hadWindowCtor) delete g.Window;
    if (!hadCanvasElement) delete g.HTMLCanvasElement;
    if (!hadCanvasContext) delete g.CanvasRenderingContext2D;
    if (!hadDocument) delete g.document;
  };
}

export function withTinyCmsDomMocks(fn) {
  const restore = setupDomMocks();
  try {
    return fn();
  } finally {
    restore();
  }
}

export async function withTinyCmsDomMocksAsync(fn) {
  const restore = setupDomMocks();
  try {
    return await fn();
  } finally {
    restore();
  }
}
