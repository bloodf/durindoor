import { isRecord, isString } from "../../../../../shared/utils/typeChecks.js";

/** Extract display-only profile fields. Phone-shaped names are masked before storage. */
export function profileFields(provider, input) {
  let data = input;
  if (provider === "codebuddy-cn") {
    try { data = JSON.parse(Buffer.from(input.split(".")[1], "base64url").toString("utf8")); }
    catch { return {}; }
  }
  if (!isRecord(data)) return {};
  const clean = (value) => isString(value) ? value.trim().slice(0, 200) : "";
  const phone = (value) => /^\+?[\d\s-]{6,20}$/.test(value) && value.replace(/\D/g, "").length >= 6;
  const mask = (value) => {
    const digits = value.replace(/\D/g, "");
    const start = Math.floor((digits.length - 4) / 2);
    return digits.length <= 4 ? "*".repeat(digits.length) : `${digits.slice(0, start)}****${digits.slice(start + 4)}`;
  };
  const candidate = clean(data.nickname) || clean(data.name) || clean(data.username);
  const rawPhone = [data.phone, data.mobile, data.telephone, data.preferred_username, candidate].map(clean).find(phone);
  const name = phone(candidate) ? mask(candidate) : candidate;
  const userId = clean(provider === "codebuddy-cn" ? data.sub : data.id);
  const result = {};
  if (name) result.name = name;
  if (rawPhone) result.phoneMasked = mask(rawPhone);
  if (userId && !phone(userId)) result.userId = userId;
  return result;
}

/** Refresh only credentials issued for the selected provider's fixed origin. */
export async function refreshProfile(connection, fetcher = fetch) {
  if (connection.authType !== "oauth" || !["codebuddy-cn", "qoder-cn"].includes(connection.provider)) throw new Error("Unsupported connection");
  if (!isString(connection.accessToken) || !connection.accessToken || /[\r\n]/.test(connection.accessToken)) throw new Error("Missing access token");
  let input = connection.accessToken;
  if (connection.provider === "qoder-cn") {
    const response = await fetcher("https://openapi.qoder.com.cn/api/v1/userinfo", {
      headers: { Authorization: `Bearer ${input}`, Accept: "application/json" },
      redirect: "error", signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("Profile request failed");
    input = await response.json();
  }
  const fields = profileFields(connection.provider, input);
  if (!fields.name && !fields.phoneMasked) throw new Error("No profile fields found");
  const { phone, mobile, telephone, ...existing } = connection.providerSpecificData || {};
  const providerSpecificData = { ...existing };
  if (fields.phoneMasked) providerSpecificData.phoneMasked = fields.phoneMasked;
  if (fields.userId) providerSpecificData[connection.provider === "codebuddy-cn" ? "uid" : "userId"] = fields.userId;
  const patch = { providerSpecificData };
  if (fields.name) patch.name = fields.name;
  return patch;
}
