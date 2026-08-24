// Skip during Next.js build/prerender — bootstrap would download cloudflared, init DNS, etc.
import { isBrowser } from "../utils/typeChecks.js";
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build" ||
process.env.NEXT_PHASE === "phase-export" ||
process.env.NEXT_PHASE === "phase-static" ||
process.env.DURINDOOR_BUILD === "1" ||
process.env.npm_lifecycle_event === "build";

// Server-only singleton: guard via global so HMR / re-imports don't double-init
if (!isBrowser() && !isBuildPhase && !global.__appBootstrapped) {
  global.__appBootstrapped = true;
  import("./initializeApp.js").
  then(({ default: initializeApp }) => initializeApp()).
  catch((e) => console.error("[Bootstrap] init failed:", e.message));
}