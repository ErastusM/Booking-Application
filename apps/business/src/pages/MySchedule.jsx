import React, { useEffect, useState } from 'react';
import { appointmentService } from '../services';
import { useAuthContext } from '../context/AuthContext';
import { CalendarClock } from 'lucide-react';

/**
 * Epic 2.4 — the staff principal's landing view: ONLY their own column
 * (the API scopes /appointments to their TeamMember server-side).
 * Owners see everyone at once via the dashboard calendar's Staff view
 * (per-staff lanes) and its staff filter — see dashboard/StaffLanesDay.jsx.
 */
const MySchedule = () => {
    const { user } = useAuthContext();
    const [appointments, setAppointments] = useState(null);

    useEffect(() => {
        appointmentService.getAllAppointments({ all: 'true' })
            .then(res => setAppointments(res.data.data || []))
            .catch(() => setAppointments([]));
    }, []);

    const upcoming = (appointments || [])
        .filter(a => new Date(a.appointmentDate) >= new Date(new Date().setHours(0, 0, 0, 0)) && a.status !== 'cancelled')
        .sort((a, b) => new Date(a.appointmentDate) - new Date(b.appointmentDate) || a.startTime.localeCompare(b.startTime));

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
        </div>
    );
};

export default MySchedule;
