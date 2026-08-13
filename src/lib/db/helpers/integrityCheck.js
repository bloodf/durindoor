// Fail startup instead of serving a database whose tables or indexes are corrupt.
// Recovery is deliberately an operator action; startup must never rewrite user data.
export class IntegrityCheckFailed extends Error {
  constructor(problems) {
    super(`SQLite integrity check failed:\n${problems.join("\n")}`);
    this.name = "IntegrityCheckFailed";
    this.problems = problems;
  }
}

export function runIntegrityCheckOrThrow(adapter) {
  const problems = adapter
    .all("PRAGMA quick_check")
    .map((row) => row.quick_check)
    .filter((result) => result !== "ok");

  if (problems.length > 0) throw new IntegrityCheckFailed(problems);
}
