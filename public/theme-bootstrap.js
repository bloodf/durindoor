(function () {
  try {
    const theme = JSON.parse(localStorage.getItem("theme"))?.state?.theme;
    if (theme !== "light" && theme !== "dark" && theme !== "system") return;
    document.documentElement.classList.toggle(
      "dark",
      theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches),
    );
  } catch {}
})();
