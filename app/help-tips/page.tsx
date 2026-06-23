'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'

type Role = 'FARMER' | 'DEALER' | 'FACILITATOR' | 'FARM_PUNDIT'

const ROLE_KEY: Record<Role, 'farmer' | 'dealer' | 'facilitator' | 'pundit'> = {
  FARMER: 'farmer',
  DEALER: 'dealer',
  FACILITATOR: 'facilitator',
  FARM_PUNDIT: 'pundit',
}

const ROLE_HOME: Record<Role, string> = {
  FARMER: '/home',
  DEALER: '/dealer/home',
  FACILITATOR: '/facilitator/home',
  FARM_PUNDIT: '/pundit/home',
}

const SECTION_KEYS = ['gettingStarted', 'dayToDay', 'gettingHelp'] as const

function isRole(s: string | null): s is Role {
  return s === 'FARMER' || s === 'DEALER' || s === 'FACILITATOR' || s === 'FARM_PUNDIT'
}

export default function HelpTipsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const roleParam = searchParams.get('role')
  // Role-aware via the `?role=` param the drawer passes. /help-tips itself
  // has no role-prefixed path, so we can't infer from pathname — yesterday's
  // version always defaulted to FARMER for that reason.
  const activeRole: Role = isRole(roleParam) ? roleParam : 'FARMER'
  const backTarget = ROLE_HOME[activeRole]
  const t = useTranslations('helpTips')
  const roleKey = ROLE_KEY[activeRole]

  return (
    <div className="min-h-screen bg-[#F7F5F0]">
      <div className="px-5 py-5 flex items-center gap-3" style={{ background: '#3A7D44' }}>
        <button onClick={() => router.push(backTarget)}
          aria-label="Back"
          className="text-white/90 hover:text-white text-[28px] leading-none w-9 h-9 flex items-center justify-center font-light pb-1">
          ‹
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
