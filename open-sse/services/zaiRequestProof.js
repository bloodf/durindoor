import { isRecord } from "../../src/shared/utils/typeChecks.js";

const proofKeys = ["captcha_verify_param", "captchaVerifyParam", "zaiCaptchaVerifyParam"];

/**
 * Client Z.ai proofs belong only to the selected canonical zai-web provider.
 * Clone the request/PSD path so a later combo member retains its original proof.
 * This is outbound omission, independent of stored credentials and audit redaction.
 */
export function isolateZaiRequestProof(body, provider) {
  if (provider === "zai-web" || !isRecord(body)) return body;
  const copy = { ...body };
  for (const key of proofKeys) delete copy[key];
  if (isRecord(copy.providerSpecificData)) {
    copy.providerSpecificData = isolateZaiRequestProof(copy.providerSpecificData, provider);
  }
  return copy;
}
