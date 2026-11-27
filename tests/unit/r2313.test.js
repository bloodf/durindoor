/**
 * durindoor#2313 item 1: the background and request-time refresh
 * (checkAndRefreshToken) validates refresh results with the same rules as
 * refreshAndUpdateCredentials before it reshapes, persists or returns them.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refreshProviderCredentials: vi.fn(),
  refreshCopilotToken: vi.fn(),
  refreshGitHubToken: vi.fn(),
}));

vi.mock("../../open-sse/services/oauthCredentialManager.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, refreshProviderCredentials: mocks.refreshProviderCredentials };
});
vi.mock("../../open-sse/services/tokenRefresh.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, refreshCopilotToken: mocks.refreshCopilotToken, refreshGitHubToken: mocks.refreshGitHubToken };
});

const originalDataDir = process.env.DATA_DIR;
let dataDir;
let repo;
let wrapper;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "r2313-"));
  process.env.DATA_DIR = dataDir;
  vi.resetModules();
  repo = await import("../../src/lib/db/repos/connectionsRepo.js");
  wrapper = await import("../../src/sse/services/tokenRefresh.js");
});

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  mocks.refreshProviderCredentials.mockReset();
  mocks.refreshCopilotToken.mockReset().mockResolvedValue(null);
  mocks.refreshGitHubToken.mockReset();
});

const nowSeconds = () => Math.floor(Date.now() / 1000);
let sequence = 0;
async function createConnection(provider = "claude", extra = {}) {
  sequence += 1;
  return repo.createProviderConnection({
    provider,
    authType: "oauth",
    email: `r2313-${sequence}@example.com`,
    accessToken: "A0",
    refreshToken: "R0",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...extra,
  });
}
const stored = (id) => repo.getProviderConnectionById(id);

describe("commit race", () => {
  it("1+2: a stale unrotated refresh keeps the newer stored access token but returns the issued one", async () => {
    const connection = await createConnection();
    mocks.refreshProviderCredentials.mockImplementationOnce(async () => {
      await repo.updateProviderConnection(connection.id, { accessToken: "A-winner" });
      return { accessToken: "A-late", refreshToken: "R0", expiresIn: 3600 };
    });

    const result = await wrapper.checkAndRefreshToken("claude", { ...connection }, null, { force: true });

    expect(await stored(connection.id)).toMatchObject({ accessToken: "A-winner", refreshToken: "R0" });
    expect(result.accessToken).toBe("A-late");
  });

  it("2: a request that loses a rotation race still gets the valid access token it was issued", async () => {
    const connection = await createConnection();
    mocks.refreshProviderCredentials.mockImplementationOnce(async () => {
      await repo.updateProviderConnection(connection.id, { accessToken: "A-winner", refreshToken: "R-winner" });
      return { accessToken: "A-late", refreshToken: "R-late", expiresIn: 3600 };
    });

    const result = await wrapper.checkAndRefreshToken("claude", { ...connection }, null, { force: true });

    expect(await stored(connection.id)).toMatchObject({ accessToken: "A-winner", refreshToken: "R-winner" });
    expect(result.accessToken).toBe("A-late");
  });

  it("3: persists when the exchange already stored the replacement refresh token", async () => {
    const connection = await createConnection();
    mocks.refreshProviderCredentials.mockImplementationOnce(async () => {
      await repo.updateProviderConnection(connection.id, { accessToken: "A-mid", refreshToken: "R1" });
      return { accessToken: "A1", refreshToken: "R1", expiresIn: 3600 };
    });

    await wrapper.checkAndRefreshToken("claude", { ...connection }, null, { force: true });

    expect(await stored(connection.id)).toMatchObject({ accessToken: "A1", refreshToken: "R1" });
  });

  it("3: persists when the starting credentials have no access token to compare", async () => {
    const connection = await createConnection();
    mocks.refreshProviderCredentials.mockResolvedValueOnce({ accessToken: "A1", refreshToken: "R0", expiresIn: 3600 });

    await wrapper.checkAndRefreshToken("claude", { ...connection, accessToken: undefined }, null, { force: true });

    expect(await stored(connection.id)).toMatchObject({ accessToken: "A1", refreshToken: "R0" });
  });

  it("persists an unrotated refresh when nothing newer was stored", async () => {
    const connection = await createConnection();
    mocks.refreshProviderCredentials.mockResolvedValueOnce({ accessToken: "A1", refreshToken: "R0", expiresIn: 3600 });

    await wrapper.checkAndRefreshToken("claude", { ...connection }, null, { force: true });

    expect(await stored(connection.id)).toMatchObject({ accessToken: "A1", refreshToken: "R0" });
  });
});

const MALFORMED = [
  ["refreshToken {}", { accessToken: "A1", refreshToken: {} }],
  ["copilotToken with a newline", { accessToken: "A1", copilotToken: "bad\n" }],
  ["copilotTokenExpiresAt -1", { accessToken: "A1", copilotToken: "C1", copilotTokenExpiresAt: -1 }],
  ["copilotTokenExpiresAt 1e300", { accessToken: "A1", copilotToken: "C1", copilotTokenExpiresAt: 1e300 }],
  ["copilotTokenExpiresAt 9e11", { accessToken: "A1", copilotToken: "C1", copilotTokenExpiresAt: 9e11 }],
  ["nested copilotTokenExpiresAt -1", { accessToken: "A1", providerSpecificData: { copilotToken: "C1", copilotTokenExpiresAt: -1 } }],
  ["nested copilotTokenExpiresAt 1e300", { accessToken: "A1", providerSpecificData: { copilotToken: "C1", copilotTokenExpiresAt: 1e300 } }],
  ["nested copilotTokenExpiresAt 9e11", { accessToken: "A1", providerSpecificData: { copilotToken: "C1", copilotTokenExpiresAt: 9e11 } }],
  ["nested copilotToken with a newline", { accessToken: "A1", providerSpecificData: { copilotToken: "bad\n" } }],
  ["expiresIn 1e300", { accessToken: "A1", refreshToken: "R1", expiresIn: 1e300 }],
  ["no access token", { refreshToken: "R1", expiresIn: 3600 }],
];

describe("4: malformed refresh results are rejected before persistence", () => {
  for (const provider of ["claude", "github", "copilot-m365-web"]) {
    it.each(MALFORMED)(`${provider}: %s`, async (_label, raw) => {
      const connection = await createConnection(provider, {
        providerSpecificData: { copilotToken: "C0", copilotTokenExpiresAt: nowSeconds() + 3600 },
      });
      mocks.refreshProviderCredentials.mockResolvedValueOnce(raw);

      const result = await wrapper.checkAndRefreshToken(provider, { ...connection }, null, { force: true });

      const row = await stored(connection.id);
      expect(row).toMatchObject({ accessToken: "A0", refreshToken: "R0", expiresAt: connection.expiresAt });
      expect(row.providerSpecificData.copilotToken).toBe("C0");
      expect(result).toMatchObject({ accessToken: "A0", refreshToken: "R0", expiresAt: connection.expiresAt });
      expect(result.providerSpecificData.copilotToken).toBe("C0");
      expect(result.copilotToken).toBeUndefined();
      expect(result.copilotTokenExpiresAt).toBeUndefined();
    });
  }
});

describe("4: malformed Copilot-only refreshes are rejected", () => {
  it.each([
    ["token with a newline", { token: "bad\n", expiresAt: () => nowSeconds() + 1800 }],
    ["token {}", { token: {}, expiresAt: () => nowSeconds() + 1800 }],
    ["expiresAt -1", { token: "C1", expiresAt: () => -1 }],
    ["expiresAt 1e300", { token: "C1", expiresAt: () => 1e300 }],
    ["expiresAt 9e11", { token: "C1", expiresAt: () => 9e11 }],
  ])("%s", async (_label, { token, expiresAt }) => {
    const connection = await createConnection("github", { expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    mocks.refreshCopilotToken.mockResolvedValueOnce({ token, expiresAt: expiresAt() });

    const result = await wrapper.checkAndRefreshToken("github", { ...connection });

    expect(mocks.refreshCopilotToken).toHaveBeenCalled();
    expect((await stored(connection.id)).providerSpecificData?.copilotToken).toBeUndefined();
    expect(result.copilotToken).toBeUndefined();
    expect(result.providerSpecificData?.copilotToken).toBeUndefined();
  });

  it("refreshGitHubAndCopilotTokens never returns a malformed Copilot token", async () => {
    mocks.refreshGitHubToken.mockResolvedValueOnce({ accessToken: "G1", refreshToken: "GR1", expiresIn: 3600 });
    mocks.refreshCopilotToken.mockResolvedValueOnce({ token: "bad\n", expiresAt: nowSeconds() + 1800 });

    const result = await wrapper.refreshGitHubAndCopilotTokens({ refreshToken: "GR0" });

    expect(result.accessToken).toBe("G1");
    expect(result.providerSpecificData?.copilotToken).toBeUndefined();
  });
});

describe("5: valid flows still persist", () => {
  it("Copilot M365 refresh-token rotation persists", async () => {
    const connection = await createConnection("copilot-m365-web");
    mocks.refreshProviderCredentials.mockResolvedValueOnce({ accessToken: "A1", refreshToken: "R1", expiresIn: 4500 });

    const result = await wrapper.checkAndRefreshToken("copilot-m365-web", { ...connection }, null, { force: true });

    expect(await stored(connection.id)).toMatchObject({ accessToken: "A1", refreshToken: "R1" });
    expect(result).toMatchObject({ accessToken: "A1", refreshToken: "R1" });
  });

  it("a valid Copilot-only refresh persists and is returned", async () => {
    const connection = await createConnection("github", { expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    const expiresAt = nowSeconds() + 1800;
    mocks.refreshCopilotToken.mockResolvedValueOnce({ token: "C1", expiresAt });

    const result = await wrapper.checkAndRefreshToken("github", { ...connection });

    expect((await stored(connection.id)).providerSpecificData).toMatchObject({ copilotToken: "C1", copilotTokenExpiresAt: expiresAt });
    expect(result.copilotToken).toBe("C1");
  });

  it("a valid GitHub refresh with a nested Copilot token persists", async () => {
    const connection = await createConnection("github");
    const copilotTokenExpiresAt = nowSeconds() + 1800;
    mocks.refreshProviderCredentials.mockResolvedValueOnce({
      accessToken: "A1", refreshToken: "R1", expiresIn: 3600,
      providerSpecificData: { copilotToken: "C1", copilotTokenExpiresAt },
    });

    await wrapper.checkAndRefreshToken("github", { ...connection }, null, { force: true });

    expect(await stored(connection.id)).toMatchObject({
      accessToken: "A1", refreshToken: "R1", providerSpecificData: { copilotToken: "C1", copilotTokenExpiresAt },
    });
  });
});
