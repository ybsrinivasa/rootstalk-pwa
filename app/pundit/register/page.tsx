'use client'
import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'

const COLOUR = '#3C3489'

const EDUCATION_OPTIONS = [
  { value: 'DOCTORATE', label: 'Doctorate (Ph.D.)' },
  { value: 'MASTERS', label: 'Masters (M.Sc., M.Tech.)' },
  { value: 'BACCALAUREATE', label: 'Baccalaureate (B.Sc., B.Tech.)' },
  { value: 'CLASS_XII_AND_BELOW', label: 'Class XII and below' },
  { value: 'NO_FORMAL_EDUCATION', label: 'No formal education' },
]
const EXPERIENCE_OPTIONS = [
  { value: 'UP_TO_5_YEARS', label: 'Up to 5 years' },
  { value: 'FROM_5_TO_10', label: '5 to 10 years' },
  { value: 'FROM_10_TO_15', label: '10 to 15 years' },
  { value: 'ABOVE_15', label: 'More than 15 years' },
]
const SUPPORT_METHODS = [
  { value: 'CONVENTIONAL', label: 'Conventional (chemical-based)' },
  { value: 'NON_CHEMICAL', label: 'Non-chemical (organic/IPM)' },
]
const EXPERTISE_DOMAINS = [
  'plant_protection', 'plant_nutrition', 'overall_agronomy',
  'plant_propagation', 'farm_equipments_and_mechanisation',
]
const CROP_GROUPS = [
  'cereals', 'oilseeds', 'fruit_trees', 'fibre_crops',
  'flower_crops', 'fodder_crops', 'medicinal_and_aromatic_crops',
]
const LANGUAGES = [
  { code: 'en', name: 'English' }, { code: 'hi', name: 'Hindi' },
  { code: 'te', name: 'Telugu' }, { code: 'kn', name: 'Kannada' },
  { code: 'ta', name: 'Tamil' }, { code: 'ml', name: 'Malayalam' },
  { code: 'mr', name: 'Marathi' }, { code: 'gu', name: 'Gujarati' },
  { code: 'pa', name: 'Punjabi' }, { code: 'bn', name: 'Bengali' },
]

export default function PunditRegisterPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    email: '',
    education: '',
    experience_band: '',
    support_method: '',
    organisation_name: '',
    declaration_accepted: false,
    expertise_domains: [] as string[],
    crop_groups: [] as string[],
    languages: [] as string[],
    support_areas: [{ state_cosh_id: '', district_cosh_id: '' }],
  })

  function toggle(field: 'expertise_domains' | 'crop_groups' | 'languages', value: string) {
    setForm(f => ({
      ...f,
      [field]: f[field].includes(value)
        ? f[field].filter((x: string) => x !== value)
        : [...f[field], value],
    }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form.declaration_accepted) {
      setError('You must accept the declaration to register.')
      return
    }
    setSubmitting(true); setError('')
    try {
      await api.post('/pundit/profile', {
        ...form,
        support_areas: form.support_areas.filter(a => a.state_cosh_id),
      })
      router.replace('/pundit/home')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg || 'Registration failed.')
    } finally { setSubmitting(false) }
  }

  const StepDot = ({ n }: { n: number }) => (
    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${step >= n ? 'text-white' : 'bg-slate-100 text-[#7A8C7E]'}`}
      style={step >= n ? { background: COLOUR } : {}}>
      {n}
    </div>
  )

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="Register as FarmPundit" activeRole="FARMER" />
      <div className="pt-16 pb-20 px-4">
        {/* Steps */}
        <div className="flex items-center gap-2 mt-4 mb-6 justify-center">
          {[1,2,3,4].map(n => (
            <div key={n} className="flex items-center gap-2">
              <StepDot n={n} />
              {n < 4 && <div className={`h-0.5 w-6 ${step > n ? 'bg-purple-700' : 'bg-slate-200'}`} />}
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-bold text-[#6B3F1F]">Professional Profile</h2>
                <p className="text-[#7A8C7E] text-sm mt-0.5">Tell farmers about your qualifications</p>
              </div>
              <div className="bg-white rounded-2xl p-5 border border-[#DDD0B8] space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#6B3F1F] mb-1.5">Email</label>
                  <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    required placeholder="your@email.com"
                    className="w-full border border-[#DDD0B8] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2"
                    style={{ '--tw-ring-color': COLOUR } as React.CSSProperties} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#6B3F1F] mb-1.5">Education</label>
                  <select value={form.education} onChange={e => setForm(f => ({ ...f, education: e.target.value }))}
                    required className="w-full border border-[#DDD0B8] rounded-xl px-4 py-2.5 text-sm focus:outline-none">
                    <option value="">Select…</option>
                    {EDUCATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#6B3F1F] mb-1.5">Years of Experience</label>
                  <select value={form.experience_band} onChange={e => setForm(f => ({ ...f, experience_band: e.target.value }))}
                    required className="w-full border border-[#DDD0B8] rounded-xl px-4 py-2.5 text-sm focus:outline-none">
                    <option value="">Select…</option>
                    {EXPERIENCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#6B3F1F] mb-1.5">Support Approach</label>
                  {SUPPORT_METHODS.map(m => (
                    <label key={m.value} className="flex items-center gap-3 p-2 cursor-pointer">
                      <input type="radio" name="support_method" value={m.value}
                        checked={form.support_method === m.value}
                        onChange={() => setForm(f => ({ ...f, support_method: m.value }))} />
                      <span className="text-sm text-[#6B3F1F]">{m.label}</span>
                    </label>
                  ))}
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#6B3F1F] mb-1.5">Organisation (optional)</label>
                  <input value={form.organisation_name} onChange={e => setForm(f => ({ ...f, organisation_name: e.target.value }))}
                    placeholder="University, Research Institute, NGO…"
                    className="w-full border border-[#DDD0B8] rounded-xl px-4 py-2.5 text-sm focus:outline-none" />
                </div>
              </div>
              <button type="button" onClick={() => setStep(2)}
                disabled={!form.education || !form.experience_band || !form.support_method || !form.email}
                className="w-full py-3.5 rounded-2xl text-white font-semibold disabled:opacity-50"
                style={{ background: COLOUR }}>
                Next →
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-bold text-[#6B3F1F]">Expertise & Crops</h2>
                <p className="text-[#7A8C7E] text-sm">What are you expert in?</p>
              </div>
              <div className="bg-white rounded-2xl p-5 border border-[#DDD0B8] space-y-4">
                <div>
                  <p className="text-sm font-medium text-[#6B3F1F] mb-3">Expertise Domains</p>
                  <div className="space-y-2">
                    {EXPERTISE_DOMAINS.map(d => (
                      <label key={d} className="flex items-center gap-3 p-2 rounded-xl hover:bg-[#F5F0E8] cursor-pointer">
                        <input type="checkbox" checked={form.expertise_domains.includes(d)}
                          onChange={() => toggle('expertise_domains', d)} className="w-4 h-4 rounded" />
                        <span className="text-sm text-[#6B3F1F] capitalize">{d.replace(/_/g, ' ')}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-[#6B3F1F] mb-3">Crop Groups of Interest</p>
                  <div className="flex flex-wrap gap-2">
                    {CROP_GROUPS.map(cg => (
                      <button key={cg} type="button" onClick={() => toggle('crop_groups', cg)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${form.crop_groups.includes(cg) ? 'text-white border-transparent' : 'border-[#DDD0B8] text-[#6B3F1F]'}`}
                        style={form.crop_groups.includes(cg) ? { background: COLOUR } : {}}>
                        {cg.replace(/_/g, ' ')}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(1)}
                  className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] font-medium py-3.5 rounded-2xl text-sm">← Back</button>
                <button type="button" onClick={() => setStep(3)}
                  className="flex-1 text-white font-semibold py-3.5 rounded-2xl"
                  style={{ background: COLOUR }}>Next →</button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-bold text-[#6B3F1F]">Languages & Area</h2>
                <p className="text-[#7A8C7E] text-sm">Where and how do you communicate?</p>
              </div>
              <div className="bg-white rounded-2xl p-5 border border-[#DDD0B8] space-y-4">
                <div>
                  <p className="text-sm font-medium text-[#6B3F1F] mb-3">Languages (select all you can advise in)</p>
                  <div className="flex flex-wrap gap-2">
                    {LANGUAGES.map(l => (
                      <button key={l.code} type="button" onClick={() => toggle('languages', l.code)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${form.languages.includes(l.code) ? 'text-white border-transparent' : 'border-[#DDD0B8] text-[#6B3F1F]'}`}
                        style={form.languages.includes(l.code) ? { background: COLOUR } : {}}>
                        {l.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-[#6B3F1F] mb-3">Support Area (State/District Cosh IDs)</p>
                  {form.support_areas.map((area, idx) => (
                    <div key={idx} className="flex gap-2 mb-2">
                      <input value={area.state_cosh_id}
                        onChange={e => setForm(f => {
                          const areas = [...f.support_areas]
                          areas[idx] = { ...areas[idx], state_cosh_id: e.target.value }
                          return { ...f, support_areas: areas }
                        })}
                        placeholder="state_karnataka"
                        className="flex-1 border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm font-mono focus:outline-none" />
                      <input value={area.district_cosh_id}
                        onChange={e => setForm(f => {
                          const areas = [...f.support_areas]
                          areas[idx] = { ...areas[idx], district_cosh_id: e.target.value }
                          return { ...f, support_areas: areas }
                        })}
                        placeholder="district_mysuru (optional)"
                        className="flex-1 border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm font-mono focus:outline-none" />
                    </div>
                  ))}
                  <button type="button"
                    onClick={() => setForm(f => ({ ...f, support_areas: [...f.support_areas, { state_cosh_id: '', district_cosh_id: '' }] }))}
                    className="text-xs font-medium" style={{ color: COLOUR }}>
                    + Add another area
                  </button>
                </div>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(2)}
                  className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] font-medium py-3.5 rounded-2xl text-sm">← Back</button>
                <button type="button" onClick={() => setStep(4)}
                  className="flex-1 text-white font-semibold py-3.5 rounded-2xl"
                  style={{ background: COLOUR }}>Next →</button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-bold text-[#6B3F1F]">Declaration</h2>
                <p className="text-[#7A8C7E] text-sm">Almost done</p>
              </div>
              <div className="bg-white rounded-2xl p-5 border border-[#DDD0B8] space-y-4 text-sm text-[#6B3F1F] leading-relaxed">
                <p>By registering as a FarmPundit on RootsTalk, I declare that:</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>All information provided is accurate and truthful</li>
                  <li>I have the qualifications and experience claimed in my profile</li>
                  <li>I will respond to assigned queries within the 7-day window to the best of my ability</li>
                  <li>I will provide advice that is in the best interest of farmers</li>
                  <li>I will not use this platform for commercial promotion of specific brands unless disclosed</li>
                </ul>
                <label className="flex items-start gap-3 pt-2 cursor-pointer">
                  <input type="checkbox" checked={form.declaration_accepted}
                    onChange={e => setForm(f => ({ ...f, declaration_accepted: e.target.checked }))}
                    className="w-5 h-5 rounded mt-0.5" />
                  <span className="font-medium text-[#6B3F1F]">I accept and agree to the above declaration</span>
                </label>
              </div>
              {error && <p className="text-sm text-[#D4682E] bg-red-50 px-4 py-2 rounded-xl">{error}</p>}
              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(3)}
                  className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] font-medium py-3.5 rounded-2xl text-sm">← Back</button>
                <button type="submit" disabled={!form.declaration_accepted || submitting}
                  className="flex-1 text-white font-semibold py-3.5 rounded-2xl disabled:opacity-50"
                  style={{ background: COLOUR }}>
                  {submitting ? 'Registering…' : 'Complete Registration'}
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
