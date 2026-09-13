import localFont from "next/font/local";
import { Cinzel } from "next/font/google";
import "lenis/dist/lenis.css";
import "./home.css";
import "./hero.css";
import "./sections.css";
import "./demo.css";

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

const description =
  "One guarded gateway for every AI provider. Add credentials once, point every OpenAI-compatible tool at a single local endpoint.";

export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  icons: { icon: "/home/favicon.svg" },
  title: "DurinDoor — Speak, friend, and enter",
  description,
  openGraph: {
    title: "DurinDoor — Speak, friend, and enter",
    description,
    type: "website",
    images: [{ url: "/home/door-poster.webp", width: 1600, height: 679, alt: "Ancient stone door glowing emerald in dark ruins" }],
  },
  twitter: { card: "summary_large_image", title: "DurinDoor — Speak, friend, and enter", description },
};

export const viewport = { themeColor: "#040705", colorScheme: "dark" };

export default function HomeLayout({ children }) {
  return <div className={`dark dd-home ${inter.variable} ${cinzel.variable}`}>{children}</div>;
}
