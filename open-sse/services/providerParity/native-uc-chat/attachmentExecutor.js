// Attachment-enabled registration target. The original default remains text-only.
import { UcChatExecutor } from "./executor.js";
import { extractUcAttachment, uploadUcAttachment } from "./attachments.js";

export class UcAttachmentChatExecutor extends UcChatExecutor {
  constructor({ uploadFetchImpl, uploadTimeoutMs, ...options } = {}) {
    super(options);
    this.attachments = {
      extract: extractUcAttachment,
      upload: (media, context) => uploadUcAttachment(media, {
        ...context, fetchImpl: uploadFetchImpl, timeoutMs: uploadTimeoutMs,
      }),
    };
  }
}
export const createUcAttachmentChatExecutor = (options) => new UcAttachmentChatExecutor(options);
