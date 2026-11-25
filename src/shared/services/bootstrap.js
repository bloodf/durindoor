// Runtime services start only in a Node server, never during build or prerender.
export function bootstrapRuntime() {
  if (process.env.NEXT_RUNTIME !== "nodejs" ||
      ["phase-production-build", "phase-export", "phase-static"].includes(process.env.NEXT_PHASE) ||
      process.env.DURINDOOR_BUILD === "1" || process.env.npm_lifecycle_event === "build") return Promise.resolve();

  if (!globalThis.__appBootstrapPromise) {
    globalThis.__appBootstrapPromise = import("./initializeApp.js")
      .then(({ initializeApp }) => initializeApp())
      .catch((error) => {
        delete globalThis.__appBootstrapPromise;
        throw error;
      });
  }
  return globalThis.__appBootstrapPromise;
}
