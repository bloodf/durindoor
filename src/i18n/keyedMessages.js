// Small additive pilot for messages whose identity must outlive their English copy.
export const REQUEST_DETAILS_TITLE = "usage.requestDetails.title";

const messages = {
  en: { [REQUEST_DETAILS_TITLE]: "Request details" },
  vi: { [REQUEST_DETAILS_TITLE]: "Chi tiết yêu cầu" },
  id: { [REQUEST_DETAILS_TITLE]: "Detail Permintaan" },
  "zh-CN": { [REQUEST_DETAILS_TITLE]: "请求详情" },
};

export function getKeyedMessage(key, locale) {
  const catalog = Object.hasOwn(messages, locale) ? messages[locale] : messages.en;
  if (Object.hasOwn(catalog, key)) return catalog[key];
  return Object.hasOwn(messages.en, key) ? messages.en[key] : key;
}
