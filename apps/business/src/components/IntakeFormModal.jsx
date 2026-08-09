import React, { useEffect, useState } from 'react';
import { formService } from '../services';

// Should a field show, given current answers and its showIf rule?
const fieldVisible = (field, answers) => {
    const cond = field.showIf;
    if (!cond || !cond.field) return true;
    const controlling = answers[cond.field];
    return String(controlling ?? '') === String(cond.equals ?? '');
};

const IntakeFormModal = ({ appointmentId, onClose, onCompleted }) => {
    const [forms, setForms] = useState([]); // [{ template, completed, submission }]
    const [activeIdx, setActiveIdx] = useState(0);
    const [answers, setAnswers] = useState({}); // label -> value
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let alive = true;
        formService.getFormsForAppointment(appointmentId)
            .then(res => {
                if (!alive) return;
                const data = res.data.data || [];
                setForms(data);
                const firstPending = data.findIndex(f => !f.completed);
                setActiveIdx(firstPending >= 0 ? firstPending : 0);
            })
            .catch(() => setError('Could not load forms.'))
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [appointmentId]);

    const active = forms[activeIdx];

    // Seed answers from an existing submission when switching forms
    useEffect(() => {
        if (!active) return;
        const seed = {};
        (active.submission?.answers || []).forEach(a => { seed[a.label] = a.value; });
        setAnswers(seed);
        setError('');
    }, [activeIdx, active]);

    const setAnswer = (label, value) => setAnswers(a => ({ ...a, [label]: value }));

    const submit = async () => {
        const template = active.template;
        // Client-side required validation (respecting visibility)
        for (const f of template.fields) {
            if (f.required && fieldVisible(f, answers)) {
                const v = answers[f.label];
                const empty = v === undefined || v === '' || v === null || (Array.isArray(v) && v.length === 0) || v === false;
                if (empty) { setError(`"${f.label}" is required`); return; }
            }
        }
        setSaving(true);
        setError('');
        try {
            const payload = {
                template: template._id,
                appointment: appointmentId,
                answers: template.fields
                    .filter(f => fieldVisible(f, answers))
                    .map(f => ({ label: f.label, value: answers[f.label] ?? '' })),
            };
            await formService.submitForm(payload);
            const updated = forms.map((fm, i) => i === activeIdx ? { ...fm, completed: true } : fm);
            setForms(updated);
            onCompleted && onCompleted();
            const nextPending = updated.findIndex(f => !f.completed);
            if (nextPending >= 0) setActiveIdx(nextPending);
            else onClose();
        } catch (err) {
            setError(err.response?.data?.message || 'Could not submit the form.');
        } finally {
            setSaving(false);
        }
    };

    const renderField = (f) => {
        if (!fieldVisible(f, answers)) return null;
        const v = answers[f.label];
        const common = { className: 'input', style: { fontSize: '0.9rem' } };
        return (
            <div key={f.label} style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.35rem' }}>
                    {f.label}{f.required && <span style={{ color: '#dc2626' }}> *</span>}
                </label>
                {f.type === 'textarea' && <textarea {...common} rows={3} value={v || ''} onChange={e => setAnswer(f.label, e.target.value)} style={{ ...common.style, resize: 'vertical' }} />}
                {f.type === 'text' && <input {...common} value={v || ''} onChange={e => setAnswer(f.label, e.target.value)} />}
                {f.type === 'number' && <input {...common} type="number" value={v || ''} onChange={e => setAnswer(f.label, e.target.value)} />}
                {f.type === 'date' && <input {...common} type="date" value={v || ''} onChange={e => setAnswer(f.label, e.target.value)} />}
                {f.type === 'select' && (
                    <select {...common} value={v || ''} onChange={e => setAnswer(f.label, e.target.value)}>
                        <option value="">Select…</option>
                        {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                )}
                {f.type === 'radio' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        {f.options.map(o => (
                            <label key={o} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                                <input type="radio" name={f.label} checked={v === o} onChange={() => setAnswer(f.label, o)} style={{ accentColor: 'var(--gold)' }} /> {o}
                            </label>
                        ))}
                    </div>
                )}
                {f.type === 'checkbox' && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                        <input type="checkbox" checked={!!v} onChange={e => setAnswer(f.label, e.target.checked)} style={{ accentColor: 'var(--gold)', width: '18px', height: '18px' }} /> I agree / confirm
                    </label>
                )}
            </div>
        );
    };

    return (
        <>
            <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1100 }} />
            <div className="modal-center" style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: '480px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', background: 'var(--card-bg)', borderRadius: 'var(--radius)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', zIndex: 1101 }}>
                <div style={{ background: 'var(--ink)', padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0 }}>
                    <h2 style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)', fontSize: '1.2rem', fontWeight: '700', margin: 0 }}>{active?.template?.title || 'Forms'}</h2>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: '1.5rem', lineHeight: 1 }}>×</button>
                </div>
                <div style={{ padding: '1.5rem' }}>
                    {loading ? (
                        <div style={{ textAlign: 'center', padding: '2rem' }}>
                            <div style={{ width: '32px', height: '32px', border: '3px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
                        </div>
                    ) : forms.length === 0 ? (
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '1rem' }}>No forms to complete for this appointment.</p>
                    ) : (
                        <>
                            {forms.length > 1 && (
                                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                                    {forms.map((fm, i) => (
                                        <button key={fm.template._id} onClick={() => setActiveIdx(i)} style={{
                                            padding: '0.3rem 0.75rem', borderRadius: '99px', border: '1.5px solid', borderColor: i === activeIdx ? 'var(--gold)' : 'var(--border)',
                                            background: i === activeIdx ? 'rgba(240,62,22,0.12)' : 'var(--card-bg)', color: i === activeIdx ? 'var(--gold-dark)' : 'var(--text-secondary)',
                                            fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'var(--font-body)',
                                        }}>{fm.completed ? '✓ ' : ''}{fm.template.title}</button>
                                    ))}
                                </div>
                            )}
                            {active?.template?.description && <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>{active.template.description}</p>}
                            {active?.completed && <p style={{ fontSize: '0.8rem', color: '#059669', marginBottom: '1rem' }}>✓ Already submitted — you can update your answers.</p>}
                            {active?.template?.fields.map(renderField)}
                            {error && <p style={{ color: '#dc2626', fontSize: '0.85rem', marginBottom: '0.75rem' }}>{error}</p>}
                            <button onClick={submit} disabled={saving} className="btn-primary" style={{ width: '100%', padding: '0.85rem', fontWeight: '700' }}>{saving ? 'Submitting…' : 'Submit form'}</button>
                        </>
                    )}
                </div>
            </div>
        </>
    );
};

export default IntakeFormModal;
