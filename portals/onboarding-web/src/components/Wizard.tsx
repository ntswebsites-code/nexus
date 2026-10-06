'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  clearSession,
  loadSession,
  OnboardingApiError,
  navigateTo,
  saveSession,
  type ApplicationView,
  type EvidenceRow,
  type Meta,
  type Owner,
  type Person,
  type ReadinessView,
  type SavePayload,
  type Session,
} from '@/lib/api';
import {
  BANK_FIELDS,
  DECLARATIONS,
  DECLARATION_OPTIONS,
  DEFAULT_FORM,
  INVESTOR_FIELDS,
  isEntity,
  holderMatches,
  KYC_FIELDS,
  OWNERSHIP_NARRATIVES,
  STEP_HELP,
  STEPS,
  TAX_FIELDS,
  type Field,
} from '@/lib/fields';
import { Alert, FieldInput, Shell } from './ui';
import { EvidenceCard } from './EvidenceCard';
import { ReadinessPanel } from './ReadinessPanel';

const FALLBACK_TYPES = ['Institutional investor', 'Pension / provident fund', 'Corporate treasury', 'Investment company / family office', 'Trust / foundation', 'Fund / collective investment vehicle', 'Individual / HNW'];
const CONSENT =
  'I confirm that I am authorised to submit this application, the information is accurate to the best of my knowledge, and Matanho / the investment manager may verify identity, ownership, source of funds, source of wealth, tax status, sanctions, PEP and adverse-media information for KYC/AML purposes. I understand that automated checks support the review but do not make the final client-acceptance decision.';

const blankOwner = (): Owner => ({ name: '', nationality: '', id: '', pct: '' });
const blankPerson = (): Person => ({ name: '', role: '', email: '' });

type Errors = Record<string, string>;
type Phase = 'loading' | 'start' | 'wizard' | 'done' | 'error';

export function Wizard() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Record<string, string>>(DEFAULT_FORM);
  const [owners, setOwners] = useState<Owner[]>([blankOwner()]);
  const [signatories, setSignatories] = useState<Person[]>([blankPerson()]);
  const [directors, setDirectors] = useState<Person[]>([blankPerson()]);
  const [evidence, setEvidence] = useState<EvidenceRow[]>([]);
  const [onFile, setOnFile] = useState({ taxId: false, bankAccount: false });
  const [errors, setErrors] = useState<Errors>({});
  const [banner, setBanner] = useState<{ kind: 'error' | 'ok' | 'info'; text: string } | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty' | 'failed'>('saved');
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ref, setRef] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<ReadinessView | null>(null);
  const [submitReadiness, setSubmitReadiness] = useState<{ score: number; riskBand: string } | null>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const entity = isEntity(form.investorType ?? '');
  const types = meta?.investorTypes.map((t) => t.value) ?? FALLBACK_TYPES;
  const required = useMemo(() => meta?.investorTypes.find((t) => t.value === form.investorType)?.requiredSlots ?? [], [meta, form.investorType]);
  const slotLabel = useCallback((k: string) => meta?.slots.find((s) => s.key === k)?.label ?? k, [meta]);

  const hydrate = useCallback((a: ApplicationView) => {
    setForm({ ...DEFAULT_FORM, ...a.form, primaryEmail: a.form.primaryEmail || a.email });
    setOwners(a.ownerDetails.length ? a.ownerDetails : [blankOwner()]);
    setSignatories(a.signatories.length ? a.signatories : [blankPerson()]);
    setDirectors(a.directors.length ? a.directors : [blankPerson()]);
    setEvidence(a.evidence);
    setOnFile({ taxId: a.taxIdOnFile, bankAccount: a.bankAccountOnFile });
  }, []);

  // Boot: legacy ?resume=<id>.<token> links, then the stored session.
  useEffect(() => {
    let alive = true;
    (async () => {
      const q = new URLSearchParams(window.location.search).get('resume');
      if (q && q.includes('.')) {
        const [id, token] = [q.slice(0, q.indexOf('.')), q.slice(q.indexOf('.') + 1)];
        saveSession({ id, token });
        window.history.replaceState(null, '', '/');
      }
      api.meta().then((m) => alive && setMeta(m)).catch(() => undefined);
      const s = loadSession();
      if (!s) return alive && setPhase('start');
      try {
        const a = await api.get(s.id, s.token);
        if (!alive) return;
        if (a.status !== 'Draft') {
          navigateTo('/status');
          return;
        }
        setSession(s);
        hydrate(a);
        setPhase('wizard');
        void api.readiness(s.id, s.token).then(setReadiness).catch(() => undefined);
      } catch (e) {
        if (!alive) return;
        if (e instanceof OnboardingApiError && e.status === 404) {
          clearSession();
          setPhase('start');
          setBanner({ kind: 'info', text: 'That draft link has expired. Start again or request a new link by email.' });
        } else setPhase('error');
      }
    })();
    return () => {
      alive = false;
    };
  }, [hydrate]);

  const payload = useCallback((): SavePayload => ({ form, owners: owners.filter((o) => o.name.trim()), signatories: signatories.filter((s) => s.name.trim()), directors: directors.filter((s) => s.name.trim()) }), [form, owners, signatories, directors]);

  const save = useCallback(async () => {
    if (!session) return false;
    setSaveState('saving');
    try {
      await api.save(session.id, session.token, payload());
      dirty.current = false;
      setSaveState('saved');
      return true;
    } catch (e) {
      setSaveState('failed');
      if (e instanceof OnboardingApiError && e.status === 409) navigateTo('/status');
      return false;
    }
  }, [session, payload]);

  // Debounced autosave (1 s) on any change after load.
  const touch = useCallback(() => {
    dirty.current = true;
    setSaveState('dirty');
  }, []);

  const refreshReadiness = useCallback(async () => {
    if (!session) return;
    try {
      const r = await api.readiness(session.id, session.token);
      setReadiness(r);
    } catch {
      /* panel degrades gracefully when readiness is unavailable */
    }
  }, [session]);
  useEffect(() => {
    if (phase !== 'wizard' || !dirty.current) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 1000);
    return () => clearTimeout(timer.current);
  }, [form, owners, signatories, directors, phase, save]);

  const setField = (k: string, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => (e[k] ? { ...e, [k]: '' } : e));
    touch();
  };

  // ------------------------------------------------------------ validation (per step)
  function validate(stepKey: string): Errors {
    const e: Errors = {};
    const need = (fields: Field[]) =>
      fields.forEach((f) => {
        if (f.entityOnly && !entity) return;
        const v = (form[f.key] ?? '').trim();
        const stored = (f.key === 'taxId' && onFile.taxId) || (f.key === 'bankAccount' && onFile.bankAccount);
        if (f.required && !v && !stored) e[f.key] = `${f.label} is required`;
        if (f.type === 'email' && v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) e[f.key] = 'Enter a valid email address';
        if (f.type === 'number' && v && (!/^\d+(\.\d+)?$/.test(v) || Number(v) < 0)) e[f.key] = 'Enter an amount of zero or more';
        if (f.key === 'swift' && v && !/^[A-Za-z]{4}[A-Za-z]{2}[A-Za-z0-9]{2}([A-Za-z0-9]{3})?$/.test(v)) e[f.key] = 'SWIFT / BIC must be 8 or 11 characters';
        if (f.key === 'bankAccount' && v && !/^(?=.*\d)[A-Za-z0-9 -]{4,40}$/.test(v)) e[f.key] = 'Enter a valid account number or IBAN';
        if (f.type === 'url' && v && !/^https?:\/\//i.test(v)) e[f.key] = 'Start with http:// or https://';
      });
    if (stepKey === 'investor') need(INVESTOR_FIELDS);
    if (stepKey === 'kyc') need(KYC_FIELDS);
    if (stepKey === 'tax') {
      need([...TAX_FIELDS, ...BANK_FIELDS]);
    }
    if (stepKey === 'ownership') {
      const named = owners.filter((o) => o.name.trim());
      if (!named.length) e.owners = 'Add at least one beneficial owner or controller';
      const total = named.reduce((t, o) => t + (Number(o.pct) || 0), 0);
      if (total > 100.01) e.owners = `Ownership adds up to ${total}%, which is over 100%`;
      if (named.some((o) => o.pct !== '' && (Number(o.pct) < 0 || Number(o.pct) > 100 || Number.isNaN(Number(o.pct))))) e.owners = 'Ownership % must be between 0 and 100';
      if (!signatories.some((s) => s.name.trim())) e.signatories = 'Add at least one authorised signatory';
      if (entity && !directors.some((s) => s.name.trim())) e.directors = 'Add at least one director, trustee or governing person';
      [...signatories, ...directors].forEach((p) => {
        if (p.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) e.people = `"${p.email}" is not a valid email address`;
      });
    }
    if (stepKey === 'evidence') {
      const have = new Set(evidence.filter((r) => r.name).map((r) => r.slot));
      const missing = required.filter((s) => !have.has(s));
      if (missing.length) e.evidence = `Still required: ${missing.map(slotLabel).join(', ')}`;
    }
    if (stepKey === 'review') {
      if (!(form.signatureName ?? '').trim()) e.signatureName = 'Signatory name is required';
      if (!(form.signatureCapacity ?? '').trim()) e.signatureCapacity = 'Capacity / title is required';
      if (!consent) e.consent = 'Tick the declaration to submit';
    }
    return e;
  }

  function go(target: number) {
    if (target > step) {
      for (let i = step; i < target; i++) {
        const e = validate(STEPS[i]!.key);
        if (Object.keys(e).length) {
          setStep(i);
          setErrors(e);
          setBanner({ kind: 'error', text: Object.values(e)[0]! });
          focusFirst(e);
          return;
        }
      }
    }
    setErrors({});
    setBanner(null);
    setStep(target);
    void save();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function focusFirst(e: Errors) {
    const k = Object.keys(e)[0];
    if (k) setTimeout(() => document.getElementById(`f-${k}`)?.focus(), 30);
  }

  async function start(email: string, name: string, type: string) {
    setBanner(null);
    try {
      const r = await api.create({ email, applicantType: type, name: name || undefined });
      const s = { id: r.id, token: r.token };
      saveSession(s);
      setSession(s);
      setForm({ ...DEFAULT_FORM, investorType: type, legalName: name, primaryEmail: email });
      dirty.current = true;
      setPhase('wizard');
      void api.readiness(s.id, s.token).then(setReadiness).catch(() => undefined);
      setBanner({ kind: 'ok', text: `Draft saved. We emailed a private link to ${email} so you can continue on any device.` });
    } catch (e) {
      setBanner({ kind: 'error', text: e instanceof OnboardingApiError ? e.message : 'Could not start the application.' });
    }
  }

  async function refreshEvidence() {
    if (!session) return;
    try {
      const a = await api.get(session.id, session.token);
      setEvidence(a.evidence);
      setErrors((e) => ({ ...e, evidence: '' }));
      await refreshReadiness();
    } catch {
      /* next autosave surfaces connectivity problems */
    }
  }

  async function submit() {
    if (!session) return;
    const e = validate('review');
    if (Object.keys(e).length) {
      setErrors(e);
      setBanner({ kind: 'error', text: Object.values(e)[0]! });
      focusFirst(e);
      return;
    }
    setSubmitting(true);
    setBanner(null);
    try {
      const r = await api.submit(session.id, session.token, payload());
      setRef(r.ref);
      if (r.readiness) setSubmitReadiness(r.readiness);
      setPhase('done');
    } catch (err) {
      if (err instanceof OnboardingApiError && err.code === 'incomplete_application') {
        const d = err.details as { fields?: string[]; evidence?: string[] } | undefined;
        setBanner({ kind: 'error', text: `Complete before submitting: ${[...(d?.fields ?? []), ...(d?.evidence ?? [])].join('; ')}` });
      } else setBanner({ kind: 'error', text: err instanceof OnboardingApiError ? err.message : 'Submission failed.' });
    } finally {
      setSubmitting(false);
    }
  }

  // ------------------------------------------------------------ views
  if (phase === 'loading') return <Shell><p className="muted pad">Loading your application...</p></Shell>;
  if (phase === 'error') return <Shell><Alert kind="error">We could not load your application. Check your connection and refresh.</Alert></Shell>;
  if (phase === 'start') return <Shell pill="Institutional investor onboarding"><Start types={types} banner={banner} onStart={start} /></Shell>;
  if (phase === 'done')
    return (
      <Shell>
        <section className="card success">
          <div className="eyebrow">Application received</div>
          <h1>Thank you. Your application is with us.</h1>
          <p className="muted">Your reference is</p>
          <p className="ref">{ref}</p>
          <p className="muted">A confirmation email is on its way. Our Compliance team reviews every application; they may ask for more information, and you can follow progress at any time.</p>
          {submitReadiness ? (
            <p className="muted" data-testid="submit-readiness">Submission readiness: {submitReadiness.score}% · {submitReadiness.riskBand} review risk</p>
          ) : null}
          <a className="btn accent" href="/status">Track my application</a>
        </section>
      </Shell>
    );

  const [title, help] = STEP_HELP[STEPS[step]!.key];
  const pct = Math.round(((step + 1) / STEPS.length) * 100);
  const key = STEPS[step]!.key;
  // A bank-holder name that differs from the legal name is advisory only (Compliance reviews it): it never blocks Continue.
  const holderWarning = !errors.bankHolder && (form.bankHolder ?? '').trim() && !holderMatches(form.legalName ?? '', form.bankHolder ?? '') ? 'Account holder should match the legal name; Compliance will review a mismatch.' : undefined;
  const field = (f: Field, extra?: { onFile?: boolean }) =>
    f.entityOnly && !entity ? null : <FieldInput key={f.key} field={f} value={form[f.key] ?? ''} error={errors[f.key]} warning={f.key === 'bankHolder' ? holderWarning : undefined} onChange={(v) => setField(f.key, v)} onFile={extra?.onFile} />;
  const doneSlots = evidence.filter((r) => r.name).length;

  return (
    <Shell pill="Institutional investor onboarding">
      <section className="hero">
        <div>
          <div className="eyebrow">Investor / LP application</div>
          <h1>One application. One verified investor record.</h1>
        </div>
        <div className="hero-state">
          <div><span>Draft</span><strong>{saveState === 'saving' ? 'Saving...' : saveState === 'failed' ? 'Not saved' : saveState === 'dirty' ? 'Unsaved changes' : 'Saved'}</strong><small>Resume link emailed</small></div>
          <div><span>Evidence</span><strong>{doneSlots} uploaded</strong><small>{required.length} required</small></div>
          <div><span>Decision</span><strong>Human controlled</strong><small>Compliance decides</small></div>
        </div>
      </section>
      <div className="grid wizard-grid">
        <nav className="rail" aria-label="Application steps">
          {STEPS.map((s, i) => (
            <button key={s.key} type="button" className={i === step ? 'active' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined} onClick={() => go(i)}>
              <b>{i < step ? '✓' : i + 1}</b>
              <span>{s.title}<small>{s.sub}</small></span>
            </button>
          ))}
        </nav>
        <section className="card">
          <header className="card-head">
            <div>
              <div className="eyebrow">Step {step + 1} of {STEPS.length}</div>
              <h2>{title}</h2>
              <p className="muted">{help}</p>
            </div>
            <div className="progress"><span>{pct}% complete</span><div className="track"><i style={{ width: `${pct}%` }} /></div></div>
          </header>
          {banner ? <Alert kind={banner.kind}>{banner.text}</Alert> : null}
          <form onSubmit={(e) => { e.preventDefault(); if (key === 'review') void submit(); else go(step + 1); }} noValidate>
            {key === 'investor' ? (
              <div className="fields">
                <label className="field"><span>Investor type</span>
                  <select id="f-investorType" value={form.investorType} onChange={(e) => setField('investorType', e.target.value)}>
                    {types.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </label>
                {INVESTOR_FIELDS.map((f) => field(f))}
              </div>
            ) : null}

            {key === 'ownership' ? (
              <>
                <RepeaterTitle title="Beneficial owners and controllers" help="Natural persons who ultimately own or control the investor." add="Add owner / controller" onAdd={() => { setOwners([...owners, blankOwner()]); touch(); }} />
                {errors.owners ? <p className="err" role="alert">{errors.owners}</p> : null}
                {owners.map((o, i) => (
                  <div className="row owner" key={i}>
                    <input aria-label="Full name" placeholder="Full name" value={o.name} onChange={(e) => { setOwners(owners.map((x, j) => (j === i ? { ...x, name: e.target.value } : x))); touch(); }} />
                    <input aria-label="Nationality" placeholder="Nationality" value={o.nationality} onChange={(e) => { setOwners(owners.map((x, j) => (j === i ? { ...x, nationality: e.target.value } : x))); touch(); }} />
                    <input aria-label="ID / passport number" placeholder="ID / passport (blank keeps stored)" value={o.id} onChange={(e) => { setOwners(owners.map((x, j) => (j === i ? { ...x, id: e.target.value } : x))); touch(); }} />
                    <input aria-label="Ownership percent" inputMode="decimal" placeholder="Ownership %" value={o.pct} onChange={(e) => { setOwners(owners.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x))); touch(); }} />
                    <button type="button" className="btn ghost" aria-label="Remove owner" onClick={() => { setOwners(owners.length > 1 ? owners.filter((_, j) => j !== i) : [blankOwner()]); touch(); }}>Remove</button>
                  </div>
                ))}
                {entity ? (
                  <PeopleList title="Directors, trustees and governing persons" help="Everyone on the board or governing body of the entity." list={directors} set={(l) => { setDirectors(l); touch(); }} error={errors.directors} add="Add director" roleHint="Role (Director, Trustee...)" />
                ) : null}
                <PeopleList title="Authorised signatories" help="People permitted to instruct or sign for this relationship." list={signatories} set={(l) => { setSignatories(l); touch(); }} error={errors.signatories} add="Add signatory" roleHint="Role / title" />
                {errors.people ? <p className="err">{errors.people}</p> : null}
                {entity ? <div className="fields">{OWNERSHIP_NARRATIVES.map((f) => field(f))}</div> : null}
              </>
            ) : null}

            {key === 'kyc' ? (
              <>
                <div className="declarations">
                  {DECLARATIONS.map((d) => (
                    <div className="declaration" key={d.key}>
                      <div><strong>{d.title}</strong><small>{d.help}</small></div>
                      <select aria-label={d.title} value={form[d.key] ?? 'no'} onChange={(e) => setField(d.key, e.target.value)}>
                        {DECLARATION_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                <div className="fields">{KYC_FIELDS.map((f) => field(f))}</div>
              </>
            ) : null}

            {key === 'tax' ? (
              <>
                <h3>Tax</h3>
                <div className="fields">{TAX_FIELDS.map((f) => field(f, { onFile: f.key === 'taxId' && onFile.taxId && !form.taxId }))}</div>
                <h3>Funding account</h3>
                <div className="fields">{BANK_FIELDS.map((f) => field(f, { onFile: f.key === 'bankAccount' && onFile.bankAccount && !form.bankAccount }))}</div>
              </>
            ) : null}

            {key === 'evidence' && session ? (
              <>
                {errors.evidence ? <Alert kind="error">{errors.evidence}</Alert> : null}
                <div className="docs">
                  {(meta?.slots ?? []).filter((s) => required.includes(s.key) || ['doc8', 'doc11'].includes(s.key)).map((s) => (
                    <EvidenceCard key={s.key} slot={s.key} label={s.label} required={required.includes(s.key)} row={evidence.find((r) => r.slot === s.key)} session={session} maxMb={meta?.maxUploadMb ?? 10} accept={meta?.acceptedFileTypes ?? ['application/pdf', 'image/png', 'image/jpeg']} onUploaded={refreshEvidence} />
                  ))}
                </div>
                {!meta ? <p className="muted">Loading document list...</p> : null}
                <div className="fields">
                  <FieldInput field={{ key: 'evidenceNote', label: 'Additional evidence / explanation', hint: 'optional', type: 'textarea', wide: true }} value={form.evidenceNote ?? ''} onChange={(v) => setField('evidenceNote', v)} />
                  <FieldInput field={{ key: 'complianceContact', label: 'Compliance contact', hint: 'optional', type: 'textarea', wide: true }} value={form.complianceContact ?? ''} onChange={(v) => setField('complianceContact', v)} />
                </div>
              </>
            ) : null}

            {key === 'review' ? (
              <>
                <Summary form={form} owners={owners} directors={directors} signatories={signatories} evidence={evidence} required={required} slotLabel={slotLabel} entity={entity} />
                <div className="fields">
                  <FieldInput field={{ key: 'signatureName', label: 'Authorised signatory name', required: true }} value={form.signatureName ?? ''} error={errors.signatureName} onChange={(v) => setField('signatureName', v)} />
                  <FieldInput field={{ key: 'signatureCapacity', label: 'Capacity / title', required: true, placeholder: 'e.g. Trustee, Director, CIO' }} value={form.signatureCapacity ?? ''} error={errors.signatureCapacity} onChange={(v) => setField('signatureCapacity', v)} />
                </div>
                <label className={`consent${errors.consent ? ' has-error' : ''}`}>
                  <input id="f-consent" type="checkbox" checked={consent} onChange={(e) => { setConsent(e.target.checked); setErrors((x) => ({ ...x, consent: '' })); }} />
                  <span>{CONSENT}</span>
                </label>
                {errors.consent ? <p className="err">{errors.consent}</p> : null}
              </>
            ) : null}

            <div className="actions">
              <button type="button" className="btn ghost" disabled={step === 0} onClick={() => go(step - 1)}>Back</button>
              <div>
                <button type="button" className="btn" onClick={async () => { const ok = await save(); setBanner(ok ? { kind: 'ok', text: 'Draft saved.' } : { kind: 'error', text: 'Draft not saved. Check your connection and retry.' }); }}>Save draft</button>
                {key === 'review' ? (
                  <button type="submit" className="btn accent" disabled={submitting}>{submitting ? 'Submitting...' : 'Submit application'}</button>
                ) : (
                  <button type="submit" className="btn accent">Continue</button>
                )}
              </div>
            </div>
          </form>
        </section>
        {session ? <ReadinessPanel session={session} readiness={readiness} onRefresh={refreshReadiness} /> : null}
      </div>
    </Shell>
  );
}

function Start({ types, banner, onStart }: { types: string[]; banner: { kind: 'error' | 'ok' | 'info'; text: string } | null; onStart: (email: string, name: string, type: string) => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState(types[0] ?? 'Institutional investor');
  const [busy, setBusy] = useState(false);
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  return (
    <section className="hero single">
      <div className="card start">
        <div className="eyebrow">Investor / LP application</div>
        <h1>Apply to invest with Matanho</h1>
        <p className="muted">Start with your email. We save your draft as you go and send a private link so you can continue on any device.</p>
        {banner ? <Alert kind={banner.kind}>{banner.text}</Alert> : null}
        <form onSubmit={async (e) => { e.preventDefault(); if (!valid) return; setBusy(true); await onStart(email.trim(), name.trim(), type); setBusy(false); }}>
          <div className="fields one">
            <label className="field"><span>Investor type</span><select value={type} onChange={(e) => setType(e.target.value)}>{types.map((t) => <option key={t}>{t}</option>)}</select></label>
            <label className="field"><span>Legal name <em>optional now</em></span><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="organization" /></label>
            <label className="field"><span>Contact email <b aria-hidden>*</b></span><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
          </div>
          <div className="actions">
            <a className="btn ghost" href="/resume">Resume an application</a>
            <button className="btn accent" disabled={!valid || busy}>{busy ? 'Starting...' : 'Start application'}</button>
          </div>
        </form>
      </div>
    </section>
  );
}

function RepeaterTitle({ title, help, add, onAdd }: { title: string; help: string; add: string; onAdd: () => void }) {
  return (
    <div className="section-title">
      <div><h3>{title}</h3><p className="muted">{help}</p></div>
      <button type="button" className="btn small" onClick={onAdd}>+ {add}</button>
    </div>
  );
}

function PeopleList({ title, help, list, set, add, error, roleHint }: { title: string; help: string; list: Person[]; set: (l: Person[]) => void; add: string; error?: string; roleHint: string }) {
  const upd = (i: number, k: keyof Person, v: string) => set(list.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  return (
    <div className="people">
      <RepeaterTitle title={title} help={help} add={add} onAdd={() => set([...list, blankPerson()])} />
      {error ? <p className="err" role="alert">{error}</p> : null}
      {list.map((p, i) => (
        <div className="row person" key={i}>
          <input aria-label="Full name" placeholder="Full name" value={p.name} onChange={(e) => upd(i, 'name', e.target.value)} />
          <input aria-label="Role" placeholder={roleHint} value={p.role} onChange={(e) => upd(i, 'role', e.target.value)} />
          <input aria-label="Email" type="email" placeholder="Email" value={p.email} onChange={(e) => upd(i, 'email', e.target.value)} />
          <button type="button" className="btn ghost" aria-label={`Remove ${title}`} onClick={() => set(list.length > 1 ? list.filter((_, j) => j !== i) : [blankPerson()])}>Remove</button>
        </div>
      ))}
    </div>
  );
}

function Summary({ form, owners, directors, signatories, evidence, required, slotLabel, entity }: { form: Record<string, string>; owners: Owner[]; directors: Person[]; signatories: Person[]; evidence: EvidenceRow[]; required: string[]; slotLabel: (k: string) => string; entity: boolean }) {
  const have = new Set(evidence.filter((r) => r.name).map((r) => r.slot));
  const rows: [string, string][] = [
    ['Investor', `${form.legalName || '-'} (${form.investorType})`],
    ['Registration', form.registrationRef || '-'],
    ['Jurisdiction', form.jurisdiction || '-'],
    ['Contact', `${form.primaryContact || '-'} · ${form.primaryEmail || '-'}`],
    ['Beneficial owners', owners.filter((o) => o.name.trim()).map((o) => `${o.name}${o.pct ? ` (${o.pct}%)` : ''}`).join(', ') || '-'],
    ...(entity ? ([['Directors', directors.filter((d) => d.name.trim()).map((d) => d.name).join(', ') || '-']] as [string, string][]) : []),
    ['Signatories', signatories.filter((d) => d.name.trim()).map((d) => d.name).join(', ') || '-'],
    ['Declarations', DECLARATIONS.map((d) => `${d.title.split(' (')[0]}: ${form[d.key] === 'no' ? 'No' : form[d.key] === 'yes' ? 'Yes' : 'Unsure'}`).join(' · ')],
    ['Tax residence', form.taxResidence || '-'],
    ['Funding account', `${form.bankName || '-'} · holder ${form.bankHolder || '-'}`],
    ['Required documents', required.length ? `${required.filter((s) => have.has(s)).length} of ${required.length} uploaded${required.some((s) => !have.has(s)) ? ` (missing: ${required.filter((s) => !have.has(s)).map(slotLabel).join(', ')})` : ''}` : '-'],
  ];
  return (
    <dl className="summary">
      {rows.map(([k, v]) => (
        <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
      ))}
    </dl>
  );
}
