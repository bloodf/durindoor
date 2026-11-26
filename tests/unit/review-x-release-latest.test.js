import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const workflow = (name) => parse(readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), "utf8"));

describe("Docker release promotion", () => {
  it("promotes latest only for stable release tags", () => {
    const docker = workflow("release-tag.yml").jobs.docker;
    expect(docker.with.release_tag).toBe("${{ needs.tag.outputs.tag }}");
    expect(docker.with.promote_latest).toBe("${{ !contains(needs.tag.outputs.tag, '-') }}");
  });

  it("allows manual republishing of an existing tag without a push trigger", () => {
    const docker = workflow("docker-publish.yml");
    expect(docker.on).toHaveProperty("workflow_call");
    expect(docker.on).not.toHaveProperty("push");
    expect(docker.on.workflow_dispatch.inputs.release_tag).toEqual({
      description: "Existing vX.Y.Z tag to publish",
      required: true,
      type: "string",
    });
    expect(docker.on.workflow_dispatch.inputs.promote_latest).toEqual({
      description: "Promote this republish to latest",
      default: false,
      type: "boolean",
    });
    const checkout = docker.jobs.prepare.steps.find((step) => step.name === "Check out release tag");
    expect(checkout.with.ref).toContain("inputs.release_tag");
    const build = docker.jobs.build.steps.find((step) => step.name === "Build and push platform image by digest");
    expect(build.with.file).toBe("source/Dockerfile");
  });
});
