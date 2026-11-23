/** Hosted deployments never treat a reverse proxy as a local operator. */
export function isHosted() {
  const mode = (process.env.DEPLOYMENT_MODE || "local").trim().toLowerCase();
  if (mode === "local") return false;
  if (mode === "hosted" || mode === "remote") return true;
  throw new Error("DEPLOYMENT_MODE must be local, hosted, or remote");
}
