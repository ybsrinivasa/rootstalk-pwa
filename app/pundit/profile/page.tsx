'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken, getUser } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

interface SupportArea { state_cosh_id: string; district_cosh_id: string | null }

interface PunditProfile {
  id: string
  user_id: string
  email: string | null
  education: string | null
  experience_band: string | null
  support_method: string | null
  cultivation_type: string | null
  organisation_name: string | null
  phone_hidden: boolean
  declaration_accepted: boolean
  expertise_domains: string[]
  support_areas: SupportArea[]
  languages: string[]
}

const COLOUR = '#3C3489'

export default function PunditProfilePage() {
  const router = useRouter()
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
    <div className="min-h-screen bg-slate-50">
      <PWAHeader title="Expert Credentials" activeRole="FARM_PUNDIT" />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">

        {loading && (
          <div className="mt-4 h-32 bg-white rounded-2xl border border-slate-100 animate-pulse" />
        )}

        {!loading && !profile && (
          <div className="mt-4 bg-white rounded-2xl border border-slate-100 p-5 text-center">
            <p className="text-sm text-slate-500">No expert profile found.</p>
            <button onClick={() => router.push('/pundit/register')}
              className="mt-3 px-4 py-2 rounded-xl text-white text-sm font-medium"
              style={{ background: COLOUR }}>
              Register as Expert
            </button>
          </div>
        )}

        {!loading && profile && (
          <>
            {/* Identity */}
            <div className="mt-4 bg-white rounded-2xl border border-slate-100 p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 rounded-full flex items-center justify-center text-white text-lg font-bold"
                  style={{ background: COLOUR }}>
                  {(user?.name || '?')[0].toUpperCase()}
                </div>
                <div>
                  <p className="font-semibold text-slate-800">{user?.name || '—'}</p>
                  <p className="text-xs text-slate-400">{user?.phone || '—'}</p>
                </div>
              </div>
              {profile.email && (
                <div className="border-t border-slate-50 pt-3">
                  <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Email</p>
                  <p className="text-sm text-slate-700">{profile.email}</p>
                </div>
              )}
            </div>

            {/* Education */}
            <div className="mt-4 bg-white rounded-2xl border border-slate-100 p-5">
              <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">Education</p>
              <p className="text-sm text-slate-800">{profile.education || '—'}</p>
              {profile.experience_band && (
                <>
                  <p className="text-xs text-slate-400 uppercase tracking-wide mt-3 mb-2">Experience</p>
                  <p className="text-sm text-slate-800">{profile.experience_band}</p>
                </>
              )}
            </div>

            {/* Expertise Domains */}
            <div className="mt-4 bg-white rounded-2xl border border-slate-100 p-5">
              <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">Expertise Domains</p>
              {profile.expertise_domains.length === 0 ? (
                <p className="text-sm text-slate-400">None listed</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {profile.expertise_domains.map(d => (
                    <span key={d} className="text-xs px-3 py-1.5 rounded-full font-medium"
                      style={{ background: COLOUR + '15', color: COLOUR }}>
                      {d}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Languages */}
            <div className="mt-4 bg-white rounded-2xl border border-slate-100 p-5">
              <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">Languages</p>
              {profile.languages.length === 0 ? (
                <p className="text-sm text-slate-400">None listed</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {profile.languages.map(l => (
                    <span key={l} className="text-xs px-3 py-1.5 rounded-full bg-slate-100 text-slate-700 font-medium">
                      {l.toUpperCase()}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Support Areas */}
            <div className="mt-4 bg-white rounded-2xl border border-slate-100 p-5">
              <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">Support Areas</p>
              {profile.support_areas.length === 0 ? (
                <p className="text-sm text-slate-400">None listed</p>
              ) : (
                <ul className="space-y-1">
                  {profile.support_areas.map((a, i) => (
                    <li key={i} className="text-sm text-slate-700">
                      {a.state_cosh_id}{a.district_cosh_id ? ` · ${a.district_cosh_id}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Support Method */}
            {profile.support_method && (
              <div className="mt-4 bg-white rounded-2xl border border-slate-100 p-5">
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">Support Method</p>
                <p className="text-sm text-slate-800">{profile.support_method}</p>
              </div>
            )}

            {/* Phone Privacy */}
            <div className="mt-4 bg-white rounded-2xl border border-slate-100 p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-700">Phone privacy</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {phoneHidden ? 'Hidden — companies cannot find you by phone' : 'Visible — companies can find you by phone'}
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

            {/* Edit credentials placeholder */}
            <div className="mt-6">
              <button disabled
                className="w-full py-3.5 rounded-2xl border border-slate-200 text-sm font-medium text-slate-400 flex items-center justify-center gap-2">
                Edit my credentials
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-semibold">Coming soon</span>
              </button>
            </div>
          </>
        )}
      </div>
      <BottomNav color={COLOUR} activeRole="FARM_PUNDIT" />
    </div>
  )
}
