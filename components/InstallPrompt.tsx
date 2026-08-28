'use client'
import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'

// Manually-triggered install sheet. Never auto-opens; only shows in
// response to a dispatched `INSTALL_PROMPT_OPEN_EVENT`. The auto-popup
// path (3s after landing) was removed 2026-08-28 when the mandatory
// Get-started install gate went in — the two nudges were redundant
// and confusing.
//
// After further team feedback, the sheet is now surfaced from a
// persistent home-screen banner for users who signed up before the
// gate existed. Any component that wants to show the sheet dispatches
// `openInstallPrompt()`; this component listens and renders.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export const INSTALL_PROMPT_OPEN_EVENT = 'rt-install-prompt-open'

export function openInstallPrompt() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(INSTALL_PROMPT_OPEN_EVENT))
  }
}

function NodeMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="5" fill="white"/>
      <circle cx="8"  cy="12" r="3.5" fill="white" opacity="0.7"/>
      <circle cx="40" cy="36" r="3.5" fill="white" opacity="0.7"/>
      <circle cx="8"  cy="36" r="3.5" fill="white" opacity="0.5"/>
      <circle cx="40" cy="12" r="3.5" fill="white" opacity="0.5"/>
      <line x1="24" y1="24" x2="8"  y2="12" stroke="white" strokeWidth="1.5" opacity="0.6"/>
      <line x1="24" y1="24" x2="40" y2="36" stroke="white" strokeWidth="1.5" opacity="0.6"/>
      <line x1="24" y1="24" x2="8"  y2="36" stroke="white" strokeWidth="1"   opacity="0.35"/>
      <line x1="24" y1="24" x2="40" y2="12" stroke="white" strokeWidth="1"   opacity="0.35"/>
    </svg>
  )
}

export default function InstallPrompt() {
  const t = useTranslations('installBanner')
  const [show, setShow] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const [isAndroid, setIsAndroid] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    if (isStandalone) return  // never mount listeners for installed users

    const ua = navigator.userAgent
    setIsIOS(/iphone|ipad|ipod/i.test(ua))
    setIsAndroid(/android/i.test(ua))

    // Capture Chrome's beforeinstallprompt whenever it fires so we
    // have the native dialog ready when the user asks. Attaching
    // here (not on demand) ensures we don't miss the event.
    const beforeInstall = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', beforeInstall)

    // Manual-open channel — the home-screen InstallBanner dispatches
    // this when the user taps Install.
    const openHandler = () => setShow(true)
    window.addEventListener(INSTALL_PROMPT_OPEN_EVENT, openHandler)

    return () => {
      window.removeEventListener('beforeinstallprompt', beforeInstall)
      window.removeEventListener(INSTALL_PROMPT_OPEN_EVENT, openHandler)
    }
  }, [])

  function close() {
    setShow(false)
  }

  async function install() {
    if (!deferredPrompt) return
    setInstalling(true)
    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    setInstalling(false)
    if (outcome === 'accepted') setShow(false)
    setDeferredPrompt(null)
  }

  if (!show) return null

  return (
    <div className="fixed inset-0 z-[200] flex items-end" style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={close}>
      <div
        className="w-full bg-white rounded-t-2xl pb-8"
        style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-stone-200 rounded-full mx-auto mt-3 mb-6" />

        <div className="px-6 flex items-center gap-4 mb-5">
          <div className="w-14 h-14 rounded-2xl flex-shrink-0 flex items-center justify-center"
            style={{ background: '#3A7D44' }}>
            <NodeMark size={28} />
          </div>
          <div>
            <p className="font-bold text-[#6B3F1F] text-lg leading-snug">
              {t('sheetTitle')}
            </p>
            <p className="text-[#7A8C7E] text-sm mt-0.5">
              {t('sheetSubtitle')}
            </p>
          </div>
        </div>

        <div className="px-6 mb-5 flex gap-4">
          {[
            { icon: '⚡', text: t('benefitFast') },
            { icon: '📵', text: t('benefitOffline') },
            { icon: '🔔', text: t('benefitAlerts') },
          ].map(b => (
            <div key={b.text} className="flex-1 bg-[#F5F0E8] rounded-xl p-3 text-center border border-[#DDD0B8]">
              <p className="text-xl mb-1">{b.icon}</p>
              <p className="text-[#6B3F1F] text-xs font-medium">{b.text}</p>
            </div>
          ))}
        </div>

        {isIOS ? (
          <div className="mx-6 bg-[#F5F0E8] rounded-xl p-4 border border-[#DDD0B8] mb-4">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-6 h-6 rounded-full bg-[#3A7D44] text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">1</div>
              <p className="text-[#6B3F1F] text-sm leading-relaxed">
                {t('iosStep1')}
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-[#3A7D44] text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">2</div>
              <p className="text-[#6B3F1F] text-sm leading-relaxed">
                {t('iosStep2')}
              </p>
            </div>
          </div>
        ) : deferredPrompt ? (
          <div className="px-6 mb-4">
            <button
              onClick={install}
              disabled={installing}
              className="w-full py-4 rounded-xl text-white font-semibold text-base disabled:opacity-60 transition-opacity"
              style={{ background: '#3A7D44' }}
            >
              {installing ? t('installing') : t('installCta')}
            </button>
          </div>
        ) : (
          <div className="mx-6 bg-[#F5F0E8] rounded-xl p-4 border border-[#DDD0B8] mb-4">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-6 h-6 rounded-full bg-[#3A7D44] text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">1</div>
              <p className="text-[#6B3F1F] text-sm leading-relaxed">
                {t('manualStep1', { browser: isAndroid ? 'Chrome' : t('yourBrowser') })}
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-[#3A7D44] text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">2</div>
              <p className="text-[#6B3F1F] text-sm leading-relaxed">
                {t('manualStep2')}
              </p>
            </div>
            <p className="text-[#7A8C7E] text-[11px] mt-3 italic">
              {t('manualNote')}
            </p>
          </div>
        )}

        <button onClick={close}
          className="block w-full text-center text-[#7A8C7E] text-sm py-1">
          {t('close')}
        </button>
      </div>
    </div>
  )
}
