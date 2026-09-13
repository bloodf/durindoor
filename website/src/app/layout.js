import "material-symbols/outlined.css";
import "@site/styles/shared/tokens.css";
import "@site/styles/shared/globals.css";
import { ThemeProvider } from "@/shared/components/ThemeProvider";

export const metadata = { title: "DurinDoor", description: "Speak, friend, and enter. One guarded gateway for every AI provider." };

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the stored theme before first paint; same file the real dashboard ships. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme-bootstrap.js"></script>
      </head>
      <body className="font-sans antialiased"><ThemeProvider>{children}</ThemeProvider></body>
    </html>
  );
}
