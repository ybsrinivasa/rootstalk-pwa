'use client'
import { useState, useEffect, FormEvent } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'

interface QueryDetail {
  id: string; title: string; description: string | null; severity: string
  crop_cosh_id: string | null; crop_age: string | null
  status: string; created_at: string; expires_at: string; days_remaining: number
  is_holding: boolean
  media: { media_type: string; url: string }[]
  remarks: { action: string; pundit_id: string | null; remark: string | null; created_at: string }[]
  response: { problem_cosh_id: string | null; text: string | null; media: unknown[]; created_at: string } | null
}

const COLOUR = '#3C3489'

export default function PunditQueryDetailPage() {
  const { queryId } = useParams<{ queryId: string }>()
  const router = useRouter()
  const [query, setQuery] = useState<QueryDetail | null>(null)
  const [loading, setLoading] = useState(true)

  // Respond modal
  const [showRespond, setShowRespond] = useState(false)
  const [responding, setResponding] = useState(false)
  const [respondForm, setRespondForm] = useState({ text: '', problem_cosh_id: '' })
  const [respondError, setRespondError] = useState('')

  // Forward modal
  const [showForward, setShowForward] = useState(false)
  const [forwarding, setForwarding] = useState(false)
  const [forwardForm, setForwardForm] = useState({ to_pundit_id: '', remarks: '' })
  const [forwardError, setForwardError] = useState('')

  // Return modal
  const [showReturn, setShowReturn] = useState(false)
  const [returning, setReturning] = useState(false)
  const [returnRemarks, setReturnRemarks] = useState('')
  const [returnError, setReturnError] = useState('')

  // Reject modal
  const [showReject, setShowReject] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [rejectRemarks, setRejectRemarks] = useState('')
  const [rejectError, setRejectError] = useState('')

  const load = async () => {
    try {
      const { data } = await api.get<QueryDetail>(`/pundit/queries/${queryId}`)
      setQuery(data)
    } finally { setLoading(false) }
  }

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [queryId])

  async function handleRespond(e: FormEvent) {
    e.preventDefault()
    if (!respondForm.text && !respondForm.problem_cosh_id) {
      setRespondError('Please provide at least a text response or select the crop health problem.')
      return
    }
    setResponding(true); setRespondError('')
    try {
      await api.put(`/pundit/queries/${queryId}/respond`, respondForm)
      setShowRespond(false)
      load()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setRespondError(msg || 'Failed to submit response.')
    } finally { setResponding(false) }
  }

  async function handleForward(e: FormEvent) {
    e.preventDefault()
    setForwarding(true); setForwardError('')
    try {
      await api.put(`/pundit/queries/${queryId}/forward`, forwardForm)
      setShowForward(false)
      load()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setForwardError(msg || 'Failed to forward query.')
    } finally { setForwarding(false) }
  }

  async function handleReturn(e: FormEvent) {
    e.preventDefault()
    setReturning(true); setReturnError('')
    try {
      await api.put(`/pundit/queries/${queryId}/return`, { remarks: returnRemarks })
      setShowReturn(false)
      load()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setReturnError(msg || 'Failed to return query.')
    } finally { setReturning(false) }
  }

  async function handleReject(e: FormEvent) {
    e.preventDefault()
    setRejecting(true); setRejectError('')
    try {
      await api.put(`/pundit/queries/${queryId}/reject`, { remarks: rejectRemarks })
      setShowReject(false)
      load()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setRejectError(msg || 'Failed to reject query.')
    } finally { setRejecting(false) }
  }

  if (loading || !query) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: COLOUR }} />
    </div>
  )

  const isActive = ['NEW', 'FORWARDED', 'RETURNED'].includes(query.status)

  return (
    <div className="min-h-screen bg-slate-50">
      <PWAHeader title="Query" activeRole="FARMER" />
      <div className="pt-16 pb-28 px-4 space-y-4">
        {/* Header card */}
        <div className="bg-white rounded-2xl p-4 border border-slate-100 mt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <p className="font-semibold text-slate-800">{query.title}</p>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${query.status === 'RESPONDED' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                  {query.status}
                </span>
                <span className="text-xs text-slate-400">{query.severity}</span>
              </div>
            </div>
            {isActive && (
              <div className={`text-xs font-semibold px-2 py-1 rounded-xl ${query.days_remaining <= 1 ? 'bg-red-100 text-red-700' : query.days_remaining <= 3 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                {query.days_remaining}d left
              </div>
            )}
          </div>
        </div>

        {/* Details */}
        <div className="bg-white rounded-2xl p-4 border border-slate-100">
          {query.crop_cosh_id && (
            <div className="flex gap-3 mb-2">
              <span className="text-xs text-slate-400 w-20 shrink-0">Crop</span>
              <span className="text-sm text-slate-700 font-mono">{query.crop_cosh_id}</span>
            </div>
          )}
          {query.crop_age && (
            <div className="flex gap-3 mb-2">
              <span className="text-xs text-slate-400 w-20 shrink-0">Crop Age</span>
              <span className="text-sm text-slate-700">{query.crop_age}</span>
            </div>
          )}
          {query.description && (
            <div className="mt-3 pt-3 border-t border-slate-100">
              <p className="text-xs text-slate-400 mb-1">Description</p>
              <p className="text-sm text-slate-700 leading-relaxed">{query.description}</p>
            </div>
          )}
        </div>

        {/* Remarks chain */}
        {query.remarks.length > 0 && (
          <div className="bg-white rounded-2xl p-4 border border-slate-100">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Query History</p>
            <div className="space-y-3">
              {query.remarks.map((r, i) => (
                <div key={i} className="flex gap-3">
                  <div className="w-2 h-2 rounded-full bg-slate-300 mt-2 shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-slate-600 capitalize">{r.action.toLowerCase()}</p>
                    {r.remark && <p className="text-xs text-slate-500 mt-0.5">{r.remark}</p>}
                    <p className="text-xs text-slate-300 mt-0.5">{new Date(r.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Response */}
        {query.response && (
          <div className="bg-green-50 rounded-2xl p-4 border border-green-200">
            <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-2">Response</p>
            {query.response.problem_cosh_id && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 mb-3">
                <p className="text-xs text-blue-700">
                  🔬 Crop health problem identified: <strong>{query.response.problem_cosh_id}</strong>
                  <br />CHA recommendations have been added to the farmer's advisory.
                </p>
              </div>
            )}
            {query.response.text && <p className="text-sm text-slate-700 leading-relaxed">{query.response.text}</p>}
          </div>
        )}
      </div>

      {/* Action bar (only when holding and query is active) */}
      {query.is_holding && isActive && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-100 px-4 py-3 space-y-2">
          <button onClick={() => setShowRespond(true)}
            className="w-full py-3 rounded-2xl text-white font-semibold text-sm"
            style={{ background: `linear-gradient(135deg, #2d2570, ${COLOUR})` }}>
            ✓ Respond to Query
          </button>
          <div className="flex gap-2">
            <button onClick={() => setShowForward(true)}
              className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium">
              → Forward
            </button>
            {query.status !== 'NEW' && (
              <button onClick={() => setShowReturn(true)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium">
                ← Return
              </button>
            )}
            <button onClick={() => setShowReject(true)}
              className="flex-1 py-2.5 rounded-xl border border-red-100 text-red-500 text-sm font-medium">
              ✗ Reject
            </button>
          </div>
        </div>
      )}

      {/* Respond Modal */}
      {showRespond && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
          <div className="bg-white rounded-t-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">Respond to Query</h2>
              <p className="text-slate-400 text-xs mt-0.5">7-day window closes on response. Farmer is notified immediately.</p>
            </div>
            <form onSubmit={handleRespond} className="p-5 space-y-4 pb-8">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Crop Health Problem (if applicable)</label>
                <input value={respondForm.problem_cosh_id}
                  onChange={e => setRespondForm(f => ({ ...f, problem_cosh_id: e.target.value }))}
                  placeholder="e.g. sp_blast_rice or pg_aphids (Cosh ID)"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none font-mono" />
                <p className="text-xs text-slate-400 mt-1">
                  If you enter a problem ID, the system will automatically deliver CHA recommendations to the farmer.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Your Advice</label>
                <textarea value={respondForm.text}
                  onChange={e => setRespondForm(f => ({ ...f, text: e.target.value }))}
                  rows={5} placeholder="Write your detailed recommendation here…"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none resize-none" />
              </div>
              {respondError && <p className="text-sm text-red-600">{respondError}</p>}
              <div className="flex gap-3">
                <button type="button" onClick={() => { setShowRespond(false); setRespondError('') }}
                  className="flex-1 border border-slate-200 text-slate-700 font-medium py-3 rounded-2xl text-sm">Cancel</button>
                <button type="submit" disabled={responding}
                  className="flex-1 text-white font-semibold py-3 rounded-2xl text-sm disabled:opacity-50"
                  style={{ background: COLOUR }}>
                  {responding ? 'Sending…' : 'Send Response'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Forward Modal */}
      {showForward && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
          <div className="bg-white rounded-t-3xl w-full">
            <div className="p-5 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">Forward Query</h2>
              <p className="text-slate-400 text-xs mt-0.5">7-day clock does not reset. Mandatory comments required.</p>
            </div>
            <form onSubmit={handleForward} className="p-5 space-y-4 pb-8">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Recipient's Pundit ID</label>
                <input value={forwardForm.to_pundit_id}
                  onChange={e => setForwardForm(f => ({ ...f, to_pundit_id: e.target.value }))}
                  required placeholder="FarmPundit profile ID"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none font-mono" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Remarks (mandatory)</label>
                <textarea value={forwardForm.remarks}
                  onChange={e => setForwardForm(f => ({ ...f, remarks: e.target.value }))}
                  required rows={3} placeholder="Why are you forwarding? What context should the recipient know?"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none resize-none" />
              </div>
              {forwardError && <p className="text-sm text-red-600">{forwardError}</p>}
              <div className="flex gap-3">
                <button type="button" onClick={() => { setShowForward(false); setForwardError('') }}
                  className="flex-1 border border-slate-200 text-slate-700 font-medium py-3 rounded-2xl text-sm">Cancel</button>
                <button type="submit" disabled={forwarding}
                  className="flex-1 text-white font-semibold py-3 rounded-2xl text-sm disabled:opacity-50"
                  style={{ background: COLOUR }}>
                  {forwarding ? 'Forwarding…' : 'Forward'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Return Modal */}
      {showReturn && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
          <div className="bg-white rounded-t-3xl w-full">
            <div className="p-5 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">Return Query</h2>
            </div>
            <form onSubmit={handleReturn} className="p-5 space-y-4 pb-8">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Remarks (mandatory)</label>
                <textarea value={returnRemarks} onChange={e => setReturnRemarks(e.target.value)}
                  required rows={3} placeholder="Why are you returning? What do you need?"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none resize-none" />
              </div>
              {returnError && <p className="text-sm text-red-600">{returnError}</p>}
              <div className="flex gap-3">
                <button type="button" onClick={() => { setShowReturn(false); setReturnError('') }}
                  className="flex-1 border border-slate-200 text-slate-700 font-medium py-3 rounded-2xl text-sm">Cancel</button>
                <button type="submit" disabled={returning}
                  className="flex-1 text-white font-semibold py-3 rounded-2xl text-sm disabled:opacity-50"
                  style={{ background: '#b45309' }}>
                  {returning ? 'Returning…' : 'Return Query'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {showReject && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
          <div className="bg-white rounded-t-3xl w-full">
            <div className="p-5 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">Reject Query</h2>
              <p className="text-slate-400 text-xs mt-0.5">This is a terminal action. The query cannot be reopened.</p>
            </div>
            <form onSubmit={handleReject} className="p-5 space-y-4 pb-8">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Reason (mandatory)</label>
                <textarea value={rejectRemarks} onChange={e => setRejectRemarks(e.target.value)}
                  required rows={3} placeholder="Why are you rejecting this query?"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none resize-none" />
              </div>
              {rejectError && <p className="text-sm text-red-600">{rejectError}</p>}
              <div className="flex gap-3">
                <button type="button" onClick={() => { setShowReject(false); setRejectError('') }}
                  className="flex-1 border border-slate-200 text-slate-700 font-medium py-3 rounded-2xl text-sm">Cancel</button>
                <button type="submit" disabled={rejecting}
                  className="flex-1 text-white font-semibold py-3 rounded-2xl text-sm disabled:opacity-50"
                  style={{ background: '#dc2626' }}>
                  {rejecting ? 'Rejecting…' : 'Reject Query'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
