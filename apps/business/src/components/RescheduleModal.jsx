import React, { useEffect, useMemo, useState } from 'react';
import { availabilityService, appointmentService } from '../services';
import { buildTimeSlots } from '../utils/bookingSlots';
import { X } from 'lucide-react';

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const fmtDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Availability-aware reschedule popup — pick a new open slot without leaving the
// bookings page. Reuses the same slot rules as the booking calendar.
const RescheduleModal = ({ appointment, onClose, onDone }) => {
    const providerId = appointment?.provider?._id || appointment?.provider || '';
    // Prefer the service's duration; fall back to the booked span, then 30, so slot
    // conflict detection (and greying) is accurate even if service isn't populated.
    const toMin = (t) => { const [h, m] = String(t || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
    const duration = appointment?.service?.duration
        || (appointment?.startTime && appointment?.endTime ? toMin(appointment.endTime) - toMin(appointment.startTime) : 0)
        || 30;

    const [schedule, setSchedule] = useState(null);
    const [selectedDate, setSelectedDate] = useState(null);
    const [bookedSlots, setBookedSlots] = useState([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!providerId) return;
        availabilityService.getProviderAvailability(providerId)
            .then((res) => setSchedule(res.data.data.schedule))
            .catch(() => setSchedule(null));
    }, [providerId]);

    // Next 28 days, limited to days the provider works (when the schedule is known).
    const days = useMemo(() => {
        const out = [];
        const today = new Date(); today.setHours(0, 0, 0, 0);
        for (let i = 0; i < 28; i++) {
            const d = new Date(today); d.setDate(today.getDate() + i);
            const cfg = schedule?.[DAY_NAMES[d.getDay()]];
            const works = !schedule || (cfg?.enabled && (cfg.slots || []).some((s) => s?.start && s?.end));
            if (works) out.push(d);
        }
        return out;
    }, [schedule]);

    const selectDate = (dateStr) => {
        setSelectedDate(dateStr);
        setError('');
        if (providerId) {
            appointmentService.getBookedSlots(providerId, dateStr)
                .then((res) => setBookedSlots(res.data.data || []))
                .catch(() => setBookedSlots([]));
        }
    };

    const slots = useMemo(() => {
        if (!selectedDate) return [];
        let blocks = [{ start: 8 * 60, end: 20 * 60 }];
        if (schedule) {
            const [y, m, d] = selectedDate.split('-').map(Number);
            const cfg = schedule[DAY_NAMES[new Date(y, m - 1, d).getDay()]];
            if (!cfg?.enabled || !Array.isArray(cfg.slots)) return [];
            blocks = cfg.slots
                .filter((s) => s?.start && s?.end)
                .map((s) => {
                    const [sh, sm] = s.start.split(':').map(Number);
                    const [eh, em] = s.end.split(':').map(Number);
                    return { start: sh * 60 + sm, end: eh * 60 + em };
                })
                .filter((b) => b.end > b.start);
            if (!blocks.length) return [];
        }
        const bookedRanges = bookedSlots.map((b) => {
            const [bsH, bsM] = b.startTime.split(':').map(Number);
            const [beH, beM] = b.endTime.split(':').map(Number);
            return { start: bsH * 60 + bsM, end: beH * 60 + beM };
        });
        let minStart = -1;
        const now = new Date();
        if (selectedDate === fmtDate(now)) minStart = now.getHours() * 60 + now.getMinutes();
        return buildTimeSlots({ blocks, bookedRanges, duration, minStart });
    }, [selectedDate, schedule, bookedSlots, duration]);

    const confirm = async (time) => {
        setBusy(true); setError('');
        try {
            await appointmentService.rescheduleAppointment(appointment._id, { appointmentDate: selectedDate, startTime: time });
            onDone();
        } catch (err) {
            setError(err.response?.data?.message || 'Could not reschedule to that slot — please pick another.');
            setBusy(false);
        }
    };

    return (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,5,5,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '1rem' }}>
            <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" className="scale-in" style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', width: '100%', maxWidth: '460px', maxHeight: '85dvh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(4,5,5,0.3)', overflow: 'hidden' }}>
                <div style={{ padding: '1.1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
                    <div style={{ minWidth: 0 }}>
                        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: '600', color: 'var(--charcoal)', margin: 0 }}>Reschedule</h2>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0.15rem 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{appointment?.service?.name} · {duration} min</p>
                    </div>
                    <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem', flexShrink: 0 }}><X size={20} /></button>
                </div>

                <div style={{ padding: '1rem 1.25rem', overflowY: 'auto' }}>
                    {/* Date chips */}
                    <p style={{ fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 0.6rem' }}>Pick a day</p>
                    <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.5rem', scrollbarWidth: 'none' }}>
                        {days.map((d) => {
                            const ds = fmtDate(d);
                            const active = ds === selectedDate;
                            return (
                                <button key={ds} onClick={() => selectDate(ds)} style={{
                                    flex: '0 0 auto', minWidth: '58px', padding: '0.5rem 0.4rem', borderRadius: 'var(--radius-sm)',
                                    border: `1.5px solid ${active ? 'var(--gold)' : 'var(--border)'}`,
                                    background: active ? 'rgba(240,62,22,0.12)' : 'transparent', cursor: 'pointer',
                                    color: active ? 'var(--gold-dark)' : 'var(--text-secondary)', fontFamily: 'var(--font-body)',
                                }}>
                                    <div style={{ fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{d.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                                    <div style={{ fontSize: '1.05rem', fontWeight: '600' }}>{d.getDate()}</div>
                                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{d.toLocaleDateString('en-US', { month: 'short' })}</div>
                                </button>
                            );
                        })}
                    </div>

                    {/* Time slots */}
                    {selectedDate && (
                        <>
                            <p style={{ fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', margin: '1rem 0 0.6rem' }}>Pick a time</p>
                            {slots.length === 0 ? (
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', padding: '0.5rem 0' }}>No open slots that day — try another.</p>
                            ) : (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: '0.5rem' }}>
                                    {slots.map((s, i) => (
                                        <button key={i} disabled={s.isBooked || busy} onClick={() => confirm(s.time)} title={s.isBooked ? 'Already booked' : ''} style={{
                                            padding: '0.6rem 0.4rem', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-body)', fontWeight: '600', fontSize: '0.9rem',
                                            border: `1.5px solid ${s.isBooked ? 'var(--border)' : 'var(--gold)'}`,
                                            background: s.isBooked ? 'var(--surface-sunken)' : 'white',
                                            color: s.isBooked ? 'var(--text-muted)' : 'var(--gold-dark)',
                                            textDecoration: s.isBooked ? 'line-through' : 'none',
                                            opacity: s.isBooked ? 0.55 : (busy ? 0.6 : 1),
                                            cursor: s.isBooked || busy ? 'not-allowed' : 'pointer',
                                        }}>{s.time}</button>
                                    ))}
                                </div>
                            )}
                        </>
                    )}

                    {error && <p style={{ color: '#dc2626', fontSize: '0.85rem', marginTop: '0.85rem' }}>{error}</p>}
                </div>
            </div>
        </div>
    );
};

export default RescheduleModal;
