function parseDeploymentMode(value = process.env.DEPLOYMENT_MODE) {
  const mode = (value || "local").trim().toLowerCase();
  if (mode === "local" || mode === "hosted" || mode === "remote") return mode;
  throw new Error("DEPLOYMENT_MODE must be local, hosted, or remote");
}

function isHosted(value = process.env.DEPLOYMENT_MODE) {
  return parseDeploymentMode(value) !== "local";
}

module.exports = { parseDeploymentMode, isHosted };
