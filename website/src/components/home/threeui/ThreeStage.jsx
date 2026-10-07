/** Lightweight routing-line background. Motion is CSS-only and follows reduced-motion preferences. */
export default function ThreeStage({ effect, className = "" }) {
  return <div className={`routing-field routing-field-${effect} ${className}`} aria-hidden="true"><i /><i /><i /><i /></div>;
}
