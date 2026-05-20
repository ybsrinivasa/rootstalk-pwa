'use client'
import { useState, useEffect } from 'react'
import { getUser, ROLE_COLOURS } from '@/lib/auth'
import { getLanguage, setLanguage } from '@/lib/language'
import api from '@/lib/api'

type Lang = { language_code: string; language_name_native: string }

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
  title,  // kept for backward compat; no longer rendered. The wordmark
          // + role label replaced it 2026-05-20 per LoYaRo header
          // pattern (see LoYaRo_RootsTalk_UI_Design_System.docx).
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
  void title  // unused since 2026-05-20; suppresses lint
  const user = getUser()
  const [showLang, setShowLang] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [languages, setLanguages] = useState<Lang[]>([])
  const [currentLang, setCurrentLang] = useState(getLanguage())
  const colour = customColour || ROLE_COLOURS[activeRole] || '#3A7D44'
  const roleLabel = ROLE_LABEL[activeRole] || 'Farmer'

  useEffect(() => {
    api.get('/platform/languages').then(r => setLanguages(r.data)).catch(() => {})
  }, [])

  function switchLang(code: string) {
    setLanguage(code)
    setCurrentLang(code)
    setShowLang(false)
    window.location.reload()
  }

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 py-3 safe-area-top"
        style={{ background: colour }}>
        <div className="flex items-center">
          <div>
            {/* rootsTALK.in wordmark — same split-weight treatment as
                the landing hero and the right drawer. White variants
                since the header sits on the role-coloured chrome. */}
            <p className="leading-none">
              <span className="text-white/80 font-light text-[19px]">roots</span>
              <span className="text-white font-black text-[19px]">TALK</span>
              <span className="text-white/55 font-light text-[16px]">.in</span>
            </p>
            <p className="text-white/70 text-[11px] mt-0.5 leading-none">{roleLabel}</p>
          </div>
          {urgencyBadges && (
            <div className="flex items-center gap-2 ml-3">
              <span className="text-white text-sm font-bold">{urgencyBadges.new}</span>
              <span className="text-amber-300 text-sm font-bold">{urgencyBadges.pending}</span>
              <span className="text-[#D4682E] text-sm font-bold">{urgencyBadges.returned}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowLang(!showLang)}
            className="text-white text-xs border border-white/30 rounded-full px-2.5 py-1 font-medium">
            {currentLang.toUpperCase()}
          </button>
          <button onClick={() => setShowAbout(true)} className="w-7 h-7 flex items-center justify-center opacity-60 hover:opacity-100">
            <svg width="20" height="20" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="24" r="5" fill="white"/>
              <circle cx="8" cy="12" r="3.5" fill="white" opacity="0.7"/>
              <circle cx="40" cy="36" r="3.5" fill="white" opacity="0.7"/>
              <circle cx="8" cy="36" r="3.5" fill="white" opacity="0.5"/>
              <circle cx="40" cy="12" r="3.5" fill="white" opacity="0.5"/>
              <line x1="24" y1="24" x2="8" y2="12" stroke="white" strokeWidth="2" opacity="0.6"/>
              <line x1="24" y1="24" x2="40" y2="36" stroke="white" strokeWidth="2" opacity="0.6"/>
              <line x1="24" y1="24" x2="8" y2="36" stroke="white" strokeWidth="1.5" opacity="0.35"/>
              <line x1="24" y1="24" x2="40" y2="12" stroke="white" strokeWidth="1.5" opacity="0.35"/>
            </svg>
          </button>
          {onRoleSwitch && (
            <button onClick={onRoleSwitch}
              className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white text-xs font-bold">
              {user?.name?.[0]?.toUpperCase() || '?'}
            </button>
          )}
        </div>
      </header>

      {/* Language sheet */}
      {showLang && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end">
          <div className="bg-white rounded-t-2xl w-full max-h-80 overflow-auto pb-6">
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

      {/* About rootsTALK sheet */}
      {showAbout && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={() => setShowAbout(false)}>
          <div className="bg-white rounded-t-2xl w-full pb-8 safe-area-bottom" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-stone-200 rounded-full mx-auto mt-3 mb-5" />
            <div className="px-6 flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: '#3A7D44' }}>
                <svg width="24" height="24" viewBox="0 0 48 48" fill="none">
                  <circle cx="24" cy="24" r="5" fill="white"/>
                  <circle cx="8" cy="12" r="3.5" fill="white" opacity="0.7"/>
                  <circle cx="40" cy="36" r="3.5" fill="white" opacity="0.7"/>
                  <line x1="24" y1="24" x2="8" y2="12" stroke="white" strokeWidth="2" opacity="0.6"/>
                  <line x1="24" y1="24" x2="40" y2="36" stroke="white" strokeWidth="2" opacity="0.6"/>
                </svg>
              </div>
              <div>
                <p className="font-bold text-[#6B3F1F] text-base">rootsTALK<span className="text-[#7A8C7E]">.in</span></p>
                <p className="text-[#7A8C7E] text-xs mt-0.5">by Neytiri Eywafarm Agritech</p>
              </div>
            </div>
            <div className="px-6 space-y-1 mb-6">
              <p className="text-[#7A8C7E] text-sm">Your agricultural advisory network — connecting farmers, experts, and companies across India.</p>
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
