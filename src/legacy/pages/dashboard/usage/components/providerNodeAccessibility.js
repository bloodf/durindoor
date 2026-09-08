export function getProviderNodeAccessibility(active, tooltipId) {
  return active ? { tabIndex: 0, "aria-describedby": tooltipId } : {};
}
