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
