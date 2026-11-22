"use client";

import { Modal, Button } from "@/shared/components";

/**
 * Review step shown before a bulk change applies. Confirm applies the reviewed
 * ids; Cancel closes without changing anything.
 */
export default function BulkReviewModal({ review, busy = false, onConfirm, onCancel }) {
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
        <div className="flex flex-col gap-3" data-testid="bulk-review">
          <p className="text-sm text-dd-text" data-testid="bulk-review-summary">
            {review.label} {review.count} {noun}{review.detail ? `: ${review.detail}` : ""}.
          </p>
          {review.hiddenCount > 0 && (
            <p className="text-xs text-dd-muted" role="status" data-testid="bulk-review-hidden">
              {review.hiddenCount} of these {review.hiddenCount === 1 ? "is" : "are"} hidden by the current filter or page.
            </p>
          )}
          <ul className="max-h-48 list-disc overflow-y-auto pl-5 text-sm text-dd-text" aria-label="Affected connections">
            {review.names.map((name, index) => <li key={review.ids[index]}>{name}</li>)}
          </ul>
        </div>
      )}
    </Modal>
  );
}
