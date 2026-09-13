import React, { useEffect, useState } from 'react';
import { appointmentService, myTimeOffService, myServicesService, myProfileService, myAvailabilityService, timeClockService, authService } from '../services';
import { useAuthContext } from '../context/AuthContext';
import { CalendarClock, Palmtree, ConciergeBell, Clock, Camera, KeyRound, Timer } from 'lucide-react';
import Switch from '../components/Switch';
import { uploadToCloudinary } from '../utils/uploadImage';
import { cloudinaryAvatar } from '../utils/cloudinary';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DEFAULT_SCHED = () => Object.fromEntries(DAYS.map(d => [d, { enabled: false, slots: [{ start: '09:00', end: '17:00' }] }]));
// Mirror the server's change-password rule exactly (authController.changePassword):
// ≥8 chars with an uppercase letter, a digit, and one of ! @ # $ % ^ & *. A
// broader client set would pass validation here and then be rejected by the API.
const PW_RE = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{8,}$/;

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
    const { user, logout } = useAuthContext();
    const [appointments, setAppointments] = useState(null);
    const todayKey = new Date().toISOString().slice(0, 10);
    const [timeOff, setTimeOff] = useState(null);       // null = loading, false = failed
    const [form, setForm] = useState({ startDate: todayKey, endDate: todayKey, type: 'vacation', note: '' });
    const [busy, setBusy] = useState('');
    const [err, setErr] = useState('');
    const [msg, setMsg] = useState('');
    const [services, setServices] = useState(null);     // null = loading, false = failed, [] = the menu
    const [mySvc, setMySvc] = useState([]);             // ids I perform
    const [offersAll, setOffersAll] = useState(true);   // do I perform everything, or only mySvc?
    const [svcBusy, setSvcBusy] = useState(false);
    const [svcMsg, setSvcMsg] = useState('');
    // My own price/duration per service. Keyed by serviceId → { price, duration }
    // as strings ('' = inherit the business default). Seeded from serviceOverrides.
    const [prices, setPrices] = useState({});
    const [priceBusy, setPriceBusy] = useState(false);
    const [priceMsg, setPriceMsg] = useState('');
    // My profile (name, phone, photo) — my own editable identity.
    const [profile, setProfile] = useState(null);       // null = loading
    const [profileBusy, setProfileBusy] = useState('');  // '' | 'save' | 'photo'
    const [profileMsg, setProfileMsg] = useState('');
    // My weekly working hours. null = loading; `inherits` = no custom schedule yet.
    const [schedule, setSchedule] = useState(null);
    const [inherits, setInherits] = useState(true);
    const [hoursBusy, setHoursBusy] = useState(false);
    const [hoursMsg, setHoursMsg] = useState('');
    // Password change.
    // Time clock. null = loading, false = failed; else { open, entries, totalMinutes }.
    const [clock, setClock] = useState(null);
    const [clockBusy, setClockBusy] = useState(false);
    const [clockMsg, setClockMsg] = useState('');
    const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
    const [pwBusy, setPwBusy] = useState(false);
    const [pwMsg, setPwMsg] = useState('');   // { ok, text }

    useEffect(() => {
        appointmentService.getAllAppointments({ all: 'true' })
            .then(res => setAppointments(res.data.data || []))
            .catch(() => setAppointments([]));
        myProfileService.get()
            .then(res => setProfile({
                name: res.data.data?.name || '', phone: res.data.data?.phone || '',
                photoUrl: res.data.data?.photoUrl || '', role: res.data.data?.role || '',
                color: res.data.data?.color || '#f03e16',
            }))
            .catch(() => setProfile(false));
        myAvailabilityService.get()
            .then(res => {
                const sched = res.data.data?.schedule;
                if (sched) {
                    const norm = DEFAULT_SCHED();
                    DAYS.forEach(d => {
                        if (sched[d]) norm[d] = { enabled: !!sched[d].enabled, slots: [{ start: sched[d].slots?.[0]?.start || '09:00', end: sched[d].slots?.[0]?.end || '17:00' }] };
                    });
                    setSchedule(norm); setInherits(false);
                } else { setSchedule(DEFAULT_SCHED()); setInherits(true); }
            })
            // On a load failure, HIDE the editor (false) rather than seed all-days-off:
            // showing an all-off default that a member could save would wipe their
            // real hours. The section is gated on `schedule` being truthy.
            .catch(() => setSchedule(false));
        timeClockService.get()
            .then(res => setClock(res.data.data))
            .catch(() => setClock(false));
        myTimeOffService.list()
            .then(res => setTimeOff(res.data.data || []))
            .catch(() => setTimeOff(false));
        myServicesService.get()
            .then(res => {
                setServices(res.data.data?.services || []);
                const selected = (res.data.data?.selected || []).map(String);
                setMySvc(selected);
                // Legacy rows (flag unset) followed the old rule: empty = all.
                const flag = res.data.data?.offersAllServices;
                setOffersAll(flag !== undefined ? flag : selected.length === 0);
                const seed = {};
                (res.data.data?.overrides || []).forEach(o => {
                    seed[String(o.service)] = {
                        price: o.price == null ? '' : String(o.price),
                        duration: o.duration == null ? '' : String(o.duration),
                    };
                });
                setPrices(seed);
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
            // Picking specific services means "only these".
            await myServicesService.set(next, false);
            setSvcMsg('Saved'); setTimeout(() => setSvcMsg(''), 2500);
        } catch (e) {
            setMySvc(prev);
            setSvcMsg(e?.response?.data?.message || 'Could not save');
        } finally { setSvcBusy(false); }
    };

    // Switch between "I perform everything" and "only the services I pick".
    const setServiceMode = async (all) => {
        const prev = offersAll;
        setOffersAll(all); setSvcBusy(true); setSvcMsg('');
        try {
            await myServicesService.set(mySvc, all);
            setSvcMsg('Saved'); setTimeout(() => setSvcMsg(''), 2500);
        } catch (e) {
            setOffersAll(prev);
            setSvcMsg(e?.response?.data?.message || 'Could not save');
        } finally { setSvcBusy(false); }
    };

    const setPrice = (id, key, value) => setPrices(p => ({ ...p, [id]: { ...(p[id] || { price: '', duration: '' }), [key]: value } }));

    // Save my own prices/durations. Only rows where I actually set a value are sent;
    // a blank field means "inherit the business default", so it carries null.
    const saveMyPrices = async () => {
        const rows = Object.entries(prices)
            .map(([service, v]) => ({
                service,
                price: v.price === '' ? null : Number(v.price),
                duration: v.duration === '' ? null : Number(v.duration),
            }))
            .filter(r => r.price != null || r.duration != null);
        if (rows.some(r => (r.price != null && (Number.isNaN(r.price) || r.price < 0))
            || (r.duration != null && (Number.isNaN(r.duration) || r.duration <= 0)))) {
            setPriceMsg('Enter a valid price and duration.'); return;
        }
        setPriceBusy(true); setPriceMsg('');
        try {
            await myServicesService.setPricing(rows);
            setPriceMsg('Saved'); setTimeout(() => setPriceMsg(''), 2500);
        } catch (e) {
            setPriceMsg(e?.response?.data?.message || 'Could not save your prices.');
        } finally { setPriceBusy(false); }
    };

    // ── My profile ──
    const uploadMyPhoto = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setProfileBusy('photo'); setProfileMsg('');
        try {
            const url = await uploadToCloudinary(file);
            await myProfileService.update({ photoUrl: url });
            setProfile(p => ({ ...p, photoUrl: url }));
            setProfileMsg('Photo updated'); setTimeout(() => setProfileMsg(''), 2500);
        } catch { setProfileMsg('Photo upload failed — try again'); }
        finally { setProfileBusy(''); }
    };
    const saveProfile = async () => {
        if (!profile.name.trim()) { setProfileMsg('Your name can’t be empty.'); return; }
        setProfileBusy('save'); setProfileMsg('');
        try {
            await myProfileService.update({ name: profile.name.trim(), phone: profile.phone.trim() });
            setProfileMsg('Saved'); setTimeout(() => setProfileMsg(''), 2500);
        } catch (e) { setProfileMsg(e?.response?.data?.message || 'Could not save your profile.'); }
        finally { setProfileBusy(''); }
    };

    // ── My working hours ──
    const setDay = (day, patch) => setSchedule(s => ({ ...s, [day]: { ...s[day], ...patch } }));
    const setDaySlot = (day, key, value) => setSchedule(s => ({
        ...s, [day]: { ...s[day], slots: [{ ...(s[day].slots?.[0] || { start: '09:00', end: '17:00' }), [key]: value }] },
    }));
    const saveHours = async () => {
        setHoursBusy(true); setHoursMsg('');
        try {
            await myAvailabilityService.set(schedule);
            setInherits(false);
            setHoursMsg('Saved'); setTimeout(() => setHoursMsg(''), 2500);
        } catch (e) { setHoursMsg(e?.response?.data?.message || 'Could not save your hours.'); }
        finally { setHoursBusy(false); }
    };

    // ── Password ──
    const changePassword = async (e) => {
        e.preventDefault();
        setPwMsg('');
        if (pw.next !== pw.confirm) { setPwMsg({ ok: false, text: 'The new passwords don’t match.' }); return; }
        if (!PW_RE.test(pw.next)) { setPwMsg({ ok: false, text: 'Use at least 8 characters with an uppercase letter, a number and a special character.' }); return; }
        setPwBusy(true);
        try {
            await authService.changePassword({ currentPassword: pw.current, newPassword: pw.next });
            setPw({ current: '', next: '', confirm: '' });
            // Changing the password invalidates every session (the server bumps
            // tokenVersion), so this device is now signed out too. Say so, then log
            // out cleanly after a beat rather than letting the next request 401 and
            // bounce them unexpectedly. Leave the button disabled through the logout.
            setPwMsg({ ok: true, text: 'Password changed — signing you out. Please sign in again.' });
            setTimeout(() => { logout(); }, 1800);
        } catch (err) {
            setPwMsg({ ok: false, text: err?.response?.data?.message || 'Could not change your password.' });
            setPwBusy(false);
        }
    };

    const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 3500); };

    // ── Time clock ──
    const punch = async (dir) => {
        if (clockBusy) return;
        setClockBusy(true); setClockMsg('');
        try {
            await (dir === 'in' ? timeClockService.clockIn() : timeClockService.clockOut());
            const res = await timeClockService.get();
            setClock(res.data.data);
            setClockMsg(dir === 'in' ? 'Clocked in' : 'Clocked out'); setTimeout(() => setClockMsg(''), 2500);
        } catch (e) {
            setClockMsg(e?.response?.data?.message || 'Could not update the clock.');
        } finally { setClockBusy(false); }
    };
    const fmtHM = (mins) => `${Math.floor(mins / 60)}h ${mins % 60}m`;
    const fmtClock = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const fmtDay = (iso) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

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

            {/* ── My profile ───────────────────────────────────────── */}
            {profile && profile !== false && (
                <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1.15rem 1.25rem', marginTop: '2rem' }} data-testid="my-profile">
                    <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 700, color: 'var(--charcoal)', margin: '0 0 0.15rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                        <Camera size={16} /> My profile
                    </h2>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: '0 0 1rem' }}>
                        This is how you appear to clients when they book with you.
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                        {profile.photoUrl
                            ? <img src={cloudinaryAvatar(profile.photoUrl, 168)} alt="" style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover' }} />
                            : <span aria-hidden="true" style={{ width: 56, height: 56, borderRadius: '50%', background: profile.color || 'var(--gold)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '1.4rem' }}>{(profile.name || '?').trim().charAt(0).toUpperCase()}</span>}
                        <label className="btn-outline" style={{ padding: '0.45rem 1rem', cursor: profileBusy === 'photo' ? 'default' : 'pointer', fontSize: '0.8rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.4rem', opacity: profileBusy === 'photo' ? 0.6 : 1 }}>
                            <Camera size={15} /> {profileBusy === 'photo' ? 'Uploading…' : profile.photoUrl ? 'Change photo' : 'Add photo'}
                            <input type="file" accept="image/*" onChange={uploadMyPhoto} disabled={profileBusy === 'photo'} style={{ display: 'none' }} data-testid="my-photo" />
                        </label>
                    </div>
                    <div style={{ display: 'grid', gap: '0.7rem', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginTop: '1rem' }}>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                            Name
                            <input className="input" style={{ padding: '0.5rem 0.6rem', fontWeight: 400 }} value={profile.name} onChange={e => setProfile(p => ({ ...p, name: e.target.value }))} data-testid="my-name" />
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                            Phone
                            <input className="input" style={{ padding: '0.5rem 0.6rem', fontWeight: 400 }} value={profile.phone} onChange={e => setProfile(p => ({ ...p, phone: e.target.value }))} data-testid="my-phone" />
                        </label>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '1rem' }}>
                        <button type="button" className="btn-primary" onClick={saveProfile} disabled={profileBusy === 'save'} data-testid="save-my-profile" style={{ padding: '0.5rem 1.3rem' }}>
                            {profileBusy === 'save' ? 'Saving…' : 'Save profile'}
                        </button>
                        {profileMsg && <span style={{ fontSize: '0.82rem', fontWeight: 650, color: profileMsg === 'Saved' || profileMsg === 'Photo updated' ? '#1f8a4c' : 'var(--gold-dark)' }}>{profileMsg}</span>}
                    </div>
                </div>
            )}

            {/* ── My working hours ─────────────────────────────────── */}
            {schedule && (
                <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1.15rem 1.25rem', marginTop: '2rem' }} data-testid="my-hours">
                    <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 700, color: 'var(--charcoal)', margin: '0 0 0.15rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                        <Clock size={16} /> My working hours
                    </h2>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: '0 0 1rem' }}>
                        {inherits
                            ? 'You currently follow the business’s opening hours. Set your own below and save to override them.'
                            : 'Your own weekly hours. Clients can only book you inside these.'}
                    </p>
                    <div style={{ display: 'grid', gap: '0.4rem' }}>
                        {DAYS.map(d => {
                            const cfg = schedule[d];
                            const slot = cfg.slots?.[0] || { start: '09:00', end: '17:00' };
                            return (
                                <div key={d} data-testid="my-hours-row" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', width: '128px', fontSize: '0.85rem', color: 'var(--charcoal)', textTransform: 'capitalize' }}>
                                        <input type="checkbox" checked={cfg.enabled} onChange={e => setDay(d, { enabled: e.target.checked })} data-testid={`my-hours-${d}`} />
                                        {d}
                                    </label>
                                    {cfg.enabled ? (
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                                            <input type="time" className="input" value={slot.start} onChange={e => setDaySlot(d, 'start', e.target.value)} style={{ padding: '0.3rem 0.4rem', width: '110px' }} />
                                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>–</span>
                                            <input type="time" className="input" value={slot.end} onChange={e => setDaySlot(d, 'end', e.target.value)} style={{ padding: '0.3rem 0.4rem', width: '110px' }} />
                                        </span>
                                    ) : (
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Day off</span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '1rem' }}>
                        <button type="button" className="btn-primary" onClick={saveHours} disabled={hoursBusy} data-testid="save-my-hours" style={{ padding: '0.5rem 1.3rem' }}>
                            {hoursBusy ? 'Saving…' : 'Save my hours'}
                        </button>
                        {hoursMsg && <span style={{ fontSize: '0.82rem', fontWeight: 650, color: hoursMsg === 'Saved' ? '#1f8a4c' : 'var(--gold-dark)' }}>{hoursMsg}</span>}
                    </div>
                </div>
            )}

            {/* ── My services ──────────────────────────────────────── */}
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1.15rem 1.25rem', marginTop: '2rem' }} data-testid="my-services">
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 700, color: 'var(--charcoal)', margin: '0 0 0.15rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    <ConciergeBell size={16} /> My services
                </h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: '0 0 1rem' }}>
                    Tell clients what you offer so they’re matched to you correctly.
                </p>

                {services === null && <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading…</p>}
                {services === false && <p style={{ margin: 0, color: 'var(--gold-dark)', fontSize: '0.85rem' }}>Couldn’t load the service list.</p>}
                {Array.isArray(services) && services.length === 0 && (
                    <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>Your business hasn’t added any services yet.</p>
                )}
                {Array.isArray(services) && services.length > 0 && (
                    <>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.75rem' }}>
                            <span style={{ fontSize: '0.85rem', color: 'var(--charcoal)' }}>I offer all services this business books</span>
                            <Switch checked={offersAll} disabled={svcBusy} onChange={setServiceMode} label={offersAll ? 'All' : 'Only selected'} data-testid="my-offers-all-switch" />
                        </div>
                        {!offersAll && (
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
                        )}
                        <p style={{ margin: '0.7rem 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            {offersAll
                                ? 'You perform every service.'
                                : mySvc.length
                                    ? `You perform ${mySvc.length} of ${services.length} service${services.length > 1 ? 's' : ''}.`
                                    : 'You don’t offer any listed services yet — pick the ones you do.'}
                            {svcMsg && <span style={{ marginLeft: '0.5rem', color: svcMsg === 'Saved' ? '#1f8a4c' : 'var(--gold-dark)', fontWeight: 650 }}>{svcMsg}</span>}
                        </p>
                    </>
                )}
            </div>

            {/* ── My prices ────────────────────────────────────────── */}
            {Array.isArray(services) && services.length > 0 && (() => {
                const mine = offersAll ? services : services.filter(s => mySvc.includes(String(s._id)));
                return (
                    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1.15rem 1.25rem', marginTop: '2rem' }} data-testid="my-prices">
                        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 700, color: 'var(--charcoal)', margin: '0 0 0.15rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                            <ConciergeBell size={16} /> My prices
                        </h2>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: '0 0 1rem' }}>
                            Set your own price and length for each service you perform. Leave a field blank to use the business default shown as the placeholder.
                        </p>
                        <div style={{ display: 'grid', gap: '0.6rem' }}>
                            {mine.map(s => {
                                const row = prices[String(s._id)] || { price: '', duration: '' };
                                return (
                                    <div key={s._id} data-testid="my-price-row" style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '0.6rem', alignItems: 'center' }}>
                                        <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--charcoal)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                            N$
                                            <input type="number" min="0" inputMode="decimal" className="input" data-testid="my-price-amount"
                                                value={row.price} placeholder={String(s.price ?? 0)}
                                                onChange={e => setPrice(String(s._id), 'price', e.target.value)}
                                                style={{ width: '84px', padding: '0.4rem 0.5rem' }} />
                                        </label>
                                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                            <input type="number" min="1" inputMode="numeric" className="input" data-testid="my-price-duration"
                                                value={row.duration} placeholder={String(s.duration ?? 0)}
                                                onChange={e => setPrice(String(s._id), 'duration', e.target.value)}
                                                style={{ width: '68px', padding: '0.4rem 0.5rem' }} />
                                            min
                                        </label>
                                    </div>
                                );
                            })}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '1rem' }}>
                            <button type="button" className="btn-primary" onClick={saveMyPrices} disabled={priceBusy} data-testid="save-my-prices" style={{ padding: '0.5rem 1.3rem' }}>
                                {priceBusy ? 'Saving…' : 'Save my prices'}
                            </button>
                            {priceMsg && <span style={{ fontSize: '0.82rem', fontWeight: 650, color: priceMsg === 'Saved' ? '#1f8a4c' : 'var(--gold-dark)' }}>{priceMsg}</span>}
                        </div>
                    </div>
                );
            })()}

            {/* ── Time clock ───────────────────────────────────────── */}
            {clock && clock !== false && (
                <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1.15rem 1.25rem', marginTop: '2rem' }} data-testid="my-timeclock">
                    <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 700, color: 'var(--charcoal)', margin: '0 0 0.15rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                        <Timer size={16} /> Time clock
                    </h2>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: '0 0 1rem' }}>
                        Clock in when you start and out when you finish. {clock.totalMinutes > 0 && <>You’ve logged <strong>{fmtHM(clock.totalMinutes)}</strong> in the last 30 days.</>}
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        {clock.open ? (
                            <>
                                <span style={{ fontSize: '0.9rem', color: 'var(--charcoal)', fontWeight: 600 }} data-testid="clock-status">
                                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#1f8a4c', marginRight: 6 }} />
                                    On the clock since {fmtClock(clock.open.clockIn)}
                                </span>
                                <button type="button" className="btn-primary" onClick={() => punch('out')} disabled={clockBusy} data-testid="clock-out" style={{ padding: '0.5rem 1.3rem' }}>
                                    {clockBusy ? '…' : 'Clock out'}
                                </button>
                            </>
                        ) : (
                            <button type="button" className="btn-primary" onClick={() => punch('in')} disabled={clockBusy} data-testid="clock-in" style={{ padding: '0.5rem 1.3rem' }}>
                                {clockBusy ? '…' : 'Clock in'}
                            </button>
                        )}
                        {clockMsg && <span style={{ fontSize: '0.82rem', fontWeight: 650, color: (clockMsg === 'Clocked in' || clockMsg === 'Clocked out') ? '#1f8a4c' : 'var(--gold-dark)' }}>{clockMsg}</span>}
                    </div>
                    {Array.isArray(clock.entries) && clock.entries.length > 0 && (
                        <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }} data-testid="clock-entries">
                            {clock.entries.slice(0, 8).map((e) => (
                                <div key={e._id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                    <span style={{ minWidth: 92, color: 'var(--charcoal)', fontWeight: 600 }}>{fmtDay(e.clockIn)}</span>
                                    <span>{fmtClock(e.clockIn)} – {e.clockOut ? fmtClock(e.clockOut) : 'now'}</span>
                                    <span style={{ marginLeft: 'auto', fontWeight: 650, color: e.minutes == null ? '#1f8a4c' : 'var(--charcoal)' }}>{e.minutes == null ? 'open' : fmtHM(e.minutes)}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

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

            {/* ── Password ─────────────────────────────────────────── */}
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1.15rem 1.25rem', marginTop: '2rem' }} data-testid="my-password">
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 700, color: 'var(--charcoal)', margin: '0 0 0.15rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    <KeyRound size={16} /> Password
                </h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: '0 0 1rem' }}>
                    Change the password you use to sign in.
                </p>
                <form onSubmit={changePassword} style={{ display: 'grid', gap: '0.7rem', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', maxWidth: '520px' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        Current password
                        <input type="password" className="input" style={{ padding: '0.5rem 0.6rem', fontWeight: 400 }} value={pw.current} onChange={e => setPw(p => ({ ...p, current: e.target.value }))} autoComplete="current-password" required data-testid="pw-current" />
                    </label>
                    <span />
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        New password
                        <input type="password" className="input" style={{ padding: '0.5rem 0.6rem', fontWeight: 400 }} value={pw.next} onChange={e => setPw(p => ({ ...p, next: e.target.value }))} autoComplete="new-password" required data-testid="pw-next" />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        Confirm new password
                        <input type="password" className="input" style={{ padding: '0.5rem 0.6rem', fontWeight: 400 }} value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} autoComplete="new-password" required data-testid="pw-confirm" />
                    </label>
                    <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.25rem' }}>
                        <button type="submit" className="btn-primary" disabled={pwBusy} data-testid="save-password" style={{ padding: '0.5rem 1.3rem' }}>
                            {pwBusy ? 'Saving…' : 'Change password'}
                        </button>
                        {pwMsg && <span style={{ fontSize: '0.82rem', fontWeight: 650, color: pwMsg.ok ? '#1f8a4c' : 'var(--gold-dark)' }}>{pwMsg.text}</span>}
                    </div>
                </form>
            </div>
        </div>
    );
};

export default MySchedule;
