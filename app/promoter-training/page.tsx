'use client'

// Promoter Training Session invite flow — Commit K of the 2026-07-24
// build plan. Shared page routed from BOTH /dealer/home and
// /facilitator/home when a training session is active for the
// promoter's parent client(s):
//
//   /promoter-training?role=DEALER
//   /promoter-training?role=FACILITATOR
//
// F-P has at most one training session (locked binding); D-P may
// have several. Whichever role, the flow is the same:
//   1. Pick a training session (auto-selected when only one).
//   2. Enter farmer phone (registered users only — refused
//      farmer_not_registered otherwise).
//   3. Pick a crop → pick a package (both drawn from the
//      training's PARENT catalogue via Commit C's inheritance).
//   4. Submit → POST /promoter/training/{training_client_id}/invite-farmer.
//
// The whole page wears a yellow "TRAINING" frame so the promoter
// knows they're not doing real work.

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import api from '@/lib/api'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import { cropDisplayName } from '@/lib/crop-name'

interface TrainingSession {
  id: string
  parent_client_id: string
  parent_display_name: string
  display_name: string
  training_ends_at: string
  training_status: string
}

interface Crop {
  crop_cosh_id: string
  name: string
}

interface Package {
  id: string
  name: string
  description: string | null
  package_type: string | null
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: '2-digit', month: 'short',
  })
}

// Inline error extractor — the backend refusal shape wraps the
// human-readable text in detail.message (per the 2026-07-16 error
// surfacing pattern we've been consistent with everywhere else).
function extractErr(err: unknown, fallback: string): string {
  const e = err as {
    response?: { data?: { detail?: { message?: string } | string } }
    message?: string
  }
  const d = e?.response?.data?.detail
  if (typeof d === 'string') return d
  if (d && typeof d.message === 'string') return d.message
  return e?.message || fallback
}

export default function PromoterTrainingInvitePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#F5F0E8]" />}>
      <PromoterTrainingInviteInner />
    </Suspense>
  )
}

function PromoterTrainingInviteInner() {
  const router = useRouter()
  const params = useSearchParams()
  const role = (params.get('role') || 'DEALER').toUpperCase() as 'DEALER' | 'FACILITATOR'
  const activeRole = role === 'DEALER' ? 'DEALER' : 'FACILITATOR'

  const [sessions, setSessions] = useState<TrainingSession[]>([])
  const [pickedSession, setPickedSession] = useState<TrainingSession | null>(null)
  const [farmerPhone, setFarmerPhone] = useState('')
  const [crops, setCrops] = useState<Crop[]>([])
  const [pickedCrop, setPickedCrop] = useState<Crop | null>(null)
  const [packages, setPackages] = useState<Package[]>([])
  const [pickedPackage, setPickedPackage] = useState<Package | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // 1. Load available sessions. Auto-pick when there's only one.
  useEffect(() => {
    if (!getToken()) { router.replace('/'); return }
    api.get<TrainingSession[]>('/promoter/training/available-clients')
      .then(r => {
        setSessions(r.data)
        if (r.data.length === 1) setPickedSession(r.data[0])
      })
      .catch(() => setError('Could not load training sessions.'))
      .finally(() => setLoading(false))
  }, [router])

  // 2. When a session is picked, load its crops (via /promoter/crops
  //    scoped to the training client's id — Commit C's inheritance
  //    resolves this to the parent's Package catalogue).
  useEffect(() => {
    if (!pickedSession) { setCrops([]); setPickedCrop(null); return }
    setPickedCrop(null); setPickedPackage(null); setPackages([])
    api.get<{ crop_cosh_id: string; name: string }[]>(
      `/promoter/crops?client_id=${pickedSession.id}&district_cosh_id=${''}`,
    )
      .then(r => setCrops(r.data.map(c => ({ ...c, name: cropDisplayName(c.crop_cosh_id, c.name) }))))
      .catch(() => setCrops([]))
  }, [pickedSession])

  // 3. When a crop is picked, load its packages.
  useEffect(() => {
    if (!pickedSession || !pickedCrop) { setPackages([]); return }
    // Reuse /farmer/packages — Commit C makes it training-aware
    // (it resolves the training client to the parent for Package
    // lookups). district_cosh_id doesn't apply to the training
    // discovery scope; pass empty and the endpoint filters on
    // client+crop alone.
    api.get<Package[]>(
      `/farmer/packages?client_id=${pickedSession.id}&crop_cosh_id=${pickedCrop.crop_cosh_id}&district_cosh_id=`,
    )
      .then(r => setPackages(r.data))
      .catch(() => setPackages([]))
  }, [pickedSession, pickedCrop])

  const canSubmit = useMemo(() => {
    return !!(pickedSession && farmerPhone.trim().length >= 10 && pickedPackage && !submitting)
  }, [pickedSession, farmerPhone, pickedPackage, submitting])

  const onSubmit = useCallback(async () => {
    if (!canSubmit || !pickedSession || !pickedPackage) return
    setSubmitting(true); setError(''); setSuccess('')
    try {
      const digits = farmerPhone.replace(/\D/g, '').slice(-10)
      const phone = digits.length === 10 ? `+91${digits}` : farmerPhone.trim()
      await api.post(`/promoter/training/${pickedSession.id}/invite-farmer`, {
        farmer_phone: phone,
        package_id: pickedPackage.id,
        promoter_type: role,
      })
      setSuccess(`Invitation sent. The farmer will see it in their PWA.`)
      setFarmerPhone('')
      setPickedCrop(null)
      setPickedPackage(null)
    } catch (err) {
      setError(extractErr(err, 'Could not send the invitation.'))
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, pickedSession, pickedPackage, farmerPhone, role])

  if (loading) {
    return <div className="min-h-screen bg-[#F5F0E8]" />
  }

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="Training Invite" activeRole={activeRole} back={role === 'DEALER' ? '/dealer/home' : '/facilitator/home'} />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto space-y-4">
        {/* 2026-07-24 — Training frame. Whole page wears an amber
            border so the promoter always sees they're in training. */}
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-amber-900 font-semibold text-sm">Training Sandbox</p>
          <p className="text-amber-800 text-xs mt-1 leading-relaxed">
            Invite a real farmer into a practice session. The farmer must
            accept before anything appears on their PWA. Nothing here
            affects your real allocations, orders, or subscriptions.
          </p>
        </div>

        {sessions.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#DDD0B8] px-4 py-8 text-center">
            <p className="text-[#6B3F1F] font-semibold">No training sessions active</p>
            <p className="text-xs text-[#7A8C7E] mt-2">
              The company&apos;s CA starts a training session from the CA
              portal. Once it&apos;s running, you&apos;ll see it here.
            </p>
          </div>
        ) : (
          <>
            {/* Session picker */}
            {sessions.length > 1 && (
              <div className="bg-white rounded-2xl border border-[#DDD0B8] p-4">
                <p className="text-xs font-semibold text-[#6B3F1F] mb-2">Pick a training session</p>
                <div className="space-y-2">
                  {sessions.map(s => (
                    <button key={s.id}
                      onClick={() => setPickedSession(s)}
                      className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                        pickedSession?.id === s.id
                          ? 'bg-amber-100 border-amber-400'
                          : 'bg-white border-[#DDD0B8]'
                      }`}>
                      <p className="text-sm font-semibold text-[#6B3F1F]">
                        {s.parent_display_name}
                      </p>
                      <p className="text-[11px] text-[#7A8C7E] mt-0.5">
                        Ends {formatDate(s.training_ends_at)}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Farmer phone */}
            {pickedSession && (
              <div className="bg-white rounded-2xl border border-[#DDD0B8] p-4">
                <label className="text-xs font-semibold text-[#6B3F1F]" htmlFor="farmer-phone">
                  Farmer&apos;s phone number
                </label>
                <p className="text-[11px] text-[#7A8C7E] mt-1">
                  The farmer must already be registered on RootsTalk.
                </p>
                <input
                  id="farmer-phone"
                  type="tel"
                  inputMode="numeric"
                  value={farmerPhone}
                  onChange={e => setFarmerPhone(e.target.value)}
                  placeholder="10-digit number"
                  className="w-full mt-2 px-3 py-2 border border-[#DDD0B8] rounded-lg text-sm bg-[#FAFAF7]"
                />
              </div>
            )}

            {/* Crop picker */}
            {pickedSession && crops.length > 0 && (
              <div className="bg-white rounded-2xl border border-[#DDD0B8] p-4">
                <p className="text-xs font-semibold text-[#6B3F1F] mb-2">Pick a crop</p>
                <div className="flex flex-wrap gap-2">
                  {crops.map(c => (
                    <button key={c.crop_cosh_id}
                      onClick={() => setPickedCrop(c)}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                        pickedCrop?.crop_cosh_id === c.crop_cosh_id
                          ? 'bg-amber-100 border-amber-400 text-amber-900 font-semibold'
                          : 'bg-white border-[#DDD0B8] text-[#6B3F1F]'
                      }`}>
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {pickedSession && crops.length === 0 && (
              <div className="bg-white rounded-2xl border border-[#DDD0B8] px-4 py-4 text-xs text-[#7A8C7E]">
                No crops with active packages under this training session yet.
              </div>
            )}

            {/* Package picker */}
            {pickedCrop && packages.length > 0 && (
              <div className="bg-white rounded-2xl border border-[#DDD0B8] p-4">
                <p className="text-xs font-semibold text-[#6B3F1F] mb-2">Pick a package</p>
                <div className="space-y-2">
                  {packages.map(p => (
                    <button key={p.id}
                      onClick={() => setPickedPackage(p)}
                      className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                        pickedPackage?.id === p.id
                          ? 'bg-amber-100 border-amber-400'
                          : 'bg-white border-[#DDD0B8]'
                      }`}>
                      <p className="text-sm font-semibold text-[#6B3F1F]">{p.name}</p>
                      {p.description && (
                        <p className="text-[11px] text-[#7A8C7E] mt-0.5 line-clamp-2">{p.description}</p>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">
                {error}
              </div>
            )}
            {success && (
              <div className="rounded-lg border border-green-200 bg-green-50 text-green-800 text-sm px-3 py-2">
                {success}
              </div>
            )}

            {/* Submit */}
            {pickedSession && (
              <button
                onClick={onSubmit}
                disabled={!canSubmit}
                className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white font-semibold shadow-sm"
              >
                {submitting ? 'Sending…' : 'Send Training Invitation'}
              </button>
            )}
          </>
        )}
      </div>
      <BottomNav color={role === 'DEALER' ? '#7D4196' : '#7D4E00'} activeRole={activeRole} />
    </div>
  )
}
