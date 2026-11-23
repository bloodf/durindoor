import { execFileSync } from "node:child_process";

/** Build evidence with the requested candidate or the repository's current HEAD. */
export function buildV5EvidenceReport(cases, root, env = process.env) {
  let candidate = env.V5_EVIDENCE_CANDIDATE;
  if (!candidate) {
    try {
      candidate = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
    } catch {
      candidate = null;
    }
  }
  return { candidate, generatedAt: new Date().toISOString(), cases };
}
