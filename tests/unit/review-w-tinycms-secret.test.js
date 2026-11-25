/** Regression for #2469: TinyCMS's imported app-config-uuid is a credential. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  decryptProviderSpecificData,
  encryptProviderSpecificData,
  scrubProviderSpecificDataForExport,
} from "@/lib/db/helpers/providerSpecificDataSecrets.js";
import { isEncryptedBlob } from "@/lib/crypto/columnCrypto.js";

let tempDir;
let originalDataDir;

beforeEach(() => {
  originalDataDir = process.env.DATA_DIR;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-tinycms-secret-"));
  process.env.DATA_DIR = tempDir;
});

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("TinyCMS imported credential storage (#2469)", () => {
  it("encrypts app-config-uuid, decrypts it on read, and preserves legacy plaintext", () => {
    const rowId = "tinycms-connection";
    const credential = "tinycms-account-uuid";
    const stored = encryptProviderSpecificData({ "app-config-uuid": credential }, rowId);

    expect(isEncryptedBlob(stored["app-config-uuid"])).toBe(true);
    expect(JSON.stringify(stored)).not.toContain(credential);
    expect(decryptProviderSpecificData(stored, rowId)["app-config-uuid"]).toBe(credential);
    expect(decryptProviderSpecificData({ "app-config-uuid": "legacy-uuid" }, rowId)["app-config-uuid"]).toBe("legacy-uuid");
  });

  it("omits app-config-uuid from scrubbed exports", () => {
    expect(scrubProviderSpecificDataForExport({ "app-config-uuid": "tinycms-account-uuid" })).toEqual({});
  });
});
