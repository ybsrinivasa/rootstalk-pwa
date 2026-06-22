'use client'
import { useRouter, usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'

type Role = 'FARMER' | 'DEALER' | 'FACILITATOR' | 'FARM_PUNDIT'

function getActiveRoleFromPath(pathname: string): Role {
  if (pathname.startsWith('/dealer')) return 'DEALER'
  if (pathname.startsWith('/facilitator')) return 'FACILITATOR'
  if (pathname.startsWith('/pundit')) return 'FARM_PUNDIT'
  return 'FARMER'
}

const ROLE_KEY: Record<Role, 'farmer' | 'dealer' | 'facilitator' | 'pundit'> = {
  FARMER: 'farmer',
  DEALER: 'dealer',
  FACILITATOR: 'facilitator',
  FARM_PUNDIT: 'pundit',
}

const SECTION_KEYS = ['gettingStarted', 'dayToDay', 'gettingHelp'] as const

export default function HelpTipsPage() {
  const router = useRouter()
  const pathname = usePathname() || '/'
  const activeRole = getActiveRoleFromPath(pathname)
  const t = useTranslations('helpTips')
  const roleKey = ROLE_KEY[activeRole]

  return (
    <div className="min-h-screen bg-[#F7F5F0]">
      <div className="px-5 py-5 flex items-center gap-3" style={{ background: '#3A7D44' }}>
        <button onClick={() => router.back()} className="text-white/70 hover:text-white" aria-label="Back">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
          </svg>
        </button>
        <h1 className="text-white font-semibold text-lg">{t('title')}</h1>
      </div>

      <div className="px-5 py-6 max-w-2xl mx-auto space-y-5 pb-20">
        <p className="text-[#7A8C7E] text-sm">{t(`${roleKey}.intro`)}</p>

        {SECTION_KEYS.map(sectionKey => {
          const items = t.raw(`${roleKey}.${sectionKey}.items`) as string[] | undefined
          if (!Array.isArray(items) || items.length === 0) return null
          return (
            <div key={sectionKey} className="bg-white rounded-2xl p-5 border border-[#DDD0B8]">
              <h3 className="font-semibold text-[#6B3F1F] mb-3">
                {t(`${roleKey}.${sectionKey}.title`)}
              </h3>
              <ul className="space-y-2.5">
                {items.map((item, idx) => (
                  <li key={idx} className="flex gap-2 text-[#7A8C7E] text-sm leading-relaxed">
                    <span className="text-[#3A7D44] mt-0.5 shrink-0">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}

        <div className="bg-white rounded-2xl p-5 border border-[#DDD0B8]">
          <p className="text-[#7A8C7E] text-sm leading-relaxed">
            {t('contactFooter')}{' '}
            <a href="mailto:support@eywa.farm" className="text-[#3A7D44] font-medium underline">
              support@eywa.farm
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
