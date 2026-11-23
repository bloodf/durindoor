import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const readYaml = (path) => parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"));

describe("deployment examples use hardened runtime defaults", () => {
  it("keeps Kubernetes bootable with a read-only root and writable data/tmp mounts", () => {
    const deployment = readYaml("deploy/kubernetes/deployment.yaml");
    const spec = deployment.spec.template.spec;
    const container = spec.containers.find(({ name }) => name === "durindoor");

    expect(spec.securityContext.runAsNonRoot).toBeUndefined();
    expect(spec.securityContext.runAsUser).toBeUndefined();
    expect(spec.securityContext.runAsGroup).toBeUndefined();
    expect(container.securityContext).toMatchObject({
      allowPrivilegeEscalation: false,
      readOnlyRootFilesystem: true,
      capabilities: { drop: ["ALL"], add: ["CHOWN", "SETUID", "SETGID", "DAC_OVERRIDE"] },
    });
    expect(container.securityContext.runAsNonRoot).toBeUndefined();
    expect(container.securityContext.runAsUser).toBeUndefined();
    expect(container.securityContext.runAsGroup).toBeUndefined();
    expect(container.volumeMounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "data", mountPath: "/app/data" }),
      expect.objectContaining({ name: "tmp", mountPath: "/tmp" }),
    ]));
    expect(spec.volumes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "data", persistentVolumeClaim: expect.any(Object) }),
      expect.objectContaining({ name: "tmp", emptyDir: expect.any(Object) }),
    ]));
  });

  it("pins Kubernetes and Compose images to a numbered published release", () => {
    const kustomization = readYaml("deploy/kubernetes/kustomization.yaml");
    const compose = readYaml("docker-compose.yml");

    expect(kustomization.images).toContainEqual(expect.objectContaining({
      name: "ghcr.io/bloodf/durindoor",
      newTag: "4.9.2",
    }));
    expect(compose.services.durindoor.image).toMatch(/^ghcr\.io\/bloodf\/durindoor:\d+\.\d+\.\d+$/);
    expect(compose.services.durindoor.image).toBe("ghcr.io/bloodf/durindoor:4.9.2");
  });

  it("keeps the Compose app private and removes privilege escalation", () => {
    const compose = readYaml("docker-compose.yml");
    const app = compose.services.durindoor;

    expect(app.ports).toContain("127.0.0.1:20128:20128");
    expect(app.user).toBeUndefined();
    expect(app.read_only).toBe(true);
    expect(app.cap_drop).toContain("ALL");
    expect(app.cap_add).toEqual(["CHOWN", "SETUID", "SETGID", "DAC_OVERRIDE"]);
    expect(app.security_opt).toContain("no-new-privileges:true");
    expect(app.tmpfs).toContain("/tmp");
  });
});
