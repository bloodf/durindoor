// Adapted from Animate UI's MIT-licensed primitives-buttons-button registry.
// https://animate-ui.com/r/primitives-buttons-button.json
// Native button semantics are retained; reduced-motion disables scale feedback.
import { motion, useReducedMotion } from "motion/react";

export default function AnimateButton({ hoverScale = 1.015, tapScale = 0.98, disabled, ...props }) {
  const reduced = useReducedMotion();
  return <motion.button {...props} disabled={disabled}
    whileHover={reduced || disabled ? undefined : { scale: hoverScale }}
    whileTap={reduced || disabled ? undefined : { scale: tapScale }}
    transition={{ duration: 0.16 }} />;
}
