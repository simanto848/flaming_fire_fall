import type { Metadata } from "next";
import "./globals.css";
import Providers from "@/components/Providers";

export const metadata: Metadata = {
  title: "ShunnoShikha AI — Mission Control",
  description:
    "Spacecraft microgravity fire-safety digital twin & scientific super-intelligence. NASA Space Apps Challenge: Flame in Freefall — Team HASH.",
};

/** Applies the saved theme before first paint so there is no flash. */
const themeInit = `(function(){try{var t=localStorage.getItem("shunnoshikha-theme");if(t!=="light"&&t!=="calm")t="calm";document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme","calm");}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Orbitron:wght@500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div className="mc-bg" />
        <div className="mc-grid" />
        <div className="mc-grain" />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
