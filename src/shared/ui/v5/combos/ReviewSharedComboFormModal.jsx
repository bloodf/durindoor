import React from "react";
import ReviewComboFormModal from "./ReviewComboFormModal.jsx";
/** Shared media/editor callers keep their original payload contract. */
export default function ReviewSharedComboFormModal(props) {
  return <ReviewComboFormModal {...props} includeMembers={false} />;
}
