import React, { useState, useEffect } from 'react';
import { providerServiceService, categoryService } from '../services';
import { NAMIBIAN_TOWNS } from '../utils/namibiaTowns';
import { useAuthContext } from '../context/AuthContext';
import { useToast } from './Toast';
import { currencySymbol } from '../utils/currency';
import { Select, formatDuration } from '@bookplus/ui';
import { X, Plus, Trash2, Clock } from 'lucide-react';
import Switch from './Switch';

// Preset durations (minutes) for the dropdown; a service's saved value is added
// if it isn't one of these.
const DURATIONS = [5, 10, 15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240];
// Durations read the same everywhere, in both apps: "45 min", "1 hr", "2 hr 30 min".
const fmtDur = formatDuration;

// ownerPerforms: new menu items are the owner's own by default ("I offer this").
const blank = { name: '', category: '', description: '', priceType: 'fixed', price: '', duration: 60, bufferBefore: '', bufferAfter: '', location: '', address: '', options: [], ownerPerforms: true };

const sectionTitle = { fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: 600, color: 'var(--charcoal)', margin: '0 0 1rem' };
const label = { display: 'block', fontSize: '0.9rem', fontWeight: 600, color: 'var(--charcoal)', marginBottom: '0.45rem' };
const helper = { fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.4rem 0 0' };
const field = { marginBottom: '1.5rem' };

/**
 * Full-screen "New / Edit service" form — a clean, sectioned layout (Basic
 * details + Pricing & duration) with a sticky Save, styled with Bookplus tokens.
 * Self-contained: seeds from `editing`, saves via providerServiceService, then
 * calls onSaved().
 *
 * A team member edits THEIR services in this same sheet. Pass `memberSave` and
 * the sheet saves through it instead ({ name, price, duration } — their own
 * price and time for the service, kept on their roster row), and shows only
 * what is theirs to set: the name when adding, the price and the Duration. The
 * business's catalogue fields (category, description, extra time, options,
 * location) stay the owner's.
 */
const ServiceFormModal = ({ open, editing, categories = [], onClose, onSaved, onCategoriesChanged, memberSave = null, businessName = '' }) => {
    const memberMode = typeof memberSave === 'function';
    const { user } = useAuthContext();
    const isOwner = user?.role === 'provider' || user?.role === 'admin';
    const toast = useToast();
    const curSym = currencySymbol(user?.businessProfile?.currency);
    const [form, setForm] = useState(blank);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [showExtra, setShowExtra] = useState(false);
    const [addingCat, setAddingCat] = useState(false);
    const [newCat, setNewCat] = useState('');
    const [catSaving, setCatSaving] = useState(false);

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
                ownerPerforms: editing.ownerPerforms !== false,
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

    // A saved category that isn't in the list yet (still loading, or deleted)
    // shows its populated name rather than a raw id; kept hidden from the list.
    const categoryOptions = [
        { value: '', label: 'Featured (uncategorized)' },
        ...categories.map((c) => ({ value: c._id, label: c.name })),
        ...(form.category && !categories.some((c) => c._id === form.category)
            ? [{ value: form.category, label: (editing?.category?._id === form.category && editing.category.name) || 'Featured (uncategorized)', hidden: true }]
            : []),
    ];

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
        // Only the owner decides what clients can book THEM for.
        if (isOwner) payload.ownerPerforms = form.ownerPerforms !== false;
        try {
            if (memberMode) await memberSave({ name: payload.name, price: payload.price, duration: payload.duration });
            else if (editing) await providerServiceService.updateMyService(editing._id, payload);
            else await providerServiceService.createMyService(payload);
            toast(editing ? 'Service saved.' : 'Service created.', 'success');
            onSaved();
        } catch (e) {
            setError(e?.response?.data?.message || 'Could not save the service — please try again.');
        } finally {
            setSaving(false);
        }
    };

    const createCategory = async () => {
        if (catSaving || !newCat.trim()) return; // guard against a double-click creating duplicate categories
        setCatSaving(true);
        try {
            const res = await categoryService.createCategory(newCat.trim());
            await onCategoriesChanged?.();
            const created = res?.data?.data;
            if (created?._id) set({ category: created._id });
            setNewCat('');
            setAddingCat(false);
        } catch {
            setError('Could not add the category.');
        } finally {
            setCatSaving(false);
        }
    };

    // Full-screen sheet — fade in (a scale-from-center would zoom the whole
    // viewport and expose edge gaps); reduced-motion neutralizes it globally.
    // z 2400: above the app chrome and PhotoEditor (2000), but below the
    // @bookplus/ui picker layer (2500) so its dropdowns open on top, and below toasts.
    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2400, background: 'var(--off-white)', display: 'flex', flexDirection: 'column', paddingTop: 'env(safe-area-inset-top, 0px)', animation: 'fadeIn var(--dur) var(--ease-out) both' }}>
            {/* Header */}
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 600, color: 'var(--charcoal)', margin: 0 }}>
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
                        <input className="input" maxLength={255} value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Add a service name, e.g. 60-min consultation" style={{ fontSize: '1rem' }} autoFocus={!(memberMode && editing)} readOnly={memberMode && !!editing} data-testid="service-name" />
                        {memberMode && editing && <p style={helper}>The name is on {businessName || 'the business'}’s menu. Your price and time are yours.</p>}
                    </div>

                    {!memberMode && <>
                    <div style={field}>
                        <label style={label}>Menu category</label>
                        {addingCat ? (
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <input className="input" value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New category name" onKeyDown={(e) => e.key === 'Enter' && createCategory()} autoFocus />
                                <button type="button" onClick={createCategory} disabled={catSaving} className="btn-primary" style={{ padding: '0 1rem', whiteSpace: 'nowrap' }}>{catSaving ? 'Adding…' : 'Add'}</button>
                                <button type="button" onClick={() => { setAddingCat(false); setNewCat(''); }} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', padding: '0 0.9rem', cursor: 'pointer' }}>Cancel</button>
                            </div>
                        ) : (
                            <Select value={form.category} onChange={(e) => set({ category: e.target.value })} options={categoryOptions}
                                actions={[{ label: '+ New category…', onSelect: () => setAddingCat(true), 'data-testid': 'service-new-category' }]}
                                searchPlaceholder="Search categories" aria-label="Menu category" data-testid="service-category" />
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

                    </>}

                    {/* ── Pricing and duration ── */}
                    <h2 style={{ ...sectionTitle, marginTop: '2.25rem' }}>Pricing and duration</h2>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', ...field }}>
                        <div>
                            <label style={label}>Price type</label>
                            <Select value={form.priceType} onChange={(e) => set({ priceType: e.target.value })}
                                options={[{ value: 'fixed', label: 'Fixed' }, { value: 'free', label: 'Free' }]}
                                aria-label="Price type" data-testid="service-price-type" />
                        </div>
                        <div>
                            <label style={label}>Price</label>
                            <div style={{ position: 'relative' }}>
                                <span style={{ position: 'absolute', left: '0.9rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '0.9rem', pointerEvents: 'none' }}>{curSym}</span>
                                <input className="input" type="number" min="0" step="0.01" disabled={form.priceType === 'free'} value={form.priceType === 'free' ? '' : form.price} onChange={(e) => set({ price: e.target.value })} placeholder="0.00" aria-label="Price" data-testid="service-price" style={{ paddingLeft: '2.4rem', opacity: form.priceType === 'free' ? 0.5 : 1 }} />
                            </div>
                        </div>
                    </div>

                    <div style={field}>
                        <label style={label}>Duration</label>
                        {/* A fixed list of lengths: no search box, even past 8 rows. */}
                        <Select value={form.duration} onChange={(e) => set({ duration: Number(e.target.value) })}
                            options={durationOptions.map((m) => ({ value: m, label: fmtDur(m) }))} searchable={false}
                            aria-label="Duration" data-testid="service-duration" />
                    </div>

                    {isOwner && (
                        <div style={{ ...field, background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.9rem 1rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                                <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--charcoal)' }}>You offer this service</span>
                                <Switch label={form.ownerPerforms !== false ? 'Yes' : 'No'} checked={form.ownerPerforms !== false} onChange={(v) => set({ ownerPerforms: v })} data-testid="service-owner-performs" />
                            </div>
                            <p style={helper}>
                                {form.ownerPerforms !== false
                                    ? 'Clients can book you for it, at this price.'
                                    : 'Only the team members who offer it can be booked for it — it won’t appear under your name.'}
                            </p>
                        </div>
                    )}

                    {!memberMode && <>
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
                            {/* Optional field: "Clear town" stands in for the old blank row
                                so a picked town can still be taken back to ''. */}
                            <Select value={form.location} onChange={(e) => set({ location: e.target.value })}
                                options={[
                                    ...(form.location && !NAMIBIAN_TOWNS.includes(form.location) ? [{ value: form.location, label: form.location }] : []),
                                    ...NAMIBIAN_TOWNS.map((t) => ({ value: t, label: t })),
                                ]}
                                actions={form.location ? [{ label: 'Clear town', onSelect: () => set({ location: '' }), 'data-testid': 'service-town-clear' }] : undefined}
                                placeholder="Select a town…" searchable searchPlaceholder="Search towns"
                                aria-label="Town" data-testid="service-town" />
                        </div>
                        <div>
                            <label style={label}>Street address</label>
                            <input className="input" value={form.address} onChange={(e) => set({ address: e.target.value })} placeholder="e.g. 123 Independence Ave" />
                        </div>
                    </div>
                    <p style={helper}>Where clients come for this service. Leave blank to use your business address.</p>
                    </>}

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
