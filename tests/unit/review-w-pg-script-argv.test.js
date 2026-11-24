import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("PostgreSQL copy script password arguments", () => {
  it("keeps the password out of docker argv", () => {
    const script = readFileSync(new URL("../../scripts/copy-proxy-timeline-to-pg.sh", import.meta.url), "utf8");
    const assignments = [...script.matchAll(/PGPASSWORD=/g)];

    expect(assignments).toHaveLength(1);
    expect(script).toMatch(/^PGPASSWORD="\$pg_password" docker exec[^\n]*-e PGPASSWORD[^\n]* psql /m);
    expect(script).not.toMatch(/(?:^|\s)-e\s+["']?PGPASSWORD=[^\s"']+/m);
  });
});
