"use client";

import { Modal, Button } from "@/shared/components";
import { useUiV5 } from "@/shared/ui/v5/production/uiVersion.js";

/**
 * Review step shown before a bulk change applies. Confirm applies the reviewed
 * ids; Cancel closes without changing anything.
 */
export default function BulkReviewModal({ review, busy = false, onConfirm, onCancel }) {
  const v5 = useUiV5();
  const noun = review?.count === 1 ? "connection" : "connections";
  return (
    <Modal
      isOpen={review !== null && review !== undefined}
      onClose={busy ? () => {} : onCancel}
      title={review ? `Review: ${review.label} ${review.count} ${noun}` : "Review"}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" fullWidth disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button
            variant={review?.action === "delete" ? "danger" : "primary"}
            fullWidth
            disabled={busy || review?.count === 0}
            onClick={onConfirm}>
            {busy ? "Applying..." : "Confirm"}
          </Button>
        </div>
      }>
      {review && (
        <div className={v5 ? "flex min-w-0 flex-col gap-3" : "flex flex-col gap-3"} data-testid="bulk-review">
          <p className="text-sm text-dd-text" data-testid="bulk-review-summary">
            {review.label} {review.count} {noun}{review.detail ? `: ${review.detail}` : ""}.
          </p>
          {review.hiddenCount > 0 && (
            <p className="text-xs text-dd-muted" role="status" data-testid="bulk-review-hidden">
              {review.hiddenCount} of these {review.hiddenCount === 1 ? "is" : "are"} hidden by the current filter or page.
            </p>
          )}
          <ul className={v5 ? "max-h-48 list-disc overflow-y-auto break-words rounded-dd border border-dd-border bg-dd-surface-2 py-3 pl-8 pr-3 text-sm text-dd-text" : "max-h-48 list-disc overflow-y-auto pl-5 text-sm text-dd-text"} aria-label="Affected connections">
            {review.names.map((name, index) => <li key={review.ids[index]}>{name}</li>)}
          </ul>
        </div>
      )}
    </Modal>
  );
}
