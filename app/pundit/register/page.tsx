'use client'
import { useState, useEffect, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'

// Every dropdown on this form binds to a Cosh `core_type` slug.
// One fetch per slug at mount time — all read-only catalogue
// lookups, so they share an effect.
const SLUGS = [
  'pundit_education',
  'pundit_experience',
  'pundit_farming_methods',
  'pundit_cultivation_types',
  'pundit_domain_expertise',
  'pundit_crop_groups',
  'pundit_languages',
  'pundit_organization_types',
] as const
type Slug = typeof SLUGS[number]

interface CoshOption { cosh_id: string; name: string }
interface CoshState { cosh_id: string; name: string | null }
interface CoshLocationsResponse { states: CoshState[] }

const COLOUR = '#3C3489'

export default function PunditRegisterPage() {
  const router = useRouter()
  const t = useTranslations('pundit.register')
  const [step, setStep] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Cosh-driven option lists, keyed by slug.
  const [options, setOptions] = useState<Record<Slug, CoshOption[]>>(() => {
    const seed = {} as Record<Slug, CoshOption[]>
    SLUGS.forEach(s => { seed[s] = [] })
    return seed
  })
  const [states, setStates] = useState<CoshOption[]>([])

  useEffect(() => {
    SLUGS.forEach(slug => {
      api.get<CoshOption[]>(`/cosh/pundit-options?slug=${slug}`)
        .then(r => setOptions(o => ({ ...o, [slug]: r.data })))
        .catch(() => { /* leave empty — form just shows no choices */ })
    })
    api.get<CoshLocationsResponse>('/cosh/locations/india')
      .then(r => setStates(
        (r.data.states || [])
          .filter(s => s.name)
          .map(s => ({ cosh_id: s.cosh_id, name: s.name! }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      ))
      .catch(() => {})
  }, [])

  const [form, setForm] = useState({
    email: '',
    education_cosh_id: '',
    experience_cosh_id: '',
    // Employment branch
    is_employed_by_organization: null as boolean | null,
    organisation_type_cosh_id: '',
    non_employed_kind: '' as '' | 'RETIRED' | 'EXPERIENCED_FARMER',
    declaration_accepted: false,
    // Multi-selects, cosh_id arrays
    farming_methods: [] as string[],
    cultivation_types: [] as string[],
    expertise_domains: [] as string[],
    crop_groups: [] as string[],
    languages: [] as string[],
    support_areas: [{ state_cosh_id: '' }],
  })

  function toggleMulti(
    field: 'farming_methods' | 'cultivation_types' | 'expertise_domains' | 'crop_groups' | 'languages',
    value: string,
  ) {
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
      setError(t('errorDeclaration'))
      return
    }
    setSubmitting(true); setError('')
    try {
      const payload = {
        email: form.email,
        education_cosh_id: form.education_cosh_id || null,
        experience_cosh_id: form.experience_cosh_id || null,
        is_employed_by_organization: form.is_employed_by_organization === true,
        organisation_type_cosh_id: form.is_employed_by_organization
          ? (form.organisation_type_cosh_id || null)
          : null,
        non_employed_kind: form.is_employed_by_organization
          ? null
          : (form.non_employed_kind || null),
        declaration_accepted: form.declaration_accepted,
        farming_methods: form.farming_methods,
        cultivation_types: form.cultivation_types,
        expertise_domains: form.expertise_domains,
        crop_groups: form.crop_groups,
        languages: form.languages,
        support_areas: form.support_areas
          .filter(a => a.state_cosh_id)
          .map(a => ({ state_cosh_id: a.state_cosh_id })),
      }
      await api.post('/pundit/profile', payload)
      router.replace('/pundit/home')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: { message?: string } | string } } })?.response?.data?.detail
      const text = typeof msg === 'string' ? msg : (msg?.message || t('errorDefault'))
      setError(text)
    } finally { setSubmitting(false) }
  }

  // ── Reusable bits ────────────────────────────────────────────────────────
  const StepDot = ({ n }: { n: number }) => (
    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${step >= n ? 'text-white' : 'bg-slate-100 text-[#7A8C7E]'}`}
      style={step >= n ? { background: COLOUR } : {}}>
      {n}
    </div>
  )

  function Chips({ items, picked, onToggle }: {
    items: CoshOption[]
    picked: string[]
    onToggle: (cosh_id: string) => void
  }) {
    return (
      <div className="flex flex-wrap gap-2">
        {items.map(o => {
          const on = picked.includes(o.cosh_id)
          return (
            <button key={o.cosh_id} type="button" onClick={() => onToggle(o.cosh_id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${on ? 'text-white border-transparent' : 'border-[#DDD0B8] text-[#6B3F1F]'}`}
              style={on ? { background: COLOUR } : {}}>
              {o.name}
            </button>
          )
        })}
        {items.length === 0 && (
          <p className="text-xs text-[#7A8C7E] italic">{t('chipsLoading')}</p>
        )}
      </div>
    )
  }

  const step1Ready =
    !!form.email && !!form.education_cosh_id && !!form.experience_cosh_id &&
    form.farming_methods.length > 0 && form.cultivation_types.length > 0 &&
    form.is_employed_by_organization !== null &&
    (
      form.is_employed_by_organization
        ? !!form.organisation_type_cosh_id
        : true   // non_employed_kind is optional per user direction
    )

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="FARMER" back />
      <div className="pt-16 pb-20 px-4">
        <div className="flex items-center gap-2 mt-4 mb-6 justify-center">
          {[1,2,3,4].map(n => (
            <div key={n} className="flex items-center gap-2">
              <StepDot n={n} />
              {n < 4 && <div className={`h-0.5 w-6 ${step > n ? 'bg-purple-700' : 'bg-slate-200'}`} />}
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          {/* ── Step 1 — Professional Profile ─────────────────────────── */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-bold text-[#6B3F1F]">{t('step1.title')}</h2>
                <p className="text-[#7A8C7E] text-sm mt-0.5">{t('step1.subtitle')}</p>
              </div>
              <div className="bg-white rounded-2xl p-5 border border-[#DDD0B8] space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#6B3F1F] mb-1.5">{t('step1.emailLabel')}</label>
                  <input type="email" value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    required placeholder={t('step1.emailPlaceholder')}
                    className="w-full border border-[#DDD0B8] rounded-xl px-4 py-2.5 text-sm focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#6B3F1F] mb-1.5">{t('step1.educationLabel')}</label>
                  <select value={form.education_cosh_id}
                    onChange={e => setForm(f => ({ ...f, education_cosh_id: e.target.value }))}
                    required className="w-full border border-[#DDD0B8] rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none">
                    <option value="">{t('step1.selectPlaceholder')}</option>
                    {options.pundit_education.map(o => <option key={o.cosh_id} value={o.cosh_id}>{o.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#6B3F1F] mb-1.5">{t('step1.experienceLabel')}</label>
                  <select value={form.experience_cosh_id}
                    onChange={e => setForm(f => ({ ...f, experience_cosh_id: e.target.value }))}
                    required className="w-full border border-[#DDD0B8] rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none">
                    <option value="">{t('step1.selectPlaceholder')}</option>
                    {options.pundit_experience.map(o => <option key={o.cosh_id} value={o.cosh_id}>{o.name}</option>)}
                  </select>
                </div>
                <div>
                  <p className="text-sm font-medium text-[#6B3F1F] mb-2">{t('step1.farmingMethodsLabel')}</p>
                  <Chips items={options.pundit_farming_methods}
                    picked={form.farming_methods}
                    onToggle={v => toggleMulti('farming_methods', v)} />
                </div>
                <div>
                  <p className="text-sm font-medium text-[#6B3F1F] mb-2">{t('step1.cultivationTypesLabel')}</p>
                  <Chips items={options.pundit_cultivation_types}
                    picked={form.cultivation_types}
                    onToggle={v => toggleMulti('cultivation_types', v)} />
                </div>

                {/* Employment branch */}
                <div className="border-t border-[#DDD0B8] pt-4">
                  <p className="text-sm font-medium text-[#6B3F1F] mb-2">{t('step1.employedTitle')}</p>
                  <div className="flex gap-3 mb-3">
                    <label className="flex-1 flex items-center gap-2 p-3 rounded-xl border border-[#DDD0B8] cursor-pointer"
                      style={form.is_employed_by_organization === true ? { borderColor: COLOUR, background: `${COLOUR}11` } : {}}>
                      <input type="radio" name="employed" checked={form.is_employed_by_organization === true}
                        onChange={() => setForm(f => ({ ...f, is_employed_by_organization: true, non_employed_kind: '' }))} />
                      <span className="text-sm text-[#6B3F1F]">{t('step1.yes')}</span>
                    </label>
                    <label className="flex-1 flex items-center gap-2 p-3 rounded-xl border border-[#DDD0B8] cursor-pointer"
                      style={form.is_employed_by_organization === false ? { borderColor: COLOUR, background: `${COLOUR}11` } : {}}>
                      <input type="radio" name="employed" checked={form.is_employed_by_organization === false}
                        onChange={() => setForm(f => ({ ...f, is_employed_by_organization: false, organisation_type_cosh_id: '' }))} />
                      <span className="text-sm text-[#6B3F1F]">{t('step1.no')}</span>
                    </label>
                  </div>

                  {form.is_employed_by_organization === true && (
                    <div>
                      <label className="block text-sm font-medium text-[#6B3F1F] mb-1.5">{t('step1.organisationTypeLabel')}</label>
                      <select value={form.organisation_type_cosh_id}
                        onChange={e => setForm(f => ({ ...f, organisation_type_cosh_id: e.target.value }))}
                        required className="w-full border border-[#DDD0B8] rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none">
                        <option value="">{t('step1.selectPlaceholder')}</option>
                        {options.pundit_organization_types.map(o => <option key={o.cosh_id} value={o.cosh_id}>{o.name}</option>)}
                      </select>
                    </div>
                  )}

                  {form.is_employed_by_organization === false && (
                    <div>
                      <p className="block text-sm font-medium text-[#6B3F1F] mb-1.5">{t('step1.nonEmployedTitle')}</p>
                      <div className="space-y-2">
                        {[
                          { value: 'RETIRED', label: t('step1.nonEmployedRetired') },
                          { value: 'EXPERIENCED_FARMER', label: t('step1.nonEmployedExperiencedFarmer') },
                        ].map(o => (
                          <label key={o.value}
                            className="flex items-center gap-3 p-2.5 rounded-xl border border-[#DDD0B8] cursor-pointer"
                            style={form.non_employed_kind === o.value ? { borderColor: COLOUR, background: `${COLOUR}11` } : {}}>
                            <input type="radio" name="non_employed_kind"
                              checked={form.non_employed_kind === o.value}
                              onChange={() => setForm(f => ({ ...f, non_employed_kind: o.value as 'RETIRED' | 'EXPERIENCED_FARMER' }))} />
                            <span className="text-sm text-[#6B3F1F]">{o.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <button type="button" onClick={() => setStep(2)} disabled={!step1Ready}
                className="w-full py-3.5 rounded-2xl text-white font-semibold disabled:opacity-50"
                style={{ background: COLOUR }}>
                {t('step1.nextCta')}
              </button>
            </div>
          )}

          {/* ── Step 2 — Expertise & Crops ────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-bold text-[#6B3F1F]">{t('step2.title')}</h2>
                <p className="text-[#7A8C7E] text-sm">{t('step2.subtitle')}</p>
              </div>
              <div className="bg-white rounded-2xl p-5 border border-[#DDD0B8] space-y-4">
                <div>
                  <p className="text-sm font-medium text-[#6B3F1F] mb-2">{t('step2.domainExpertiseLabel')}</p>
                  <Chips items={options.pundit_domain_expertise}
                    picked={form.expertise_domains}
                    onToggle={v => toggleMulti('expertise_domains', v)} />
                </div>
                <div>
                  <p className="text-sm font-medium text-[#6B3F1F] mb-2">{t('step2.cropGroupsLabel')}</p>
                  <Chips items={options.pundit_crop_groups}
                    picked={form.crop_groups}
                    onToggle={v => toggleMulti('crop_groups', v)} />
                </div>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(1)}
                  className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] font-medium py-3.5 rounded-2xl text-sm">{t('step2.backCta')}</button>
                <button type="button" onClick={() => setStep(3)}
                  disabled={form.expertise_domains.length === 0 || form.crop_groups.length === 0}
                  className="flex-1 text-white font-semibold py-3.5 rounded-2xl disabled:opacity-50"
                  style={{ background: COLOUR }}>{t('step2.nextCta')}</button>
              </div>
            </div>
          )}

          {/* ── Step 3 — Languages & Preferred States ─────────────────── */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-bold text-[#6B3F1F]">{t('step3.title')}</h2>
                <p className="text-[#7A8C7E] text-sm">{t('step3.subtitle')}</p>
              </div>
              <div className="bg-white rounded-2xl p-5 border border-[#DDD0B8] space-y-4">
                <div>
                  <p className="text-sm font-medium text-[#6B3F1F] mb-2">{t('step3.languagesLabel')}</p>
                  <Chips items={options.pundit_languages}
                    picked={form.languages}
                    onToggle={v => toggleMulti('languages', v)} />
                </div>
                <div>
                  <p className="text-sm font-medium text-[#6B3F1F] mb-3">{t('step3.preferredStatesLabel')}</p>
                  {form.support_areas.map((area, idx) => {
                    const otherPicks = new Set(
                      form.support_areas
                        .filter((_, i) => i !== idx)
                        .map(a => a.state_cosh_id)
                        .filter(Boolean),
                    )
                    const opts = states.filter(s =>
                      s.cosh_id === area.state_cosh_id || !otherPicks.has(s.cosh_id))
                    return (
                      <div key={idx} className="flex gap-2 mb-2">
                        <select value={area.state_cosh_id}
                          onChange={e => setForm(f => {
                            const areas = [...f.support_areas]
                            areas[idx] = { state_cosh_id: e.target.value }
                            return { ...f, support_areas: areas }
                          })}
                          className="flex-1 border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm focus:outline-none bg-white">
                          <option value="">{t('step3.selectStatePlaceholder')}</option>
                          {opts.map(s => (
                            <option key={s.cosh_id} value={s.cosh_id}>{s.name}</option>
                          ))}
                        </select>
                        {form.support_areas.length > 1 && (
                          <button type="button"
                            onClick={() => setForm(f => ({
                              ...f, support_areas: f.support_areas.filter((_, i) => i !== idx),
                            }))}
                            className="text-[#7A8C7E] text-xl px-2"
                            aria-label={t('step3.removeStateAria')}>
                            ×
                          </button>
                        )}
                      </div>
                    )
                  })}
                  <button type="button"
                    onClick={() => setForm(f => ({ ...f, support_areas: [...f.support_areas, { state_cosh_id: '' }] }))}
                    disabled={
                      form.support_areas.some(a => !a.state_cosh_id) ||
                      form.support_areas.length >= states.length
                    }
                    className="text-xs font-medium disabled:opacity-40" style={{ color: COLOUR }}>
                    {t('step3.addStateCta')}
                  </button>
                </div>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(2)}
                  className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] font-medium py-3.5 rounded-2xl text-sm">{t('step3.backCta')}</button>
                <button type="button" onClick={() => setStep(4)}
                  disabled={form.languages.length === 0 || !form.support_areas[0]?.state_cosh_id}
                  className="flex-1 text-white font-semibold py-3.5 rounded-2xl disabled:opacity-50"
                  style={{ background: COLOUR }}>{t('step3.nextCta')}</button>
              </div>
            </div>
          )}

          {/* ── Step 4 — Declaration ──────────────────────────────────── */}
          {step === 4 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-bold text-[#6B3F1F]">{t('step4.title')}</h2>
                <p className="text-[#7A8C7E] text-sm">{t('step4.subtitle')}</p>
              </div>
              <div className="bg-white rounded-2xl p-5 border border-[#DDD0B8] space-y-4 text-sm text-[#6B3F1F] leading-relaxed">
                <p>{t('step4.intro')}</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>{t('step4.bullet1')}</li>
                  <li>{t('step4.bullet2')}</li>
                  <li>{t('step4.bullet3')}</li>
                  <li>{t('step4.bullet4')}</li>
                  <li>{t('step4.bullet5')}</li>
                </ul>
                <label className="flex items-start gap-3 pt-2 cursor-pointer">
                  <input type="checkbox" checked={form.declaration_accepted}
                    onChange={e => setForm(f => ({ ...f, declaration_accepted: e.target.checked }))}
                    className="w-5 h-5 rounded mt-0.5" />
                  <span className="font-medium text-[#6B3F1F]">{t('step4.agree')}</span>
                </label>
              </div>
              {error && <p className="text-sm text-[#D4682E] bg-red-50 px-4 py-2 rounded-xl">{error}</p>}
              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(3)}
                  className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] font-medium py-3.5 rounded-2xl text-sm">{t('step4.backCta')}</button>
                <button type="submit" disabled={!form.declaration_accepted || submitting}
                  className="flex-1 text-white font-semibold py-3.5 rounded-2xl disabled:opacity-50"
                  style={{ background: COLOUR }}>
                  {submitting ? t('step4.submitBusy') : t('step4.submitIdle')}
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
