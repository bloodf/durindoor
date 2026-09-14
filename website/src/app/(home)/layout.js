import localFont from "next/font/local";
import { Cinzel } from "next/font/google";
import { cookies } from "next/headers";
import { homeMetadata, LOCALE_COOKIE, resolveHomeLocale } from "@site/i18n/home.js";
import "lenis/dist/lenis.css";
import "./home.css";
import "./hero.css";
import "./sections.css";
import "./demo.css";
import "./story.css";
import "./ledger.css";
import "./light.css";

const inter = localFont({
  src: [
    { path: "../../../public/home/fonts/Inter-Regular.woff2", weight: "400", style: "normal" },
    { path: "../../../public/home/fonts/Inter-Medium.woff2", weight: "500", style: "normal" },
    { path: "../../../public/home/fonts/Inter-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "../../../public/home/fonts/Inter-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-home-sans",
  display: "swap",
});

const cinzel = Cinzel({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-home-display",
  display: "swap",
});

export async function generateMetadata() {
  const locale = resolveHomeLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return {
    ...homeMetadata(locale),
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
    icons: { icon: "/home/favicon.svg" },
  };
}

export const viewport = { themeColor: "#040705", colorScheme: "dark light" };

export default function HomeLayout({ children }) {
  return <div className={`dark dd-home ${inter.variable} ${cinzel.variable}`}>{children}</div>;
}
