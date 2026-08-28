import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { isRTL } from "@/lib/locales";
import PushNotificationSetup from "@/components/PushNotificationSetup";
import InstallPrompt from "@/components/InstallPrompt";
import InstallBanner from "@/components/InstallBanner";
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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Resolve the active locale + messages server-side so the first paint
  // is in the user's language. The cookie is the source of truth — see
  // i18n/request.ts. Urdu flips dir=rtl for the full-layout mirror
  // required by the Localisation Strategy §6.
  const locale = await getLocale();
  const messages = await getMessages();
  const dir = isRTL(locale) ? "rtl" : "ltr";
  return (
    <html lang={locale} dir={dir} className="h-full">
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
      <body className={`${inter.className} h-full`}>
        {/* The frame's responsive sizing + black backdrop are in
            globals.css. Two-layer wrapper:
              - .app-frame  → 430-px column, transformed (containing
                              block for `fixed` descendants), NO scroll
              - .app-scroll → fills the frame, owns the scroll
            Splitting these avoids a Chrome quirk where transform +
            overflow on the same element mis-positions fixed children.
            On phones (<768px) both wrappers are inert pass-throughs. */}
        <NextIntlClientProvider locale={locale} messages={messages}>
          <div className="app-frame">
            <div className="app-scroll">{children}</div>
            {/* FCM permission + token registration + foreground
                toast. Mounted at layout scope so every authenticated
                page picks it up; it no-ops when the user isn't
                logged in. */}
            <PushNotificationSetup />
            {/* Persistent home-screen banner for users who signed
                up before the mandatory install gate went in +
                globally-mounted install sheet the banner triggers.
                Both self-guard against standalone mode; the banner
                also filters by pathname so only role home pages
                surface it. */}
            <InstallBanner />
            <InstallPrompt />
          </div>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
