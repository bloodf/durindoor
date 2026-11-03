// Guards the Node version claim in docs/deployment/compatibility.mdx (#1143):
// app, CLI, Dockerfile, .nvmrc and every workflow must name the same Node.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (file) => readFileSync(path.join(ROOT, file), "utf8");
const APP_NODE = JSON.parse(read("package.json")).engines.node;

describe("Node version alignment", () => {
  it("pins one exact Node for the app and documents it", () => {
    expect(APP_NODE).toMatch(/^\d+\.\d+\.\d+$/);
    expect(read(".nvmrc").trim()).toBe(APP_NODE);
    expect(read("docs/deployment/compatibility.mdx")).toContain(`\`${APP_NODE}\``);
  });

  it("makes the CLI require at least that Node", () => {
    expect(JSON.parse(read("cli/package.json")).engines.node).toBe(`>=${APP_NODE}`);
  });

  it("builds the Docker image on that Node", () => {
    expect(read("Dockerfile")).toContain(`ARG NODE_IMAGE=node:${APP_NODE}-alpine`);
  });

  it("runs every workflow on that Node", () => {
    const workflows = readdirSync(path.join(ROOT, ".github/workflows")).filter((name) => name.endsWith(".yml"));
    const versions = workflows.flatMap((name) => [...read(`.github/workflows/${name}`).matchAll(/^\s*node-version:\s*([^\s#]+)/gm)].map((m) => m[1]));
    expect(versions.length).toBeGreaterThan(0);
    expect(new Set(versions)).toEqual(new Set([APP_NODE]));
  });
});
