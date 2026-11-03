import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useReducedMotion } from "motion/react";
import { getAnimatedIcon } from "./animatedIconCatalog";

/** Animated SVGs respond to their own pointer, focus and touch, and to an
 * enclosing action control. Model-option rows do not become animation owners. */
const MotionIcon = forwardRef(function MotionIcon({ name, size = 18, className = "", style, ...spanProps }, forwardedRef) {
  const reduced = useReducedMotion();
  const host = useRef(null);
  const handle = useRef(null);
  const Icon = getAnimatedIcon(name);
  useImperativeHandle(forwardedRef, () => host.current);

  useEffect(() => {
    const element = host.current;
    if (!element || reduced) return undefined;
    const control = element.closest("button,a,[role=button]");
    const owners = control && control !== element ? [element, control] : [element];
    let touchTimer;
    const start = () => handle.current?.startAnimation();
    const stop = () => handle.current?.stopAnimation();
    const touch = (event) => {
      if (event.pointerType !== "touch") return;
      if (event.currentTarget !== element && element.contains(event.target)) return;
      if (event.currentTarget !== element && element.contains(event.target)) return;
      start();
      clearTimeout(touchTimer);
      touchTimer = setTimeout(stop, 650);
    };
    for (const owner of owners) {
      owner.addEventListener("pointerenter", start);
      owner.addEventListener("pointerleave", stop);
      owner.addEventListener("focus", start);
      owner.addEventListener("blur", stop);
      owner.addEventListener("pointerdown", touch);
    }
    return () => {
      clearTimeout(touchTimer);
      for (const owner of owners) {
        owner.removeEventListener("pointerenter", start);
        owner.removeEventListener("pointerleave", stop);
        owner.removeEventListener("focus", start);
        owner.removeEventListener("blur", stop);
        owner.removeEventListener("pointerdown", touch);
      }
      stop();
    };
  }, [Icon, reduced]);

  return <span
    {...spanProps}
    ref={host}
    data-icon-name={name}
    data-v5-animated-icon={Icon.displayName || Icon.name}
    aria-hidden={spanProps["aria-hidden"] ?? "true"}
    className={`v5-motion-icon ${name === "progress_activity" && !reduced ? "animate-spin motion-reduce:animate-none " : ""}${className}`}
    style={{ display: "inline-flex", flexShrink: 0, width: size, height: size, ...style }}
  >
    <Icon ref={handle} size={size} duration={0.45} isAnimated={!reduced} style={{ display: "inline-flex", width: "100%", height: "100%" }} />
  </span>;
});
MotionIcon.displayName = "MotionIcon";

export default MotionIcon;
