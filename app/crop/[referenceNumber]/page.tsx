'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import api from '@/lib/api'

interface CropRecord {
  reference_number: string; farmer_name: string | null; farmer_district: string | null; farmer_state: string | null
  company_name: string | null; company_display_name: string | null; crop_cosh_id: string | null; package_name: string | null
  subscription_date: string | null; crop_start_date: string | null; status: string
}

export default function CropPublicPage() {
  const { referenceNumber } = useParams<{ referenceNumber: string }>()
  const [record, setRecord] = useState<CropRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    api.get<CropRecord>(`/public/crop/${referenceNumber}`)
      .then(r => setRecord(r.data))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [referenceNumber])

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-green-50">
      <div className="w-8 h-8 border-2 border-green-700 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (notFound || !record) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-green-50 px-6 text-center">
      <p className="text-5xl mb-4">🌾</p>
      <h1 className="text-xl font-bold text-gray-800">Record not found</h1>
      <p className="text-gray-500 text-sm mt-2">This crop record could not be found. Please check the reference number.</p>
      <p className="text-xs text-gray-400 mt-4 font-mono">{referenceNumber}</p>
    </div>
  )

  const fieldRow = (label: string, value: string | null | undefined) => value ? (
    <div className="flex items-start justify-between py-3 border-b border-gray-100 last:border-0">
      <p className="text-sm text-gray-400 w-2/5">{label}</p>
      <p className="text-sm font-semibold text-gray-800 text-right w-3/5">{value}</p>
    </div>
  ) : null

  return (
    <div className="min-h-screen bg-green-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-6 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-green-700 flex items-center justify-center">
            <span className="text-white text-lg">🌿</span>
          </div>
          <div>
            <p className="font-bold text-gray-900 text-sm">RootsTalk Crop Record</p>
            <p className="text-xs text-gray-400">Verified by Neytiri Eywafarm Agritech</p>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-6 py-6 space-y-4">
        {/* Reference badge */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 text-center">
          <p className="text-xs text-gray-400 mb-1">Reference Number</p>
          <p className="text-2xl font-bold text-green-700 font-mono">{record.reference_number}</p>
          <p className="text-xs text-gray-400 mt-1">This is an official RootsTalk crop advisory record</p>
        </div>

        {/* Farmer & Crop details */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Farmer</p>
          {fieldRow("Name", record.farmer_name)}
          {fieldRow("District", record.farmer_district)}
          {fieldRow("State", record.farmer_state)}
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Crop & Advisory</p>
          {fieldRow("Company", record.company_display_name || record.company_name)}
          {fieldRow("Crop", record.crop_cosh_id)}
          {fieldRow("Advisory Package", record.package_name)}
          {fieldRow("Subscribed On", record.subscription_date ? new Date(record.subscription_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : null)}
          {fieldRow("Crop Started", record.crop_start_date ? new Date(record.crop_start_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : null)}
        </div>

        <p className="text-center text-xs text-gray-400 leading-relaxed">
          This record was generated from RootsTalk, an agricultural advisory platform by
          Neytiri Eywafarm Agritech Private Limited. The information shown reflects the
          farmer's registered crop advisory subscription.
        </p>
      </div>
    </div>
  )
}
