(function () {
  // Match the runtime store default even on a first visit or blocked storage.
  let theme = "system";
  try {
    const stored = JSON.parse(localStorage.getItem("theme"))?.state?.theme;
    if (stored === "light" || stored === "dark" || stored === "system") theme = stored;
  } catch {}
  try {
    document.documentElement.classList.toggle(
      "dark",
      theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches),
    );
  } catch {}
})();
