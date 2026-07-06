import React, { useEffect, useState } from 'react';
import { formService, providerServiceService } from '../services';

const FIELD_TYPES = [
    ['text', 'Short text'],
    ['textarea', 'Paragraph'],
    ['select', 'Dropdown'],
    ['radio', 'Single choice'],
    ['checkbox', 'Checkbox / consent'],
    ['date', 'Date'],
    ['number', 'Number'],
];

const KINDS = [
    ['intake', 'Intake'],
    ['consent', 'Consent'],
    ['consultation', 'Consultation'],
    ['feedback', 'Feedback'],
];

const blankField = () => ({ label: '', type: 'text', required: false, options: [], showIf: { field: '', equals: '' } });
const blankForm = () => ({ title: '', description: '', kind: 'intake', fields: [blankField()], services: [], isActive: true });

const labelStyle = { display: 'block', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.35rem' };

const FormsManager = () => {
    const [templates, setTemplates] = useState([]);
    const [services, setServices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(blankForm());
    const [saving, setSaving] = useState(false);

    const load = async () => {
        setLoading(true);
        setError('');
        try {
            const [t, s] = await Promise.all([
                formService.getMyTemplates(),
                providerServiceService.getMyServices(),
            ]);
            setTemplates(t.data.data || []);
            setServices(s.data.data || []);
        } catch {
            setError('Could not load forms.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const openCreate = () => { setEditing(null); setForm(blankForm()); setShowForm(true); };
    const openEdit = (t) => {
        setEditing(t);
        setForm({
            title: t.title, description: t.description || '', kind: t.kind || 'intake',
            fields: t.fields?.length ? t.fields.map(f => ({ ...f, showIf: f.showIf || { field: '', equals: '' } })) : [blankField()],
            services: (t.services || []).map(s => s._id || s),
            isActive: t.isActive !== false,
        });
        setShowForm(true);
    };

    const save = async (e) => {
        e.preventDefault();
        if (!form.title.trim()) { setError('Give the form a title.'); return; }
        setSaving(true);
        try {
            const payload = { ...form, fields: form.fields.filter(f => f.label.trim()) };
            if (editing) await formService.updateTemplate(editing._id, payload);
            else await formService.createTemplate(payload);
            setShowForm(false);
            await load();
        } catch {
            setError('Could not save the form.');
        } finally {
            setSaving(false);
        }
    };

    const remove = async (t) => {
        if (!window.confirm(`Delete "${t.title}"?`)) return;
        try { await formService.deleteTemplate(t._id); await load(); } catch { /* ignore */ }
    };

    const updateField = (idx, patch) => {
        setForm(f => ({ ...f, fields: f.fields.map((fl, i) => i === idx ? { ...fl, ...patch } : fl) }));
    };

    if (loading) return (
        <div style={{ textAlign: 'center', padding: '4rem' }}>
            <div style={{ width: '40px', height: '40px', border: '3px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
        </div>
    );

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.5rem' }}>
                <div>
                    <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: '600', color: 'var(--charcoal)' }}>Forms</h2>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Intake, consent & consultation forms clients complete before their appointment.</p>
                </div>
                <button onClick={openCreate} className="btn-primary" style={{ padding: '0.65rem 1.25rem', fontSize: '0.875rem' }}>+ New form</button>
            </div>

            {error && <p style={{ color: '#dc2626', fontSize: '0.85rem', marginBottom: '1rem' }}>{error}</p>}

            {templates.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '4rem 2rem', background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📋</div>
                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', color: 'var(--charcoal)', marginBottom: '0.4rem' }}>No forms yet</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Create an intake or consent form for clients to fill in before visiting.</p>
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
                    {templates.map(t => (
                        <div key={t._id} style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.25rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                                <div>
                                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: '600', color: 'var(--charcoal)', margin: 0 }}>{t.title}</h3>
                                    <span style={{ fontSize: '0.68rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--gold-dark)', background: 'rgba(240,62,22,0.12)', padding: '0.1rem 0.5rem', borderRadius: '99px' }}>{t.kind}</span>
                                </div>
                                {!t.isActive && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Inactive</span>}
                            </div>
                            {t.description && <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.5rem 0 0' }}>{t.description}</p>}
                            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0.6rem 0 0' }}>{t.fields?.length || 0} question{(t.fields?.length || 0) !== 1 ? 's' : ''}</p>
                            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.2rem 0 0.85rem' }}>
                                {t.services?.length ? `${t.services.length} service${t.services.length !== 1 ? 's' : ''}` : 'All bookings'}
                            </p>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button onClick={() => openEdit(t)} style={{ flex: 1, padding: '0.5rem', background: 'var(--warm-gray)', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Edit</button>
                                <button onClick={() => remove(t)} style={{ padding: '0.5rem 0.85rem', background: 'none', border: '1px solid #fca5a5', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600', color: '#dc2626', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Delete</button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Builder modal */}
            {showForm && (
                <>
                    <div onClick={() => setShowForm(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1100, backdropFilter: 'blur(2px)' }} />
                    <div className="modal-center" style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: '560px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', background: 'var(--card-bg)', borderRadius: 'var(--radius)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', zIndex: 1101 }}>
                        <div style={{ background: 'var(--charcoal)', padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 1 }}>
                            <h2 style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)', fontSize: '1.2rem', fontWeight: '700', margin: 0 }}>{editing ? 'Edit form' : 'New form'}</h2>
                            <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: '1.5rem', lineHeight: 1 }}>×</button>
                        </div>
                        <form onSubmit={save} style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div>
                                <label style={labelStyle}>Title</label>
                                <input className="input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. New client intake" />
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                                <div>
                                    <label style={labelStyle}>Type</label>
                                    <select className="input" value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))}>
                                        {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label style={labelStyle}>Status</label>
                                    <select className="input" value={form.isActive ? 'active' : 'inactive'} onChange={e => setForm(f => ({ ...f, isActive: e.target.value === 'active' }))}>
                                        <option value="active">Active</option>
                                        <option value="inactive">Inactive</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label style={labelStyle}>Description (optional)</label>
                                <textarea className="input" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} style={{ resize: 'vertical' }} />
                            </div>
                            <div>
                                <label style={labelStyle}>Attach to services <span style={{ textTransform: 'none', fontWeight: '400' }}>(none = all bookings)</span></label>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                                    {services.length === 0 && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No services yet</span>}
                                    {services.map(s => {
                                        const on = form.services.includes(s._id);
                                        return (
                                            <button type="button" key={s._id} onClick={() => setForm(f => ({ ...f, services: on ? f.services.filter(id => id !== s._id) : [...f.services, s._id] }))} style={{
                                                padding: '0.3rem 0.75rem', borderRadius: '99px', border: '1.5px solid', borderColor: on ? 'var(--gold)' : 'var(--border)',
                                                background: on ? 'rgba(240,62,22,0.12)' : 'var(--card-bg)', color: on ? 'var(--gold-dark)' : 'var(--text-secondary)',
                                                fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'Plus Jakarta Sans, sans-serif',
                                            }}>{s.name}</button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Field builder */}
                            <div>
                                <label style={labelStyle}>Questions</label>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                    {form.fields.map((fl, idx) => (
                                        <div key={idx} style={{ background: 'var(--warm-gray)', borderRadius: 'var(--radius-sm)', padding: '0.85rem' }}>
                                            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                                <input className="input" placeholder="Question label" value={fl.label} onChange={e => updateField(idx, { label: e.target.value })} style={{ flex: 1, fontSize: '0.85rem' }} />
                                                <button type="button" onClick={() => setForm(f => ({ ...f, fields: f.fields.filter((_, i) => i !== idx) }))} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '1.1rem' }}>×</button>
                                            </div>
                                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                                <select className="input" value={fl.type} onChange={e => updateField(idx, { type: e.target.value })} style={{ fontSize: '0.8rem', padding: '0.4rem 0.5rem', width: 'auto' }}>
                                                    {FIELD_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                                </select>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                                                    <input type="checkbox" checked={fl.required} onChange={e => updateField(idx, { required: e.target.checked })} style={{ accentColor: 'var(--gold)' }} /> Required
                                                </label>
                                            </div>
                                            {(fl.type === 'select' || fl.type === 'radio') && (
                                                <input className="input" placeholder="Options, comma-separated" value={(fl.options || []).join(', ')} onChange={e => updateField(idx, { options: e.target.value.split(',').map(o => o.trim()).filter(Boolean) })} style={{ marginTop: '0.5rem', fontSize: '0.82rem' }} />
                                            )}
                                        </div>
                                    ))}
                                </div>
                                <button type="button" onClick={() => setForm(f => ({ ...f, fields: [...f.fields, blankField()] }))} style={{ marginTop: '0.6rem', fontSize: '0.78rem', padding: '0.35rem 0.75rem', border: '1px solid var(--gold)', borderRadius: 'var(--radius-sm)', background: 'rgba(240,62,22,0.08)', color: 'var(--gold-dark)', cursor: 'pointer', fontWeight: '600' }}>+ Add question</button>
                            </div>

                            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                                <button type="button" onClick={() => setShowForm(false)} style={{ flex: 1, padding: '0.85rem', background: 'var(--warm-gray)', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: '600', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Cancel</button>
                                <button type="submit" disabled={saving} className="btn-primary" style={{ flex: 1, padding: '0.85rem', fontWeight: '700' }}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create form'}</button>
                            </div>
                        </form>
                    </div>
                </>
            )}
        </div>
    );
};

export default FormsManager;
