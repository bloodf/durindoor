import { afterEach, expect, it, vi } from "vitest";
import { parse } from "@babel/parser";
import { fileURLToPath } from "node:url";
import { createProviderMetadataPlugin } from "../../.storybook/provider-metadata.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
afterEach(() => vi.unstubAllEnvs());

it("projects deterministic real public catalogs without leaking credentials or server imports", async () => {
  vi.stubEnv("GEMINI_OAUTH_CLIENT_SECRET", "QA_SECRET_CANARY_8819");
  vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENT_SECRET", "QA_SECRET_CANARY_8819");
  const first = await createProviderMetadataPlugin(root);
  const second = await createProviderMetadataPlugin(root);
  const registryId = first.resolveId("open-sse/providers/registry/index.js");
  const providersId = first.resolveId("open-sse/providers/index.js");
  const registrySource = first.load(registryId);
  const modelSource = first.load(providersId);
  expect(registrySource).toBe(second.load(registryId));
  expect(modelSource).toBe(second.load(providersId));
  expect(first.resolveId("./registry/index.js", `${root}/open-sse/providers/index.js`)).toBe(registryId);
  expect(first.resolveId("../providers/index.js", `${root}/open-sse/config/providerModels.js`)).toBe(providersId);
  expect(first.resolveId("../providers/index.js", "/unrelated/source/file.js")).toBeNull();
  expect(first.resolveId("open-sse/providers/shared.js")).toBeNull();
  expect(first.load("unrelated")).toBeNull();
  for (const source of [registrySource, modelSource]) {
    expect(source).not.toContain("QA_SECRET_CANARY_8819");
    const ast = parse(source, { sourceType: "module" });
    expect(ast.program.body.some((node) => node.type === "ImportDeclaration")).toBe(false);
  }
  const registry = JSON.parse(registrySource.slice("export default ".length, -1));
  const declarations = parse(modelSource, { sourceType: "module" }).program.body.map((node) => node.declaration.declarations[0]);
  const projected = Object.fromEntries(declarations.map((node) => [node.id.name, JSON.parse(modelSource.slice(node.init.start, node.init.end))]));
  const models = projected.PROVIDER_MODELS;
  expect(Object.keys(projected).sort()).toEqual(["PROVIDERS", "PROVIDER_MEDIA", "PROVIDER_MODELS", "PROVIDER_OAUTH"]);
  expect(projected.PROVIDERS.claude.format).toBe("claude");
  expect(projected.PROVIDERS["xiaomi-tokenplan"].regions).toEqual(registry.find((entry) => entry.id === "xiaomi-tokenplan").transport.regions);
  expect(registry.find((entry) => entry.id === "claude").display.name).toBeTruthy();
  expect(registry.find((entry) => entry.id === "kimchi").models.map((model) => model.id)).toEqual(models.kimchi.map((model) => model.id));
  const forbidden = new Set(["clientSecret", "clientId", "authorization", "headers", "credentials", "apiKey", "tokenUrl"]);
  const visit = (value) => {
    if (!value || Object(value) !== value) return;
    for (const [key, child] of Object.entries(value)) {
      expect(forbidden.has(key), `public catalog contains ${key}`).toBe(false);
      visit(child);
    }
  };
  visit(registry);
  visit(projected);
}, 60000);
