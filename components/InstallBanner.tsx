'use client'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { openInstallPrompt } from './InstallPrompt'

// Persistent home-screen banner for logged-in users who signed up
// before the mandatory install gate went in. Non-dismissible by
// design (per user direction, 2026-08-28) — the only way for it to
// disappear is for the user to add rootsTALK to their home screen.
//
// Tapping the banner tries the fastest path first:
//   • Android with a captured `beforeinstallprompt` event → fire
//     `deferredPrompt.prompt()` inline; banner shows a spinner while
//     Chrome's native install dialog is up; on accept, the banner
//     unmounts on the spot without ever leaving the home screen.
//   • Everything else (iOS Safari, Android with no captured event
//     yet) → fall back to the shared InstallPrompt sheet, which
//     carries the appropriate manual instructions.
//
// The `appinstalled` event + a localStorage flag both drive
// permanent hide so the banner stays gone across sessions even
// before the standalone-mode flip on next launch.

const HOME_PATHS = new Set([
  '/home',
  '/dealer/home',
  '/facilitator/home',
  '/pundit/home',
])

const INSTALLED_FLAG = 'rt_installed'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export default function InstallBanner() {
  const t = useTranslations('installBanner')
  const pathname = usePathname()
  const [visible, setVisible] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') { setVisible(false); return }
    // Never render for users who already installed (either this
    // session detected standalone, or the appinstalled listener
    // fired earlier and persisted the flag).
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    if (isStandalone) { setVisible(false); return }
    if (localStorage.getItem(INSTALLED_FLAG) === '1') { setVisible(false); return }
    const ua = navigator.userAgent
    const isMobile = /android|iphone|ipad|ipod/i.test(ua)
    setVisible(isMobile)

    const beforeInstall = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }
    const appInstalled = () => {
      localStorage.setItem(INSTALLED_FLAG, '1')
      setVisible(false)
    }
    window.addEventListener('beforeinstallprompt', beforeInstall)
    window.addEventListener('appinstalled', appInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', beforeInstall)
      window.removeEventListener('appinstalled', appInstalled)
    }
  }, [pathname])

  async function handleTap() {
    if (installing) return
    if (deferredPrompt) {
      // Inline install — stay on the current page, spinner up
      // during the native dialog, unmount on accept.
      setInstalling(true)
      try {
        await deferredPrompt.prompt()
        const { outcome } = await deferredPrompt.userChoice
        if (outcome === 'accepted') {
          localStorage.setItem(INSTALLED_FLAG, '1')
          setVisible(false)
        }
      } catch {
        // Rare — Chrome refused the prompt. Fall back so user isn't
        // left with a dead banner.
        openInstallPrompt()
      } finally {
        setInstalling(false)
        // The deferred prompt event is single-use — clear it so the
        // next tap follows the sheet fallback path.
        setDeferredPrompt(null)
      }
      return
    }
    // No native event available (iOS Safari, or Android hasn't
    // fired beforeinstallprompt yet). Full sheet with instructions.
    openInstallPrompt()
  }

  if (!visible) return null
  if (!HOME_PATHS.has(pathname)) return null

  return (
    <div
      onClick={handleTap}
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
          {installing ? t('installing') : t('bannerSubtitle')}
        </p>
      </div>
      {installing ? (
        <div className="w-5 h-5 border-2 border-[#DDD0B8] border-t-[#3A7D44] rounded-full animate-spin shrink-0" />
      ) : (
        <span className="text-[#3A7D44] font-semibold text-sm shrink-0">
          {t('bannerCta')}
        </span>
      )}
    </div>
  )
}
