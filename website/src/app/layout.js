import "material-symbols/outlined.css";
import "@site/styles/shared/tokens.css";
import "@site/styles/shared/globals.css";
import { ThemeProvider } from "@/shared/components/ThemeProvider";
import { cookies } from "next/headers";
import { HomeLocaleProvider } from "@site/i18n/HomeLocaleProvider.jsx";
import { LOCALE_COOKIE, resolveHomeLocale } from "@site/i18n/home.js";

// Metadata belongs to each surface: (home)/layout.js owns the homepage's
// title and social cards, and /login and /dashboard/* keep their own. The
// root layout only resolves the locale that drives `lang` and hydration.

export default async function RootLayout({ children }) {
  // One request cookie drives both server markup and the first client render.
  const locale = resolveHomeLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return (
    <html lang={locale} dir="ltr" suppressHydrationWarning>
      <head>
        {/* Applies the stored theme before first paint; same file the real dashboard ships. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme-bootstrap.js"></script>
      </head>
      <body className="font-sans antialiased">
        <ThemeProvider><HomeLocaleProvider locale={locale}>{children}</HomeLocaleProvider></ThemeProvider>
      </body>
    </html>
  );
}
