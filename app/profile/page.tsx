'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken, getUser, getActiveRoles, logout, ROLE_COLOURS, ROLE_LABELS } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'

export default function ProfilePage() {
  const router = useRouter()
  const user = getUser()
  const roles = getActiveRoles(user)

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

        {/* My Roles */}
        <div className="mt-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3 px-1">My Roles</p>
          <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
            {roles.map(role => (
              <div key={role} className="flex items-center gap-3 px-4 py-4 border-b border-slate-50 last:border-0">
                <div className="w-3 h-3 rounded-full" style={{ background: ROLE_COLOURS[role] }} />
                <div>
                  <p className="text-sm font-medium text-slate-800">{ROLE_LABELS[role]}</p>
                  <p className="text-xs text-slate-400">Active</p>
                </div>
              </div>
            ))}
            {!roles.includes('DEALER') && (
              <button className="w-full text-left px-4 py-4 border-b border-slate-50 text-sm text-slate-400">
                + Become a Dealer
              </button>
            )}
            {!roles.includes('FACILITATOR') && (
              <button className="w-full text-left px-4 py-4 border-b border-slate-50 text-sm text-slate-400">
                + Become a Facilitator
              </button>
            )}
            {!roles.includes('FARM_PUNDIT') && (
              <button className="w-full text-left px-4 py-4 text-sm text-slate-400">
                + Register as FarmPundit
              </button>
            )}
          </div>
        </div>

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
