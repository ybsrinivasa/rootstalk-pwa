'use client'
import { useState, useEffect } from 'react'
import { getUser, ROLE_COLOURS } from '@/lib/auth'
import { getLanguage, setLanguage } from '@/lib/language'
import api from '@/lib/api'
import AppMark from '@/components/AppMark'

type Lang = { language_code: string; language_name_native: string; status?: string }

// Role label shown beneath the rootsTALK.in wordmark. Mirrors the
// labels used in the right drawer for consistency.
const ROLE_LABEL: Record<string, string> = {
  FARMER: 'Farmer',
  DEALER: 'My Shop',
  FACILITATOR: 'Facilitator',
  FARM_PUNDIT: 'Expert',
}

export default function PWAHeader({
  activeRole = 'FARMER',
  title,  // kept for backward compat; no longer rendered.
  onRoleSwitch,
  customColour,
  urgencyBadges,
}: {
  activeRole?: string
  title?: string
  onRoleSwitch?: () => void
  customColour?: string
  urgencyBadges?: { new: number; pending: number; returned: number }
}) {
  void title  // unused since 2026-05-20
  const user = getUser()
  const [showLang, setShowLang] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [languages, setLanguages] = useState<Lang[]>([])
  const [currentLang, setCurrentLang] = useState(getLanguage())
  const colour = customColour || ROLE_COLOURS[activeRole] || '#3A7D44'
  const roleLabel = ROLE_LABEL[activeRole] || 'Farmer'

  // Language pill shows only the languages the SA has marked
  // ACTIVE in the platform settings, plus English as a permanent
  // baseline. Pre-fix it surfaced every row from /platform/languages
  // regardless of status, including drafts and disabled rows.
  useEffect(() => {
    api.get<Lang[]>('/platform/languages')
      .then(r => setLanguages(
        r.data.filter(l => !l.status || l.status === 'ACTIVE' || l.language_code === 'en'),
      ))
      .catch(() => setLanguages([{ language_code: 'en', language_name_native: 'English' }]))
  }, [])

  function switchLang(code: string) {
    setLanguage(code)
    setCurrentLang(code)
    setShowLang(false)
    window.location.reload()
  }

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 py-3"
        style={{
          background: colour,
          paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
        }}>
        {/* Left cluster — AppMark + rootsTALK.in wordmark + role.
            The whole cluster is a single tap target that opens the
            About bottom sheet (the standalone right-side icon
            button is gone). Min-height 44 for tap. */}
        <button
          onClick={() => setShowAbout(true)}
          aria-label="About rootsTALK"
          className="flex items-center gap-2.5 -mx-1 px-1 py-1 rounded-lg hover:bg-white/10 transition-colors">
          <AppMark size={30} tone="mono"/>
          <div className="text-left">
            <p className="leading-none">
              <span className="text-white/80 font-light text-[19px]">roots</span>
              <span className="text-white font-black text-[19px]">TALK</span>
              <span className="text-white/55 font-light text-[16px]">.in</span>
            </p>
            <p className="text-white/70 text-[11px] mt-0.5 leading-none">{roleLabel}</p>
          </div>
        </button>

        <div className="flex items-center gap-2">
          {urgencyBadges && (
            <div className="flex items-center gap-2 mr-1">
              <span className="text-white text-sm font-bold">{urgencyBadges.new}</span>
              <span className="text-amber-300 text-sm font-bold">{urgencyBadges.pending}</span>
              <span className="text-[#D4682E] text-sm font-bold">{urgencyBadges.returned}</span>
            </div>
          )}
          <button onClick={() => setShowLang(!showLang)}
            className="text-white text-xs border border-white/30 rounded-full px-2.5 py-1 font-medium">
            {currentLang.toUpperCase()}
          </button>
          {onRoleSwitch && (
            <button onClick={onRoleSwitch}
              className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white text-xs font-bold">
              {user?.name?.[0]?.toUpperCase() || '?'}
            </button>
          )}
        </div>
      </header>

      {/* Language sheet — z above BottomNav (z-50) so the bottom
          rows aren't eaten by the persistent tab bar. */}
      {showLang && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-end">
          <div className="bg-white rounded-t-2xl w-full max-h-80 overflow-auto"
            style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
            <div className="px-4 py-3 border-b border-[#DDD0B8] flex items-center justify-between">
              <p className="font-medium text-[#6B3F1F] text-sm">Select language</p>
              <button onClick={() => setShowLang(false)} className="text-[#7A8C7E] text-xl">×</button>
            </div>
            {languages.map((l: Lang) => (
              <button key={l.language_code} onClick={() => switchLang(l.language_code)}
                className={`w-full text-left px-4 py-3 border-b border-[#DDD0B8] flex items-center justify-between ${currentLang === l.language_code ? 'bg-green-50' : ''}`}>
                <span className="text-[#6B3F1F]">{l.language_name_native}</span>
                {currentLang === l.language_code && <span style={{ color: colour }}>✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* About rootsTALK sheet — z above BottomNav (z-50) so the
          "Visit eywa.farm" CTA at the bottom isn't covered by the
          persistent tab bar. Safe-area padding inside also clears
          the iOS home indicator. */}
      {showAbout && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-end" onClick={() => setShowAbout(false)}>
          <div className="bg-white rounded-t-2xl w-full"
            style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}
            onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-[#DDD0B8] rounded-full mx-auto mt-3 mb-5" />
            <div className="px-6 flex items-center gap-4 mb-6">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0"
                style={{ background: '#3A7D44' }}>
                <AppMark size={32} tone="mono"/>
              </div>
              <div>
                <p className="font-bold text-[#6B3F1F] text-base">
                  rootsTALK<span className="text-[#7A8C7E]">.in</span>
                </p>
                <p className="text-[#7A8C7E] text-xs mt-0.5">by Neytiri Eywafarm Agritech</p>
              </div>
            </div>
            <div className="px-6 space-y-1 mb-6">
              <p className="text-[#7A8C7E] text-sm leading-relaxed">
                Your agricultural advisory network — connecting farmers, experts,
                and companies across India.
              </p>
            </div>
            <div className="px-6">
              <a href="https://eywa.farm" target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-between w-full bg-[#F5F0E8] rounded-xl px-4 py-3.5 border border-[#DDD0B8]">
                <span className="text-[#6B3F1F] font-medium text-sm">Visit eywa.farm</span>
                <svg className="w-4 h-4 text-[#7A8C7E]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                </svg>
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
