'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

interface Invitation { id: string; client_id: string; role: string; status: string; created_at: string }

const COLOUR = '#3C3489'

export default function PunditInvitationsPage() {
  const router = useRouter()
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [showRejectModal, setShowRejectModal] = useState<string | null>(null)

  const load = () => {
    api.get<Invitation[]>('/pundit/invitations')
      .then(r => setInvitations(r.data))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [])

  async function accept(id: string) {
    await api.put(`/pundit/invitations/${id}/accept`)
    load()
  }

  async function reject(id: string) {
    if (!rejectReason) return
    setRejecting(id)
    try {
      await api.put(`/pundit/invitations/${id}/reject`, { reason: rejectReason })
      setShowRejectModal(null)
      setRejectReason('')
      load()
    } finally { setRejecting(null) }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <PWAHeader title="Company Invitations" activeRole="FARMER" />
      <div className="pt-16 pb-20 px-4">
        <div className="mt-4 space-y-3">
          {loading ? (
            <div className="h-24 bg-white rounded-2xl animate-pulse" />
          ) : invitations.length === 0 ? (
            <div className="text-center py-16">
              <span className="text-4xl">📩</span>
              <p className="text-slate-400 text-sm mt-3">No pending invitations</p>
            </div>
          ) : (
            invitations.map(inv => (
              <div key={inv.id} className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
                <div className="mb-3">
                  <p className="font-medium text-slate-800">Company invitation</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${inv.role === 'PRIMARY' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                      {inv.role === 'PRIMARY' ? 'Primary Expert' : 'Panel Expert'}
                    </span>
                    <span className="text-xs text-slate-400">{new Date(inv.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="text-xs text-slate-500 mb-3 leading-relaxed">
                  {inv.role === 'PRIMARY'
                    ? 'As a Primary Expert, you will receive queries via sequential round-robin and can forward to other experts.'
                    : 'As a Panel Expert, you receive only forwarded queries and can respond or return them.'}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => accept(inv.id)}
                    className="flex-1 text-white font-semibold py-2.5 rounded-xl text-sm"
                    style={{ background: COLOUR }}>
                    ✓ Accept
                  </button>
                  <button onClick={() => setShowRejectModal(inv.id)}
                    className="flex-1 border border-red-100 text-red-500 font-medium py-2.5 rounded-xl text-sm">
                    ✗ Decline
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      <BottomNav color={COLOUR} activeRole="FARMER" />

      {showRejectModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
          <div className="bg-white rounded-t-3xl w-full p-5 pb-8">
            <h2 className="font-bold text-slate-900 mb-1">Decline Invitation</h2>
            <p className="text-slate-400 text-sm mb-4">Please provide a reason (mandatory)</p>
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)}
              required rows={3} placeholder="Why are you declining this invitation?"
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none resize-none mb-4" />
            <div className="flex gap-3">
              <button onClick={() => { setShowRejectModal(null); setRejectReason('') }}
                className="flex-1 border border-slate-200 text-slate-700 font-medium py-3 rounded-2xl text-sm">Cancel</button>
              <button onClick={() => reject(showRejectModal)} disabled={!rejectReason || !!rejecting}
                className="flex-1 text-white font-semibold py-3 rounded-2xl text-sm disabled:opacity-50"
                style={{ background: '#dc2626' }}>
                {rejecting ? 'Declining…' : 'Confirm Decline'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
