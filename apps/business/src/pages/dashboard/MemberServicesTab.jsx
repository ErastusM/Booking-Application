import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { myServicesService } from '../../services';
import { useToast } from '../../components/Toast';
import { ChromeModal, CloseButton } from './primitives';

// A team member's own services, in the owner's "Service menu" layout: search,
// one card per service with THEIR price and time, Edit, Remove, "+ Add Service".
// Nothing comes from the business menu unless they add it themselves ("From
// <business>'s menu"), and their price is always their own (serviceOverrides).

const cardStyle = { background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' };

const MemberServicesTab = ({ curSym = 'N$', businessName = 'your business' }) => {
    const toast = useToast();
    const [data, setData] = useState(null);   // { selected, offersAllServices, services, overrides }
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [busy, setBusy] = useState('');
    const [form, setForm] = useState(null);   // { mode: 'add'|'edit', id?, name, price, duration }

    const load = useCallback(async () => {
        try { const res = await myServicesService.get(); setData(res.data.data); setError(''); }
        catch (err) { setError(err.response?.data?.message || 'Could not load your services.'); }
    }, []);
    useEffect(() => { load(); }, [load]);

    const overrideOf = useCallback((id) => (data?.overrides || []).find((o) => String(o.service?._id || o.service) === String(id)), [data]);
    const mine = useMemo(() => {
        if (!data) return [];
        const ids = new Set((data.selected || []).map(String));
        // Same reading as the server: an explicit "offers all", or a legacy row
        // (flag never set) with an empty list, means every service.
        const all = data.offersAllServices === true || (data.offersAllServices == null && ids.size === 0);
        return (data.services || [])
            .filter((s) => all || ids.has(String(s._id)))
            .map((s) => {
                const o = overrideOf(s._id);
                return { ...s, myPrice: o?.price ?? s.price, myDuration: o?.duration ?? s.duration };
            });
    }, [data, overrideOf]);
    const shown = mine.filter((s) => !search || s.name.toLowerCase().includes(search.toLowerCase()));
    const menuRest = (data?.services || []).filter((s) => !mine.some((m) => String(m._id) === String(s._id)));

    // The member's full override list with one row replaced (the API takes the whole list).
    const overridesWith = (id, price, duration) => {
        const rest = (data?.overrides || [])
            .filter((o) => String(o.service?._id || o.service) !== String(id))
            .map((o) => ({ service: String(o.service?._id || o.service), price: o.price, duration: o.duration }));
        return [...rest, { service: String(id), price, duration }];
    };
    const idsOf = (list) => list.map((s) => String(s._id));

    const save = async () => {
        const price = form.price === '' ? null : Number(form.price);
        const duration = form.duration === '' ? null : Number(form.duration);
        if (form.mode === 'add' && !form.name.trim()) { toast('Give the service a name', 'error'); return; }
        if (price != null && (!Number.isFinite(price) || price < 0)) { toast('Enter a valid price', 'error'); return; }
        if (duration != null && (!Number.isFinite(duration) || duration < 5)) { toast('Time must be at least 5 minutes', 'error'); return; }
        setBusy('save');
        try {
            let id = form.id;
            if (form.mode === 'add') {
                const res = await myServicesService.add(form.name.trim(), price ?? undefined, duration ?? undefined);
                id = res.data.data.service._id;
            }
            // Always record THEIR price and time, even when the name matched a
            // service already on the menu at a different price.
            await myServicesService.setPricing(overridesWith(id, price, duration));
            setForm(null);
            toast(form.mode === 'add' ? 'Service added' : 'Service updated', 'success');
            await load();
        } catch (err) { toast(err.response?.data?.message || 'Could not save the service', 'error'); } finally { setBusy(''); }
    };

    const remove = async (s) => {
        if (!window.confirm(`Remove ${s.name} from your services? Clients won't be able to book it with you. ${businessName} keeps it on its menu.`)) return;
        setBusy(`rm-${s._id}`);
        try {
            await myServicesService.set(idsOf(mine).filter((id) => id !== String(s._id)), false);
            toast(`${s.name} removed`, 'success');
            await load();
        } catch (err) { toast(err.response?.data?.message || 'Could not remove the service', 'error'); } finally { setBusy(''); }
    };

    const addFromMenu = async (s) => {
        setBusy(`add-${s._id}`);
        try {
            await myServicesService.set([...idsOf(mine), String(s._id)], false);
            toast(`${s.name} added — set your price if it differs`, 'success');
            await load();
        } catch (err) { toast(err.response?.data?.message || 'Could not add the service', 'error'); } finally { setBusy(''); }
    };

    const actionBtn = (danger) => ({ background: danger ? '#fee2e2' : 'rgba(240,62,22,0.1)', border: `1px solid ${danger ? '#fca5a5' : 'rgba(240,62,22,0.3)'}`, color: danger ? '#ef4444' : 'var(--gold-dark)', padding: '0.35rem 0.875rem', minHeight: '36px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600', fontFamily: 'var(--font-body)' });

    return (
        <div data-testid="member-services">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                <div>
                    <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: '600', color: 'var(--charcoal)' }}>My services</h2>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>The services clients can book you for, at your prices</p>
                </div>
                <button onClick={() => setForm({ mode: 'add', name: '', price: '', duration: '' })} className="btn-primary" style={{ padding: '0.65rem 1.25rem', fontSize: '0.875rem', flexShrink: 0 }} data-testid="member-add-service">
                    + Add Service
                </button>
            </div>

            {error && !data ? (
                <div style={{ ...cardStyle, padding: '2rem', textAlign: 'center' }}>
                    <p style={{ color: 'var(--charcoal)', fontWeight: 600, marginBottom: '0.75rem' }}>{error}</p>
                    <button onClick={load} className="btn-primary" style={{ padding: '0.5rem 1.2rem' }}>Try again</button>
                </div>
            ) : !data ? (
                <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
            ) : (
                <>
                    {mine.length > 3 && (
                        <div style={{ marginBottom: '1.25rem', maxWidth: '360px' }}>
                            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your services" aria-label="Search your services" className="input" />
                        </div>
                    )}
                    {shown.length === 0 ? (
                        <div style={{ ...cardStyle, padding: '3rem 2rem', textAlign: 'center', marginBottom: '1.5rem' }}>
                            <p style={{ fontSize: '1.05rem', color: 'var(--charcoal)', fontWeight: 600, marginBottom: '0.35rem' }}>{search ? 'No services match your search' : 'No services yet'}</p>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>{search ? 'Try a different name' : 'Add what you do so clients can book you.'}</p>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
                            {shown.map((s) => (
                                <div key={s._id} data-testid="member-service" style={{ ...cardStyle, borderLeft: '3px solid var(--gold)', padding: '1rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                                    <div style={{ minWidth: 0 }}>
                                        <p style={{ fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.95rem', marginBottom: '0.2rem' }}>{s.name}</p>
                                        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{s.myDuration} min</p>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexShrink: 0 }}>
                                        <span style={{ fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{curSym} {s.myPrice}</span>
                                        <button onClick={() => setForm({ mode: 'edit', id: s._id, name: s.name, price: String(s.myPrice ?? ''), duration: String(s.myDuration ?? '') })} style={actionBtn(false)}>Edit</button>
                                        <button onClick={() => remove(s)} disabled={busy === `rm-${s._id}`} style={actionBtn(true)}>Remove</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {menuRest.length > 0 && (
                        <div style={{ ...cardStyle, padding: '1.1rem 1.25rem' }}>
                            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.2rem' }}>From {businessName}’s menu</h3>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '0.8rem' }}>Add one you also do. You can set your own price after.</p>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                {menuRest.map((s) => (
                                    <button key={s._id} type="button" onClick={() => addFromMenu(s)} disabled={busy === `add-${s._id}`} data-testid="member-menu-add"
                                        style={{ minHeight: '40px', padding: '0 0.9rem', borderRadius: '999px', border: '1px solid var(--border)', background: 'var(--card-bg)', color: 'var(--charcoal)', fontFamily: 'var(--font-body)', fontSize: '0.85rem', cursor: 'pointer' }}>
                                        + {s.name}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}

            {form && (
                <ChromeModal
                    onClose={() => { if (busy !== 'save') setForm(null); }}
                    scrimStyle={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1001, backdropFilter: 'blur(2px)' }}
                    panelClassName="modal-center appt-modal-pop"
                    panelStyle={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: '420px', maxWidth: '95vw', maxHeight: '90dvh', display: 'flex', flexDirection: 'column', background: 'var(--card-bg)', borderRadius: 'var(--radius)', boxShadow: '0 20px 60px rgba(0,0,0,0.25)', zIndex: 1002, overflow: 'hidden' }}
                >
                    <div style={{ background: 'var(--ink)', padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                        <div>
                            <h2 style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)', fontSize: '1.25rem', fontWeight: '600', margin: '0 0 0.15rem' }}>{form.mode === 'add' ? 'Add a service' : form.name}</h2>
                            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.75rem', margin: 0 }}>{form.mode === 'add' ? 'Something you do, at your price' : 'Your price and time for this service'}</p>
                        </div>
                        <CloseButton onClick={() => setForm(null)} />
                    </div>
                    <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.9rem', overflowY: 'auto' }}>
                        {form.mode === 'add' && (
                            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.85rem', fontWeight: 600, color: 'var(--charcoal)' }}>Service name
                                <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Engine bay clean" autoFocus data-testid="member-service-name" />
                            </label>
                        )}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }}>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.85rem', fontWeight: 600, color: 'var(--charcoal)' }}>Your price ({curSym})
                                <input className="input" type="number" min="0" inputMode="decimal" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} data-testid="member-service-price" />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.85rem', fontWeight: 600, color: 'var(--charcoal)' }}>Minutes
                                <input className="input" type="number" min="5" inputMode="numeric" value={form.duration} onChange={(e) => setForm((f) => ({ ...f, duration: e.target.value }))} data-testid="member-service-duration" />
                            </label>
                        </div>
                        <button onClick={save} disabled={busy === 'save'} className="btn-primary" style={{ minHeight: '48px' }} data-testid="member-service-save">{busy === 'save' ? 'Saving…' : 'Save'}</button>
                    </div>
                </ChromeModal>
            )}
        </div>
    );
};

export default MemberServicesTab;
