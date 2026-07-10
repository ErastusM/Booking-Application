import React, { useState, useEffect } from 'react';
import { providerServiceService, categoryService } from '../services';
import { NAMIBIAN_TOWNS } from '../utils/namibiaTowns';
import { useAuthContext } from '../context/AuthContext';
import { currencySymbol } from '../utils/currency';
import { X, Plus, Trash2, Clock } from 'lucide-react';

// Preset durations (minutes) for the dropdown; a service's saved value is added
// if it isn't one of these.
const DURATIONS = [5, 10, 15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240];
const fmtDur = (m) => {
    const n = Number(m);
    if (!n) return '';
    if (n < 60) return `${n} min`;
    const h = Math.floor(n / 60), r = n % 60;
    return r ? `${h} hr ${r} min` : `${h} hr`;
};

const blank = { name: '', category: '', description: '', priceType: 'fixed', price: '', duration: 60, bufferBefore: '', bufferAfter: '', location: '', address: '', options: [] };

const sectionTitle = { fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: 700, color: 'var(--charcoal)', margin: '0 0 1rem' };
const label = { display: 'block', fontSize: '0.9rem', fontWeight: 600, color: 'var(--charcoal)', marginBottom: '0.45rem' };
const helper = { fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.4rem 0 0' };
const field = { marginBottom: '1.5rem' };

/**
 * Full-screen "New / Edit service" form — a clean, sectioned layout (Basic
 * details + Pricing & duration) with a sticky Save, styled with Bookplus tokens.
 * Self-contained: seeds from `editing`, saves via providerServiceService, then
 * calls onSaved().
 */
const ServiceFormModal = ({ open, editing, categories = [], onClose, onSaved, onCategoriesChanged }) => {
    const { user } = useAuthContext();
    const curSym = currencySymbol(user?.businessProfile?.currency);
    const [form, setForm] = useState(blank);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [showExtra, setShowExtra] = useState(false);
    const [addingCat, setAddingCat] = useState(false);
    const [newCat, setNewCat] = useState('');

    useEffect(() => {
        if (!open) return;
        if (editing) {
            setForm({
                name: editing.name || '',
                category: editing.category?._id || editing.category || '',
                description: editing.description || '',
                priceType: Number(editing.price) === 0 ? 'free' : 'fixed',
                price: editing.price ?? '',
                duration: editing.duration || 60,
                bufferBefore: editing.bufferBefore || '',
                bufferAfter: editing.bufferAfter || '',
                location: editing.location || '',
                address: editing.address || '',
                options: editing.options || [],
            });
            setShowExtra(!!(editing.bufferBefore || editing.bufferAfter));
        } else {
            setForm(blank);
            setShowExtra(false);
        }
        setError('');
        setAddingCat(false);
        setNewCat('');
    }, [open, editing]);

    if (!open) return null;

    const set = (patch) => setForm((f) => ({ ...f, ...patch }));
    const setOption = (i, patch) => setForm((f) => ({ ...f, options: f.options.map((o, idx) => idx === i ? { ...o, ...patch } : o) }));

    const durationOptions = DURATIONS.includes(Number(form.duration)) ? DURATIONS : [...DURATIONS, Number(form.duration)].sort((a, b) => a - b);

    const submit = async () => {
        if (!form.name.trim()) { setError('Please add a service name'); return; }
        setSaving(true);
        setError('');
        const payload = {
            name: form.name.trim(),
            // Service model requires a description — fall back to the name.
            description: (form.description || '').trim() || form.name.trim(),
            price: form.priceType === 'free' ? 0 : (Number(form.price) || 0),
            duration: Number(form.duration) || 30,
            category: form.category || null,
            bufferBefore: Number(form.bufferBefore) || 0,
            bufferAfter: Number(form.bufferAfter) || 0,
            location: form.location || '',
            address: form.address || '',
            options: (form.options || []).filter((o) => o.name?.trim()).map((o) => ({
                name: o.name.trim(), description: o.description || '',
                price: Number(o.price) || 0, duration: Number(o.duration) || Number(form.duration) || 30,
            })),
        };
        try {
            if (editing) await providerServiceService.updateMyService(editing._id, payload);
            else await providerServiceService.createMyService(payload);
            onSaved();
        } catch (e) {
            setError(e?.response?.data?.message || 'Could not save the service — please try again.');
        } finally {
            setSaving(false);
        }
    };

    const createCategory = async () => {
        if (!newCat.trim()) return;
        try {
            const res = await categoryService.createCategory(newCat.trim());
            await onCategoriesChanged?.();
            const created = res?.data?.data;
            if (created?._id) set({ category: created._id });
            setNewCat('');
            setAddingCat(false);
        } catch {
            setError('Could not add the category.');
        }
    };

    // Full-screen sheet — fade in (a scale-from-center would zoom the whole
    // viewport and expose edge gaps); reduced-motion neutralizes it globally.
    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'var(--off-white)', display: 'flex', flexDirection: 'column', paddingTop: 'env(safe-area-inset-top, 0px)', animation: 'fadeIn var(--dur) var(--ease-out) both' }}>
            {/* Header */}
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 700, color: 'var(--charcoal)', margin: 0 }}>
                    {editing ? 'Edit service' : 'New service'}
                </h1>
                <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.4rem', display: 'flex' }}>
                    <X size={24} />
                </button>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 1.25rem 2rem' }}>
                <div style={{ maxWidth: '560px', margin: '0 auto' }}>

                    {/* ── Basic details ── */}
                    <h2 style={sectionTitle}>Basic details</h2>

                    <div style={field}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                            <label style={label}>Service name</label>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{form.name.length}/255</span>
                        </div>
                        <input className="input" maxLength={255} value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Add a service name, e.g. Men's Haircut" style={{ fontSize: '1rem' }} autoFocus />
                    </div>

                    <div style={field}>
                        <label style={label}>Menu category</label>
                        {addingCat ? (
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <input className="input" value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New category name" onKeyDown={(e) => e.key === 'Enter' && createCategory()} autoFocus />
                                <button type="button" onClick={createCategory} className="btn-primary" style={{ padding: '0 1rem', whiteSpace: 'nowrap' }}>Add</button>
                                <button type="button" onClick={() => { setAddingCat(false); setNewCat(''); }} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', padding: '0 0.9rem', cursor: 'pointer' }}>Cancel</button>
                            </div>
                        ) : (
                            <select className="input" value={form.category} onChange={(e) => { if (e.target.value === '__new__') { setAddingCat(true); } else { set({ category: e.target.value }); } }}>
                                <option value="">Featured (uncategorized)</option>
                                {categories.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                                <option value="__new__">+ New category…</option>
                            </select>
                        )}
                        <p style={helper}>The category displayed to you, and to clients online.</p>
                    </div>

                    <div style={field}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                            <label style={label}>Description <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{form.description.length}/1000</span>
                        </div>
                        <textarea className="input" rows={3} maxLength={1000} value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="Add a short description" style={{ resize: 'vertical' }} />
                    </div>

                    {/* ── Pricing and duration ── */}
                    <h2 style={{ ...sectionTitle, marginTop: '2.25rem' }}>Pricing and duration</h2>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', ...field }}>
                        <div>
                            <label style={label}>Price type</label>
                            <select className="input" value={form.priceType} onChange={(e) => set({ priceType: e.target.value })}>
                                <option value="fixed">Fixed</option>
                                <option value="free">Free</option>
                            </select>
                        </div>
                        <div>
                            <label style={label}>Price</label>
                            <div style={{ position: 'relative' }}>
                                <span style={{ position: 'absolute', left: '0.9rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '0.9rem', pointerEvents: 'none' }}>{curSym}</span>
                                <input className="input" type="number" min="0" step="0.01" disabled={form.priceType === 'free'} value={form.priceType === 'free' ? '' : form.price} onChange={(e) => set({ price: e.target.value })} placeholder="0.00" style={{ paddingLeft: '2.4rem', opacity: form.priceType === 'free' ? 0.5 : 1 }} />
                            </div>
                        </div>
                    </div>

                    <div style={field}>
                        <label style={label}>Duration</label>
                        <select className="input" value={form.duration} onChange={(e) => set({ duration: Number(e.target.value) })}>
                            {durationOptions.map((m) => <option key={m} value={m}>{fmtDur(m)}</option>)}
                        </select>
                    </div>

                    {/* Extra time (buffers) */}
                    {showExtra ? (
                        <div style={{ ...field, background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '1rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--charcoal)', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}><Clock size={15} /> Extra time</span>
                                <button type="button" onClick={() => { setShowExtra(false); set({ bufferBefore: '', bufferAfter: '' }); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem' }}>Remove</button>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                <div>
                                    <label style={{ ...label, fontSize: '0.82rem' }}>Before (min)</label>
                                    <input className="input" type="number" min="0" max="120" value={form.bufferBefore} onChange={(e) => set({ bufferBefore: e.target.value })} placeholder="0" />
                                </div>
                                <div>
                                    <label style={{ ...label, fontSize: '0.82rem' }}>After (min)</label>
                                    <input className="input" type="number" min="0" max="120" value={form.bufferAfter} onChange={(e) => set({ bufferAfter: e.target.value })} placeholder="0" />
                                </div>
                            </div>
                            <p style={helper}>Blocked-off prep/cleanup time around the booking — not shown to clients.</p>
                        </div>
                    ) : (
                        <button type="button" onClick={() => setShowExtra(true)} style={{ ...field, display: 'inline-flex', alignItems: 'center', gap: '0.45rem', background: 'none', border: '1.5px solid var(--border)', borderRadius: '999px', padding: '0.55rem 1.1rem', cursor: 'pointer', color: 'var(--charcoal)', fontWeight: 600, fontFamily: 'var(--font-body)', fontSize: '0.85rem' }}>
                            <Plus size={16} /> Add extra time
                        </button>
                    )}

                    {/* Options (sub-options / variants) */}
                    <div style={field}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                            <label style={{ ...label, marginBottom: 0 }}>Options <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(e.g. Adults, Students)</span></label>
                            <button type="button" onClick={() => set({ options: [...form.options, { name: '', description: '', price: '', duration: '' }] })} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.82rem', padding: '0.4rem 0.85rem', border: '1.5px solid var(--gold)', borderRadius: '999px', background: 'rgba(240,62,22,0.08)', color: 'var(--gold-dark)', cursor: 'pointer', fontWeight: 600 }}><Plus size={14} /> Add option</button>
                        </div>
                        {form.options.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                {form.options.map((opt, i) => (
                                    <div key={i} style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.85rem' }}>
                                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                                            <input className="input" value={opt.name} onChange={(e) => setOption(i, { name: e.target.value })} placeholder="Option name" style={{ flex: 1 }} />
                                            <button type="button" onClick={() => set({ options: form.options.filter((_, idx) => idx !== i) })} aria-label="Remove option" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', display: 'flex', padding: '0.3rem' }}><Trash2 size={16} /></button>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                                            <input className="input" type="number" min="0" value={opt.price} onChange={(e) => setOption(i, { price: e.target.value })} placeholder={`Price (${curSym})`} />
                                            <input className="input" type="number" min="5" step="5" value={opt.duration} onChange={(e) => setOption(i, { duration: e.target.value })} placeholder="Duration (min)" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* ── Location (optional) ── */}
                    <h2 style={{ ...sectionTitle, marginTop: '2.25rem' }}>Location <span style={{ fontSize: '0.85rem', fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></h2>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', ...field }}>
                        <div>
                            <label style={label}>Town</label>
                            <select className="input" value={form.location} onChange={(e) => set({ location: e.target.value })}>
                                <option value="">Select a town…</option>
                                {form.location && !NAMIBIAN_TOWNS.includes(form.location) && <option value={form.location}>{form.location}</option>}
                                {NAMIBIAN_TOWNS.map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={label}>Street address</label>
                            <input className="input" value={form.address} onChange={(e) => set({ address: e.target.value })} placeholder="e.g. 123 Independence Ave" />
                        </div>
                    </div>
                    <p style={helper}>Where clients come for this service. Leave blank to use your business address.</p>

                    {error && <p role="alert" style={{ marginTop: '1.25rem', color: 'var(--danger-fg, #dc2626)', fontSize: '0.85rem' }}>{error}</p>}
                </div>
            </div>

            {/* Sticky footer */}
            <div style={{ flexShrink: 0, padding: '1rem 1.25rem calc(1rem + env(safe-area-inset-bottom, 0px))', borderTop: '1px solid var(--border)', background: 'var(--off-white)' }}>
                <div style={{ maxWidth: '560px', margin: '0 auto' }}>
                    <button type="button" onClick={submit} disabled={saving} className="btn-primary" style={{ width: '100%', padding: '0.95rem', fontSize: '1rem' }}>
                        {saving ? 'Saving…' : editing ? 'Save changes' : 'Save'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ServiceFormModal;
