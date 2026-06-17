'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useLocale } from 'next-intl'
import api from '@/lib/api'

interface ParameterOption {
  parameter_name: string
  option_name: string
}

interface CropRecord {
  reference_number: string
  farmer_name: string | null
  farmer_phone: string | null
  farmer_district: string | null
  farmer_state: string | null
  crop_name: string | null
  company: string | null
  package_id: string | null
  package_name: string | null
  crop_start_date: string | null
  crop_closure_date: string | null
  parameters_options: ParameterOption[]
}

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function CropPublicPage() {
  const { referenceNumber } = useParams<{ referenceNumber: string }>()
  const locale = useLocale()
  const [record, setRecord] = useState<CropRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    // 2026-06-06 — switched to /public/crop-record/{ref} (the spec
    // path; the old /public/crop/{ref} is a 301 redirect alias).
    api.get<CropRecord>(`/public/crop-record/${referenceNumber}`)
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
    <div className="flex items-start justify-between py-2.5 border-b border-gray-100 last:border-0">
      <p className="text-sm text-gray-500 w-2/5">{label}</p>
      <p className="text-sm font-semibold text-gray-800 text-right w-3/5">{value}</p>
    </div>
  ) : null

  const locationLine = [record.farmer_district, record.farmer_state].filter(Boolean).join(', ') || null

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
          <p className="text-xs text-gray-400 mt-1">Official RootsTalk crop advisory record</p>
        </div>

        {/* Farmer */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Farmer</p>
          {fieldRow('Name', record.farmer_name)}
          {record.farmer_phone && (
            <div className="flex items-start justify-between py-2.5 border-b border-gray-100 last:border-0">
              <p className="text-sm text-gray-500 w-2/5">Phone</p>
              <a href={`tel:${record.farmer_phone}`} className="text-sm font-semibold text-green-700 text-right w-3/5">
                {record.farmer_phone}
              </a>
            </div>
          )}
          {fieldRow('Location', locationLine)}
        </div>

        {/* Crop & Company */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Crop</p>
          {fieldRow('Crop', record.crop_name)}
          {fieldRow('Company', record.company)}
          {fieldRow('Start date', formatDate(record.crop_start_date, locale))}
          {fieldRow('Closure date', formatDate(record.crop_closure_date, locale))}
        </div>

        {/* Parameters-Options */}
        {record.parameters_options.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Parameters &amp; Options</p>
            <p className="text-xs text-gray-500 mb-3">
              The package&apos;s fingerprint — what this advisory plan is configured for.
            </p>
            <div className="space-y-0">
              {record.parameters_options.map((p, i) => (
                <div key={i} className="flex items-start justify-between py-2.5 border-b border-gray-100 last:border-0">
                  <p className="text-sm text-gray-500 w-2/5">{p.parameter_name}</p>
                  <p className="text-sm font-semibold text-gray-800 text-right w-3/5">{p.option_name}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-center text-xs text-gray-400 leading-relaxed">
          Generated by RootsTalk, an agricultural advisory platform by
          Neytiri Eywafarm Agritech Private Limited.
        </p>
      </div>
    </div>
  )
}
