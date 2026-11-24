/** Regression for #2469: TinyCMS's imported app-config-uuid is a credential. */
import { describe, expect, it } from "vitest";

import {
  decryptProviderSpecificData,
  encryptProviderSpecificData,
  scrubProviderSpecificDataForExport,
} from "@/lib/db/helpers/providerSpecificDataSecrets.js";
import { isEncryptedBlob } from "@/lib/crypto/columnCrypto.js";

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
