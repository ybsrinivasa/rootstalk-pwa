'use client'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { openInstallPrompt } from './InstallPrompt'

// Persistent home-screen banner for logged-in users who haven't
// added rootsTALK to their home screen yet. Non-dismissible by
// design (per user direction, 2026-08-28) — the only way for it to
// disappear is for the user to install, at which point the standalone
// check + `rt_installed` localStorage flag both hide it.
//
// Tapping the banner tries the fastest path first:
//   • Android with a captured `beforeinstallprompt` event → fire
//     `deferredPrompt.prompt()` inline; spinner while Chrome's
//     native dialog is up; on accept, banner unmounts on the spot.
//   • Everything else (iOS Safari, Android with no captured event
//     yet) → fall back to the shared InstallPrompt sheet.
//
// Uninstall detection (2026-08-28): if `beforeinstallprompt` fires
// on a session where `rt_installed = '1'` was already set, the app
// must have been uninstalled since we set the flag — Chrome only
// fires beforeinstallprompt when the app is installable, which
// implies not-currently-installed. Clear the flag so the banner
// reappears. Listeners attach regardless of current visibility so
// this signal isn't missed when the flag suppresses the render.

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
  // `visible` = "mount criteria met" (mobile UA + not standalone).
  // `installedFlag` = "user has installed" (from localStorage).
  // Banner renders only when visible && !installedFlag; keeping the
  // two separate lets us flip installedFlag → false without losing
  // the mobile/standalone context.
  const [visible, setVisible] = useState(false)
  const [installedFlag, setInstalledFlag] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    // Never mount for users currently running as an installed PWA —
    // display-mode standalone is authoritative.
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    if (isStandalone) { setVisible(false); return }
    const ua = navigator.userAgent
    const isMobile = /android|iphone|ipad|ipod/i.test(ua)
    setVisible(isMobile)
    setInstalledFlag(localStorage.getItem(INSTALLED_FLAG) === '1')

    // Listeners attach even when the installedFlag currently
    // suppresses the render — otherwise we can't detect the
    // uninstall signal.
    const beforeInstall = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      // Uninstall signal: Chrome only fires beforeinstallprompt when
      // the app is installable (i.e. not currently installed). If our
      // flag said "installed" and Chrome now says "installable", the
      // user must have uninstalled. Clear the flag to bring the
      // banner back.
      if (localStorage.getItem(INSTALLED_FLAG) === '1') {
        localStorage.removeItem(INSTALLED_FLAG)
        setInstalledFlag(false)
      }
    }
    const appInstalled = () => {
      localStorage.setItem(INSTALLED_FLAG, '1')
      setInstalledFlag(true)
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
          setInstalledFlag(true)
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
  if (installedFlag) return null
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
