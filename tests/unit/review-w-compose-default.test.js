import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const readYaml = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("default Compose file does not require PostgreSQL configuration", () => {
  it("keeps required Postgres password interpolation in the opt-in override", () => {
    const defaultComposeSource = readYaml("docker-compose.yml");
    const postgresComposeSource = readYaml("docker-compose.postgres.yml");
    const defaultCompose = parse(defaultComposeSource);
    const postgresCompose = parse(postgresComposeSource);

    expect(defaultComposeSource).not.toMatch(/\$\{[^}]+:\?/);
    expect(Object.keys(defaultCompose.services)).toEqual(["durindoor"]);
    expect(postgresCompose.services).toEqual(expect.objectContaining({
      postgres16: expect.any(Object),
      postgres17: expect.any(Object),
      postgres18: expect.any(Object),
    }));
    for (const service of Object.values(postgresCompose.services)) {
      expect(service.environment.POSTGRES_PASSWORD).toBe("${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}");
    }
    expect(postgresCompose.volumes).toEqual({
      "durindoor-pg16-data": { name: "durindoor-pg16-data" },
      "durindoor-pg17-data": { name: "durindoor-pg17-data" },
      "durindoor-pg18-data": { name: "durindoor-pg18-data" },
    });
  });
});
