'use client'
import { useRouter } from 'next/navigation'

export default function PrivacyPolicyPage() {
  const router = useRouter()
  return (
    <div className="min-h-screen bg-[#F7F5F0]">
      {/* Header */}
      <div className="px-5 py-5 flex items-center gap-3" style={{ background: '#3A7D44' }}>
        <button onClick={() => router.back()} className="text-white/70 hover:text-white">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
          </svg>
        </button>
        <h1 className="text-white font-semibold text-lg">Privacy Policy</h1>
      </div>

      {/* Content */}
      <div className="px-5 py-6 max-w-2xl mx-auto space-y-6 pb-16">
        <p className="text-[#7A8C7E] text-xs">Last updated: April 2026</p>

        {[
          {
            title: "What we collect",
            body: "We collect your mobile phone number (for login and verification), your name, your location (state, district, and GPS coordinates), and your farm-related information including crop subscriptions and advisory records. We also collect queries you raise to agricultural experts and responses received."
          },
          {
            title: "How we use your data",
            body: "Your phone number is used only for login. Your location helps us find nearby dealers, facilitators, and relevant advisories. Your crop and advisory records are used to deliver personalised agricultural guidance. Your queries are shared with the agricultural experts you choose to contact. We do not sell your data to any third party."
          },
          {
            title: "Data sharing",
            body: "Your name and phone number may be visible to dealers and facilitators when you place orders through the app. Your crop records are visible to your company's advisory team. Queries you submit are visible to the FarmPundit expert assigned to handle them. No data is shared outside RootsTalk without your consent."
          },
          {
            title: "Location data",
            body: "GPS coordinates are collected when you choose to share them. They are used to find nearby dealers and facilitators. You can decline GPS access — the app will use your registered district instead. You can update or clear your GPS data at any time from your Profile."
          },
          {
            title: "Data retention",
            body: "Your data is retained for as long as your account is active. If you delete your account, your personal information is anonymised within 30 days. Crop advisory records may be retained in anonymised form for agricultural research purposes."
          },
          {
            title: "Your rights",
            body: "Under the Digital Personal Data Protection Act 2023 (India), you have the right to access your data, correct inaccurate information, and request deletion of your account and data. You can delete your account at any time from the Profile screen."
          },
          {
            title: "Security",
            body: "All data is encrypted in transit and at rest. Login is secured with OTP verification. We do not store plain-text passwords. Access to your data is limited to authorised personnel of Neytiri Eywafarm Agritech Private Limited."
          },
          {
            title: "Contact us",
            body: "For any privacy-related queries, contact us at: support@eywa.farm or visit eywa.farm. Neytiri Eywafarm Agritech Private Limited, India."
          },
        ].map(section => (
          <div key={section.title} className="bg-white rounded-2xl p-5 border border-[#DDD0B8]">
            <h3 className="font-semibold text-[#6B3F1F] mb-2">{section.title}</h3>
            <p className="text-[#7A8C7E] text-sm leading-relaxed">{section.body}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
