import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "rootsTALK.in",
  description: "Your agricultural advisory network",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "rootsTALK",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: "#3A7D44",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      {/* Desktop "phone frame": ≥md viewports get a black backdrop and a
          430-px-wide white column. The wrapper div uses transform-gpu on
          md+ so it becomes the containing block for `position: fixed`
          descendants — meaning PWAHeader, BottomNav, bottom-sheets, the
          install-prompt etc. all pin to the column edges instead of the
          1080-px viewport without per-component changes. Internal scroll
          (md:h-dvh + md:overflow-y-auto) keeps the header/nav glued to
          the column instead of the viewport top/bottom. Below md, the
          wrapper is inert: no max-width, no transform, no inner scroll
          — phones behave exactly as before. */}
      <body className={`${inter.className} h-full bg-white md:bg-black md:overflow-hidden`}>
        <div className="md:mx-auto md:max-w-[430px] md:h-dvh md:overflow-y-auto md:overflow-x-hidden md:bg-white md:shadow-2xl md:transform-gpu md:relative">
          {children}
        </div>
      </body>
    </html>
  );
}
