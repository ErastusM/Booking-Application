import React, { useCallback, useEffect, useState } from 'react';
import { Select, DatePicker } from '@bookplus/ui';
import { myTimeOffService } from '../../services';
import { useToast } from '../../components/Toast';

// A team member's time off, on the Availability screen under the owner's
// "Blocked Times" — drawn the same way (one row per entry, the same date and
// action styling). The member asks; the owner approves. The owner has no such
// list: their own days off are simply blocked time.

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
const card = { background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' };

const TimeOffSection = ({ businessName = 'the business' }) => {
    const toast = useToast();
    const [leave, setLeave] = useState(null); // null = loading
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({ startDate: todayKey(), endDate: todayKey(), type: 'vacation', note: '' });
    const [busy, setBusy] = useState('');

    const load = useCallback(async () => {
        try { const res = await myTimeOffService.list(); setLeave(res.data.data || []); }
        catch { setLeave([]); }
    }, []);
    useEffect(() => { load(); }, [load]);

    const request = async (e) => {
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
            await load();
        } catch (err) { toast(err.response?.data?.message || 'Could not request time off', 'error'); } finally { setBusy(''); }
    };
    const withdraw = async (t) => {
        setBusy(`w-${t._id}`);
        try { await myTimeOffService.withdraw(t._id); await load(); }
        catch (err) { toast(err.response?.data?.message || 'Could not withdraw the request', 'error'); } finally { setBusy(''); }
    };

    const upcoming = (leave || []).filter((t) => t.endDate >= todayKey()).sort((a, b) => a.startDate.localeCompare(b.startDate));

    return (
        <div style={{ marginTop: '2rem' }} data-testid="time-off">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div>
                    <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: '600', color: 'var(--charcoal)' }}>Time off</h2>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.825rem', marginTop: '0.2rem' }}>Ask for days off. {businessName} approves them.</p>
                </div>
                {!showForm && (
                    <button onClick={() => setShowForm(true)} className="btn-outline" style={{ padding: '0.55rem 1.1rem', fontSize: '0.825rem' }} data-testid="request-time-off">+ Request time off</button>
                )}
            </div>

            {showForm && (
                <form onSubmit={request} style={{ ...card, padding: '1.1rem 1.25rem', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
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
                        return (
                            <div key={t._id} data-testid="time-off-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.875rem 1.25rem', borderBottom: i < upcoming.length - 1 ? '1px solid var(--border)' : 'none', gap: '1rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', minWidth: 0 }}>
                                    <div style={{ width: '38px', height: '38px', borderRadius: '8px', background: 'rgba(240,62,22,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', flexShrink: 0 }}>🌴</div>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                            <span style={{ fontWeight: '600', fontSize: '0.875rem', color: 'var(--charcoal)' }}>{t.startDate === t.endDate ? t.startDate : `${t.startDate} – ${t.endDate}`}</span>
                                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{t.type}</span>
                                            <span style={{ fontSize: '0.68rem', fontWeight: '600', padding: '0.1rem 0.5rem', borderRadius: '99px', background: st.bg, color: st.fg }}>{st.label}</span>
                                        </div>
                                        {t.note && <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.note}</p>}
                                    </div>
                                </div>
                                {t.status === 'pending' && (
                                    <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                                        <button onClick={() => withdraw(t)} disabled={busy === `w-${t._id}`} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.3rem 0.7rem', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Withdraw</button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default TimeOffSection;
