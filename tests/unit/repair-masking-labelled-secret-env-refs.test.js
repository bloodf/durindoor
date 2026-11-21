import { describe, it, expect } from "vitest";
import { maskText } from "../../open-sse/services/contentMasking.js";

describe("labelled_secret masking skips variable and expression references (#1073)", () => {
  const unchanged = [
    "const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });",
    "const key = { api_key: env.ANTHROPIC_API_KEY_V2 };",
    "secret_key = os.environ['DJANGO_SECRET_KEY']",
    "secret_key = os.environ[\"DJANGO_SECRET_KEY\"]",
    "password = os.getenv(\"DATABASE_PASSWORD\")",
    "password = os.environ.get(\"DATABASE_PASSWORD\")",
    "auth_token: import.meta.env.VITE_AUTH_TOKEN,",
    "apiKey: config.providers.openai.apiKey,",
    "API_KEY=${OPENAI_API_KEY_PRODUCTION}",
    "API_KEY=$OPENAI_API_KEY_PRODUCTION",
    "apiKey: \"${OPENAI_API_KEY_PRODUCTION}\"",
    "const opts = { accessToken: currentAccessToken };",
    "client_secret: CLIENT_SECRET_V2,",
    "refreshToken: loadRefreshToken2(user),",
    "apiKey: \"your-api-key-here\"",
    "api_key=xxxxxxxxxxxxxxxxxxxx",
    "password: \"changeme-placeholder\"",
    "password=short123"
  ];
  for (const text of unchanged) {
    it(`keeps ${JSON.stringify(text)} unchanged`, () => {
      const counts = {};
      expect(maskText(text, {}, counts)).toBe(text);
      expect(counts.labelled_secret).toBeUndefined();
    });
  }

  it("keeps a whole code sample unchanged in a response-like text", () => {
    const text = [
      "```js",
      "import OpenAI from \"openai\";",
      "const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });",
      "```"
    ].join("\n");
    expect(maskText(text)).toBe(text);
  });
});

describe("labelled_secret masking still redacts literal secrets (#1073)", () => {
  it("masks a quoted literal next to an apiKey label", () => {
    const counts = {};
    expect(maskText("new OpenAI({ apiKey: \"live-Rk4pW9zQm2xt7vNb3Lq\" })", {}, counts))
      .toBe("new OpenAI({ apiKey: \"[REDACTED:secret]\" })");
    expect(counts.labelled_secret).toBe(1);
  });

  it("masks a quoted sk-live literal", () => {
    const out = maskText("apiKey: 'sk-live-9fK2mQ7xLp4Rz8Wn'");
    expect(out).not.toContain("9fK2mQ7xLp4Rz8Wn");
    expect(out).toContain("[REDACTED:");
  });

  it("masks unquoted password literals of qualifying length", () => {
    const counts = {};
    expect(maskText("password=hunter2hunter2hunter2", {}, counts)).toBe("password=[REDACTED:secret]");
    expect(counts.labelled_secret).toBe(1);
  });

  it("masks api_key query parameters with a literal", () => {
    expect(maskText("GET https://api.example.test/v1?api_key=Rk4pW9zQm2xt7vNb3&q=1"))
      .toBe("GET https://api.example.test/v1?api_key=[REDACTED:secret]&q=1");
  });

  it("masks env-file literals with mixed letters and digits", () => {
    expect(maskText("DB_PASSWORD=Rk4pW9zQm2xt7vNb3\nCLIENT_SECRET=a8f3c9e1b7d24f60"))
      .toBe("DB_PASSWORD=[REDACTED:secret]\nCLIENT_SECRET=[REDACTED:secret]");
  });
});
