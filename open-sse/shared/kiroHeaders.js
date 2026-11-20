import { createHash } from "crypto";
import {
  KIRO_IDE_VERSION,
  KIRO_RUNTIME_SDK_VERSION,
  KIRO_AGENT_OS,
  KIRO_AGENT_OS_VERSION,
  KIRO_NODE_VERSION,
} from "../config/kiroClient.js";

/** Share a stable per-account identity; inference identifies its streaming API separately. */
export function buildKiroIdentityHeaders(credentials, { inference = false } = {}) {
  const seed =
    credentials?.providerSpecificData?.clientId
    || credentials?.refreshToken
    || credentials?.providerSpecificData?.profileArn
    || credentials?.apiKey
    || credentials?.accessToken
    || "kiro-anonymous";
  const machineId = createHash("sha256").update(String(seed)).digest("hex");
  const identity = `KiroIDE-${KIRO_IDE_VERSION}-${machineId}`;

  return {
    "User-Agent":
      `aws-sdk-js/${KIRO_RUNTIME_SDK_VERSION} ua/2.1 ` +
      `os/${KIRO_AGENT_OS}#${KIRO_AGENT_OS_VERSION} ` +
      `lang/js md/nodejs#${KIRO_NODE_VERSION} ` +
      `api/codewhisperer${inference ? "streaming" : "runtime"}#${KIRO_RUNTIME_SDK_VERSION} ${inference ? "m/E" : "m/N,E"} ${identity}`,
    "x-amz-user-agent": `aws-sdk-js/${KIRO_RUNTIME_SDK_VERSION} ${identity}`,
  };
}
