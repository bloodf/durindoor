import { NextResponse } from "next/server";
import { hasExactRequestOrigin, hasValidCliToken, hasValidToken } from "@/dashboardGuard";
import { requireSameOrigin } from "@/lib/auth/requireSameOrigin";
import { getSettings } from "@/lib/localDb";
import { isUsingDefaultPassword, verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { checkLock, getClientIp, recordFail, recordSuccess } from "@/lib/auth/loginLimiter";
import { getAdapter } from "@/lib/db/driver.js";
import { getProviderConnectionById } from "@/lib/db/repos/connectionsRepo.js";
import { refreshAndUpdateCredentials } from "@/shared/services/providerCredentials.js";
import { isAntigravityProvider } from "@/lib/antigravity/refreshProtocol.js";
import {
  enableAntigravityRecovery,
  fenceAntigravityRecovery,
  readAntigravityLeaseStatus,
  resetAntigravityRetryBudget,
} from "@/lib/antigravity/leaseSql.js";
import { putRecoveryPassword, recoveryCredentialExists } from "@/lib/antigravity/recoveryStore.js";
import { publicCategory } from "@/lib/antigravity/publicError.js";
import { isRecord, isString } from "@/shared/utils/typeChecks.js";
import {
  readAntigravityScheduler,
  setAntigravitySchedulerEnabled,
} from "@/lib/antigravity/scheduler.js";

const PASSWORD_HEADER = "x-9r-password";
const BODY_LIMIT = 8192;
const PASSWORD_ACTIONS = new Set(["enroll", "replace", "enable", "scheduler-enable"]);
const SESSION_ACTIONS = new Set(["disable", "delete", "retry", "reset", "scheduler-disable"]);

function json(body, status = 200) {
  return NextResponse.json(body, { status });
}

function categoryResponse(category, status = 409) {
  return json({ error: publicCategory(category) }, status);
}

async function readLimitedJson(request) {
  const contentLength = request.headers.get("content-length");
  if (/^\d+$/.test(contentLength || "") && Number(contentLength) > BODY_LIMIT) {
    const error = new Error("body");
    error.status = 413;
    throw error;
  }
  if (!request.body) return {};
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let received = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > BODY_LIMIT) {
        await reader.cancel();
        const error = new Error("body");
        error.status = 413;
        throw error;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  if (!text) return {};
  return JSON.parse(text);
}

async function authorize(request, { passwordRequired }) {
  const originDenied = await requireSameOrigin(request, {
    isSameOrigin: hasExactRequestOrigin,
    allowCliToken: hasValidCliToken,
  });
  if (originDenied) return { response: originDenied };
  const cliOk = await hasValidCliToken(request);
  const jwtOk = await hasValidToken(request);
  if (!cliOk && !jwtOk) return { response: json({ error: "Unauthorized" }, 401) };
  if (!passwordRequired) return { ok: true };
  const settings = await getSettings();
  if (await isUsingDefaultPassword(settings)) {
    return { response: json({ error: "Dashboard password change required" }, 403) };
  }
  const password = request.headers.get(PASSWORD_HEADER);
  const ip = getClientIp(request);
  const lock = checkLock(ip);
  if (lock.locked) {
    return {
      response: json(
        { error: `Too many failed attempts. Try again in ${lock.retryAfter}s.`, retryAfter: lock.retryAfter },
        429
      ),
    };
  }
  if (!password || !(await verifyDashboardPassword(password))) {
    if (password) recordFail(ip);
    return { response: json({ error: "Unauthorized" }, 401) };
  }
  recordSuccess(ip);
  return { ok: true };
}

function publicStatus(row, connection) {
  const storedSubject = connection?.providerSpecificData?.antigravitySubject;
  const subjectPresent = row?.subjectPresent === true || (isString(storedSubject) && storedSubject.length > 0);
  if (!row) {
    return {
      attemptState: "idle",
      errorCategory: null,
      recoveryEnabled: false,
      retryCount: 0,
      nextRetryAt: null,
      subjectPresent,
    };
  }
  return {
    attemptState: row.attemptState,
    errorCategory: row.errorCategory ? publicCategory(row.errorCategory) : null,
    recoveryEnabled: row.recoveryEnabled === true,
    retryCount: row.retryCount || 0,
    nextRetryAt: row.nextRetryAt || null,
    subjectPresent,
  };
}

async function loadAntigravityConnection(connectionId) {
  if (!isString(connectionId) || !connectionId || connectionId.length > 128) return null;
  const connection = await getProviderConnectionById(connectionId);
  if (!connection || !isAntigravityProvider(connection.provider)) return null;
  return connection;
}

export async function GET(request) {
  try {
    const auth = await authorize(request, { passwordRequired: false });
    if (auth.response) return auth.response;
    const scheduler = await readAntigravityScheduler();
    const connectionId = new URL(request.url).searchParams.get("connectionId");
    if (!connectionId) return json({ schedulerEnabled: scheduler.enabled === true });
    const connection = await loadAntigravityConnection(connectionId);
    if (!connection) return json({ error: "Not found" }, 404);
    const db = await getAdapter();
    const status = readAntigravityLeaseStatus(db, connection.id);
    return json({ schedulerEnabled: scheduler.enabled === true, ...publicStatus(status, connection) });
  } catch {
    return categoryResponse("pre_dispatch_failure", 500);
  }
}

export async function POST(request) {
  try {
    let body;
    try {
      body = await readLimitedJson(request);
    } catch (error) {
      return categoryResponse("pre_dispatch_failure", error?.status === 413 ? 413 : 400);
    }
    if (!isRecord(body)) return categoryResponse("pre_dispatch_failure", 400);
    const action = body.action;
    if (!PASSWORD_ACTIONS.has(action) && !SESSION_ACTIONS.has(action)) return categoryResponse("pre_dispatch_failure", 400);
    const auth = await authorize(request, { passwordRequired: PASSWORD_ACTIONS.has(action) });
    if (auth.response) return auth.response;

    if (action === "scheduler-enable" || action === "scheduler-disable") {
      const next = await setAntigravitySchedulerEnabled(action === "scheduler-enable");
      return json({ schedulerEnabled: next.enabled === true });
    }

    const connection = await loadAntigravityConnection(body.connectionId);
    if (!connection) return json({ error: "Not found" }, 404);
    const db = await getAdapter();

    if (action === "enroll" || action === "replace") {
      const subject = connection.providerSpecificData?.antigravitySubject;
      if (!isString(subject) || !subject) return categoryResponse("reauth_required");
      const password = body.recoveryPassword;
      if (!isString(password) || !password) return categoryResponse("encryption", 400);
      await putRecoveryPassword(connection.id, password);
      return json({ ok: true, ...publicStatus(readAntigravityLeaseStatus(db, connection.id), connection) });
    }

    if (action === "enable") {
      if (!recoveryCredentialExists(db, connection.id)) return categoryResponse("encryption");
      const subject = connection.providerSpecificData?.antigravitySubject || null;
      const enabled = db.transaction(() => enableAntigravityRecovery(db, connection.id, subject));
      if (!enabled.ok) return categoryResponse(enabled.category);
      return json({ ok: true, ...publicStatus(readAntigravityLeaseStatus(db, connection.id), connection) });
    }

    if (action === "disable" || action === "delete") {
      db.transaction(() => fenceAntigravityRecovery(db, connection.id, { deleteCredential: action === "delete" }));
      return json({ ok: true, ...publicStatus(readAntigravityLeaseStatus(db, connection.id), connection) });
    }

    if (action === "reset") {
      const reset = db.transaction(() => resetAntigravityRetryBudget(db, connection.id));
      if (!reset.ok) return categoryResponse(reset.category);
      return json({ ok: true, ...publicStatus(readAntigravityLeaseStatus(db, connection.id), connection) });
    }

    const refreshed = await refreshAndUpdateCredentials(connection, true);
    const status = readAntigravityLeaseStatus(await getAdapter(), connection.id);
    return json({
      ok: refreshed?.refreshed === true,
      schedulerEnabled: (await readAntigravityScheduler()).enabled === true,
      ...publicStatus(status, connection),
    });
  } catch (error) {
    return categoryResponse(error?.category || "pre_dispatch_failure", error?.status || 400);
  }
}
