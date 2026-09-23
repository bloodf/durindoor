// Kubernetes-style readiness alias of /api/health (ported from OmniRoute
// #10977). Same body/status as /api/health; distinct from /api/livez
// (process-alive only, no readiness check). A readiness probe should 503
// here — not restart the container — while the app is still warming up.
export const dynamic = "force-dynamic";
export { GET, OPTIONS } from "../health/route.js";
