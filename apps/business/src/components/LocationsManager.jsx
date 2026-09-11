import React, { useEffect, useRef, useState } from 'react';
import { locationService } from '../services';
import { useToast } from './Toast';

// Owner screen over the multi-location CRUD. Businesses start with one primary
// "Main" location (created by the backfill); here the owner can add more, rename
// them, set their address, choose which is primary, and retire the ones they no
// longer use. The server enforces the invariants (exactly one primary, can't
// retire the primary or the last active location) — this surfaces them and
// relays any refusal as a toast.

const card = {
    background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)',
    boxShadow: 'var(--shadow-sm)', padding: '1.1rem 1.25rem',
};
const label = { display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '0.3rem' };
const input = {
    width: '100%', padding: '0.55rem 0.7rem', borderRadius: '8px', border: '1px solid var(--border)',
    background: 'var(--surface-sunken, var(--card-bg))', color: 'var(--charcoal)', font: 'inherit', fontSize: '0.9rem',
};
const pill = (color, bg, border) => ({
    fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
    color, background: bg || 'transparent', border: border || 'none', padding: '0.15rem 0.5rem', borderRadius: '999px',
});

const LocationRow = ({ loc, busy, onSave, onSetPrimary, onToggleActive }) => {
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(loc.name);
    const [address, setAddress] = useState(loc.address || '');
    // Re-sync drafts if the row's server state changes underneath us (e.g. a save
    // refetch, or another tab).
    useEffect(() => { setName(loc.name); setAddress(loc.address || ''); }, [loc.name, loc.address]);

    const cancel = () => { setEditing(false); setName(loc.name); setAddress(loc.address || ''); };
    const save = async () => {
        // Leave edit mode only if the save actually succeeded — on a failure the
        // toast tells the user, and their text stays put so they can retry.
        if (await onSave(loc._id, { name: name.trim(), address: address.trim() })) {
            setEditing(false);
        }
    };

    return (
        <div style={{ ...card, opacity: loc.isActive ? 1 : 0.6 }} data-testid="location-row">
            {!editing ? (
                <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, color: 'var(--charcoal)', fontSize: '1rem' }}>{loc.name}</span>
                        {loc.isPrimary && <span style={pill('var(--gold-dark)', 'rgba(240,62,22,0.1)')}>Primary</span>}
                        {!loc.isActive && <span style={pill('var(--text-muted)', 'transparent', '1px solid var(--border)')}>Inactive</span>}
                    </div>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: '0.35rem 0 0' }}>
                        {loc.address || 'No address set'}
                    </p>
                </>
            ) : (
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                    <div>
                        <label style={label}>Name</label>
                        <input style={input} value={name} disabled={busy} onChange={(e) => setName(e.target.value)} aria-label="Location name" />
                    </div>
                    <div>
                        <label style={label}>Address</label>
                        <input style={input} value={address} disabled={busy} onChange={(e) => setAddress(e.target.value)} placeholder="Optional" aria-label="Location address" />
                    </div>
                </div>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.85rem' }}>
                {editing ? (
                    <>
                        <button type="button" className="btn-primary" disabled={busy || !name.trim()} onClick={save} style={{ opacity: (busy || !name.trim()) ? 0.5 : 1 }}>Save</button>
                        <button type="button" className="btn-outline" disabled={busy} onClick={cancel}>Cancel</button>
                    </>
                ) : (
                    <>
                        <button type="button" className="btn-outline" disabled={busy} onClick={() => setEditing(true)}>Edit</button>
                        {!loc.isPrimary && loc.isActive && (
                            <button type="button" className="btn-outline" disabled={busy} onClick={() => onSetPrimary(loc._id)}>Make primary</button>
                        )}
                        {/* The primary can't be retired directly (the server refuses it), so its
                            control is hidden rather than shown-then-rejected. */}
                        {loc.isActive
                            ? (!loc.isPrimary && <button type="button" className="btn-outline" disabled={busy} onClick={() => onToggleActive(loc, false)}>Deactivate</button>)
                            : <button type="button" className="btn-outline" disabled={busy} onClick={() => onToggleActive(loc, true)}>Reactivate</button>}
                    </>
                )}
            </div>
        </div>
    );
};

const LocationsManager = () => {
    const toast = useToast();
    const [locations, setLocations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [form, setForm] = useState({ name: '', address: '' });
    // A synchronous lock: `busy` only disables buttons after a re-render, so a fast
    // double-click could fire two mutations (and create two locations) before then.
    const inFlight = useRef(false);

    const load = async () => {
        try {
            const res = await locationService.getMyLocations();
            setLocations(res.data.data || []);
        } catch {
            toast('Could not load your locations.', 'error');
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

    // Run a mutation, refetch, and surface any server refusal (e.g. "make another
    // location primary first") as a toast. Returns whether it succeeded so a row
    // can decide to leave edit mode.
    const guard = async (fn, okMsg) => {
        if (inFlight.current) return false; // drop a double-click before the disable lands
        inFlight.current = true;
        setBusy(true);
        try {
            await fn();
            await load();
            if (okMsg) toast(okMsg, 'success');
            return true;
        } catch (err) {
            toast(err?.response?.data?.message || 'Something went wrong. Please try again.', 'error');
            return false;
        } finally {
            inFlight.current = false;
            setBusy(false);
        }
    };

    const handleCreate = async (e) => {
        e.preventDefault();
        if (!form.name.trim()) return;
        const ok = await guard(
            () => locationService.createLocation({ name: form.name.trim(), address: form.address.trim() }),
            'Location added.'
        );
        if (ok) setForm({ name: '', address: '' });
    };
    const handleSave = (id, data) => guard(() => locationService.updateLocation(id, data), 'Saved.');
    const handleSetPrimary = (id) => guard(() => locationService.setPrimaryLocation(id), 'Primary location updated.');
    const handleToggleActive = (loc, isActive) => guard(
        () => locationService.updateLocation(loc._id, { isActive }),
        isActive ? 'Location reactivated.' : 'Location deactivated.'
    );

    return (
        <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', fontWeight: 600, color: 'var(--charcoal)', marginBottom: '0.25rem' }}>Locations</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '2rem' }}>
                The places your business operates from. New bookings can be assigned to a location; the <strong>primary</strong> one is used whenever none is chosen.
            </p>

            {loading ? (
                <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginBottom: '2rem' }}>
                    {locations.map((loc) => (
                        <LocationRow
                            key={loc._id}
                            loc={loc}
                            busy={busy}
                            onSave={handleSave}
                            onSetPrimary={handleSetPrimary}
                            onToggleActive={handleToggleActive}
                        />
                    ))}
                </div>
            )}

            <form onSubmit={handleCreate} style={{ ...card }}>
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 600, color: 'var(--charcoal)', marginBottom: '0.9rem' }}>Add a location</h2>
                <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '0.9rem' }}>
                    <div>
                        <label style={label}>Name</label>
                        <input style={input} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Downtown" aria-label="New location name" />
                    </div>
                    <div>
                        <label style={label}>Address</label>
                        <input style={input} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="Optional" aria-label="New location address" />
                    </div>
                </div>
                <button type="submit" className="btn-primary" disabled={busy || !form.name.trim()} style={{ opacity: (busy || !form.name.trim()) ? 0.5 : 1 }}>
                    Add location
                </button>
            </form>
        </div>
    );
};

export default LocationsManager;
