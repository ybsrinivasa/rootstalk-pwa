'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken, getUser } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

interface CoshNamedRef { cosh_id: string; name: string | null }

interface SupportArea {
  state_cosh_id: string
  state_name: string | null
  district_cosh_id: string | null
  district_name: string | null
}

interface PunditProfile {
  id: string
  user_id: string
  phone: string | null
  email: string | null
  education: CoshNamedRef | null
  experience: CoshNamedRef | null
  is_employed_by_organization: boolean
  organisation_type: CoshNamedRef | null
  non_employed_kind: 'RETIRED' | 'EXPERIENCED_FARMER' | null
  phone_hidden: boolean
  declaration_accepted: boolean
  farming_methods: CoshNamedRef[]
  cultivation_types: CoshNamedRef[]
  expertise_domains: CoshNamedRef[]
  crop_groups: CoshNamedRef[]
  languages: CoshNamedRef[]
  support_areas: SupportArea[]
}

const COLOUR = '#3C3489'

const NON_EMPLOYED_KEY: Record<string, 'nonEmployedRetired' | 'nonEmployedExperiencedFarmer'> = {
  RETIRED: 'nonEmployedRetired',
  EXPERIENCED_FARMER: 'nonEmployedExperiencedFarmer',
}

// Helper to render a CoshNamedRef — falls back to the raw cosh_id
// if Cosh sync hasn't loaded the English translation yet.
function nameOf(ref: CoshNamedRef | null, missing: string): string {
  if (!ref) return missing
  return ref.name || ref.cosh_id
}

function ChipList({ items, palette = 'colour', emptyLabel }: {
  items: CoshNamedRef[]
  palette?: 'colour' | 'slate'
  emptyLabel: string
}) {
  if (items.length === 0) {
    return <p className="text-sm text-[#7A8C7E]">{emptyLabel}</p>
  }
  const cls = palette === 'slate'
    ? 'bg-slate-100 text-[#6B3F1F]'
    : ''
  return (
    <div className="flex flex-wrap gap-2">
      {items.map(item => (
        <span key={item.cosh_id}
          className={`text-xs px-3 py-1.5 rounded-full font-medium ${cls}`}
          style={palette === 'colour' ? { background: COLOUR + '15', color: COLOUR } : undefined}>
          {nameOf(item, '—')}
        </span>
      ))}
    </div>
  )
}

export default function PunditProfilePage() {
  const router = useRouter()
  const t = useTranslations('pundit.profile')
  const user = getUser()
  const [profile, setProfile] = useState<PunditProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [phoneHidden, setPhoneHidden] = useState(false)
  const [privacyLoading, setPrivacyLoading] = useState(false)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    api.get<PunditProfile>('/pundit/profile')
      .then(r => {
        setProfile(r.data)
        setPhoneHidden(r.data.phone_hidden ?? false)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function togglePrivacy() {
    setPrivacyLoading(true)
    try {
      await api.put('/pundit/profile/phone-privacy', { phone_hidden: !phoneHidden })
      setPhoneHidden(v => !v)
    } finally { setPrivacyLoading(false) }
  }

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="FARM_PUNDIT" back="/pundit/home" />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">

        {loading && (
          <div className="mt-4 h-32 bg-white rounded-2xl border border-[#DDD0B8] animate-pulse" />
        )}

        {!loading && !profile && (
          <div className="mt-4 bg-white rounded-2xl border border-[#DDD0B8] p-5 text-center">
            <p className="text-sm text-[#7A8C7E]">{t('noProfileFound')}</p>
            <button onClick={() => router.push('/pundit/register')}
              className="mt-3 px-4 py-2 rounded-xl text-white text-sm font-medium"
              style={{ background: COLOUR }}>
              {t('registerCta')}
            </button>
          </div>
        )}

        {!loading && profile && (
          <>
            {/* Identity + Phone (read-only) + Phone privacy toggle */}
            <div className="mt-4 bg-white rounded-2xl border border-[#DDD0B8] p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 rounded-full flex items-center justify-center text-white text-lg font-bold"
                  style={{ background: COLOUR }}>
                  {(user?.name || '?')[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[#6B3F1F] truncate">{user?.name || t('missing')}</p>
                  <p className="text-xs text-[#7A8C7E]">
                    {profile.phone || user?.phone || t('missing')}
                    {phoneHidden && (
                      <span className="ml-1 text-[10px] uppercase tracking-wide font-bold text-amber-700">{t('phoneHiddenSuffix')}</span>
                    )}
                  </p>
                </div>
              </div>
              {profile.email && (
                <div className="border-t border-[#DDD0B8] pt-3">
                  <p className="text-xs text-[#7A8C7E] uppercase tracking-wide mb-1">{t('emailLabel')}</p>
                  <p className="text-sm text-[#6B3F1F]">{profile.email}</p>
                </div>
              )}
              <div className="border-t border-[#DDD0B8] pt-3 mt-3 flex items-center justify-between gap-3">
                <div className="flex-1">
                  <p className="text-sm font-medium text-[#6B3F1F]">{t('phonePrivacyTitle')}</p>
                  <p className="text-xs text-[#7A8C7E] mt-0.5">
                    {phoneHidden ? t('phonePrivacyHidden') : t('phonePrivacyVisible')}
                  </p>
                </div>
                <button
                  onClick={togglePrivacy}
                  disabled={privacyLoading}
                  className={`relative w-12 h-6 rounded-full transition-colors shrink-0 ${phoneHidden ? 'bg-[#3C3489]' : 'bg-stone-200'}`}>
                  <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${phoneHidden ? 'translate-x-7' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>

            {/* Education + Experience */}
            <div className="mt-4 bg-white rounded-2xl border border-[#DDD0B8] p-5">
              <p className="text-xs text-[#7A8C7E] uppercase tracking-wide mb-2">{t('educationLabel')}</p>
              <p className="text-sm text-[#6B3F1F]">{nameOf(profile.education, t('missing'))}</p>
              <p className="text-xs text-[#7A8C7E] uppercase tracking-wide mt-3 mb-2">{t('experienceLabel')}</p>
              <p className="text-sm text-[#6B3F1F]">{nameOf(profile.experience, t('missing'))}</p>
            </div>

            {/* Farming Methods */}
            <div className="mt-4 bg-white rounded-2xl border border-[#DDD0B8] p-5">
              <p className="text-xs text-[#7A8C7E] uppercase tracking-wide mb-2">{t('farmingMethodsLabel')}</p>
              <ChipList items={profile.farming_methods} emptyLabel={t('noneListed')} />
            </div>

            {/* Cultivation Types */}
            <div className="mt-4 bg-white rounded-2xl border border-[#DDD0B8] p-5">
              <p className="text-xs text-[#7A8C7E] uppercase tracking-wide mb-2">{t('cultivationTypesLabel')}</p>
              <ChipList items={profile.cultivation_types} emptyLabel={t('noneListed')} />
            </div>

            {/* Organisation / Non-employed branch */}
            <div className="mt-4 bg-white rounded-2xl border border-[#DDD0B8] p-5">
              <p className="text-xs text-[#7A8C7E] uppercase tracking-wide mb-2">{t('organisationLabel')}</p>
              {profile.is_employed_by_organization ? (
                <>
                  <p className="text-sm text-[#6B3F1F]">{t('yes')}</p>
                  <p className="text-xs text-[#7A8C7E] uppercase tracking-wide mt-3 mb-2">{t('organisationTypeLabel')}</p>
                  <p className="text-sm text-[#6B3F1F]">{nameOf(profile.organisation_type, t('missing'))}</p>
                </>
              ) : (
                <>
                  <p className="text-sm text-[#6B3F1F]">{t('no')}</p>
                  {profile.non_employed_kind && (
                    <p className="text-sm text-[#6B3F1F] mt-2">
                      {NON_EMPLOYED_KEY[profile.non_employed_kind]
                        ? t(NON_EMPLOYED_KEY[profile.non_employed_kind])
                        : profile.non_employed_kind}
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Domain Expertise */}
            <div className="mt-4 bg-white rounded-2xl border border-[#DDD0B8] p-5">
              <p className="text-xs text-[#7A8C7E] uppercase tracking-wide mb-2">{t('domainExpertiseLabel')}</p>
              <ChipList items={profile.expertise_domains} emptyLabel={t('noneListed')} />
            </div>

            {/* Crop Groups */}
            <div className="mt-4 bg-white rounded-2xl border border-[#DDD0B8] p-5">
              <p className="text-xs text-[#7A8C7E] uppercase tracking-wide mb-2">{t('cropGroupsLabel')}</p>
              <ChipList items={profile.crop_groups} emptyLabel={t('noneListed')} />
            </div>

            {/* Languages */}
            <div className="mt-4 bg-white rounded-2xl border border-[#DDD0B8] p-5">
              <p className="text-xs text-[#7A8C7E] uppercase tracking-wide mb-2">{t('languagesLabel')}</p>
              <ChipList items={profile.languages} palette="slate" emptyLabel={t('noneListed')} />
            </div>

            {/* Preferred States */}
            <div className="mt-4 bg-white rounded-2xl border border-[#DDD0B8] p-5">
              <p className="text-xs text-[#7A8C7E] uppercase tracking-wide mb-2">{t('preferredStatesLabel')}</p>
              {profile.support_areas.length === 0 ? (
                <p className="text-sm text-[#7A8C7E]">{t('noneListed')}</p>
              ) : (
                <ul className="space-y-1">
                  {profile.support_areas.map((a, i) => (
                    <li key={i} className="text-sm text-[#6B3F1F]">
                      {a.state_name || a.state_cosh_id}
                      {a.district_name ? ` · ${a.district_name}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Edit credentials placeholder */}
            <div className="mt-6">
              <button disabled
                className="w-full py-3.5 rounded-2xl border border-[#DDD0B8] text-sm font-medium text-[#7A8C7E] flex items-center justify-center gap-2">
                {t('editCta')}
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-[#7A8C7E] font-semibold">{t('comingSoon')}</span>
              </button>
            </div>
          </>
        )}
      </div>
      <BottomNav color={COLOUR} activeRole="FARM_PUNDIT" />
    </div>
  )
}
