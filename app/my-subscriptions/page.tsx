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
  client_id: string; company_name: string | null; company_logo: string | null; primary_colour: string | null
}

const STATUS_COLOUR: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  WAITLISTED: 'bg-amber-100 text-amber-700',
  SUSPENDED: 'bg-orange-100 text-orange-700',
  LAPSED: 'bg-slate-100 text-slate-500',
  CANCELLED: 'bg-slate-100 text-slate-400',
}

export default function MySubscriptionsPage() {
  const router = useRouter()
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [brandings, setBrandings] = useState<Record<string, Branding>>({})
  const [discover, setDiscover] = useState<DiscoverPackage[]>([])
  const [loading, setLoading] = useState(true)
  const [unsubscribing, setUnsubscribing] = useState<string | null>(null)

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
        ids.map(id => api.get<Branding>(`/portal/${id}/branding`).then(r => ({ id, data: r.data })))
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

  const active = subscriptions.filter(s => s.status === 'ACTIVE')
  const others = subscriptions.filter(s => s.status !== 'ACTIVE')

  return (
    <div className="min-h-screen bg-slate-50">
      <PWAHeader title="My Subscriptions" activeRole="FARMER" />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">
        {loading ? (
          <div className="mt-4 space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-24 bg-white rounded-2xl animate-pulse" />)}</div>
        ) : (
          <div className="space-y-6 mt-4">
            {/* Active subscriptions */}
            {active.length > 0 && (
              <section>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Active ({active.length})</p>
                <div className="space-y-3">
                  {active.map(sub => {
                    const b = brandings[sub.client_id]
                    const colour = b?.primary_colour || '#1A5C2A'
                    return (
                      <div key={sub.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                        <div className="px-4 py-2.5 flex items-center gap-3" style={{ background: colour + '18' }}>
                          {b?.logo_url && <img src={b.logo_url} alt="" className="w-6 h-6 rounded object-cover" />}
                          <p className="text-sm font-bold flex-1" style={{ color: colour }}>{b?.display_name || 'Company'}</p>
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">ACTIVE</span>
                        </div>
                        <div className="px-4 py-3">
                          {sub.reference_number && (
                            <p className="text-xs font-mono text-slate-500 mb-1">{sub.reference_number}</p>
                          )}
                          <p className="text-xs text-slate-400">
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
                              className="px-4 py-2 rounded-xl text-xs font-medium text-red-500 border border-red-200 hover:bg-red-50 disabled:opacity-40">
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
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Other ({others.length})</p>
                <div className="space-y-2">
                  {others.map(sub => {
                    const b = brandings[sub.client_id]
                    return (
                      <div key={sub.id} className="bg-white rounded-2xl border border-slate-100 px-4 py-3 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-slate-700">{b?.display_name || 'Company'}</p>
                          {sub.reference_number && <p className="text-xs font-mono text-slate-400">{sub.reference_number}</p>}
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOUR[sub.status] || 'bg-slate-100 text-slate-500'}`}>
                          {sub.status}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {/* Active Advisories in District — discovery */}
            {discover.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Active in Your District</p>
                  <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full font-medium">Discover</span>
                </div>
                <p className="text-xs text-slate-400 mb-3">Other companies offering advisories in your district</p>
                <div className="space-y-2">
                  {discover.map(pkg => (
                    <div key={pkg.package_id} className="bg-white rounded-2xl border border-slate-100 px-4 py-3 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{pkg.company_name || 'Company'}</p>
                        <p className="text-xs text-slate-400">{pkg.package_name} · {pkg.crop_cosh_id}</p>
                      </div>
                      <button onClick={() => router.push('/subscribe')}
                        className="text-xs px-3 py-1.5 rounded-lg text-white font-medium"
                        style={{ background: pkg.primary_colour || '#1A5C2A' }}>
                        Subscribe
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {subscriptions.length === 0 && discover.length === 0 && (
              <div className="text-center py-16">
                <span className="text-4xl">🌾</span>
                <p className="text-slate-500 font-medium mt-3">No subscriptions yet</p>
                <button onClick={() => router.push('/subscribe')}
                  className="mt-4 px-6 py-3 rounded-2xl text-white text-sm font-semibold bg-green-700">
                  Subscribe to an advisory
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <BottomNav color="#1A5C2A" />
    </div>
  )
}
