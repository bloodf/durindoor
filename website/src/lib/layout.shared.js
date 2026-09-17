export function baseOptions() {
  return {
    nav: {
      title: (
        <>
          <img src="/durindoor-wordmark.png" alt="" width={26} height={26} />
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
