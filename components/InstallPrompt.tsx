'use client'
import { useState, useEffect } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'rt_a2hs_dismissed'
const DISMISS_DAYS = 7

// 2026-07-03 — Manual open channel. The landing screen's "Install app"
// footer link dispatches this event; InstallPrompt subscribes and pops
// the sheet regardless of engagement / dismissal state. Lets users who
// missed the auto-popup (Chrome's engagement heuristic gates
// beforeinstallprompt) still get to the install flow on demand.
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
  const [show, setShow]                   = useState(false)
  const [isIOS, setIsIOS]                 = useState(false)
  const [isAndroid, setIsAndroid]         = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installing, setInstalling]       = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    // Already installed as standalone — never show the sheet.
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    const ua = navigator.userAgent
    const ios = /iphone|ipad|ipod/i.test(ua)
    const android = /android/i.test(ua)
    setIsIOS(ios)
    setIsAndroid(android)

    // Manual-open channel — always active. The landing "Install app"
    // link dispatches openInstallPrompt() which fires this. Ignores
    // dismissal cooldown but respects standalone mode.
    const openHandler = () => {
      if (isStandalone) return
      setShow(true)
    }
    window.addEventListener(INSTALL_PROMPT_OPEN_EVENT, openHandler)

    if (isStandalone) {
      return () => window.removeEventListener(INSTALL_PROMPT_OPEN_EVENT, openHandler)
    }

    // Auto-popup path — governed by the dismissal cooldown so users
    // aren't nagged. Manual open above stays available either way.
    const dismissedTs = localStorage.getItem(DISMISS_KEY)
    const cooledDown = !dismissedTs || Date.now() - parseInt(dismissedTs) >= DISMISS_DAYS * 86_400_000

    if (ios && cooledDown) {
      const t = setTimeout(() => setShow(true), 3000)
      return () => {
        clearTimeout(t)
        window.removeEventListener(INSTALL_PROMPT_OPEN_EVENT, openHandler)
      }
    }

    // Android/Desktop Chrome — wait for the browser's install
    // readiness signal. Capture the event regardless of cooldown so
    // manual-open can use `deferredPrompt` even after auto-popup was
    // dismissed.
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      if (cooledDown) {
        setTimeout(() => setShow(true), 3000)
      }
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      window.removeEventListener(INSTALL_PROMPT_OPEN_EVENT, openHandler)
    }
  }, [])

  function dismiss() {
    setShow(false)
    localStorage.setItem(DISMISS_KEY, Date.now().toString())
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
      onClick={dismiss}>
      <div
        className="w-full bg-white rounded-t-2xl pb-8"
        style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="w-10 h-1 bg-stone-200 rounded-full mx-auto mt-3 mb-6" />

        {/* Identity row */}
        <div className="px-6 flex items-center gap-4 mb-5">
          <div className="w-14 h-14 rounded-2xl flex-shrink-0 flex items-center justify-center"
            style={{ background: '#3A7D44' }}>
            <NodeMark size={28} />
          </div>
          <div>
            <p className="font-bold text-[#6B3F1F] text-lg leading-snug">
              Add rootsTALK<span className="text-[#7A8C7E] font-normal">.in</span>
            </p>
            <p className="text-[#7A8C7E] text-sm mt-0.5">
              to your Home Screen for quick access
            </p>
          </div>
        </div>

        {/* Benefits */}
        <div className="px-6 mb-5 flex gap-4">
          {[
            { icon: '⚡', text: 'Opens instantly' },
            { icon: '📵', text: 'Works offline' },
            { icon: '🔔', text: 'Get alerts' },
          ].map(b => (
            <div key={b.text} className="flex-1 bg-[#F5F0E8] rounded-xl p-3 text-center border border-[#DDD0B8]">
              <p className="text-xl mb-1">{b.icon}</p>
              <p className="text-[#6B3F1F] text-xs font-medium">{b.text}</p>
            </div>
          ))}
        </div>

        {isIOS ? (
          /* iOS — manual instruction */
          <div className="mx-6 bg-[#F5F0E8] rounded-xl p-4 border border-[#DDD0B8] mb-4">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-6 h-6 rounded-full bg-[#3A7D44] text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">1</div>
              <p className="text-[#6B3F1F] text-sm leading-relaxed">
                Tap the{' '}
                <span className="inline-flex items-center gap-1 bg-white border border-[#DDD0B8] rounded px-1.5 py-0.5 mx-0.5">
                  <svg className="w-3.5 h-3.5 text-blue-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/>
                  </svg>
                  <span className="text-blue-500 font-medium text-xs">Share</span>
                </span>{' '}
                button in Safari's toolbar
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-[#3A7D44] text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">2</div>
              <p className="text-[#6B3F1F] text-sm leading-relaxed">
                Scroll down and tap{' '}
                <span className="font-semibold text-[#6B3F1F]">"Add to Home Screen"</span>
              </p>
            </div>
          </div>
        ) : deferredPrompt ? (
          /* Android / Desktop Chrome — captured the install event */
          <div className="px-6 mb-4">
            <button
              onClick={install}
              disabled={installing}
              className="w-full py-4 rounded-xl text-white font-semibold text-base disabled:opacity-60 transition-opacity"
              style={{ background: '#3A7D44' }}
            >
              {installing ? 'Installing…' : 'Add to Home Screen'}
            </button>
          </div>
        ) : (
          /* Android / Chrome — install event hasn't fired yet.
             This happens when the user opens the sheet manually
             (via the landing "Install app" link) before Chrome's
             engagement heuristic satisfies. Show the manual menu
             route so the user always has a path. */
          <div className="mx-6 bg-[#F5F0E8] rounded-xl p-4 border border-[#DDD0B8] mb-4">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-6 h-6 rounded-full bg-[#3A7D44] text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">1</div>
              <p className="text-[#6B3F1F] text-sm leading-relaxed">
                Tap the{' '}
                <span className="inline-flex items-center gap-1 bg-white border border-[#DDD0B8] rounded px-1.5 py-0.5 mx-0.5">
                  <span className="text-[#6B3F1F] font-semibold text-xs tracking-wider">⋮</span>
                </span>{' '}
                menu in {isAndroid ? "Chrome's" : "your browser's"} toolbar
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-[#3A7D44] text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">2</div>
              <p className="text-[#6B3F1F] text-sm leading-relaxed">
                Tap{' '}
                <span className="font-semibold text-[#6B3F1F]">"Install app"</span>
                {' '}or{' '}
                <span className="font-semibold text-[#6B3F1F]">"Add to Home screen"</span>
              </p>
            </div>
            <p className="text-[#7A8C7E] text-[11px] mt-3 italic">
              If neither option appears yet, browse the app for a minute and try again — Chrome unlocks Install after a short engagement.
            </p>
          </div>
        )}

        <button onClick={dismiss}
          className="block w-full text-center text-[#7A8C7E] text-sm py-1">
          Not now
        </button>
      </div>
    </div>
  )
}
