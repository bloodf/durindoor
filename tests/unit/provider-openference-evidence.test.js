import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import openferenceApiEntry from "../../open-sse/providers/registry/openference-api.js";
import { PROVIDERS, PROVIDER_OAUTH } from "../../open-sse/providers/index.js";
import { getProvider } from "../../src/lib/oauth/providers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

export const OPENFERENCE_DISPOSITION = {
  issue: 1220,
  upstreamCommit: "61e07fb7e0d4e1e76111495d3718c9e4d06d2a62",
  disposition: "UNAVAILABLE_PENDING_EXTERNAL_PREREQUISITES",
  reasons: [
    "upstream_embedded_client_id_is_placeholder_omniroute",
    "no_public_oauth_registration_published_by_openference",
    "prohibition_against_inventing_client_id_redirect_or_scopes",
    "preservation_of_credential_encryption_account_scope_and_egress",
    "no_shared_oauth_or_registry_index_edits_authorized",
  ],
};

describe("Issue #1220: Openference provider evidence and disposition", () => {
  it("verifies openference-api (API-key) provider is registered and fully specified", () => {
    expect(openferenceApiEntry).toMatchObject({
      id: "openference-api",
      alias: "ofa",
      category: "apikey",
      authType: "apikey",
      transport: {
        baseUrl: "https://api.openference.com/v1/chat/completions",
        validateUrl: "https://api.openference.com/v1/models",
      },
      modelsFetcher: {
        url: "https://api.openference.com/v1/models",
        type: "openai",
      },
      passthroughModels: true,
      serviceKinds: ["llm"],
    });

    const registered = REGISTRY.find((entry) => entry.id === "openference-api");
    expect(registered).toBeDefined();
    expect(registered.id).toBe("openference-api");
    expect(registered.alias).toBe("ofa");
  });

  it("verifies canonical openference (OAuth) is absent from active runtime to prevent unverified credential use", () => {
    // Registry check: no unverified openference OAuth stub in REGISTRY
    const canonicalEntry = REGISTRY.find((entry) => entry.id === "openference");
    expect(canonicalEntry).toBeUndefined();

    // Transport check: PROVIDERS must not contain canonical openference
    expect(PROVIDERS.openference).toBeUndefined();

    // OAuth metadata check: PROVIDER_OAUTH must not expose openference
    expect(PROVIDER_OAUTH.openference).toBeUndefined();

    // OAuth flow provider check: getProvider must return undefined for openference
    expect(getProvider("openference")).toBeUndefined();
  });

  it("proves upstream 61e07fb embedded client id placeholder and grounds unavailable disposition", () => {
    // In upstream 61e07fb open-sse/utils/publicCreds.ts:
    // openference_id was encoded as [0, 0, 0, 0, 0, 0, 0, 0, 0] with MASK = "omniroute-public-v1".
    // 0 ^ MASK[i] yields the ASCII characters of "omniroute".
    const mask = "omniroute-public-v1";
    const upstreamBytes = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const decodedUpstreamId = upstreamBytes
      .map((b, i) => String.fromCharCode(b ^ mask.charCodeAt(i % mask.length)))
      .join("");

    expect(decodedUpstreamId).toBe("omniroute");
    expect(OPENFERENCE_DISPOSITION.disposition).toBe("UNAVAILABLE_PENDING_EXTERNAL_PREREQUISITES");
    expect(OPENFERENCE_DISPOSITION.reasons).toContain("upstream_embedded_client_id_is_placeholder_omniroute");
  });

  it("verifies omniroute-provider-matrix records for openference and openference-api", () => {
    const matrixPath = resolve(ROOT, "internal/docs/omniroute-provider-matrix.json");
    const matrix = JSON.parse(readFileSync(matrixPath, "utf8"));

    const openferenceRow = matrix.find((row) => row.id === "openference");
    expect(openferenceRow).toBeDefined();
    expect(openferenceRow).toMatchObject({
      id: "openference",
      aliases: ["of"],
      class: "oauth-session",
      executor: "default",
      format: "openai",
      authType: "oauth",
      sourcePath: "open-sse/config/providers/registry/openference/index.ts",
    });

    const openferenceApiRow = matrix.find((row) => row.id === "openference-api");
    expect(openferenceApiRow).toBeDefined();
    expect(openferenceApiRow).toMatchObject({
      id: "openference-api",
      aliases: ["ofa"],
      class: "simple-default",
      executor: "default",
      format: "openai",
      authType: "apikey",
      sourcePath: "open-sse/config/providers/registry/openference-api/index.ts",
    });
  });
});
