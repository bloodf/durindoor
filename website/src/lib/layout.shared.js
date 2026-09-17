export function baseOptions() {
  return {
    nav: {
      title: (
        <>
          <img src="/icons/icon-512.png" alt="" width={28} height={28} />
          DurinDoor
        </>
      ),
    },
    links: [
      { text: "Home", url: "/" },
      { text: "Docs", url: "/docs" },
      { text: "Demo", url: "/dashboard" },
      { text: "GitHub", url: "https://github.com/bloodf/durindoor", external: true },
    ],
    githubUrl: "https://github.com/bloodf/durindoor",
    themeSwitch: { enabled: false },
  };
}
