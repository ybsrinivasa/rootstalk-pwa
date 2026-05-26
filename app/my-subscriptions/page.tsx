'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

interface Subscription {
  id: string; status: string; client_id: string; package_id: string
  crop_start_date: string | null; reference_number: string | null
  subscription_type?: string
}
interface Branding { display_name: string; primary_colour: string; logo_url: string | null }
interface DiscoverPackage {
  package_id: string; package_name: string; crop_cosh_id: string
  client_id: string; client_name: string | null; client_colour: string | null
  // legacy field aliases (backend may return either form)
  company_name?: string | null; primary_colour?: string | null
}

const STATUS_COLOUR: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  WAITLISTED: 'bg-amber-100 text-amber-700',
  SUSPENDED: 'bg-orange-100 text-orange-700',
  LAPSED: 'bg-slate-100 text-[#7A8C7E]',
  CANCELLED: 'bg-slate-100 text-[#7A8C7E]',
}

export default function MySubscriptionsPage() {
  const router = useRouter()
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [brandings, setBrandings] = useState<Record<string, Branding>>({})
  const [discover, setDiscover] = useState<DiscoverPackage[]>([])
  const [loading, setLoading] = useState(true)
  const [unsubscribing, setUnsubscribing] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<string | null>(null)

  const load = async () => {
    try {
      const [subRes, discRes] = await Promise.allSettled([
        api.get<Subscription[]>('/farmer/my-subscriptions'),
        api.get<DiscoverPackage[]>('/farmer/active-advisories-in-district'),
      ])
      const subs = subRes.status === 'fulfilled' ? subRes.value.data : []
      setSubscriptions(subs)
      setDiscover(discRes.status === 'fulfilled' ? discRes.value.data : [])

      const ids = [...new Set(subs.map(s => s.client_id))]
      const brandResults = await Promise.allSettled(
        ids.map(id => api.get<Branding>(`/client/${id}/info`).then(r => ({ id, data: r.data })))
      )
      const m: Record<string, Branding> = {}
      brandResults.forEach(r => { if (r.status === 'fulfilled') m[r.value.id] = r.value.data })
      setBrandings(m)
    } finally { setLoading(false) }
  }

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [])

  async function unsubscribe(sub: Subscription) {
    if (!confirm(`Unsubscribe from this advisory?`)) return
    setUnsubscribing(sub.id)
    try {
      await api.put(`/farmer/subscriptions/${sub.id}/unsubscribe`, {})
      load()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      alert(msg || 'Cannot unsubscribe from this advisory.')
    } finally { setUnsubscribing(null) }
  }

  async function cancelDelegation(sub: Subscription) {
    if (!confirm('Cancel pending payment request? You can then choose someone else or pay yourself.')) return
    setCancelling(sub.id)
    try {
      await api.delete(`/farmer/subscriptions/${sub.id}/delegate-payment`)
      load()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      alert(msg || 'Could not cancel the request.')
    } finally { setCancelling(null) }
  }

  const active = subscriptions.filter(s => s.status === 'ACTIVE')
  const others = subscriptions.filter(s => s.status !== 'ACTIVE')

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="My Subscriptions" activeRole="FARMER" back="/home" />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">
        {/* Back to home — /my-subscriptions is reached from the
            right drawer, so there's no obvious one-step back; an
            explicit Home link gives the farmer a clear exit. */}
        <button
          onClick={() => router.replace('/home')}
          className="mt-4 mb-2 flex items-center gap-1 text-sm"
          style={{ color: '#7A8C7E' }}>
          ← Back to home
        </button>
        {loading ? (
          <div className="mt-4 space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-24 bg-white rounded-2xl animate-pulse" />)}</div>
        ) : (
          <div className="space-y-6 mt-4">
            {/* Active subscriptions */}
            {active.length > 0 && (
              <section>
                <p className="text-xs font-bold text-[#7A8C7E] uppercase tracking-wider mb-3">Active ({active.length})</p>
                <div className="space-y-3">
                  {active.map(sub => {
                    const b = brandings[sub.client_id]
                    const colour = b?.primary_colour || '#3A7D44'
                    return (
                      <div key={sub.id} className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm overflow-hidden">
                        <div className="px-4 py-2.5 flex items-center gap-3" style={{ background: colour + '18' }}>
                          {b?.logo_url && <img src={b.logo_url} alt="" className="w-6 h-6 rounded object-cover" />}
                          <p className="text-sm font-bold flex-1" style={{ color: colour }}>{b?.display_name || 'Company'}</p>
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">ACTIVE</span>
                        </div>
                        <div className="px-4 py-3">
                          {sub.reference_number && (
                            <p className="text-xs font-mono text-[#7A8C7E] mb-1">{sub.reference_number}</p>
                          )}
                          <p className="text-xs text-[#7A8C7E]">
                            {sub.crop_start_date
                              ? `Started ${new Date(sub.crop_start_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
                              : 'Awaiting crop start date'}
                          </p>
                          <div className="flex gap-2 mt-3">
                            <button onClick={() => router.push(`/crop-detail/${sub.id}`)}
                              className="flex-1 py-2 rounded-xl text-xs font-semibold text-white"
                              style={{ background: colour }}>
                              Open Advisory
                            </button>
                            <button onClick={() => unsubscribe(sub)}
                              disabled={unsubscribing === sub.id}
                              className="px-4 py-2 rounded-xl text-xs font-medium text-[#D4682E] border border-red-200 hover:bg-red-50 disabled:opacity-40">
                              {unsubscribing === sub.id ? '…' : 'Unsubscribe'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {/* Waitlisted / past */}
            {others.length > 0 && (
              <section>
                <p className="text-xs font-bold text-[#7A8C7E] uppercase tracking-wider mb-3">Other ({others.length})</p>
                <div className="space-y-2">
                  {others.map(sub => {
                    const b = brandings[sub.client_id]
                    const isWaitlisted = sub.status === 'WAITLISTED'
                    return (
                      <div key={sub.id} className="bg-white rounded-2xl border border-[#DDD0B8] px-4 py-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold text-[#6B3F1F]">{b?.display_name || 'Company'}</p>
                            {sub.reference_number && <p className="text-xs font-mono text-[#7A8C7E]">{sub.reference_number}</p>}
                            {isWaitlisted && (
                              <p className="text-xs text-amber-700 mt-1">Pending payment delegation</p>
                            )}
                          </div>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOUR[sub.status] || 'bg-slate-100 text-[#7A8C7E]'}`}>
                            {sub.status}
                          </span>
                        </div>
                        {isWaitlisted && (
                          <button
                            onClick={() => cancelDelegation(sub)}
                            disabled={cancelling === sub.id}
                            className="mt-2 text-xs text-amber-700 underline disabled:opacity-40">
                            {cancelling === sub.id ? 'Cancelling…' : 'Cancel pending request'}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {/* Active Advisories in District — discovery (A3a) */}
            {discover.length > 0 && (
              <section>
                <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-widest mb-1">Advisories in your area</p>
                <p className="text-xs text-[#7A8C7E] mb-3">Other companies offering advisories in your district</p>
                <div className="space-y-2">
                  {discover.map(pkg => {
                    const companyName = pkg.client_name || pkg.company_name || 'Company'
                    const accentColour = pkg.client_colour || pkg.primary_colour || '#3A7D44'
                    const cropLabel = pkg.crop_cosh_id
                      .replace(/^crop_/, '')
                      .replace(/_/g, ' ')
                      .replace(/\b\w/g, c => c.toUpperCase())
                    return (
                      <div key={pkg.package_id} className="bg-white rounded-2xl border border-[#DDD0B8] px-4 py-3 flex items-center justify-between">
                        <div className="flex items-center gap-2.5 flex-1 min-w-0">
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: accentColour }} />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[#6B3F1F] truncate" style={{ color: accentColour }}>{companyName}</p>
                            <p className="text-xs text-[#7A8C7E]">{cropLabel}</p>
                          </div>
                        </div>
                        <button onClick={() => router.push('/subscribe')}
                          className="text-xs px-3 py-1.5 rounded-lg text-white font-medium ml-3 flex-shrink-0"
                          style={{ background: accentColour }}>
                          Explore →
                        </button>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {subscriptions.length === 0 && discover.length === 0 && (
              <div className="text-center py-16">
                <span className="text-4xl">🌾</span>
                <p className="text-[#7A8C7E] font-medium mt-3">No subscriptions yet</p>
                <button onClick={() => router.push('/subscribe')}
                  className="mt-4 px-6 py-3 rounded-2xl text-white text-sm font-semibold bg-green-700">
                  Subscribe to an advisory
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <BottomNav color="#3A7D44" />
    </div>
  )
}
