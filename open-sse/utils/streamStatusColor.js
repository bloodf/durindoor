/** Color an abnormal stream status when explicitly enabled or on a TTY. */
export function colorStreamStatus(status, color) {
  const explicit = process.env.APP_LOG_COLORS?.trim().toLowerCase();
  const enabled = ["true", "1", "yes", "on"].includes(explicit) ? true
    : ["false", "0", "no", "off"].includes(explicit) ? false
    : Boolean(process.stdout?.isTTY && process.env.NO_COLOR === undefined);
  if (!enabled) return status;
  return `\x1b[${color === "yellow" ? 33 : 31}m${status}\x1b[0m`;
}
