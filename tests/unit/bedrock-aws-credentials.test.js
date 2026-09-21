import { describe, expect, it } from "vitest";
import { BEDROCK_CREDENTIAL_MODE } from "../../open-sse/config/bedrock.js";
import {
  buildBedrockClientAuth,
  detectBedrockCredentialMode,
} from "../../open-sse/shared/awsCredentials.js";
import { BedrockExecutor } from "../../open-sse/executors/bedrock.js";

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
    // Only `profile`: passing static keys alongside would pin them and defeat SSO refresh.
    expect(buildBedrockClientAuth(credentials)).toEqual({ profile: "my-sso-profile" });
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

  it("builds a profile-mode client for a connection with no API key", () => {
    let seen = null;
    const executor = new BedrockExecutor((credentials) => {
      seen = credentials;
      return {};
    });
    executor.createClient({ providerSpecificData: { profile: "my-sso-profile" } });
    // The injected factory takes precedence, proving the executor does not demand an API key
    // before a client is built.
    expect(seen.providerSpecificData.profile).toBe("my-sso-profile");
  });
});
