'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

interface PromotedFarmer {
  subscription_id: string; farmer_user_id: string; farmer_name: string | null
  farmer_phone: string | null; client_id: string; package_id: string
  status: string; reference_number: string | null; crop_start_date: string | null
}

const COLOUR = '#085041'

export default function DealerPromotedFarmersPage() {
  const router = useRouter()
  const [farmers, setFarmers] = useState<PromotedFarmer[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    api.get<PromotedFarmer[]>('/dealer/promoted-farmers')
      .then(r => setFarmers(r.data))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="My Promoted Farmers" activeRole="DEALER" back="/dealer/home" />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">
        <div className="mt-4 mb-3 flex justify-end">
          <button onClick={() => router.push('/dealer/promoter-assign')}
            className="text-sm font-semibold px-4 py-2.5 rounded-xl text-white"
            style={{ background: '#085041' }}>
            + Assign advisory
          </button>
        </div>
        {loading ? (
          <div className="mt-4 space-y-3">
            {[1, 2].map(i => <div key={i} className="h-20 bg-white rounded-2xl animate-pulse" />)}
          </div>
        ) : farmers.length === 0 ? (
          <div className="mt-8 text-center py-16">
            <span className="text-4xl">👨‍🌾</span>
            <p className="text-[#7A8C7E] font-medium mt-3">No promoted farmers yet</p>
            <p className="text-xs text-[#7A8C7E] mt-1">Farmers you sponsor will appear here</p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {farmers.map(f => (
              <button key={f.subscription_id}
                onClick={() => router.push(`/dealer/promoted-farmers/${f.subscription_id}`)}
                className="w-full bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm text-left active:scale-98 transition-transform">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-[#6B3F1F]">{f.farmer_name || 'Unknown farmer'}</p>
                    <p className="text-xs text-[#7A8C7E] mt-0.5">{f.farmer_phone}</p>
                    {f.reference_number && (
                      <p className="text-xs font-mono text-[#7A8C7E] mt-0.5">{f.reference_number}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      f.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-[#7A8C7E]'
                    }`}>{f.status}</span>
                    <p className="text-[#DDD0B8] text-xl mt-1">›</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      <BottomNav color={COLOUR} activeRole="DEALER" />
    </div>
  )
}
