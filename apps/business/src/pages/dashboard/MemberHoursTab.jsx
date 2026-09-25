import React, { useCallback, useEffect, useState } from 'react';
import { Select, DatePicker, TimePicker } from '@bookplus/ui';
import { myAvailabilityService, myTimeOffService } from '../../services';
import { useToast } from '../../components/Toast';

// A team member's own working hours, in the owner's "Working Hours" layout (a
// row per day with a toggle and times, Save Changes). Nothing is inherited from
// the business: a member with no hours yet starts with every day off. Below it,
// "Time off" takes the place of the owner's "Blocked Times" — the member asks,
// the owner approves.

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const OFF_WEEK = () => Object.fromEntries(DAYS.map((d) => [d, { enabled: false, slots: [{ start: '09:00', end: '17:00' }] }]));
const TYPES = [['vacation', 'Vacation'], ['sick', 'Sick'], ['training', 'Training'], ['other', 'Other']];
const STATUS = {
    pending: { label: 'Waiting for approval', bg: 'var(--warning-bg)', fg: 'var(--warning-fg)' },
    approved: { label: 'Approved', bg: '#dff1e7', fg: '#1a5e3b' },
    declined: { label: 'Declined', bg: 'var(--surface-sunken)', fg: 'var(--text-secondary)' },
};
const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const niceDate = (k) => new Date(`${k}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

const card = { background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' };

const MemberHoursTab = ({ businessName = 'the business' }) => {
    const toast = useToast();
    const [schedule, setSchedule] = useState(null);
    const [hadHours, setHadHours] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState('');
    const [leave, setLeave] = useState(null);       // null = loading
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({ startDate: todayKey(), endDate: todayKey(), type: 'vacation', note: '' });
    const [busy, setBusy] = useState('');

    const loadHours = useCallback(async () => {
        try {
            const res = await myAvailabilityService.get();
            const s = res.data.data?.schedule;
            setHadHours(!!s);
            // Fill any missing day so every row renders; an absent schedule = all off.
            const base = OFF_WEEK();
            setSchedule(s ? Object.fromEntries(DAYS.map((d) => [d, { enabled: !!s[d]?.enabled, slots: s[d]?.slots?.length ? s[d].slots : base[d].slots }])) : base);
        } catch (err) { toast(err.response?.data?.message || 'Could not load your hours', 'error'); setSchedule(OFF_WEEK()); }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps -- toast is only used on failure
    const loadLeave = useCallback(async () => {
        try { const res = await myTimeOffService.list(); setLeave(res.data.data || []); }
        catch { setLeave([]); }
    }, []);
    useEffect(() => { loadHours(); loadLeave(); }, [loadHours, loadLeave]);

    const toggle = (day) => setSchedule((s) => ({ ...s, [day]: { ...s[day], enabled: !s[day].enabled } }));
    const setTime = (day, key, value) => setSchedule((s) => ({ ...s, [day]: { ...s[day], slots: [{ ...s[day].slots[0], [key]: value }, ...s[day].slots.slice(1)] } }));

    const saveHours = async () => {
        const bad = DAYS.find((d) => schedule[d].enabled && !(schedule[d].slots[0]?.start < schedule[d].slots[0]?.end));
        if (bad) { toast(`${bad[0].toUpperCase()}${bad.slice(1)}: the end time must be after the start time`, 'error'); return; }
        setSaving(true); setSaved('');
        try {
            await myAvailabilityService.set(schedule);
            setHadHours(true);
            setSaved(DAYS.some((d) => schedule[d].enabled) ? 'Your hours are saved. Clients can book you in these hours.' : 'Saved. You have no working days, so clients can’t book you.');
        } catch (err) { toast(err.response?.data?.message || 'Could not save your hours', 'error'); } finally { setSaving(false); }
    };

    const requestLeave = async (e) => {
        e.preventDefault();
        // The date picker has no native min check on submit, so a first day that
        // slipped into the past (the form left open past midnight) is caught here.
        if (form.startDate < todayKey()) { toast('The first day can’t be in the past', 'error'); return; }
        if (form.endDate < form.startDate) { toast('The last day can’t be before the first day', 'error'); return; }
        setBusy('request');
        try {
            await myTimeOffService.request({ startDate: form.startDate, endDate: form.endDate, type: form.type, note: form.note.trim(), allDay: true });
            toast(`Time off requested. ${businessName} will approve it.`, 'success');
            setShowForm(false); setForm({ startDate: todayKey(), endDate: todayKey(), type: 'vacation', note: '' });
            await loadLeave();
        } catch (err) { toast(err.response?.data?.message || 'Could not request time off', 'error'); } finally { setBusy(''); }
    };
    const withdraw = async (t) => {
        setBusy(`w-${t._id}`);
        try { await myTimeOffService.withdraw(t._id); await loadLeave(); }
        catch (err) { toast(err.response?.data?.message || 'Could not withdraw the request', 'error'); } finally { setBusy(''); }
    };

    const upcoming = (leave || []).filter((t) => t.endDate >= todayKey()).sort((a, b) => a.startDate.localeCompare(b.startDate));

    return (
        <div data-testid="member-hours">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                <div>
                    <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: '600', color: 'var(--charcoal)' }}>My working hours</h2>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>When clients can book you. {businessName}’s opening hours don’t apply.</p>
                </div>
                <button onClick={saveHours} disabled={saving || !schedule} className="btn-primary" style={{ padding: '0.65rem 1.5rem', fontSize: '0.875rem', flexShrink: 0 }} data-testid="member-save-hours">
                    {saving ? 'Saving...' : 'Save Changes'}
                </button>
            </div>

            {!hadHours && (
                <div style={{ background: 'rgba(240,62,22,0.1)', border: '1px solid rgba(240,62,22,0.3)', color: 'var(--charcoal)', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.25rem', fontSize: '0.875rem' }}>
                    Turn on the days you work and set your times. Clients can’t book you until you do.
                </div>
            )}
            {saved && (
                <div role="status" style={{ background: '#d1fae5', border: '1px solid #6ee7b7', color: '#065f46', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>{saved}</div>
            )}

            {schedule && (
                <div style={{ ...card, overflow: 'hidden' }}>
                    {DAYS.map((day, i) => {
                        const c = schedule[day];
                        return (
                            <div key={day} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', padding: '1.05rem 1.25rem', borderBottom: i < 6 ? '1px solid var(--border)' : 'none', background: c.enabled ? 'var(--card-bg)' : 'var(--surface-sunken)', transition: 'background 0.2s' }}>
                                <div style={{ minWidth: 0, flex: 1 }}>
                                    <div style={{ fontWeight: '600', color: c.enabled ? 'var(--charcoal)' : 'var(--text-muted)', fontSize: '1rem', textTransform: 'capitalize', marginBottom: c.enabled ? '0.55rem' : 0 }}>{day}</div>
                                    {c.enabled ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                            <TimePicker aria-label={`${day} start`} value={c.slots[0]?.start || '09:00'} onChange={(e) => setTime(day, 'start', e.target.value)} sheetTitle={`${day[0].toUpperCase()}${day.slice(1)} start`} style={{ width: '112px', maxWidth: '42vw', padding: '0.45rem 0.6rem', fontSize: '1rem' }} />
                                            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', flexShrink: 0 }}>to</span>
                                            <TimePicker aria-label={`${day} end`} value={c.slots[0]?.end || '17:00'} onChange={(e) => setTime(day, 'end', e.target.value)} sheetTitle={`${day[0].toUpperCase()}${day.slice(1)} end`} style={{ width: '112px', maxWidth: '42vw', padding: '0.45rem 0.6rem', fontSize: '1rem' }} />
                                        </div>
                                    ) : (
                                        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Not working</div>
                                    )}
                                </div>
                                <button onClick={() => toggle(day)} role="switch" aria-checked={c.enabled} aria-label={`${day} working`} style={{ width: '50px', height: '30px', borderRadius: '99px', border: 'none', background: c.enabled ? 'var(--gold)' : '#cbd0d8', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0, alignSelf: 'center' }}>
                                    <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'white', position: 'absolute', top: '3px', left: '3px', transform: c.enabled ? 'translateX(20px)' : 'translateX(0)', transition: 'transform 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.25)' }} />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Time off — in place of the owner's "Blocked Times" */}
            <div style={{ marginTop: '2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
                    <div>
                        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: '600', color: 'var(--charcoal)' }}>Time off</h2>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.825rem', marginTop: '0.2rem' }}>Ask for days off. {businessName} approves them.</p>
                    </div>
                    {!showForm && (
                        <button onClick={() => setShowForm(true)} className="btn-outline" style={{ padding: '0.55rem 1.1rem', fontSize: '0.825rem', flexShrink: 0 }} data-testid="member-request-leave">+ Request time off</button>
                    )}
                </div>

                {showForm && (
                    <form onSubmit={requestLeave} style={{ ...card, padding: '1.1rem 1.25rem', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }}>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.8rem', fontWeight: 600 }}>First day
                                <DatePicker value={form.startDate} min={todayKey()} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value, endDate: f.endDate < e.target.value ? e.target.value : f.endDate }))} sheetTitle="First day" style={{ fontWeight: 400 }} />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.8rem', fontWeight: 600 }}>Last day
                                <DatePicker value={form.endDate} min={form.startDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} sheetTitle="Last day" style={{ fontWeight: 400 }} />
                            </label>
                        </div>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.8rem', fontWeight: 600 }}>Kind
                            <Select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                                options={TYPES.map(([v, l]) => ({ value: v, label: l }))} sheetTitle="Kind of time off" style={{ fontWeight: 400 }} />
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.8rem', fontWeight: 600 }}>Note (optional)
                            <input className="input" maxLength={200} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="e.g. Family wedding" />
                        </label>
                        <div style={{ display: 'flex', gap: '0.6rem' }}>
                            <button type="submit" disabled={busy === 'request'} className="btn-primary" style={{ padding: '0.6rem 1.2rem' }}>{busy === 'request' ? 'Sending…' : 'Request time off'}</button>
                            <button type="button" onClick={() => setShowForm(false)} className="btn-outline" style={{ padding: '0.6rem 1.2rem' }}>Cancel</button>
                        </div>
                    </form>
                )}

                {leave === null ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Loading…</p>
                ) : upcoming.length === 0 ? (
                    <div style={{ ...card, padding: '2rem', textAlign: 'center' }}>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No time off coming up.</p>
                    </div>
                ) : (
                    <div style={{ ...card, overflow: 'hidden' }}>
                        {upcoming.map((t, i) => {
                            const st = STATUS[t.status] || STATUS.pending;
                            const range = t.startDate === t.endDate ? niceDate(t.startDate) : `${niceDate(t.startDate)} – ${niceDate(t.endDate)}`;
                            return (
                                <div key={t._id} data-testid="member-leave" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', padding: '0.875rem 1.25rem', borderBottom: i < upcoming.length - 1 ? '1px solid var(--border)' : 'none', flexWrap: 'wrap' }}>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontWeight: '600', fontSize: '0.9rem', color: 'var(--charcoal)', textTransform: 'capitalize' }}>{t.type} · {range}</div>
                                        {t.note && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t.note}</div>}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <span style={{ fontSize: '0.72rem', fontWeight: 600, padding: '0.2rem 0.6rem', borderRadius: '99px', background: st.bg, color: st.fg }}>{st.label}</span>
                                        {t.status === 'pending' && (
                                            <button onClick={() => withdraw(t)} disabled={busy === `w-${t._id}`} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.3rem 0.7rem', minHeight: '32px', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Withdraw</button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default MemberHoursTab;
