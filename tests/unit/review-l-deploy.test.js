import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const readYaml = (path) => parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"));

describe("deployment examples use hardened runtime defaults", () => {
  it("runs Kubernetes non-root with a read-only root and explicit writable data/tmp mounts", () => {
    const deployment = readYaml("deploy/kubernetes/deployment.yaml");
    const spec = deployment.spec.template.spec;
    const container = spec.containers.find(({ name }) => name === "durindoor");

    expect(spec.securityContext).toMatchObject({ runAsNonRoot: true, runAsUser: 1000, runAsGroup: 1000 });
    expect(container.securityContext).toMatchObject({
      runAsNonRoot: true,
      runAsUser: 1000,
      runAsGroup: 1000,
      allowPrivilegeEscalation: false,
      readOnlyRootFilesystem: true,
      capabilities: { drop: ["ALL"] },
    });
    expect(container.securityContext.capabilities.add).toBeUndefined();
    expect(container.volumeMounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "data", mountPath: "/app/data" }),
      expect.objectContaining({ name: "tmp", mountPath: "/tmp" }),
    ]));
    expect(spec.volumes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "data", persistentVolumeClaim: expect.any(Object) }),
      expect.objectContaining({ name: "tmp", emptyDir: expect.any(Object) }),
    ]));
  });

  it("pins Kubernetes and Compose images to the current release", () => {
    const kustomization = readYaml("deploy/kubernetes/kustomization.yaml");
    const compose = readYaml("docker-compose.yml");

    expect(kustomization.images).toContainEqual(expect.objectContaining({
      name: "ghcr.io/bloodf/durindoor",
      newTag: "4.11.0",
    }));
    expect(compose.services.durindoor.image).toBe("ghcr.io/bloodf/durindoor:4.11.0");
  });

  it("keeps the Compose app private and removes privilege escalation", () => {
    const compose = readYaml("docker-compose.yml");
    const app = compose.services.durindoor;

    expect(app.ports).toContain("127.0.0.1:20128:20128");
    expect(app.user).toBe("1000:1000");
    expect(app.read_only).toBe(true);
    expect(app.cap_drop).toContain("ALL");
    expect(app.security_opt).toContain("no-new-privileges:true");
    expect(app.tmpfs).toContain("/tmp");
  });
});
