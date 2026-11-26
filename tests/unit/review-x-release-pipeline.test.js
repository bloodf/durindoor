import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const read = (name) => readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), "utf8");
const workflow = (name) => parse(read(name));

describe("release pipeline", () => {
  it("requires the release PAT before creating a release", () => {
    const steps = workflow("release-tag.yml").jobs.tag.steps;
    const check = steps.find((step) => step.name === "Check for RELEASE_PAT");
    expect(check.env.RELEASE_PAT).toContain("secrets.RELEASE_PAT");
    expect(check.run).toMatch(/-z "\$RELEASE_PAT"[\s\S]*exit 1/);
    expect(steps.find((step) => step.name === "Create tag and GitHub Release").env.GH_TOKEN).toBe("${{ secrets.RELEASE_PAT }}");
  });

  it("gates both reusable publishers on the shared gate", () => {
    const jobs = workflow("release-tag.yml").jobs;
    expect(jobs.gate.uses).toBe("./.github/workflows/release-gate.yml");
    for (const [job, file] of [["npm", "release.yml"], ["docker", "docker-publish.yml"]]) {
      expect(jobs[job].needs).toContain("gate");
      expect(jobs[job].uses).toBe(`./.github/workflows/${file}`);
      expect(workflow(file).on).toHaveProperty("workflow_call");
    }
    expect(read("release-gate.yml")).toContain("pnpm run test:ci");
  });

  it("builds Docker from the validated tag checkout", () => {
    const docker = workflow("docker-publish.yml");
    const steps = docker.jobs.build.steps;
    expect(steps.find((step) => step.name === "Check out release source at validated commit").with.ref).toContain("needs.prepare.outputs.commit");
    const build = steps.find((step) => step.name === "Build and push platform image by digest");
    expect(build.with.context).toBe("source");
    expect(build.with.file).toBe("source/Dockerfile");
    expect(read("docker-publish.yml")).not.toContain("github.workflow_sha");
  });

  it("checks both manifest versions before npm publish", () => {
    const steps = workflow("release.yml").jobs.publish.steps;
    const index = steps.findIndex((step) => step.name === "Verify tag matches both package versions");
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(steps.findIndex((step) => step.name === "Publish CLI"));
    expect(steps[index].run).toContain("./package.json");
    expect(steps[index].run).toContain("./cli/package.json");
    expect(steps[index].run).toContain("exit 1");
  });
});
