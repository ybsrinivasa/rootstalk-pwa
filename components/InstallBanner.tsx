'use client'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { openInstallPrompt } from './InstallPrompt'

// Persistent home-screen banner for logged-in users who signed up
// before the mandatory install gate went in. Non-dismissible by
// design (per user direction, 2026-08-28) — the only way for it to
// disappear is for the user to add rootsTALK to their home screen,
// at which point `display-mode: standalone` flips true and the banner
// hides forever on that install.
//
// Visibility rules:
//   • Only on role home pages (farmer / dealer / facilitator / pundit)
//     — landing already has the mandatory Get-started gate, and deep
//     pages don't need the visual overhead.
//   • Only for mobile UAs (Android + iOS) — desktop is out of scope
//     for install-to-home-screen; those are back-office surfaces.
//   • Never when the PWA is running in standalone mode.
//
// Tapping the banner dispatches `openInstallPrompt()` — the shared
// InstallPrompt sheet (mounted globally in the root layout) picks up
// the event and shows the install sheet with the appropriate
// Android/iOS branching.

const HOME_PATHS = new Set([
  '/home',
  '/dealer/home',
  '/facilitator/home',
  '/pundit/home',
])

export default function InstallBanner() {
  const t = useTranslations('installBanner')
  const pathname = usePathname()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') { setVisible(false); return }
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    if (isStandalone) { setVisible(false); return }
    const ua = navigator.userAgent
    const isMobile = /android|iphone|ipad|ipod/i.test(ua)
    setVisible(isMobile)
  }, [pathname])

  if (!visible) return null
  if (!HOME_PATHS.has(pathname)) return null

  return (
    <div
      onClick={() => openInstallPrompt()}
      className="mx-4 mt-3 mb-1 flex items-center gap-3 rounded-2xl border border-[#DDD0B8] bg-[#F5F0E8] px-4 py-3 cursor-pointer active:scale-[0.99] transition-transform"
      role="button"
    >
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: '#3A7D44' }}>
        <span className="text-white text-lg">⬆</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#6B3F1F] leading-tight">
          {t('bannerTitle')}
        </p>
        <p className="text-[11px] text-[#7A8C7E] mt-0.5 leading-tight">
          {t('bannerSubtitle')}
        </p>
      </div>
      <span className="text-[#3A7D44] font-semibold text-sm shrink-0">
        {t('bannerCta')}
      </span>
    </div>
  )
}
