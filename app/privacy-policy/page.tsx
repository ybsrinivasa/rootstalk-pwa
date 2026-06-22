'use client'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

export default function PrivacyPolicyPage() {
  const router = useRouter()
  const t = useTranslations('privacyPolicy')
  const sections: { titleKey: 'collectTitle' | 'useTitle' | 'shareTitle' | 'locationTitle' | 'retentionTitle' | 'rightsTitle' | 'securityTitle' | 'contactTitle'; bodyKey: 'collectBody' | 'useBody' | 'shareBody' | 'locationBody' | 'retentionBody' | 'rightsBody' | 'securityBody' | 'contactBody' }[] = [
    { titleKey: 'collectTitle',    bodyKey: 'collectBody' },
    { titleKey: 'useTitle',        bodyKey: 'useBody' },
    { titleKey: 'shareTitle',      bodyKey: 'shareBody' },
    { titleKey: 'locationTitle',   bodyKey: 'locationBody' },
    { titleKey: 'retentionTitle',  bodyKey: 'retentionBody' },
    { titleKey: 'rightsTitle',     bodyKey: 'rightsBody' },
    { titleKey: 'securityTitle',   bodyKey: 'securityBody' },
    { titleKey: 'contactTitle',    bodyKey: 'contactBody' },
  ]
  return (
    <div className="min-h-screen bg-[#F7F5F0]">
      {/* Header */}
      <div className="px-5 py-5 flex items-center gap-3" style={{ background: '#3A7D44' }}>
        <button onClick={() => router.back()} className="text-white/70 hover:text-white">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
          </svg>
        </button>
        <h1 className="text-white font-semibold text-lg">{t('title')}</h1>
      </div>

      {/* Content */}
      <div className="px-5 py-6 max-w-2xl mx-auto space-y-6 pb-16">
        <p className="text-[#7A8C7E] text-xs">{t('lastUpdated')}</p>

        <a href="https://eywa.farm/privacy" target="_blank" rel="noopener noreferrer"
          className="block bg-white rounded-2xl p-5 border border-[#DDD0B8] hover:border-[#3A7D44] transition-colors">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 mt-0.5 shrink-0" fill="none" stroke="#3A7D44" strokeWidth={1.75} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"/>
            </svg>
            <div className="flex-1">
              <p className="text-[#6B3F1F] font-semibold text-sm">{t('externalTitle')}</p>
              <p className="text-[#7A8C7E] text-xs mt-1">{t('externalSubtitle')}</p>
            </div>
          </div>
        </a>

        {sections.map(section => (
          <div key={section.titleKey} className="bg-white rounded-2xl p-5 border border-[#DDD0B8]">
            <h3 className="font-semibold text-[#6B3F1F] mb-2">{t(`sections.${section.titleKey}`)}</h3>
            <p className="text-[#7A8C7E] text-sm leading-relaxed">{t(`sections.${section.bodyKey}`)}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
