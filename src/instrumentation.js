// Next.js startup hook. Runs once per server start in every deployment shape
// (systemd, Docker, `npm start`, dev), which is why the Headroom proxy is
// revived from here rather than from host-specific service wiring.
//
// IMPORTANT — keep this file edge-safe. Next.js compiles instrumentation.js
// for every runtime, and `src/proxy.js` (the Next 16 middleware convention)
// guarantees the edge runtime always has one. Webpack follows every
// `await import(...)` it can parse, even inside runtime `if` guards, so any
// Node-only module (`os`, `fs`, `child_process`, db/driver, provider
// registry, ...) imported here lands in the edge bundle and fails the build
// with "Module not found" / UnhandledSchemeError (dev server 500s).
//
// The only safe pattern: reference Node-only code through a dynamic import
// nested inside `if (process.env.NEXT_RUNTIME === "nodejs")`. Next defines
// NEXT_RUNTIME as a compile-time literal per bundle, so the edge compiler
// constant-folds the branch away and never sees the import. All Node-only
// boot logic lives in ./instrumentation.node.js — do not import it (or any
// other module) statically from this file.

export function register() {
  // Compile-time guard, not just a runtime one: in the edge bundle this
  // becomes `if ("edge" === "nodejs")` and the whole block is tree-shaken.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // register() stays synchronous and never blocks on the proxy startup
    // probe; a compression proxy must never keep the gateway from starting.
    void import("./instrumentation.node.js")
      .then(({ bootstrapNodejsRuntime }) => bootstrapNodejsRuntime())
      .catch((error) => {
        console.log(`[headroom] bootstrap skipped: ${error?.message || error}`);
      });
  }
}
