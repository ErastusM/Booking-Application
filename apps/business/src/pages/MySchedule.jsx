import React, { useEffect, useState } from 'react';
import { appointmentService, myTimeOffService, myServicesService } from '../services';
import { useAuthContext } from '../context/AuthContext';
import { CalendarClock, Palmtree, Scissors } from 'lucide-react';

/**
 * Epic 2.4 — the staff principal's landing view: ONLY their own column
 * (the API scopes /appointments to their TeamMember server-side).
 * Owners see everyone at once via the dashboard calendar's Staff view
 * (per-staff lanes) and its staff filter — see dashboard/StaffLanesDay.jsx.
 *
 * Staff also request their own time off here; the owner approves it on the Team
 * page. A request sits pending — visible to the owner — and only closes this
 * member's calendar once approved.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtRange = (a, b) => {
    const pa = a.split('-').map(Number);
    const pb = b.split('-').map(Number);
    if (a === b) return `${pa[2]} ${MONTHS[pa[1] - 1]}`;
    if (pa[0] === pb[0] && pa[1] === pb[1]) return `${pa[2]}–${pb[2]} ${MONTHS[pb[1] - 1]}`;
    return `${pa[2]} ${MONTHS[pa[1] - 1]} – ${pb[2]} ${MONTHS[pb[1] - 1]}`;
};
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const MySchedule = () => {
    const { user } = useAuthContext();
    const [appointments, setAppointments] = useState(null);
    const todayKey = new Date().toISOString().slice(0, 10);
    const [timeOff, setTimeOff] = useState(null);       // null = loading, false = failed
    const [form, setForm] = useState({ startDate: todayKey, endDate: todayKey, type: 'vacation', note: '' });
    const [busy, setBusy] = useState('');
    const [err, setErr] = useState('');
    const [msg, setMsg] = useState('');
    const [services, setServices] = useState(null);     // null = loading, false = failed, [] = the menu
    const [mySvc, setMySvc] = useState([]);             // ids I perform ([] = all)
    const [svcBusy, setSvcBusy] = useState(false);
    const [svcMsg, setSvcMsg] = useState('');

    useEffect(() => {
        appointmentService.getAllAppointments({ all: 'true' })
            .then(res => setAppointments(res.data.data || []))
            .catch(() => setAppointments([]));
        myTimeOffService.list()
            .then(res => setTimeOff(res.data.data || []))
            .catch(() => setTimeOff(false));
        myServicesService.get()
            .then(res => {
                setServices(res.data.data?.services || []);
                setMySvc((res.data.data?.selected || []).map(String));
            })
            .catch(() => setServices(false));
    }, []);

    // Auto-save each toggle (same as the owner's Team screen), optimistic with a
    // revert if the save fails.
    const toggleService = async (id) => {
        const next = mySvc.includes(id) ? mySvc.filter(x => x !== id) : [...mySvc, id];
        const prev = mySvc;
        setMySvc(next); setSvcBusy(true); setSvcMsg('');
        try {
            await myServicesService.set(next);
            setSvcMsg('Saved'); setTimeout(() => setSvcMsg(''), 2500);
        } catch (e) {
            setMySvc(prev);
            setSvcMsg(e?.response?.data?.message || 'Could not save');
        } finally { setSvcBusy(false); }
    };

    const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 3500); };

    // Swallow refetch failures: the request/withdraw already succeeded, so
    // surfacing a reload error as the operation's error would make staff retry
    // and file a duplicate.
    const reloadTimeOff = () => myTimeOffService.list().then(res => setTimeOff(res.data.data || [])).catch(() => {});

    const requestTimeOff = async () => {
        if (form.endDate < form.startDate) { setErr('The end date can’t be before the start date.'); return; }
        setBusy('add'); setErr('');
        try {
            await myTimeOffService.request({ startDate: form.startDate, endDate: form.endDate, allDay: true, type: form.type, note: form.note.trim() });
            setForm(f => ({ ...f, note: '' }));
            flash('Request sent — your manager will review it.');
        } catch (e) {
            setErr(e?.response?.data?.message || 'Could not send that request.');
            setBusy(''); return;
        }
        await reloadTimeOff();
        setBusy('');
    };

    const withdraw = async (id) => {
        setBusy(id); setErr('');
        try {
            await myTimeOffService.withdraw(id);
        } catch (e) {
            setErr(e?.response?.data?.message || 'Could not withdraw that request.');
            setBusy(''); return;
        }
        await reloadTimeOff();
        setBusy('');
    };

    const upcoming = (appointments || [])
        .filter(a => new Date(a.appointmentDate) >= new Date(new Date().setHours(0, 0, 0, 0)) && a.status !== 'cancelled')
        .sort((a, b) => new Date(a.appointmentDate) - new Date(b.appointmentDate) || a.startTime.localeCompare(b.startTime));

    const statusStyle = { pending: ['#a86a12', 'Awaiting approval'], approved: ['#1f8a4c', 'Approved'], declined: ['var(--text-muted)', 'Declined'] };

    return (
        <div className="container" style={{ paddingTop: 'calc(56px + 2rem)', paddingBottom: '4rem', maxWidth: '680px' }}>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', fontWeight: 600, color: 'var(--charcoal)', margin: '0 0 0.35rem' }}>
                My schedule
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', margin: '0 0 1.75rem' }}>
                Hi {user?.name?.split(' ')[0]} — these are your upcoming appointments.
            </p>

            {appointments === null ? (
                <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
            ) : upcoming.length === 0 ? (
                <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '2.5rem 1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <CalendarClock size={28} style={{ marginBottom: '0.6rem', color: 'var(--gold)' }} />
                    <p style={{ margin: 0 }}>Nothing booked yet — enjoy the quiet.</p>
                </div>
            ) : (
                upcoming.map(a => (
                    <div key={a._id} data-testid="my-schedule-appt" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.9rem 1.15rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <div style={{ textAlign: 'center', minWidth: '64px' }}>
                            <p style={{ margin: 0, fontWeight: 600, color: 'var(--gold-dark)', fontSize: '0.8rem' }}>
                                {new Date(a.appointmentDate).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                            </p>
                            <p className="tnum" style={{ margin: 0, fontWeight: 600, color: 'var(--charcoal)', fontSize: '0.95rem' }}>{a.startTime}</p>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ margin: 0, fontWeight: 600, color: 'var(--charcoal)', fontSize: '0.92rem' }}>{a.service?.name || 'Service'}</p>
                            <p style={{ margin: '2px 0 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                                {a.walkInName || a.customer?.name || 'Client'} · {a.startTime}–{a.endTime}
                            </p>
                        </div>
                        <span style={{ fontSize: '0.72rem', fontWeight: 600, padding: '0.2rem 0.6rem', borderRadius: '99px', textTransform: 'capitalize', background: a.status === 'confirmed' ? 'var(--info-bg)' : 'var(--warning-bg)', color: a.status === 'confirmed' ? 'var(--info-fg)' : 'var(--warning-fg)' }}>{a.status}</span>
                    </div>
                ))
            )}

            {/* ── My services ──────────────────────────────────────── */}
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1.15rem 1.25rem', marginTop: '2rem' }} data-testid="my-services">
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 700, color: 'var(--charcoal)', margin: '0 0 0.15rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    <Scissors size={16} /> My services
                </h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: '0 0 1rem' }}>
                    Pick the services you perform so clients are matched to you correctly. None selected = you perform all of them.
                </p>

                {services === null && <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading…</p>}
                {services === false && <p style={{ margin: 0, color: 'var(--gold-dark)', fontSize: '0.85rem' }}>Couldn’t load the service list.</p>}
                {Array.isArray(services) && services.length === 0 && (
                    <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>Your business hasn’t added any services yet.</p>
                )}
                {Array.isArray(services) && services.length > 0 && (
                    <>
                        <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                            {services.map(s => {
                                const active = mySvc.includes(String(s._id));
                                return (
                                    <button key={s._id} type="button" onClick={() => toggleService(String(s._id))} disabled={svcBusy}
                                        data-testid="my-service-chip"
                                        style={{
                                            padding: '0.4rem 0.85rem', borderRadius: '999px', fontSize: '0.82rem', fontWeight: 600,
                                            cursor: svcBusy ? 'default' : 'pointer',
                                            border: `1px solid ${active ? 'var(--gold)' : 'var(--border)'}`,
                                            background: active ? 'rgba(240,62,22,0.1)' : 'var(--card-bg)',
                                            color: active ? 'var(--gold-dark)' : 'var(--text-secondary)',
                                        }}>
                                        {s.name}
                                    </button>
                                );
                            })}
                        </div>
                        <p style={{ margin: '0.7rem 0 0', fontSize: '0.8rem', color: mySvc.length ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                            {mySvc.length
                                ? `You perform ${mySvc.length} of ${services.length} service${services.length > 1 ? 's' : ''}.`
                                : 'You perform every service.'}
                            {svcMsg && <span style={{ marginLeft: '0.5rem', color: svcMsg === 'Saved' ? '#1f8a4c' : 'var(--gold-dark)', fontWeight: 650 }}>{svcMsg}</span>}
                        </p>
                    </>
                )}
            </div>

            {/* ── Time off ─────────────────────────────────────────── */}
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1.15rem 1.25rem', marginTop: '2rem' }}>
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 700, color: 'var(--charcoal)', margin: '0 0 0.15rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    <Palmtree size={16} /> Time off
                </h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: '0 0 1rem' }}>
                    Request a day or a range. Your manager approves it before it takes your calendar offline.
                </p>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'flex-end' }}>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>From
                        <input type="date" className="input" value={form.startDate}
                            onChange={e => setForm(f => ({ ...f, startDate: e.target.value, endDate: f.endDate < e.target.value ? e.target.value : f.endDate }))}
                            style={{ display: 'block', padding: '0.4rem 0.5rem', marginTop: '0.2rem' }} data-testid="myto-from" />
                    </label>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>To
                        <input type="date" className="input" value={form.endDate} min={form.startDate}
                            onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                            style={{ display: 'block', padding: '0.4rem 0.5rem', marginTop: '0.2rem' }} data-testid="myto-to" />
                    </label>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Type
                        <select className="input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                            style={{ display: 'block', padding: '0.42rem 0.5rem', marginTop: '0.2rem' }}>
                            {['vacation', 'sick', 'unpaid', 'training', 'other'].map(t => <option key={t} value={t}>{cap(t)}</option>)}
                        </select>
                    </label>
                </div>
                <input className="input" placeholder="Note (optional)" value={form.note} maxLength={200}
                    onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                    style={{ marginTop: '0.6rem', padding: '0.45rem 0.6rem', width: '100%', maxWidth: '340px' }} />
                <div>
                    <button type="button" className="btn-primary" onClick={requestTimeOff} disabled={busy === 'add'} data-testid="request-timeoff" style={{ marginTop: '0.65rem', padding: '0.5rem 1.2rem' }}>
                        {busy === 'add' ? 'Sending…' : 'Request time off'}
                    </button>
                </div>
                {err && <p style={{ margin: '0.5rem 0 0', color: 'var(--gold-dark)', fontSize: '0.82rem' }}>{err}</p>}
                {msg && <p style={{ margin: '0.5rem 0 0', color: '#1f8a4c', fontSize: '0.82rem' }}>{msg}</p>}

                <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }} data-testid="myto-list">
                    {timeOff === null && <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading…</p>}
                    {timeOff === false && <p style={{ margin: 0, color: 'var(--gold-dark)', fontSize: '0.85rem' }}>Couldn’t load your time off.</p>}
                    {Array.isArray(timeOff) && timeOff.length === 0 && <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>No time off yet.</p>}
                    {Array.isArray(timeOff) && timeOff.map(t => {
                        const [color, label] = statusStyle[t.status] || ['var(--text-muted)', t.status];
                        return (
                            <div key={t._id} style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', padding: '0.6rem 0.7rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)', flexWrap: 'wrap' }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 650, fontSize: '0.9rem', color: 'var(--charcoal)' }}>{fmtRange(t.startDate, t.endDate)}</div>
                                    <div style={{ marginTop: '0.15rem', fontSize: '0.76rem', color: 'var(--text-secondary)', display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                        <span style={{ padding: '0.1rem 0.45rem', borderRadius: '999px', background: 'rgba(240,62,22,0.1)', color: 'var(--gold-dark)', fontWeight: 650 }}>{cap(t.type)}</span>
                                        <span>{t.allDay ? 'All day' : `${t.startTime}–${t.endTime}`}</span>
                                        <span style={{ color, fontWeight: 650 }}>{label}</span>
                                        {t.note && <span>· {t.note}</span>}
                                    </div>
                                </div>
                                {t.status === 'pending' && (
                                    <button type="button" className="btn-outline" disabled={busy === t._id} onClick={() => withdraw(t._id)} style={{ padding: '0.3rem 0.7rem', fontSize: '0.78rem' }} data-testid="withdraw-timeoff">Withdraw</button>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default MySchedule;
