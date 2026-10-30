import { SITE_URL } from "@site/lib/site.js";
import localFont from "next/font/local";

import { cookies } from "next/headers";
import { homeMetadata, LOCALE_COOKIE, resolveHomeLocale } from "@site/i18n/home.js";
import "lenis/dist/lenis.css";
import "./home.css";
import "./hero.css";
import "./sections.css";
import "./demo.css";
import "./story.css";
import "./ledger.css";
import "./brand.css";

const space = localFont({
  src: "../../../public/home/fonts/SpaceGrotesk.ttf",
  variable: "--font-home-sans", display: "swap", weight: "300 700",
});

const display = localFont({ src: "../../../public/home/fonts/CormorantGaramond.ttf", variable: "--font-home-display", display: "swap", weight: "300 700" });

export async function generateMetadata() {
  const locale = resolveHomeLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return {
    ...homeMetadata(locale),
    metadataBase: SITE_URL,
    icons: { icon: "/home/favicon.svg" },
    alternates: { canonical: new URL("/", SITE_URL).href },
  };
}

export const viewport = { themeColor: "#171719", colorScheme: "dark light" };

export default function HomeLayout({ children }) {
  return <div className={`dark dd-home ${space.variable} ${display.variable}`}>{children}</div>;
}
