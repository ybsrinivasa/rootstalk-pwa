'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken, getUser, getActiveRoles, logout, ROLE_COLOURS, ROLE_LABELS } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

interface Subscription { id: string; status: string; package_id: string }

export default function ProfilePage() {
  const router = useRouter()
  const user = getUser()
  const roles = getActiveRoles(user)
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [alertPref, setAlertPref] = useState<Record<string, { send_to_self: boolean; promoter_user_id: string }>>({})
  const [savingAlert, setSavingAlert] = useState<string | null>(null)
  const [alertSuccess, setAlertSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (!getToken()) return
    api.get<Subscription[]>('/farmer/my-subscriptions')
      .then(r => setSubscriptions(r.data.filter(s => s.status === 'ACTIVE')))
      .catch(() => {})
  }, [])

  async function saveAlertPref(subId: string) {
    setSavingAlert(subId)
    try {
      await api.post(`/farmer/subscriptions/${subId}/alert-preferences`, alertPref[subId] || { send_to_self: true })
      setAlertSuccess(subId)
      setTimeout(() => setAlertSuccess(null), 2000)
    } finally { setSavingAlert(null) }
  }

  useEffect(() => {
    if (!getToken()) router.replace('/register')
  }, [router])

  return (
    <div className="min-h-screen bg-slate-50">
      <PWAHeader title="Profile" activeRole="FARMER" />
      <div className="pt-16 pb-20 px-4">
        {/* User card */}
        <div className="bg-white rounded-2xl p-5 mt-4 border border-slate-100 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full flex items-center justify-center text-white text-xl font-bold"
              style={{ background: 'linear-gradient(135deg, #065f46, #059669)' }}>
              {(user?.name || user?.phone || 'U')[0].toUpperCase()}
            </div>
            <div>
              <p className="font-semibold text-slate-900">{user?.name || 'No name set'}</p>
              <p className="text-slate-400 text-sm">{user?.phone || user?.email}</p>
            </div>
          </div>
        </div>

        {/* My Roles — tap to switch context */}
        <div className="mt-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3 px-1">My Roles — tap to open</p>
          <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
            {roles.map(role => {
              const destination = role === 'DEALER' ? '/dealer/orders'
                : role === 'FACILITATOR' ? '/facilitator/orders'
                : role === 'FARMER' ? '/home'
                : null
              return (
                <button key={role} onClick={() => destination && router.push(destination)}
                  className="w-full flex items-center gap-3 px-4 py-4 border-b border-slate-50 last:border-0 text-left active:bg-slate-50">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center"
                    style={{ background: ROLE_COLOURS[role] + '20' }}>
                    <div className="w-3 h-3 rounded-full" style={{ background: ROLE_COLOURS[role] }} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-800">{ROLE_LABELS[role]}</p>
                    <p className="text-xs text-slate-400">Active · tap to open</p>
                  </div>
                  <span className="text-slate-300">›</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Alert Preferences (Farmer only) */}
        {roles.includes('FARMER') && subscriptions.length > 0 && (
          <div className="mt-5">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3 px-1">Alert Preferences</p>
            <div className="space-y-3">
              {subscriptions.map(sub => (
                <div key={sub.id} className="bg-white rounded-2xl p-4 border border-slate-100">
                  <p className="text-xs text-slate-500 font-mono mb-3">{sub.id.slice(0, 12)}…</p>
                  <label className="flex items-center gap-3 cursor-pointer mb-3">
                    <input type="checkbox"
                      checked={alertPref[sub.id]?.send_to_self !== false}
                      onChange={e => setAlertPref(p => ({
                        ...p,
                        [sub.id]: { ...(p[sub.id] || {}), send_to_self: e.target.checked, promoter_user_id: p[sub.id]?.promoter_user_id || '' }
                      }))}
                      className="w-4 h-4 rounded" />
                    <span className="text-sm text-slate-700">Send alerts to my phone</span>
                  </label>
                  <div className="mb-3">
                    <label className="block text-xs text-slate-500 mb-1">Also alert my promoter (user ID, optional)</label>
                    <input
                      value={alertPref[sub.id]?.promoter_user_id || ''}
                      onChange={e => setAlertPref(p => ({
                        ...p,
                        [sub.id]: { ...(p[sub.id] || { send_to_self: true }), promoter_user_id: e.target.value }
                      }))}
                      placeholder="Dealer or facilitator user ID"
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none" />
                  </div>
                  <button onClick={() => saveAlertPref(sub.id)} disabled={savingAlert === sub.id}
                    className="w-full py-2.5 rounded-xl text-white text-xs font-semibold disabled:opacity-50"
                    style={{ background: '#1A5C2A' }}>
                    {alertSuccess === sub.id ? '✓ Saved' : savingAlert === sub.id ? 'Saving…' : 'Save Preferences'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sign out */}
        <button onClick={logout}
          className="w-full mt-6 py-3.5 border border-red-100 text-red-500 rounded-2xl text-sm font-medium">
          Sign out
        </button>
      </div>
      <BottomNav color="#1A5C2A" />
    </div>
  )
}
