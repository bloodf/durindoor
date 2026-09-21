import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BEDROCK_CREDENTIAL_MODE } from "../../open-sse/config/bedrock.js";
import {
  buildBedrockClientAuth,
  checkBedrockProfileInput,
  detectBedrockCredentialMode,
} from "../../open-sse/shared/awsCredentials.js";
import { BedrockExecutor, statusFromError } from "../../open-sse/executors/bedrock.js";
import { buildAwsConnectionEdit } from "../../src/shared/utils/awsConnectionEdit.js";

describe("Bedrock credential mode detection", () => {
  it("keeps a bare API key connection on the existing bearer-token path", () => {
    const credentials = { apiKey: "bedrock-api-key" };
    expect(detectBedrockCredentialMode(credentials)).toBe(BEDROCK_CREDENTIAL_MODE.API_KEY);
    expect(buildBedrockClientAuth(credentials)).toEqual({
      token: { token: "bedrock-api-key" },
      authSchemePreference: ["httpBearerAuth"],
    });
  });

  it("selects static AWS keys from the access key id, not from the API key field", () => {
    const credentials = {
      apiKey: "aws-secret-access-key",
      providerSpecificData: { accessKeyId: "AKIAEXAMPLE" },
    };
    expect(detectBedrockCredentialMode(credentials)).toBe(BEDROCK_CREDENTIAL_MODE.STATIC);
    expect(buildBedrockClientAuth(credentials)).toEqual({
      credentials: { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "aws-secret-access-key" },
    });
  });

  it("passes a session token through for temporary keys", () => {
    const auth = buildBedrockClientAuth({
      apiKey: "aws-secret-access-key",
      providerSpecificData: { accessKeyId: "ASIAEXAMPLE", sessionToken: "session-token" },
    });
    expect(auth.credentials.sessionToken).toBe("session-token");
  });

  it("lets a profile win over static keys so a filled-in profile is never ignored", () => {
    const credentials = {
      apiKey: "aws-secret-access-key",
      providerSpecificData: { profile: "my-sso-profile", accessKeyId: "AKIAEXAMPLE" },
    };
    expect(detectBedrockCredentialMode(credentials)).toBe(BEDROCK_CREDENTIAL_MODE.PROFILE);
    // Only the profile's provider: passing static keys alongside would pin them and defeat SSO refresh.
    const auth = buildBedrockClientAuth(credentials);
    expect(Object.keys(auth)).toEqual(["credentials"]);
    expect(auth.credentials).toBeTypeOf("function");
  });

  it("ignores a whitespace-only profile instead of selecting an empty profile mode", () => {
    const credentials = {
      apiKey: "aws-secret-access-key",
      providerSpecificData: { profile: "   ", accessKeyId: "AKIAEXAMPLE" },
    };
    expect(detectBedrockCredentialMode(credentials)).toBe(BEDROCK_CREDENTIAL_MODE.STATIC);
  });
});

describe("Bedrock credential validation", () => {
  it("rejects a profile name that could reach a credential resolver as an arbitrary string", () => {
    for (const profile of ["../../etc/passwd", "bad name", "a".repeat(65), "x;y"]) {
      expect(() =>
        buildBedrockClientAuth({ providerSpecificData: { profile } }),
      ).toThrow(/Invalid AWS profile name/);
    }
  });

  it("rejects a temporary access key with no session token", () => {
    expect(() =>
      buildBedrockClientAuth({
        apiKey: "aws-secret-access-key",
        providerSpecificData: { accessKeyId: "ASIAEXAMPLE" },
      }),
    ).toThrow(/temporary AWS access key/);
  });

  it("rejects static keys with no secret access key", () => {
    expect(() =>
      buildBedrockClientAuth({ providerSpecificData: { accessKeyId: "AKIAEXAMPLE" } }),
    ).toThrow(/static credentials are incomplete/);
  });

  it("rejects a connection carrying no credential at all", () => {
    expect(() => buildBedrockClientAuth({})).toThrow(/Missing Bedrock credentials/);
  });

  it("tags credential errors as 401 so they are reported as auth failures", () => {
    let thrown = null;
    try {
      buildBedrockClientAuth({});
    } catch (error) {
      thrown = error;
    }
    expect(thrown?.status).toBe(401);
  });

  it("never puts a secret in the error message", () => {
    let message = "";
    try {
      buildBedrockClientAuth({
        apiKey: "super-secret-value",
        providerSpecificData: { accessKeyId: "ASIAEXAMPLE" },
      });
    } catch (error) {
      message = error.message;
    }
    expect(message).not.toContain("super-secret-value");
    expect(message).not.toContain("ASIAEXAMPLE");
  });
});

describe("BedrockExecutor credential handling", () => {
  it("answers 401 instead of calling AWS when the connection has no credential", async () => {
    const executor = new BedrockExecutor();
    const result = await executor.execute({
      model: "anthropic.claude-sonnet-4-5",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { providerSpecificData: { region: "us-east-1" } },
    });
    expect(result.response.status).toBe(401);
    const body = await result.response.json();
    expect(body.error.type).toBe("auth_error");
  });

  it("builds a profile-mode client with no bearer token when no factory is injected", async () => {
    const client = new BedrockExecutor().createClient({
      providerSpecificData: { profile: "my-sso-profile", region: "us-west-2" },
    });
    expect(client.config.profile).toBeUndefined();
    expect(client.config.token).toBeUndefined();
    expect(await client.config.region()).toBe("us-west-2");
  });

  it("maps an SDK credential-provider failure (expired SSO session) to 401 auth_error", async () => {
    const expired = Object.assign(new Error("The SSO session associated with this profile has expired"), {
      name: "CredentialsProviderError",
    });
    expect(statusFromError(expired)).toBe(401);
    expect(statusFromError(Object.assign(new Error("x"), { name: "TokenProviderError" }))).toBe(401);

    const executor = new BedrockExecutor(() => ({ send: async () => { throw expired; } }));
    const result = await executor.execute({
      model: "anthropic.claude-sonnet-4-5",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { providerSpecificData: { profile: "my-sso-profile" } },
    });
    expect(result.response.status).toBe(401);
    expect((await result.response.json()).error.type).toBe("auth_error");
  });
});

describe("Bedrock session token storage", () => {
  it("reads the session token from the top-level encrypted field", () => {
    const auth = buildBedrockClientAuth({
      apiKey: "aws-secret-access-key",
      sessionToken: "top-level-token",
      providerSpecificData: { accessKeyId: "ASIAEXAMPLE" },
    });
    expect(auth.credentials.sessionToken).toBe("top-level-token");
  });

  it("still reads a token a 9router install left in providerSpecificData", () => {
    const auth = buildBedrockClientAuth({
      apiKey: "aws-secret-access-key",
      providerSpecificData: { accessKeyId: "ASIAEXAMPLE", sessionToken: "legacy-token" },
    });
    expect(auth.credentials.sessionToken).toBe("legacy-token");
  });
});

describe("checkBedrockProfileInput", () => {
  it("accepts a missing, empty or valid profile", () => {
    expect(checkBedrockProfileInput(undefined)).toEqual({ profile: "" });
    expect(checkBedrockProfileInput({ profile: "" })).toEqual({ profile: "" });
    expect(checkBedrockProfileInput({ profile: " dev-sso " })).toEqual({ profile: "dev-sso" });
  });

  it("rejects a non-string or malformed profile", () => {
    expect(checkBedrockProfileInput({ profile: { a: 1 } }).error).toMatch(/string/);
    expect(checkBedrockProfileInput({ profile: true }).error).toMatch(/string/);
    expect(checkBedrockProfileInput({ profile: "x;rm -rf" }).error).toMatch(/Invalid AWS profile/);
  });
});

describe("buildAwsConnectionEdit", () => {
  const blank = { profile: "", accessKeyId: "", sessionToken: "" };

  it("clears a saved profile when a new API key is typed", () => {
    const { providerSpecificData } = buildAwsConnectionEdit({
      savedData: { profile: "old-sso", region: "us-east-1" },
      awsData: { ...blank, profile: "old-sso" },
      apiKey: "new-bedrock-api-key",
      region: "us-east-1",
    });
    expect(providerSpecificData.profile).toBe("");
    expect(detectBedrockCredentialMode({ apiKey: "new-bedrock-api-key", providerSpecificData }))
      .toBe(BEDROCK_CREDENTIAL_MODE.API_KEY);
  });

  it("keeps the saved session token when the field is blank and the key id is unchanged", () => {
    const edit = buildAwsConnectionEdit({
      savedData: { accessKeyId: "ASIAOLD" },
      awsData: { ...blank, accessKeyId: "ASIAOLD" },
    });
    expect(edit.sessionToken).toBeUndefined();
  });

  it("replaces the session token when the access key id changes", () => {
    expect(buildAwsConnectionEdit({
      savedData: { accessKeyId: "ASIAOLD" },
      awsData: { ...blank, accessKeyId: "ASIANEW", sessionToken: "new-token" },
    }).sessionToken).toBe("new-token");
    // Moving to a long-term key drops the old token even though none was typed.
    expect(buildAwsConnectionEdit({
      savedData: { accessKeyId: "ASIAOLD" },
      awsData: { ...blank, accessKeyId: "AKIANEW" },
    }).sessionToken).toBe("");
  });

  it("clears the session token and key id when static keys are removed", () => {
    const edit = buildAwsConnectionEdit({
      savedData: { accessKeyId: "ASIAOLD" },
      awsData: blank,
      apiKey: "bedrock-api-key",
    });
    expect(edit.sessionToken).toBe("");
    expect(edit.providerSpecificData.accessKeyId).toBe("");
  });

  it("never puts the session token in providerSpecificData", () => {
    const { providerSpecificData } = buildAwsConnectionEdit({
      savedData: {},
      awsData: { ...blank, accessKeyId: "ASIANEW", sessionToken: "secret-token" },
    });
    expect(JSON.stringify(providerSpecificData)).not.toContain("secret-token");
  });
});

describe("Bedrock profile resolves only the named profile", () => {
  const saved = {};
  const ENV = ["AWS_CONFIG_FILE", "AWS_SHARED_CREDENTIALS_FILE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_PROFILE"];
  let dir;

  beforeEach(() => {
    for (const key of ENV) saved[key] = process.env[key];
    dir = mkdtempSync(join(tmpdir(), "bedrock-profile-"));
    writeFileSync(join(dir, "config"), "[profile team]\nregion = us-east-1\n");
    writeFileSync(join(dir, "credentials"), "[team]\naws_access_key_id = AKIATEAM\naws_secret_access_key = team-secret\n");
    process.env.AWS_CONFIG_FILE = join(dir, "config");
    process.env.AWS_SHARED_CREDENTIALS_FILE = join(dir, "credentials");
    // Ambient server credentials that a fallback chain would pick up.
    process.env.AWS_ACCESS_KEY_ID = "AKIASERVER";
    process.env.AWS_SECRET_ACCESS_KEY = "server-secret";
    delete process.env.AWS_PROFILE;
  });

  afterEach(() => {
    for (const key of ENV) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolves the configured profile's own keys", async () => {
    const { credentials } = buildBedrockClientAuth({ providerSpecificData: { profile: "team" } });
    const resolved = await credentials();
    expect(resolved.accessKeyId).toBe("AKIATEAM");
  });

  it("fails for a missing profile instead of falling back to the server's credentials", async () => {
    const { credentials } = buildBedrockClientAuth({ providerSpecificData: { profile: "missing" } });
    await expect(credentials()).rejects.toMatchObject({ name: "CredentialsProviderError" });
  });

  it("returns a generic 401 message and keeps the provider's detail out of the response", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failure = Object.assign(new Error("Profile missing could not be found in /home/ops/.aws/config"), {
      name: "CredentialsProviderError",
    });
    const executor = new BedrockExecutor(() => ({ send: async () => { throw failure; } }));
    const result = await executor.execute({
      model: "anthropic.claude-sonnet-4-5",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { providerSpecificData: { profile: "missing" } },
    });
    expect(result.response.status).toBe(401);
    const text = await result.response.text();
    expect(text).not.toContain("/home/ops/.aws/config");
    expect(text).toContain("could not be resolved");
    warn.mockRestore();
  });
});
