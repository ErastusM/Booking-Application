import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { appointmentService } from '../services';
import { buildTimeSlots } from '../utils/bookingSlots';
import { Calendar, Clock, MapPin, Scissors, User, CheckCircle2, XCircle } from 'lucide-react';

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const toMin = (t) => { const [h, m] = String(t || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
// Working blocks for a date from the provider's schedule (falls back to 08:00–20:00).
const blocksFor = (dateStr, schedule) => {
    if (!dateStr) return [];
    if (!schedule) return [{ start: 8 * 60, end: 20 * 60 }];
    const [y, m, d] = dateStr.split('-').map(Number);
    const cfg = schedule[DAY_NAMES[new Date(y, m - 1, d).getDay()]];
    if (!cfg?.enabled || !Array.isArray(cfg.slots)) return [];
    return cfg.slots
        .filter((s) => s?.start && s?.end)
        .map((s) => ({ start: toMin(s.start), end: toMin(s.end) }))
        .filter((b) => b.end > b.start);
};

const statusBadge = {
    pending:   { label: 'Pending',   cls: 'badge-warning' },
    confirmed: { label: 'Confirmed', cls: 'badge-info' },
    completed: { label: 'Completed', cls: 'badge-success' },
    cancelled: { label: 'Cancelled', cls: 'badge-danger' },
    'no-show': { label: 'No-show',   cls: 'badge-neutral' },
};

const ManageBooking = () => {
    const { token } = useParams();
    const [appt, setAppt] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [cancelling, setCancelling] = useState(false);
    const [done, setDone] = useState('');
    const [showReschedule, setShowReschedule] = useState(false);
    const [rDate, setRDate] = useState('');
    const [rTime, setRTime] = useState('');
    const [savingR, setSavingR] = useState(false);

    const today = new Date().toISOString().split('T')[0];
    const toInputDate = (d) => {
        const x = new Date(d); const p = (n) => String(n).padStart(2, '0');
        return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
    };

    const load = () => {
        setLoading(true); setError('');
        appointmentService.getByToken(token)
            .then(res => setAppt(res.data.data))
            .catch(() => setError('We couldn’t find this booking. The link may be invalid or expired.'))
            .finally(() => setLoading(false));
    };
    useEffect(load, [token]);

    const cancel = async () => {
        if (!window.confirm('Cancel this booking? This cannot be undone.')) return;
        setCancelling(true); setError('');
        try {
            await appointmentService.cancelByToken(token);
            setDone('Your booking has been cancelled. Thank you for letting us know.');
            setAppt(a => a ? { ...a, status: 'cancelled' } : a);
        } catch (err) {
            setError(err.response?.data?.message || 'Could not cancel — please try again.');
        } finally {
            setCancelling(false);
        }
    };

    const reschedule = async (e) => {
        e.preventDefault();
        if (!rDate || !rTime) { setError('Please pick a new date and time'); return; }
        setSavingR(true); setError('');
        try {
            await appointmentService.rescheduleByToken(token, { appointmentDate: rDate, startTime: rTime });
            setShowReschedule(false);
            setDone('Your booking has been rescheduled. See you then!');
            load();
        } catch (err) {
            setError(err.response?.data?.message || 'Could not reschedule — please try again.');
        } finally {
            setSavingR(false);
        }
    };

    const Row = ({ icon: Icon, children }) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', padding: '0.7rem 0', borderBottom: '1px solid var(--border)' }}>
            <Icon size={18} strokeWidth={2} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <span style={{ fontSize: '0.92rem', color: 'var(--charcoal)' }}>{children}</span>
        </div>
    );

    return (
        <div style={{ background: 'var(--off-white)', minHeight: '100dvh', paddingTop: '6rem', paddingBottom: '4rem' }}>
            <div style={{ width: '100%', maxWidth: '440px', margin: '0 auto', padding: '0 1rem' }}>
                <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                    <Link to="/" style={{ textDecoration: 'none', fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: '700', color: 'var(--gold)' }}>
                        Book<span style={{ color: 'var(--charcoal)' }}>plus</span>
                    </Link>
                </div>

                <div className="card" style={{ padding: '1.75rem', borderRadius: 'var(--radius)' }}>
                    {loading ? (
                        <div style={{ textAlign: 'center', padding: '2.5rem' }}>
                            <div style={{ width: '34px', height: '34px', border: '3px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
                        </div>
                    ) : error && !appt ? (
                        <div style={{ textAlign: 'center', padding: '1.5rem 0.5rem' }}>
                            <XCircle size={36} strokeWidth={1.75} style={{ color: 'var(--text-muted)', margin: '0 auto 0.75rem' }} />
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>{error}</p>
                        </div>
                    ) : appt ? (
                        <>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: '600', margin: 0 }}>Your booking</h1>
                                <span className={`badge ${statusBadge[appt.status]?.cls || 'badge-neutral'}`}>{statusBadge[appt.status]?.label || appt.status}</span>
                            </div>

                            {appt.provider?.name && <Row icon={MapPin}>{appt.provider.name}{appt.provider.address ? ` · ${appt.provider.address}` : ''}</Row>}
                            {appt.service?.name && <Row icon={Scissors}>{appt.service.name}{appt.service.price ? ` · NAD ${appt.service.price}` : ''}</Row>}
                            <Row icon={Calendar}>{new Date(appt.appointmentDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</Row>
                            <Row icon={Clock}>{appt.startTime} – {appt.endTime}</Row>
                            {appt.staff && <Row icon={User}>with {appt.staff}</Row>}

                            {done ? (
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', marginTop: '1.25rem', padding: '0.9rem 1rem', background: 'var(--success-bg)', color: 'var(--success-fg)', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem' }}>
                                    <CheckCircle2 size={18} strokeWidth={2} style={{ flexShrink: 0, marginTop: '1px' }} /> {done}
                                </div>
                            ) : (appt.status === 'pending' || appt.status === 'confirmed') ? (
                                <>
                                    {error && <p style={{ color: 'var(--danger-fg)', fontSize: '0.85rem', marginTop: '1rem' }}>{error}</p>}
                                    {showReschedule ? (
                                        <form onSubmit={reschedule} style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                            <label style={{ fontSize: '0.78rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>New date</label>
                                            <input type="date" value={rDate} min={today} onChange={e => { setRDate(e.target.value); setRTime(''); }} className="input" required />
                                            <label style={{ fontSize: '0.78rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>New start time</label>
                                            {(() => {
                                                // Controlled hourly slots (no arbitrary minute starts), within the
                                                // provider's hours. Half-hour starts surface server-side conflict rules.
                                                const duration = appt.service?.duration || (toMin(appt.endTime) - toMin(appt.startTime)) || 30;
                                                const blocks = blocksFor(rDate, appt.schedule);
                                                const minStart = rDate === today ? (new Date().getHours() * 60 + new Date().getMinutes()) : -1;
                                                const slots = rDate ? buildTimeSlots({ blocks, bookedRanges: [], duration, minStart }) : [];
                                                if (!rDate) return <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>Pick a date first.</p>;
                                                if (slots.length === 0) return <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>No available times on this day.</p>;
                                                return (
                                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: '0.4rem' }}>
                                                        {slots.map((s, i) => {
                                                            const sel = rTime === s.time;
                                                            return (
                                                                <button key={i} type="button" onClick={() => setRTime(s.time)} style={{
                                                                    padding: '0.55rem 0.3rem', borderRadius: 'var(--radius-sm)', fontFamily: 'Outfit, sans-serif', fontWeight: '600', fontSize: '0.85rem',
                                                                    border: `1.5px solid ${sel ? 'var(--gold)' : 'var(--border)'}`,
                                                                    background: sel ? 'var(--gold)' : 'var(--card-bg)', color: sel ? 'var(--ink)' : 'var(--charcoal)', cursor: 'pointer',
                                                                }}>{s.time}</button>
                                                            );
                                                        })}
                                                    </div>
                                                );
                                            })()}
                                            <button type="submit" disabled={savingR || !rTime} className="btn-primary" style={{ width: '100%', marginTop: '0.35rem', opacity: rTime ? 1 : 0.5 }}>{savingR ? 'Saving…' : 'Confirm new time →'}</button>
                                            <button type="button" onClick={() => { setShowReschedule(false); setError(''); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem' }}>Back</button>
                                        </form>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '1.5rem' }}>
                                            <button onClick={() => { setShowReschedule(true); setRDate(toInputDate(appt.appointmentDate)); setRTime(''); setError(''); }} className="btn-primary" style={{ width: '100%' }}>Reschedule</button>
                                            <button onClick={cancel} disabled={cancelling} className="btn btn--danger-soft btn-block btn-lg">
                                                {cancelling ? 'Cancelling…' : 'Cancel booking'}
                                            </button>
                                        </div>
                                    )}
                                    <p style={{ textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.85rem' }}>Free cancellation anytime.</p>
                                </>
                            ) : (
                                <p style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '1.5rem' }}>This booking can no longer be changed.</p>
                            )}
                        </>
                    ) : null}
                </div>
            </div>
        </div>
    );
};

export default ManageBooking;
