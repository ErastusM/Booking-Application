import React, { useEffect, useState } from 'react';
import { useAuthContext } from '../context/AuthContext';
import { teamService, providerServiceService } from '../services';
import Switch from '../components/Switch';
import { UserPlus, Mail, Clock, Scissors, ChevronDown, Check, Eye, User, BarChart3, Wallet, CalendarCheck, CalendarDays, Coffee, X, Plus, Palmtree, ArrowRightLeft, Star } from 'lucide-react';

/**
 * Epic 2.4 — staff management: roster CRUD, invite-to-login, per-staff
 * weekly hours (absence = inherit business hours), and service assignment
 * ([] = performs every service). Backend: /api/team/* (already live).
 */
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DEFAULT_DAY = { enabled: false, slots: [{ start: '09:00', end: '17:00' }] };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// A 'YYYY-MM-DD' range read the way people say it: "16 Aug", "16–20 Aug",
// "28 Aug – 2 Sep".
const fmtRange = (a, b) => {
    const pa = a.split('-').map(Number);
    const pb = b.split('-').map(Number);
    if (a === b) return `${pa[2]} ${MONTHS[pa[1] - 1]}`;
    if (pa[0] === pb[0] && pa[1] === pb[1]) return `${pa[2]}–${pb[2]} ${MONTHS[pb[1] - 1]}`;
    return `${pa[2]} ${MONTHS[pa[1] - 1]} – ${pb[2]} ${MONTHS[pb[1] - 1]}`;
};
const rangeDays = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000) + 1;
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const Chip = ({ active, disabled, children, ...rest }) => (
    <button type="button" disabled={disabled} {...rest} style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
        padding: '0.4rem 0.85rem', borderRadius: '999px',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1,
        fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: '0.82rem',
        border: `1.5px solid ${active ? 'var(--gold)' : 'var(--border)'}`,
        background: active ? 'rgba(240,62,22,0.10)' : 'var(--card-bg)',
        color: active ? 'var(--gold-dark)' : 'var(--text-secondary)',
    }}>{children}</button>
);

const TABS = [
    { key: 'overview',  label: 'Overview',  Icon: BarChart3 },
    { key: 'personal',  label: 'Personal',  Icon: User },
    { key: 'workspace', label: 'Workspace', Icon: CalendarCheck },
    { key: 'pay',       label: 'Pay',       Icon: Wallet },
];

const Section = ({ icon: Icon, title, hint, children }) => (
    <div style={{ marginTop: '1.25rem' }}>
        <p style={{ margin: '0 0 0.5rem', fontWeight: 600, fontSize: '0.85rem', color: 'var(--charcoal)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Icon size={14} /> {title}
            {hint && <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>{hint}</span>}
        </p>
        {children}
    </div>
);

// A metric with no answer prints an em dash, never a zero: "we cannot say" and
// "they did none" are different facts and must not look the same.
const Stat = ({ label, value, suffix, note }) => (
    <div style={{ padding: '0.75rem 0.85rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--card-bg)' }}>
        <div style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{label}</div>
        <div className="tnum" style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem', fontWeight: 700, color: 'var(--charcoal)', lineHeight: 1.2 }}>
            {value === null || value === undefined ? '—' : value}{value === null || value === undefined ? '' : (suffix || '')}
        </div>
        {note && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>{note}</div>}
    </div>
);

const Field = ({ label, ...rest }) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
        {label}
        <input className="input" style={{ padding: '0.5rem 0.6rem', fontWeight: 400 }} {...rest} />
    </label>
);

const MemberCard = ({ member, services, colleagues, onChanged }) => {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState('');
    const [msg, setMsg] = useState('');
    const [assigned, setAssigned] = useState((member.services || []).map(String));
    // Per-member price/duration overrides, keyed by service id. '' = inherit the
    // business default. Seeded from the member's saved serviceOverrides.
    const [overrides, setOverrides] = useState(() => Object.fromEntries(
        (member.serviceOverrides || []).map(o => [String(o.service?._id || o.service), {
            price: o.price ?? '', duration: o.duration ?? '',
        }])
    ));
    const [schedule, setSchedule] = useState(null); // null = inherits business hours
    const [inviteEmail, setInviteEmail] = useState(member.email || '');
    const [inviteResult, setInviteResult] = useState(null); // sticky {ok, email, error} after a send
    const [handoverTo, setHandoverTo] = useState('');
    const [handoverResult, setHandoverResult] = useState(null); // sticky {moved, skipped, toName, error} after a run
    // Login lifecycle for the status line: no account → roster only; account but
    // never signed in → invited/awaiting; signed in at least once → active.
    const hasLogin = !!member.user;
    const loggedIn = !!(member.user && member.user.lastLoginAt);
    const invitedPending = hasLogin && !loggedIn;
    const perms = member.user?.staffPermissions || [];
    const [seesAll, setSeesAll] = useState(perms.includes('calendar:all'));
    const [tab, setTab] = useState('overview');
    const [stats, setStats] = useState(null);      // null = not fetched, false = failed
    const [bookable, setBookable] = useState(member.bookable !== false);
    const [primary, setPrimary] = useState(member.isPrimary === true);
    const todayKey = new Date().toISOString().slice(0, 10);
    // The shift editor only fetches shifts for today..+60d, so a date beyond that
    // window would show as "no shift" and silently overwrite an existing far-future
    // one on save. Cap the picker to the same horizon so the UI and the data it
    // loaded can never disagree about whether a date already has a shift.
    const maxShiftKey = (() => { const d = new Date(); d.setDate(d.getDate() + 60); return d.toISOString().slice(0, 10); })();
    const [shiftDate, setShiftDate] = useState(todayKey);
    const [shifts, setShifts] = useState(null);          // upcoming shifts already set
    const [slots, setSlots] = useState([{ start: '09:00', end: '17:00' }]);
    const [breaks, setBreaks] = useState([]);
    const [shiftErr, setShiftErr] = useState('');
    const [timeOff, setTimeOff] = useState(null);        // null = unfetched, false = failed
    const [toForm, setToForm] = useState({ startDate: todayKey, endDate: todayKey, allDay: true, startTime: '09:00', endTime: '13:00', type: 'vacation', note: '' });
    const [toBusy, setToBusy] = useState('');
    const [toErr, setToErr] = useState('');
    const [personal, setPersonal] = useState({
        name: member.name || '', role: member.role || '', email: member.email || '',
        phone: member.phone || '', country: member.country || '', address: member.address || '',
        emergencyName: member.emergencyContact?.name || '',
        emergencyPhone: member.emergencyContact?.phone || '',
    });

    useEffect(() => {
        // Pay reads the same figures as Overview, so it must trigger the fetch
        // too — otherwise opening the card and going straight to Pay shows em
        // dashes for numbers we actually have.
        if (!open || (tab !== 'overview' && tab !== 'pay') || stats !== null) return;
        teamService.getMemberStats(member._id)
            .then(res => setStats(res.data.data))
            .catch(() => setStats(false));
    }, [open, tab]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!open || tab !== 'workspace' || schedule !== null) return;
        teamService.getMemberAvailability(member._id)
            .then(res => setSchedule(res.data.data?.schedule || 'inherit'))
            .catch(() => setSchedule('inherit'));
    }, [open, tab]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!open || tab !== 'workspace' || shifts !== null) return;
        const to = new Date(); to.setDate(to.getDate() + 60);
        teamService.getMemberShifts(member._id, todayKey, to.toISOString().slice(0, 10))
            .then(res => setShifts(res.data.data || []))
            // `false`, not `[]`: a failed fetch must not read as "this member has
            // no shifts". Saving on top of that assumption replaces a day off the
            // owner never saw with a default 9-to-5.
            .catch(() => setShifts(false));
    }, [open, tab]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!open || tab !== 'workspace' || timeOff !== null) return;
        // No date window — fetch all of this member's leave. Windowing it hid leave
        // the owner had just added (past dates, or further out than the window),
        // which read as a failed save and produced invisible duplicates on retry.
        teamService.getMemberTimeOff(member._id)
            .then(res => setTimeOff(res.data.data || []))
            .catch(() => setTimeOff(false));
    }, [open, tab]); // eslint-disable-line react-hooks/exhaustive-deps

    // Editing a date that already has a shift should show that shift, not a
    // blank 9-to-5 that would silently overwrite it on save.
    useEffect(() => {
        if (!Array.isArray(shifts)) return;      // not loaded, or failed — don't seed from nothing
        const existing = shifts.find(sh => sh.date === shiftDate);
        setSlots(existing ? existing.slots.map(x => ({ start: x.start, end: x.end })) : [{ start: '09:00', end: '17:00' }]);
        setBreaks(existing ? existing.breaks.map(b => ({ start: b.start, end: b.end, label: b.label || 'Break' })) : []);
        setShiftErr('');
    }, [shiftDate, shifts]);

    const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 3500); };

    const refreshShifts = async () => {
        const to = new Date(); to.setDate(to.getDate() + 60);
        const res = await teamService.getMemberShifts(member._id, todayKey, to.toISOString().slice(0, 10));
        setShifts(res.data.data || []);
    };

    const saveShift = async () => {
        setBusy('shift'); setShiftErr('');
        try {
            // A day off has no breaks. Sending the leftovers would be refused
            // ("that break falls outside the working hours") for what the owner
            // experiences as simply marking someone off — the state is invalid,
            // so don't let the UI produce it.
            await teamService.setMemberShift(member._id, { date: shiftDate, slots, breaks: slots.length ? breaks : [] });
            await refreshShifts();
            flash(slots.length ? `Shift saved for ${shiftDate}.` : `${member.name} is off on ${shiftDate}.`);
        } catch (err) {
            setShiftErr(err?.response?.data?.message || 'Could not save that shift.');
        } finally { setBusy(''); }
    };

    const clearShift = async () => {
        setBusy('shift'); setShiftErr('');
        try {
            await teamService.clearMemberShift(member._id, shiftDate);
            await refreshShifts();
            flash('Back to their usual hours for that day.');
        } catch {
            setShiftErr('Could not clear that shift.');
        } finally { setBusy(''); }
    };

    // A failed refetch must NOT be reported as a failed mutation — the write
    // already succeeded, and telling the owner it failed makes them retry and
    // create a duplicate. Refresh failures are swallowed (the list just stays as
    // it was) rather than surfaced as the operation's error.
    const refreshTimeOff = () => teamService.getMemberTimeOff(member._id)
        .then(res => setTimeOff(res.data.data || []))
        .catch(() => {});

    // Approving/adding leave doesn't move existing bookings; the API returns how
    // many now overlap so the owner knows to reschedule them.
    const flashOverlap = (res, base) => {
        const n = res?.data?.overlappingBookings || 0;
        flash(n > 0 ? `${base} ${n} existing booking${n > 1 ? 's' : ''} overlap — reschedule or cancel ${n > 1 ? 'them' : 'it'}.` : base);
    };

    const addTimeOff = async () => {
        if (toForm.endDate < toForm.startDate) { setToErr('The end date can’t be before the start date.'); return; }
        setToBusy('add'); setToErr('');
        try {
            const body = { startDate: toForm.startDate, endDate: toForm.endDate, allDay: toForm.allDay, type: toForm.type, note: toForm.note.trim() };
            if (!toForm.allDay) { body.startTime = toForm.startTime; body.endTime = toForm.endTime; }
            const res = await teamService.addMemberTimeOff(member._id, body);
            setToForm(f => ({ ...f, note: '' }));
            flashOverlap(res, 'Time off added.');
        } catch (err) {
            setToErr(err?.response?.data?.message || 'Could not add that time off.');
            setToBusy(''); return;
        }
        await refreshTimeOff();
        setToBusy('');
    };

    const decideTimeOff = async (id, status) => {
        setToBusy(id); setToErr('');
        try {
            const res = await teamService.decideMemberTimeOff(member._id, id, status);
            if (status === 'approved') flashOverlap(res, 'Leave approved.');
            else flash('Request declined.');
        } catch (err) {
            setToErr(err?.response?.data?.message || 'Could not update that request.');
            setToBusy(''); return;
        }
        await refreshTimeOff();
        setToBusy('');
    };

    const removeTimeOff = async (id) => {
        setToBusy(id); setToErr('');
        try {
            await teamService.removeMemberTimeOff(member._id, id);
        } catch (err) {
            setToErr(err?.response?.data?.message || 'Could not remove that time off.');
            setToBusy(''); return;
        }
        await refreshTimeOff();
        setToBusy('');
    };

    const setCalendarAccess = async (next) => {
        const previous = seesAll;
        setSeesAll(next);            // optimistic — the switch should feel instant
        setBusy('perms');
        try {
            // The permissions endpoint replaces the whole set, so send every flag
            // this member already holds with only the calendar one flipped —
            // sending a bare ['calendar:all'] wiped their other flags (clients:
            // assigned and anything added later) on every toggle. calendar:self is
            // the ABSENCE of calendar:all, sent so the stored flags read sensibly.
            const others = perms.filter((p) => p !== 'calendar:all' && p !== 'calendar:self');
            await teamService.setMemberPermissions(member._id, [...others, next ? 'calendar:all' : 'calendar:self']);
            flash(next
                ? `${member.name} can now see everyone's calendar.`
                : `${member.name} now sees only their own bookings.`);
            onChanged();
        } catch (err) {
            setSeesAll(previous);
            flash(err?.response?.data?.message || 'Could not change calendar access.');
        } finally {
            setBusy('');
        }
    };

    const savePersonal = async () => {
        if (!personal.name.trim()) { flash('A name is required.'); return; }
        setBusy('personal');
        try {
            // Send only what the owner actually changed. The form is seeded once at
            // mount, so sending every field re-asserts stale values — saving a phone
            // number would push back the email this card was mounted with and wipe
            // the address the invite flow stored afterwards.
            const draft = {
                name: personal.name.trim(), role: personal.role.trim(), email: personal.email.trim(),
                phone: personal.phone.trim(), country: personal.country.trim(), address: personal.address.trim(),
            };
            const patch = {};
            Object.entries(draft).forEach(([k, v]) => { if (v !== (member[k] || '')) patch[k] = v; });
            const eName = personal.emergencyName.trim();
            const ePhone = personal.emergencyPhone.trim();
            if (eName !== (member.emergencyContact?.name || '') || ePhone !== (member.emergencyContact?.phone || '')) {
                patch.emergencyContact = { name: eName, phone: ePhone };
            }
            if (Object.keys(patch).length === 0) { flash('Nothing to save.'); setBusy(''); return; }
            await teamService.updateMember(member._id, patch);
            flash('Details saved');
            onChanged();
        } catch (err) {
            flash(err?.response?.data?.message || 'Could not save details');
        } finally { setBusy(''); }
    };

    const toggleBookable = async (next) => {
        const previous = bookable;
        setBookable(next);
        setBusy('bookable');
        try {
            await teamService.updateMember(member._id, { bookable: next });
            flash(next ? `${member.name} can be booked by clients.` : `${member.name} is on the team but not bookable.`);
            onChanged();
        } catch {
            setBookable(previous);
            flash('Could not change bookability');
        } finally { setBusy(''); }
    };

    const togglePrimary = async (next) => {
        const previous = primary;
        setPrimary(next);
        setBusy('primary');
        try {
            await teamService.setMemberPrimary(member._id, next);
            flash(next ? `${member.name} is now the primary member — shown first.` : `${member.name} is no longer the primary member.`);
            onChanged(); // refresh so a previously-primary colleague reflects the change
        } catch {
            setPrimary(previous);
            flash('Could not change the primary member');
        } finally { setBusy(''); }
    };

    const invite = async () => {
        setBusy('invite');
        setInviteResult(null);
        try {
            const res = await teamService.inviteMember(member._id, inviteEmail ? { email: inviteEmail } : {});
            const data = res?.data?.data || {};
            const to = data.email || inviteEmail;
            setInviteResult({ ok: !!data.emailSent, email: to });
            onChanged();
        } catch (err) {
            setInviteResult({ ok: false, error: err.response?.data?.message || 'Invite failed' });
        } finally { setBusy(''); }
    };

    const handover = async () => {
        const target = colleagues.find(c => String(c._id) === handoverTo);
        if (!target) return;
        if (!window.confirm(`Move ALL of ${member.name}'s upcoming bookings to ${target.name}? Anything that would double-book ${target.name} stays put and is listed after.`)) return;
        setBusy('handover');
        setHandoverResult(null);
        try {
            const res = await teamService.handoverBookings(member._id, handoverTo);
            const data = res?.data?.data || {};
            setHandoverResult({ moved: data.moved || 0, skipped: data.skipped || [], toName: target.name });
            onChanged();
        } catch (err) {
            setHandoverResult({ error: err.response?.data?.message || 'Could not move the bookings.' });
        } finally { setBusy(''); }
    };

    const toggleService = async (id) => {
        const next = assigned.includes(id) ? assigned.filter(x => x !== id) : [...assigned, id];
        setAssigned(next);
        setBusy('services');
        try { await teamService.setMemberServices(member._id, next); flash('Services updated'); }
        catch { flash('Could not update services'); setAssigned(assigned); }
        finally { setBusy(''); }
    };

    const setOverride = (id, key, value) =>
        setOverrides(o => ({ ...o, [id]: { ...(o[id] || { price: '', duration: '' }), [key]: value } }));

    const savePricing = async () => {
        // Send only rows that actually override something; '' means inherit.
        const serviceOverrides = Object.entries(overrides)
            .map(([service, v]) => ({
                service,
                price: v.price === '' ? null : Number(v.price),
                duration: v.duration === '' ? null : Number(v.duration),
            }))
            .filter(r => r.price != null || r.duration != null);
        setBusy('pricing');
        try { await teamService.setMemberPricing(member._id, serviceOverrides); flash('Prices saved'); onChanged?.(); }
        catch (err) { flash(err?.response?.data?.message || 'Could not save prices'); }
        finally { setBusy(''); }
    };

    const saveHours = async () => {
        if (schedule === 'inherit' || !schedule) return;
        setBusy('hours');
        try { await teamService.updateMemberAvailability(member._id, schedule); flash('Hours saved'); }
        catch (err) { flash(err?.response?.data?.message || 'Could not save hours'); }
        finally { setBusy(''); }
    };

    const startCustomHours = () => {
        const base = {};
        DAYS.forEach(d => { base[d] = { ...DEFAULT_DAY, enabled: !['saturday', 'sunday'].includes(d) }; });
        setSchedule(base);
    };

    const setDay = (day, patch) => setSchedule(s => ({ ...s, [day]: { ...s[day], ...patch } }));
    const setSlot = (day, key, value) => setSchedule(s => ({
        ...s, [day]: { ...s[day], slots: [{ ...(s[day].slots?.[0] || DEFAULT_DAY.slots[0]), [key]: value }] },
    }));

    return (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: '1rem', overflow: 'hidden' }} data-testid="team-member-card">
            <button type="button" onClick={() => setOpen(o => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.85rem', padding: '1rem 1.25rem', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-body)' }}>
                <span aria-hidden="true" style={{ width: '14px', height: '14px', borderRadius: '50%', background: member.color || 'var(--gold)', flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, color: 'var(--charcoal)', fontSize: '0.98rem' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{member.name}</span>
                        {primary && <span style={{ flexShrink: 0, fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gold-dark)', background: 'rgba(240,62,22,0.10)', borderRadius: '5px', padding: '0.1rem 0.35rem' }}>Primary</span>}
                    </span>
                    <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                        {member.role || 'Staff'}
                        {!hasLogin ? ' · roster only' : loggedIn ? ' · active' : ' · invited, awaiting login'}
                        {(member.services || []).length ? ` · ${member.services.length} service${member.services.length > 1 ? 's' : ''}` : ' · all services'}
                    </span>
                </span>
                {loggedIn
                    ? <Check size={16} style={{ color: 'var(--success)', flexShrink: 0 }} aria-label="Active" />
                    : invitedPending
                        ? <Mail size={15} style={{ color: 'var(--gold-dark)', flexShrink: 0 }} aria-label="Invited, awaiting login" />
                        : null}
                <ChevronDown size={18} style={{ color: 'var(--text-muted)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }} />
            </button>

            {open && (
                <div style={{ padding: '0 1.25rem 1.25rem', borderTop: '1px solid var(--border)' }}>
                    {/* Tab bar */}
                    <div role="tablist" aria-label={`${member.name} profile`} style={{
                        display: 'flex', gap: '0.15rem', flexWrap: 'wrap',
                        borderBottom: '1px solid var(--border)', margin: '0 -1.25rem 0', padding: '0 1.25rem',
                    }}>
                        {TABS.map(({ key, label, Icon }) => {
                            const active = tab === key;
                            return (
                                <button
                                    key={key}
                                    type="button"
                                    role="tab"
                                    aria-selected={active}
                                    onClick={() => setTab(key)}
                                    data-testid={`tab-${key}`}
                                    style={{
                                        display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                                        padding: '0.6rem 0.8rem', border: 'none', background: 'transparent',
                                        cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.82rem',
                                        fontWeight: 600, color: active ? 'var(--gold-dark)' : 'var(--text-muted)',
                                        borderBottom: `2px solid ${active ? 'var(--gold)' : 'transparent'}`,
                                        marginBottom: '-1px',
                                    }}
                                >
                                    <Icon size={14} /> {label}
                                </button>
                            );
                        })}
                    </div>

                    {msg && <p style={{ margin: '0.85rem 0 0', fontSize: '0.83rem', color: 'var(--gold-dark)', fontWeight: 600 }} data-testid="team-flash">{msg}</p>}

                    {/* ── Overview ───────────────────────────────────────── */}
                    {tab === 'overview' && (
                        <div style={{ marginTop: '1.1rem' }} data-testid="panel-overview">
                            {stats === null && <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading…</p>}
                            {stats === false && <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>Could not load performance right now.</p>}
                            {stats && (
                                <>
                                    <div style={{ display: 'grid', gap: '0.6rem', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
                                        <Stat label="Appointments" value={stats.appointments} note={`last ${stats.windowDays} days`} />
                                        <Stat label="Revenue" value={stats.revenue != null ? `N$${stats.revenue.toLocaleString()}` : null} note="completed only" />
                                        <Stat label="Clients" value={stats.clients} note="registered accounts" />
                                        <Stat label="Occupancy" value={stats.occupancy} suffix="%" note="booked ÷ scheduled" />
                                        <Stat label="Retention" value={stats.retention} suffix="%" note="booked more than once" />
                                        <Stat label="Rating" value={stats.rating} note={stats.reviews ? `${stats.reviews} review${stats.reviews > 1 ? 's' : ''}` : 'no reviews yet'} />
                                        <Stat label="Upcoming" value={stats.upcoming} note="still to come" />
                                    </div>
                                    <p style={{ margin: '0.8rem 0 0', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                        Occupancy counts scheduled hours from their working hours, not from shifts —
                                        a day taken as time off still counts as scheduled until shifts land.
                                    </p>
                                </>
                            )}
                        </div>
                    )}

                    {/* ── Personal ───────────────────────────────────────── */}
                    {tab === 'personal' && (
                        <div style={{ marginTop: '1.1rem' }} data-testid="panel-personal">
                            <div style={{ display: 'grid', gap: '0.7rem', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                                <Field label="Name" value={personal.name} onChange={e => setPersonal(p => ({ ...p, name: e.target.value }))} data-testid="personal-name" />
                                <Field label="Job title" value={personal.role} onChange={e => setPersonal(p => ({ ...p, role: e.target.value }))} placeholder="Barber" />
                                <Field label="Email" type="email" value={personal.email} onChange={e => setPersonal(p => ({ ...p, email: e.target.value }))} />
                                <Field label="Phone" value={personal.phone} onChange={e => setPersonal(p => ({ ...p, phone: e.target.value }))} />
                                <Field label="Country" value={personal.country} onChange={e => setPersonal(p => ({ ...p, country: e.target.value }))} placeholder="Namibia" />
                                <Field label="Address" value={personal.address} onChange={e => setPersonal(p => ({ ...p, address: e.target.value }))} />
                                <Field label="Emergency contact" value={personal.emergencyName} onChange={e => setPersonal(p => ({ ...p, emergencyName: e.target.value }))} />
                                <Field label="Emergency phone" value={personal.emergencyPhone} onChange={e => setPersonal(p => ({ ...p, emergencyPhone: e.target.value }))} />
                            </div>
                            <p style={{ margin: '0.7rem 0 0', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                Only a name is required. Everything else is optional.
                            </p>
                            <button type="button" className="btn-primary" onClick={savePersonal} disabled={busy === 'personal'} data-testid="save-personal" style={{ marginTop: '0.7rem', padding: '0.55rem 1.4rem' }}>
                                {busy === 'personal' ? 'Saving…' : 'Save details'}
                            </button>
                        </div>
                    )}

                    {/* ── Workspace ──────────────────────────────────────── */}
                    {tab === 'workspace' && (
                        <div data-testid="panel-workspace">
                            {/* Sticky result of the last invite — stays put after the roster
                                reloads (which flips this member to "has login"), so the owner
                                keeps the confirmation that the email actually went out. */}
                            {inviteResult && (
                                <div
                                    data-testid="invite-result"
                                    style={{
                                        margin: '1rem 0 0', padding: '0.7rem 0.9rem', borderRadius: 'var(--radius)',
                                        fontSize: '0.83rem', lineHeight: 1.5,
                                        border: `1px solid ${inviteResult.ok ? '#6ee7b7' : '#fca5a5'}`,
                                        background: inviteResult.ok ? '#d1fae5' : '#fef2f2',
                                        color: inviteResult.ok ? '#065f46' : '#991b1b',
                                    }}
                                >
                                    {inviteResult.ok
                                        ? <><strong>Invite email sent</strong> to {inviteResult.email}. They set a password from the link and then appear as active here.</>
                                        : <><strong>Saved, but the invite email didn’t send{inviteResult.email ? ` to ${inviteResult.email}` : ''}.</strong> {inviteResult.error ? inviteResult.error : 'Check the address and resend below.'}</>}
                                </div>
                            )}

                            {!loggedIn && (
                                <Section icon={Mail} title="Invite to log in">
                                    {invitedPending && (
                                        <p style={{ margin: '0 0 0.6rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                            Invited — waiting for them to set a password and sign in. Resend the email if it didn’t arrive.
                                        </p>
                                    )}
                                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                        <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="their@email.com" className="input" style={{ maxWidth: '260px' }} data-testid="invite-email" />
                                        <button type="button" className="btn-primary" onClick={invite} disabled={busy === 'invite'} data-testid="invite-send" style={{ padding: '0.6rem 1.3rem' }}>
                                            {busy === 'invite' ? 'Sending…' : invitedPending ? 'Resend invite' : 'Send invite'}
                                        </button>
                                    </div>
                                </Section>
                            )}

                            <Section icon={CalendarCheck} title="Bookable">
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', padding: '0.7rem 0.85rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: '40ch' }}>
                                        {bookable
                                            ? 'Clients can pick them when booking.'
                                            : 'On the team, but never offered to clients — for managers and front desk.'}
                                    </span>
                                    <Switch checked={bookable} disabled={busy === 'bookable'} onChange={toggleBookable} label={bookable ? 'Bookable' : 'Not bookable'} data-testid="bookable-switch" />
                                </div>
                            </Section>

                            <Section icon={Star} title="Primary member" hint="(the face of the business — shown first)">
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', padding: '0.7rem 0.85rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: '40ch' }}>
                                        {primary
                                            ? `${member.name} is listed first on your profile and in the booking flow.`
                                            : 'Make them first in the roster everywhere clients choose a professional.'}
                                    </span>
                                    <Switch checked={primary} disabled={busy === 'primary'} onChange={togglePrimary} label={primary ? 'Primary' : 'Not primary'} data-testid="primary-switch" />
                                </div>
                            </Section>

                            {colleagues.length > 0 && (
                                <Section icon={ArrowRightLeft} title="Hand over bookings" hint="(moves their upcoming bookings to a colleague)">
                                    <div style={{ padding: '0.7rem 0.85rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                            <select className="input" value={handoverTo} onChange={e => setHandoverTo(e.target.value)}
                                                data-testid="handover-target" style={{ maxWidth: '240px', padding: '0.5rem 0.6rem' }}>
                                                <option value="">Who takes them?</option>
                                                {colleagues.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
                                            </select>
                                            <button type="button" className="btn-primary" onClick={handover} disabled={!handoverTo || busy === 'handover'}
                                                data-testid="handover-send" style={{ padding: '0.5rem 1.2rem' }}>
                                                {busy === 'handover' ? 'Moving…' : 'Move bookings'}
                                            </button>
                                        </div>
                                        <p style={{ margin: '0.5rem 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                            For when clients booked the wrong person. Every upcoming booking moves; anything that would
                                            double-book the colleague stays with {member.name} and is listed here.
                                        </p>
                                        {handoverResult && (
                                            <div data-testid="handover-result" style={{
                                                marginTop: '0.6rem', padding: '0.6rem 0.8rem', borderRadius: 'var(--radius)',
                                                fontSize: '0.83rem', lineHeight: 1.5,
                                                border: `1px solid ${handoverResult.error ? '#fca5a5' : '#6ee7b7'}`,
                                                background: handoverResult.error ? '#fef2f2' : '#d1fae5',
                                                color: handoverResult.error ? '#991b1b' : '#065f46',
                                            }}>
                                                {handoverResult.error ? handoverResult.error : <>
                                                    <strong>Moved {handoverResult.moved} booking{handoverResult.moved === 1 ? '' : 's'}</strong> to {handoverResult.toName}.
                                                    {handoverResult.skipped.length > 0 && <>
                                                        {' '}{handoverResult.skipped.length} stayed with {member.name} ({handoverResult.toName} is already booked then):{' '}
                                                        {handoverResult.skipped.map(s => `${fmtRange(s.date, s.date)} ${s.startTime}`).join(', ')}. Reschedule those by hand from the calendar.
                                                    </>}
                                                </>}
                                            </div>
                                        )}
                                    </div>
                                </Section>
                            )}

                            {member.user && (
                                <Section icon={Eye} title="Calendar access">
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', padding: '0.7rem 0.85rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                                        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: '40ch' }}>
                                            {seesAll
                                                ? `${member.name} can open every colleague's calendar and the Staff view.`
                                                : `${member.name} sees only their own bookings. Colleagues' appointments are hidden entirely.`}
                                        </span>
                                        <Switch checked={seesAll} disabled={busy === 'perms'} onChange={setCalendarAccess} label={seesAll ? 'Everyone' : 'Own only'} data-testid="calendar-access-switch" />
                                    </div>
                                </Section>
                            )}

                            <Section icon={Scissors} title="Services & prices" hint="(none selected = performs all · blank price/time = business default)">
                                <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                                    {services.map(svc => (
                                        <Chip key={svc._id} active={assigned.includes(String(svc._id))} disabled={busy === 'services'} onClick={() => toggleService(String(svc._id))} data-testid="member-service-chip">
                                            {svc.name}
                                        </Chip>
                                    ))}
                                    {services.length === 0 && <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>No services yet — add services first.</p>}
                                </div>
                                {(() => {
                                    const performed = assigned.length ? services.filter(s => assigned.includes(String(s._id))) : services;
                                    if (!performed.length) return null;
                                    return (
                                        <div style={{ marginTop: '0.9rem', display: 'grid', gap: '0.5rem' }}>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 6.5rem 6.5rem', gap: '0.5rem', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                                                <span>{member.name.split(' ')[0]}’s service</span><span>Price</span><span>Minutes</span>
                                            </div>
                                            {performed.map(svc => {
                                                const ov = overrides[String(svc._id)] || { price: '', duration: '' };
                                                return (
                                                    <div key={svc._id} style={{ display: 'grid', gridTemplateColumns: '1fr 6.5rem 6.5rem', gap: '0.5rem', alignItems: 'center' }}>
                                                        <span style={{ fontSize: '0.85rem', color: 'var(--charcoal)' }}>{svc.name}</span>
                                                        <input className="input" type="number" min="0" inputMode="decimal"
                                                            placeholder={svc.price != null ? String(svc.price) : '—'}
                                                            value={ov.price}
                                                            onChange={e => setOverride(String(svc._id), 'price', e.target.value)}
                                                            data-testid="member-price" style={{ padding: '0.4rem 0.5rem' }} />
                                                        <input className="input" type="number" min="1" inputMode="numeric"
                                                            placeholder={svc.duration != null ? String(svc.duration) : '—'}
                                                            value={ov.duration}
                                                            onChange={e => setOverride(String(svc._id), 'duration', e.target.value)}
                                                            data-testid="member-duration" style={{ padding: '0.4rem 0.5rem' }} />
                                                    </div>
                                                );
                                            })}
                                            <div>
                                                <button type="button" className="btn-primary" disabled={busy === 'pricing'} onClick={savePricing} style={{ marginTop: '0.15rem' }}>
                                                    {busy === 'pricing' ? 'Saving…' : 'Save prices'}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })()}
                            </Section>

                            <Section icon={CalendarDays} title="Shifts" hint="(one date at a time — overrides their usual hours)">
                                <div style={{ padding: '0.75rem 0.85rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                                        Date
                                        <input type="date" className="input" value={shiftDate} min={todayKey} max={maxShiftKey}
                                            onChange={e => setShiftDate(e.target.value)}
                                            data-testid="shift-date" style={{ width: '170px', padding: '0.4rem 0.5rem', fontWeight: 400 }} />
                                        {!Array.isArray(shifts)
                                            ? <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                                                {shifts === false ? 'Couldn’t load existing shifts' : 'Loading shifts…'}
                                              </span>
                                            : shifts.some(sh => sh.date === shiftDate)
                                                ? <span style={{ fontSize: '0.72rem', color: 'var(--gold-dark)', fontWeight: 600 }}>Shift set</span>
                                                : <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500 }}>Using their usual hours</span>}
                                    </label>

                                    <div style={{ marginTop: '0.7rem' }}>
                                        <p style={{ margin: '0 0 0.35rem', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Working</p>
                                        {slots.length === 0 && (
                                            <p style={{ margin: '0 0 0.4rem', fontSize: '0.82rem', color: 'var(--gold-dark)', fontWeight: 600 }} data-testid="shift-day-off">
                                                Rostered off — no bookings that day.
                                            </p>
                                        )}
                                        {slots.map((sl, i) => (
                                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
                                                <input type="time" className="input" value={sl.start} data-testid="shift-start"
                                                    onChange={e => setSlots(v => v.map((x, j) => j === i ? { ...x, start: e.target.value } : x))}
                                                    style={{ width: '108px', padding: '0.35rem 0.5rem' }} />
                                                <span style={{ color: 'var(--text-muted)' }}>–</span>
                                                <input type="time" className="input" value={sl.end} data-testid="shift-end"
                                                    onChange={e => setSlots(v => v.map((x, j) => j === i ? { ...x, end: e.target.value } : x))}
                                                    style={{ width: '108px', padding: '0.35rem 0.5rem' }} />
                                                <button type="button" aria-label="Remove working period" onClick={() => setSlots(v => v.filter((_, j) => j !== i))}
                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.2rem' }}>
                                                    <X size={15} />
                                                </button>
                                            </div>
                                        ))}
                                        <button type="button" className="btn-outline" data-testid="add-slot"
                                            onClick={() => setSlots(v => [...v, { start: '09:00', end: '17:00' }])}
                                            style={{ padding: '0.3rem 0.7rem', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                                            <Plus size={13} /> {slots.length ? 'Add another' : 'Add hours'}
                                        </button>
                                    </div>

                                    {slots.length > 0 && (
                                    <div style={{ marginTop: '0.8rem' }}>
                                        <p style={{ margin: '0 0 0.35rem', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                            <Coffee size={12} /> Breaks
                                        </p>
                                        {breaks.map((b, i) => (
                                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
                                                <input type="time" className="input" value={b.start} data-testid="break-start"
                                                    onChange={e => setBreaks(v => v.map((x, j) => j === i ? { ...x, start: e.target.value } : x))}
                                                    style={{ width: '108px', padding: '0.35rem 0.5rem' }} />
                                                <span style={{ color: 'var(--text-muted)' }}>–</span>
                                                <input type="time" className="input" value={b.end}
                                                    onChange={e => setBreaks(v => v.map((x, j) => j === i ? { ...x, end: e.target.value } : x))}
                                                    style={{ width: '108px', padding: '0.35rem 0.5rem' }} />
                                                <input className="input" value={b.label} placeholder="Lunch"
                                                    onChange={e => setBreaks(v => v.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                                                    style={{ width: '110px', padding: '0.35rem 0.5rem' }} />
                                                <button type="button" aria-label="Remove break" onClick={() => setBreaks(v => v.filter((_, j) => j !== i))}
                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.2rem' }}>
                                                    <X size={15} />
                                                </button>
                                            </div>
                                        ))}
                                        <button type="button" className="btn-outline" data-testid="add-break"
                                            onClick={() => setBreaks(v => [...v, { start: '13:00', end: '14:00', label: 'Lunch' }])}
                                            style={{ padding: '0.3rem 0.7rem', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                                            <Plus size={13} /> Add a break
                                        </button>
                                    </div>
                                    )}

                                    {shiftErr && <p style={{ margin: '0.6rem 0 0', fontSize: '0.8rem', color: 'var(--danger, #c2321a)', fontWeight: 600 }} data-testid="shift-error">{shiftErr}</p>}

                                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                                        <button type="button" className="btn-primary" onClick={saveShift} disabled={busy === 'shift' || !Array.isArray(shifts)} data-testid="save-shift" style={{ padding: '0.5rem 1.2rem' }}>
                                            {busy === 'shift' ? 'Saving…' : 'Save shift'}
                                        </button>
                                        {Array.isArray(shifts) && shifts.some(sh => sh.date === shiftDate) && (
                                            <button type="button" className="btn-outline" onClick={clearShift} disabled={busy === 'shift'} data-testid="clear-shift" style={{ padding: '0.5rem 1.2rem' }}>
                                                Back to usual hours
                                            </button>
                                        )}
                                    </div>

                                    {Array.isArray(shifts) && shifts.length > 0 && (
                                        <p style={{ margin: '0.7rem 0 0', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                                            Set for: {shifts.map(sh => sh.date + (sh.slots.length ? '' : ' (off)')).join(' · ')}
                                        </p>
                                    )}
                                </div>
                            </Section>

                            <Section icon={Palmtree} title="Time off" hint="(a leave range — closes their calendar)">
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'flex-end' }}>
                                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>From
                                        <input type="date" className="input" value={toForm.startDate}
                                            onChange={e => setToForm(f => ({ ...f, startDate: e.target.value, endDate: f.endDate < e.target.value ? e.target.value : f.endDate }))}
                                            style={{ display: 'block', padding: '0.4rem 0.5rem', marginTop: '0.2rem' }} data-testid="timeoff-from" />
                                    </label>
                                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>To
                                        <input type="date" className="input" value={toForm.endDate} min={toForm.startDate}
                                            onChange={e => setToForm(f => ({ ...f, endDate: e.target.value }))}
                                            style={{ display: 'block', padding: '0.4rem 0.5rem', marginTop: '0.2rem' }} data-testid="timeoff-to" />
                                    </label>
                                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Type
                                        <select className="input" value={toForm.type} onChange={e => setToForm(f => ({ ...f, type: e.target.value }))}
                                            style={{ display: 'block', padding: '0.42rem 0.5rem', marginTop: '0.2rem' }}>
                                            {['vacation', 'sick', 'unpaid', 'training', 'other'].map(t => <option key={t} value={t}>{cap(t)}</option>)}
                                        </select>
                                    </label>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap', marginTop: '0.65rem' }}>
                                    <Switch checked={toForm.allDay} onChange={v => setToForm(f => ({ ...f, allDay: v }))} label={toForm.allDay ? 'All day' : 'Set hours'} data-testid="timeoff-allday" />
                                    {!toForm.allDay && (
                                        <>
                                            <input type="time" className="input" value={toForm.startTime} onChange={e => setToForm(f => ({ ...f, startTime: e.target.value }))} style={{ width: '116px', padding: '0.35rem 0.5rem' }} />
                                            <span style={{ color: 'var(--text-muted)' }}>–</span>
                                            <input type="time" className="input" value={toForm.endTime} onChange={e => setToForm(f => ({ ...f, endTime: e.target.value }))} style={{ width: '116px', padding: '0.35rem 0.5rem' }} />
                                        </>
                                    )}
                                </div>
                                <input className="input" placeholder="Note (optional) — e.g. Family visit" value={toForm.note} maxLength={200}
                                    onChange={e => setToForm(f => ({ ...f, note: e.target.value }))}
                                    style={{ marginTop: '0.6rem', padding: '0.45rem 0.6rem', width: '100%', maxWidth: '340px' }} />
                                <div>
                                    <button type="button" className="btn-primary" onClick={addTimeOff} disabled={toBusy === 'add'} data-testid="add-timeoff" style={{ marginTop: '0.65rem', padding: '0.5rem 1.2rem' }}>
                                        {toBusy === 'add' ? 'Adding…' : 'Add time off'}
                                    </button>
                                </div>
                                {toErr && <p style={{ margin: '0.5rem 0 0', color: 'var(--gold-dark)', fontSize: '0.82rem' }}>{toErr}</p>}

                                <div style={{ marginTop: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }} data-testid="timeoff-list">
                                    {timeOff === null && <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading…</p>}
                                    {timeOff === false && <p style={{ margin: 0, color: 'var(--gold-dark)', fontSize: '0.85rem' }}>Couldn’t load time off.</p>}
                                    {Array.isArray(timeOff) && timeOff.length === 0 && <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>No time off scheduled.</p>}
                                    {Array.isArray(timeOff) && timeOff.map(t => {
                                        const pending = t.status === 'pending';
                                        const nd = rangeDays(t.startDate, t.endDate);
                                        return (
                                            <div key={t._id} style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', padding: '0.6rem 0.7rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--card-bg)', flexWrap: 'wrap' }}>
                                                <div style={{ minWidth: 0, flex: 1 }}>
                                                    <div style={{ fontWeight: 650, fontSize: '0.9rem', color: 'var(--charcoal)' }}>
                                                        {fmtRange(t.startDate, t.endDate)} <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>· {nd} day{nd > 1 ? 's' : ''}</span>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.2rem', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                                                        <span style={{ padding: '0.1rem 0.45rem', borderRadius: '999px', background: 'rgba(240,62,22,0.1)', color: 'var(--gold-dark)', fontWeight: 650 }}>{cap(t.type)}</span>
                                                        <span>{t.allDay ? 'All day' : `${t.startTime}–${t.endTime}`}</span>
                                                        {t.status === 'pending' && <span style={{ color: '#a86a12', fontWeight: 650 }}>Requested — needs your OK</span>}
                                                        {t.status === 'approved' && <span style={{ color: '#1f8a4c', fontWeight: 650 }}>Approved</span>}
                                                        {t.status === 'declined' && <span style={{ color: 'var(--text-muted)', fontWeight: 650 }}>Declined</span>}
                                                        {t.note && <span>· {t.note}</span>}
                                                    </div>
                                                </div>
                                                {pending && (
                                                    <div style={{ display: 'flex', gap: '0.35rem' }}>
                                                        <button type="button" className="btn-primary" disabled={toBusy === t._id} onClick={() => decideTimeOff(t._id, 'approved')} style={{ padding: '0.3rem 0.7rem', fontSize: '0.78rem' }} data-testid="approve-timeoff">Approve</button>
                                                        <button type="button" className="btn-outline" disabled={toBusy === t._id} onClick={() => decideTimeOff(t._id, 'declined')} style={{ padding: '0.3rem 0.7rem', fontSize: '0.78rem' }}>Decline</button>
                                                    </div>
                                                )}
                                                <button type="button" aria-label="Remove time off" onClick={() => removeTimeOff(t._id)} disabled={toBusy === t._id} style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.15rem', lineHeight: 1, padding: '0 0.25rem' }}>×</button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </Section>

                            <Section icon={Clock} title="Working hours">
                                {schedule === null && <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading…</p>}
                                {schedule === 'inherit' && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.88rem' }}>Inherits the business hours.</p>
                                        <button type="button" className="btn-outline" style={{ padding: '0.45rem 1rem', fontSize: '0.82rem' }} onClick={startCustomHours} data-testid="custom-hours">Set custom hours</button>
                                    </div>
                                )}
                                {schedule && schedule !== 'inherit' && (
                                    <div>
                                        {/* One shared grid keeps the day, both time fields and the column
                                            labels aligned in fixed columns — flex-wrap pushed the end field
                                            onto its own line on phones, which is how hours got entered into
                                            the wrong boxes. Sized to fit a 360px viewport without wrapping. */}
                                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(84px, 104px) minmax(0, 96px) 12px minmax(0, 96px)', alignItems: 'center', columnGap: '0.45rem', padding: '0 0 0.4rem', marginBottom: '0.3rem', borderBottom: '1px solid var(--border)' }}>
                                            <span aria-hidden="true" />
                                            <span style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Starting time</span>
                                            <span aria-hidden="true" />
                                            <span style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Ending time</span>
                                        </div>
                                        {DAYS.map(day => (
                                            <div key={day} style={{ display: 'grid', gridTemplateColumns: 'minmax(84px, 104px) minmax(0, 96px) 12px minmax(0, 96px)', alignItems: 'center', columnGap: '0.45rem', padding: '0.3rem 0', fontSize: '0.87rem' }}>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', color: 'var(--charcoal)', textTransform: 'capitalize', cursor: 'pointer' }}>
                                                    <input type="checkbox" checked={!!schedule[day]?.enabled} onChange={e => setDay(day, { enabled: e.target.checked })} />
                                                    {day}
                                                </label>
                                                {schedule[day]?.enabled && (
                                                    <>
                                                        <input type="time" aria-label={`${day} starting time`} value={schedule[day].slots?.[0]?.start || '09:00'} onChange={e => setSlot(day, 'start', e.target.value)} className="input" style={{ width: '100%', padding: '0.35rem 0.4rem', fontSize: '0.92rem' }} />
                                                        <span style={{ color: 'var(--text-muted)', textAlign: 'center' }}>–</span>
                                                        <input type="time" aria-label={`${day} ending time`} value={schedule[day].slots?.[0]?.end || '17:00'} onChange={e => setSlot(day, 'end', e.target.value)} className="input" style={{ width: '100%', padding: '0.35rem 0.4rem', fontSize: '0.92rem' }} />
                                                    </>
                                                )}
                                            </div>
                                        ))}
                                        <button type="button" className="btn-primary" onClick={saveHours} disabled={busy === 'hours'} data-testid="save-hours" style={{ marginTop: '0.6rem', padding: '0.55rem 1.4rem' }}>
                                            {busy === 'hours' ? 'Saving…' : 'Save hours'}
                                        </button>
                                    </div>
                                )}
                            </Section>
                        </div>
                    )}

                    {/* ── Pay ────────────────────────────────────────────── */}
                    {tab === 'pay' && (
                        <div style={{ marginTop: '1.1rem' }} data-testid="panel-pay">
                            <div style={{ display: 'grid', gap: '0.6rem', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
                                <Stat label="Completed" value={stats ? stats.appointments : null} note={stats ? `last ${stats.windowDays} days` : ''} />
                                <Stat label="Revenue generated" value={stats && stats.revenue != null ? `N$${stats.revenue.toLocaleString()}` : null} note="what commission would apply to" />
                            </div>
                            <div style={{ marginTop: '1rem', padding: '0.85rem 1rem', border: '1px solid var(--border)', borderLeft: '3px solid var(--gold)', borderRadius: '0 var(--radius) var(--radius) 0' }}>
                                <p style={{ margin: '0 0 0.3rem', fontWeight: 600, fontSize: '0.85rem', color: 'var(--charcoal)' }}>Compensation isn’t set up yet</p>
                                <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                    Salary, commission and tips aren’t modelled, so nothing here is a payslip.
                                    The revenue figure above is real and is the number a commission rate would
                                    apply to — deliberately left as a fact rather than a calculation, because
                                    guessing at the base would mean paying people the wrong amount.
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const Team = () => {
    const { user } = useAuthContext();
    const [members, setMembers] = useState([]);
    const [services, setServices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [newName, setNewName] = useState('');
    const [error, setError] = useState('');

    const load = () => Promise.all([
        teamService.getMyTeam().then(r => setMembers(r.data.data || [])),
        providerServiceService.getMyServices().then(r => setServices(r.data.data || [])).catch(() => {}),
    ]).catch(() => {}).finally(() => setLoading(false));

    useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const addMember = async (e) => {
        e.preventDefault();
        if (!newName.trim()) return;
        setError('');
        try {
            await teamService.addMember({ name: newName.trim() });
            setNewName('');
            load();
        } catch (err) {
            setError(err.response?.data?.message || 'Could not add team member');
        }
    };

    return (
        <div className="container" style={{ paddingTop: 'calc(56px + 2rem)', paddingBottom: '4rem', maxWidth: '760px' }}>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', fontWeight: 600, color: 'var(--charcoal)', margin: '0 0 0.35rem' }}>Team</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', margin: '0 0 1.75rem' }}>
                Invite staff to log in, set who performs which services, and give anyone their own working hours. Clients can pick their professional when booking.
            </p>

            <form onSubmit={addMember} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.75rem', flexWrap: 'wrap' }}>
                <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Add a team member by name…" className="input" style={{ maxWidth: '300px' }} data-testid="new-member-name" />
                <button type="submit" className="btn-primary" data-testid="new-member-add" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.6rem 1.4rem' }}>
                    <UserPlus size={16} /> Add
                </button>
            </form>
            {error && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', margin: '0 0 1rem' }}>{error}</p>}

            {loading ? (
                <p style={{ color: 'var(--text-muted)' }}>Loading team…</p>
            ) : members.length === 0 ? (
                <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '2.5rem 1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <p style={{ margin: 0 }}>No team members yet. Add your first above — solo businesses can skip this entirely.</p>
                </div>
            ) : (
                members.map(m => (
                    <MemberCard key={m._id} member={m} services={services} onChanged={load}
                        // Handover targets: the owner first — their work is stored
                        // unassigned, no roster row — then every other active member.
                        colleagues={[
                            { _id: 'owner', name: `${(user?.name || 'Me').split(' ')[0]} (me)` },
                            ...members.filter(c => c._id !== m._id && c.isActive !== false),
                        ]} />
                ))
            )}
        </div>
    );
};

export default Team;
