'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken, getUser, refreshUser } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import RoleSwitcherDrawer from '@/components/RoleSwitcherDrawer'
import api from '@/lib/api'

interface PromotedFarmer {
  subscription_id: string; farmer_name: string | null; farmer_phone: string | null
  client_id: string; status: string; reference_number: string | null
  client_name?: string | null; client_colour?: string | null
}

interface OnboardingClient {
  client_promoter_id: string
  client_id: string
  client_name: string
  short_name: string
  logo_url: string | null
  primary_colour: string | null
  is_promoter: boolean
  onboarded_at: string
}

interface CompanySummary {
  client_id: string
  client_name: string
  client_colour: string
  farmer_count: number
  is_promoter: boolean
  client_promoter_id: string  // for the "Step down" button on the Promoter card
}

interface PromoterInvitation {
  client_promoter_id: string
  client_id: string
  client_name: string
  short_name: string
  logo_url: string | null
  primary_colour: string | null
  sent_at: string
}

const COLOUR = '#7D4E00'

export default function FacilitatorProfilePage() {
  const router = useRouter()
  const user = getUser()
  const [declared, setDeclared] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [showRoleDrawer, setShowRoleDrawer] = useState(false)

  // My Companies + Pending Promoter Invitations
  const [companies, setCompanies] = useState<CompanySummary[]>([])
  const [invitations, setInvitations] = useState<PromoterInvitation[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [actingId, setActingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')

  async function loadData() {
    // Three endpoints in parallel — onboarding-clients is the
    // source of truth for "who has onboarded me" (R14),
    // promoter-invitations for pending Promoter invitations (R9),
    // promoted-farmers for the per-company farmer count.
    const [onboardingRes, invitationsRes, farmersRes] = await Promise.allSettled([
      api.get<OnboardingClient[]>('/facilitator/onboarding-clients'),
      api.get<PromoterInvitation[]>('/facilitator/promoter-invitations'),
      api.get<PromotedFarmer[]>('/facilitator/promoted-farmers'),
    ])
    const onboarding = onboardingRes.status === 'fulfilled' ? onboardingRes.value.data : []
    const pending = invitationsRes.status === 'fulfilled' ? invitationsRes.value.data : []
    const farmers = farmersRes.status === 'fulfilled' ? farmersRes.value.data : []
    const farmerCountByClient: Record<string, number> = {}
    farmers.forEach(f => {
      if (!f.client_id) return
      farmerCountByClient[f.client_id] = (farmerCountByClient[f.client_id] || 0) + 1
    })
    setCompanies(onboarding.map(c => ({
      client_promoter_id: c.client_promoter_id,
      client_id: c.client_id,
      client_name: c.client_name || 'Company',
      client_colour: c.primary_colour || COLOUR,
      farmer_count: farmerCountByClient[c.client_id] || 0,
      is_promoter: c.is_promoter,
    })))
    setInvitations(pending)
  }

  useEffect(() => {
    if (!getToken()) { router.replace('/'); return }
    loadData().finally(() => setLoadingData(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function actOnInvitation(
    clientPromoterId: string,
    action: 'accept' | 'decline',
  ) {
    setActingId(clientPromoterId)
    setActionError('')
    try {
      const endpoint = action === 'accept'
        ? `/facilitator/promoter-invitations/${clientPromoterId}/accept`
        : `/facilitator/promoter-invitations/${clientPromoterId}/decline`
      await api.put(endpoint)
      await loadData()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg = typeof detail === 'string'
        ? detail
        : (detail as { message?: string })?.message
      setActionError(msg || `Could not ${action} the invitation. Please try again.`)
    } finally {
      setActingId(null)
    }
  }

  async function stepDownAsPromoter(clientPromoterId: string) {
    if (!confirm('Step down as Promoter at this company? You will stay onboarded as a Facilitator.')) return
    setActingId(clientPromoterId)
    setActionError('')
    try {
      await api.put(`/facilitator/promoter-status/${clientPromoterId}/step-down`)
      await loadData()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg = typeof detail === 'string'
        ? detail
        : (detail as { message?: string })?.message
      setActionError(msg || 'Could not step down. Please try again.')
    } finally {
      setActingId(null)
    }
  }

  // Pre-fill the checkbox when the user has already declared
  // before (e.g. they reopened the page from the role-switcher).
  useEffect(() => {
    if (user?.facilitator_declared_at) setDeclared(true)
  }, [user?.facilitator_declared_at])

  async function save() {
    if (!declared) {
      setError('Please accept the declaration to continue.')
      return
    }
    setError('')
    setSaving(true)
    try {
      // Stamps users.facilitator_declared_at and unlocks
      // /facilitator/home for this user. Idempotent — re-calling
      // preserves the original timestamp.
      await api.post('/auth/me/facilitator-declaration')
      // Refresh cached /auth/me so the home-page gate sees the
      // new declared timestamp without another round-trip.
      await refreshUser()
      setSaved(true)
      setTimeout(() => router.replace('/facilitator/home'), 1200)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg = typeof detail === 'string'
        ? detail
        : (detail as { message?: string })?.message || 'Could not save. Please try again.'
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: COLOUR }}>
      <PWAHeader title="Service Profile" activeRole="FACILITATOR" customColour={COLOUR}
        onRoleSwitch={() => setShowRoleDrawer(true)} back="/facilitator/home" />
      <div className="flex-1 flex flex-col rounded-t-[2rem] px-5 pt-7 pb-10 mt-14 bg-[#FAFAF8]">

        {!user?.facilitator_declared_at && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-5">
            <p className="font-semibold text-amber-800 text-sm">Finish your facilitator registration</p>
            <p className="text-xs text-amber-700 mt-1">
              Confirm the declaration below to start helping farmers. A company will recognise you only once you&apos;ve registered here.
            </p>
            <button onClick={() => router.replace('/home')}
              className="mt-3 text-xs underline text-amber-800 font-medium">
              ← Not now, back to Farmer Home
            </button>
          </div>
        )}

        {/* Read-only info */}
        <div className="bg-white rounded-2xl border border-[#DDD0B8] p-5 space-y-4 mb-5">
          <h2 className="font-semibold text-[#6B3F1F]">Your Details</h2>

          <div>
            <p className="text-xs text-[#7A8C7E] mb-1">Name</p>
            <p className="text-sm text-[#6B3F1F] font-medium">{user?.name || '—'}</p>
          </div>

          <div>
            <p className="text-xs text-[#7A8C7E] mb-1">Phone</p>
            <p className="text-sm text-[#6B3F1F] font-medium">{user?.phone || '—'}</p>
          </div>
        </div>

        {/* Pending Promoter invitations — R9 (2026-05-29). Shows
            invitations the Facilitator hasn't yet accepted/declined.
            Each card has explicit Accept / Decline buttons; per §11.2
            only one ACCEPTED at a time, but multiple PENDING are
            allowed (the Facilitator picks one, the others survive
            as future options). */}
        {!loadingData && invitations.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-5">
            <h2 className="font-semibold text-amber-900 mb-1">Promoter Invitations</h2>
            <p className="text-xs text-amber-800 mb-3 leading-relaxed">
              These companies are inviting you to be their Promoter. You can be a Promoter at one company at a time.
            </p>
            <div className="space-y-3">
              {invitations.map(inv => (
                <div key={inv.client_promoter_id} className="bg-white rounded-xl border border-amber-200 p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: inv.primary_colour || COLOUR }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#6B3F1F] truncate">{inv.client_name}</p>
                      <p className="text-[11px] text-[#7A8C7E]">
                        Sent {new Date(inv.sent_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => actOnInvitation(inv.client_promoter_id, 'decline')}
                      disabled={actingId === inv.client_promoter_id}
                      className="flex-1 py-2.5 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium disabled:opacity-50">
                      Decline
                    </button>
                    <button
                      onClick={() => actOnInvitation(inv.client_promoter_id, 'accept')}
                      disabled={actingId === inv.client_promoter_id}
                      className="flex-1 py-2.5 rounded-xl text-white font-semibold text-sm disabled:opacity-50"
                      style={{ background: COLOUR }}>
                      {actingId === inv.client_promoter_id ? '…' : 'Accept'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {actionError && (
              <p className="text-xs text-red-700 mt-3">{actionError}</p>
            )}
          </div>
        )}

        {/* My Companies — R14: the source-of-truth list of Clients
            that have onboarded this Facilitator (active rows only).
            "Promoter" badge marks the at-most-one Client where the
            Facilitator is currently the Promoter (§11.2 exclusivity).
            R10: "Step down" button on the Promoter card lets the
            Facilitator unilaterally end the Promoter role at that
            Client (the onboarding stays intact). */}
        {!loadingData && companies.length > 0 && (
          <div className="bg-white rounded-2xl border border-[#DDD0B8] p-5 mb-5">
            <h2 className="font-semibold text-[#6B3F1F] mb-3">My Companies</h2>
            <div className="space-y-3">
              {companies.map(c => (
                <div key={c.client_id} className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: c.client_colour }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-[#6B3F1F] truncate">{c.client_name}</p>
                      {c.is_promoter && (
                        <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 flex-shrink-0">
                          Promoter
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#7A8C7E]">{c.farmer_count} promoted {c.farmer_count === 1 ? 'farmer' : 'farmers'}</p>
                  </div>
                  {c.is_promoter && (
                    <button
                      onClick={() => stepDownAsPromoter(c.client_promoter_id)}
                      disabled={actingId === c.client_promoter_id}
                      className="text-[11px] text-[#7A8C7E] underline underline-offset-2 disabled:opacity-50 flex-shrink-0">
                      Step down
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {!loadingData && companies.length === 0 && user?.facilitator_declared_at && (
          <div className="bg-white rounded-2xl border border-[#DDD0B8] p-5 mb-5 text-center">
            <span className="text-3xl">🏢</span>
            <h2 className="font-semibold text-[#6B3F1F] mt-2">No companies yet</h2>
            <p className="text-xs text-[#7A8C7E] mt-2 leading-relaxed">
              You haven&apos;t been onboarded as a Facilitator by any company yet.
              Ask a Field Manager at the company you want to work with to onboard you.
            </p>
          </div>
        )}

        {/* Declaration */}
        <div className="bg-white rounded-2xl border border-[#DDD0B8] p-5 mb-5">
          <h2 className="font-semibold text-[#6B3F1F] mb-3">Declaration</h2>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={declared}
              onChange={e => { setDeclared(e.target.checked); setError('') }}
              className="w-5 h-5 rounded mt-0.5 accent-[#7D4E00] flex-shrink-0"
            />
            <span className="text-sm text-[#6B3F1F] leading-relaxed">
              I am willing to promote the RootsTalk PWA and help farmers in procuring inputs.
            </span>
          </label>
          {error && <p className="text-[#D4682E] text-xs mt-2">{error}</p>}
        </div>

        <button
          onClick={save}
          disabled={saving || !declared}
          className="w-full py-4 rounded-2xl text-white font-semibold text-sm disabled:opacity-40 transition-opacity"
          style={{ background: saving ? `${COLOUR}aa` : COLOUR }}>
          {saving ? 'Saving…' : saved ? '✓ Saved!' : 'Confirm & Continue'}
        </button>

        {/* router.back() is unreliable after a relaunch (empty
            history stack), so the Back button always goes to the
            Farmer Home — a stable destination from any entry path. */}
        <button onClick={() => router.replace('/home')}
          className="mt-3 w-full py-3.5 rounded-2xl text-[#7A8C7E] border border-[#DDD0B8] font-medium text-sm">
          Back to Farmer Home
        </button>
      </div>

      <RoleSwitcherDrawer
        open={showRoleDrawer}
        onClose={() => setShowRoleDrawer(false)}
        onSwitch={() => setShowRoleDrawer(false)}
        activeRole="FACILITATOR"
      />
    </div>
  )
}
