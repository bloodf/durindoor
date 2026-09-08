import { cookies } from "next/headers";
import localFont from "next/font/local";
import "material-symbols/outlined.css";
import "@/shared/ui/tokens.css";
import "./globals.css";
import { ThemeProvider } from "@/shared/components/ThemeProvider";
import "@/lib/network/initOutboundProxy"; // Auto-initialize outbound proxy env
import "@/shared/services/bootstrap"; // Auto-run initializeApp (watchdog, auto-resume tunnel)
import { initConsoleLogCapture } from "@/lib/consoleLogBuffer";
import { RuntimeI18nProvider } from "@/i18n/RuntimeI18nProvider";
import { DEFAULT_LOCALE, LOCALE_COOKIE, getLocaleDirection, normalizeLocale } from "@/i18n/config";

// Hook console immediately at module load time (server-side only, runs once)
initConsoleLogCapture();

const inter = localFont({
  src: [
    { path: "../../public/fonts/Inter-Regular.woff2", weight: "400", style: "normal" },
    { path: "../../public/fonts/Inter-Medium.woff2", weight: "500", style: "normal" },
    { path: "../../public/fonts/Inter-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "../../public/fonts/Inter-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-inter",
});

export const metadata = {
  title: "DurinDoor - AI Gateway",
  description: "One endpoint for all your AI providers. Manage keys, monitor usage, and scale effortlessly.",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", type: "image/x-icon" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/icon-512.png",
  },
};

export const viewport = {
  themeColor: "#0a0a0a",
};

export default async function RootLayout({ children }) {
  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get(LOCALE_COOKIE)?.value || DEFAULT_LOCALE);
  const direction = getLocaleDirection(locale);
  return (
    <html lang={locale} dir={direction} suppressHydrationWarning>
      <head>
        {/* Blocking pre-paint bootstrap reads Zustand's {state:{theme}} envelope.
            A same-origin file stays CSP-authorizable via script-src 'self' without unsafe-inline. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts -- must run before first paint */}
        <script src="/theme-bootstrap.js"></script>
        <script
          dangerouslySetInnerHTML={{
            __html: `if(document.fonts&&document.fonts.ready){document.fonts.ready.then(function(){document.documentElement.classList.add('fonts-loaded')})}else{document.documentElement.classList.add('fonts-loaded')}`,
          }}
        />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        <ThemeProvider>
          <RuntimeI18nProvider>
            {children}
          </RuntimeI18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
