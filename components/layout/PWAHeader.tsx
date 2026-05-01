'use client'
import { useState, useEffect } from 'react'
import { getUser, ROLE_COLOURS } from '@/lib/auth'
import { getLanguage, setLanguage } from '@/lib/language'
import api from '@/lib/api'

type Lang = { language_code: string; language_name_native: string }

export default function PWAHeader({ activeRole = 'FARMER', title = 'RootsTalk' }: {
  activeRole?: string
  title?: string
}) {
  const [showLang, setShowLang] = useState(false)
  const [languages, setLanguages] = useState<Lang[]>([])
  const [currentLang, setCurrentLang] = useState(getLanguage())
  const colour = ROLE_COLOURS[activeRole] || '#1A5C2A'
  const roleLabel = activeRole !== 'FARMER' ? `Acting as ${activeRole.replace('_', ' ')}` : ''

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
        <div>
          <p className="text-white font-semibold text-base leading-tight">{title}</p>
          {roleLabel && <p className="text-white text-xs opacity-70">{roleLabel}</p>}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowLang(!showLang)}
            className="text-white text-xs border border-white/30 rounded-full px-2.5 py-1 font-medium">
            {currentLang.toUpperCase()}
          </button>
        </div>
      </header>

      {showLang && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end">
          <div className="bg-white rounded-t-2xl w-full max-h-80 overflow-auto pb-6">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <p className="font-medium text-slate-800 text-sm">Select language</p>
              <button onClick={() => setShowLang(false)} className="text-slate-400 text-xl">×</button>
            </div>
            {languages.map((l: Lang) => (
              <button key={l.language_code} onClick={() => switchLang(l.language_code)}
                className={`w-full text-left px-4 py-3 border-b border-slate-50 flex items-center justify-between ${currentLang === l.language_code ? 'bg-green-50' : ''}`}>
                <span className="text-slate-800">{l.language_name_native}</span>
                {currentLang === l.language_code && <span style={{ color: colour }}>✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
