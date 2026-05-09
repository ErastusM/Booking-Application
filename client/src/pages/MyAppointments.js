import React, { useEffect, useState } from 'react';
import { appointmentService, reviewService } from '../services';
import ReviewModal from '../components/ReviewModal';

const statusConfig = {
    pending:   { label: 'Pending',   bg: '#fef3c7', color: '#92400e' },
    confirmed: { label: 'Confirmed', bg: '#dbeafe', color: '#1e40af' },
    completed: { label: 'Completed', bg: '#d1fae5', color: '#065f46' },
    cancelled: { label: 'Cancelled', bg: '#fee2e2', color: '#991b1b' },
};

const MyAppointments = () => {
    const [appointments, setAppointments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [reviewedIds, setReviewedIds] = useState([]);
    const [selectedAppointment, setSelectedAppointment] = useState(null);
    const [activeFilter, setActiveFilter] = useState('all');

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            const [apptRes, reviewRes] = await Promise.all([
                appointmentService.getAllAppointments(),
                reviewService.getMyReviews(),
            ]);
            setAppointments(apptRes.data.data);
            setReviewedIds(reviewRes.data.data.map(r => r.appointment));
        } catch {
            setError('Failed to fetch appointments');
        } finally {
            setLoading(false);
        }
    };

    const handleCancel = async (id) => {
        if (window.confirm('Cancel this appointment?')) {
            try {
                await appointmentService.cancelAppointment(id, 'Cancelled by customer');
                setAppointments(appointments.map(a =>
                    a._id === id ? { ...a, status: 'cancelled' } : a
                ));
            } catch {
                setError('Failed to cancel appointment');
            }
        }
    };

    const filters = ['all', 'pending', 'confirmed', 'completed', 'cancelled'];
    const filtered = activeFilter === 'all'
        ? appointments
        : appointments.filter(a => a.status === activeFilter);

    const counts = filters.reduce((acc, f) => {
        acc[f] = f === 'all' ? appointments.length : appointments.filter(a => a.status === f).length;
        return acc;
    }, {});

    if (loading) return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}>
                <div style={{
                    width: '40px', height: '40px',
                    border: '3px solid var(--border)',
                    borderTopColor: 'var(--gold)',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                    margin: '0 auto 1rem',
                }} />
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Loading appointments...</p>
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );

    return (
        <div style={{ background: 'var(--off-white)', minHeight: '100vh' }}>

            {/* Header */}
            <div style={{
                background: 'var(--charcoal)',
                paddingTop: '9rem',
                paddingBottom: '3rem',
                position: 'relative',
                overflow: 'hidden',
            }}>
                <div style={{
                    position: 'absolute', inset: 0,
                    backgroundImage: 'radial-gradient(ellipse at 80% 50%, rgba(201,168,76,0.08) 0%, transparent 60%)',
                    pointerEvents: 'none',
                }} />
                <div className="container" style={{ position: 'relative' }}>
                    <p style={{
                        color: 'var(--gold)', fontSize: '0.75rem', fontWeight: '600',
                        letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '0.75rem',
                    }}>Your Schedule</p>
                    <h1 style={{
                        fontFamily: 'Playfair Display, serif',
                        fontSize: 'clamp(2rem, 4vw, 3rem)',
                        fontWeight: '700', color: 'white',
                    }}>
                        My Appointments
                    </h1>
                </div>
            </div>

            <div className="container" style={{ paddingTop: '2.5rem', paddingBottom: '5rem' }}>

                {error && (
                    <div style={{
                        background: '#fee2e2', border: '1px solid #fca5a5',
                        color: '#991b1b', padding: '0.75rem 1rem',
                        borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.875rem',
                    }}>
                        {error}
                    </div>
                )}

                {/* Filter tabs */}
                <div style={{
                    display: 'flex', gap: '0.5rem', marginBottom: '2rem',
                    borderBottom: '1px solid var(--border)', paddingBottom: '0',
                    overflowX: 'auto',
                }}>
                    {filters.map(f => (
                        <button
                            key={f}
                            onClick={() => setActiveFilter(f)}
                            style={{
                                padding: '0.6rem 1.25rem',
                                background: 'none',
                                border: 'none',
                                borderBottom: activeFilter === f ? '2px solid var(--gold)' : '2px solid transparent',
                                color: activeFilter === f ? 'var(--gold-dark)' : 'var(--text-muted)',
                                fontWeight: activeFilter === f ? '600' : '400',
                                fontSize: '0.875rem',
                                cursor: 'pointer',
                                fontFamily: 'DM Sans, sans-serif',
                                textTransform: 'capitalize',
                                whiteSpace: 'nowrap',
                                transition: 'all 0.2s',
                                marginBottom: '-1px',
                            }}
                        >
                            {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
                            {counts[f] > 0 && (
                                <span style={{
                                    marginLeft: '0.4rem',
                                    background: activeFilter === f ? 'var(--gold)' : 'var(--warm-gray)',
                                    color: activeFilter === f ? 'var(--charcoal)' : 'var(--text-muted)',
                                    fontSize: '0.7rem',
                                    fontWeight: '700',
                                    padding: '0.1rem 0.45rem',
                                    borderRadius: '99px',
                                }}>
                                    {counts[f]}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Appointments list */}
                {filtered.length === 0 ? (
                    <div style={{
                        textAlign: 'center', padding: '5rem 2rem',
                        background: 'white', borderRadius: 'var(--radius)',
                        border: '1px solid var(--border)',
                    }}>
                        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📅</div>
                        <h3 style={{
                            fontFamily: 'Playfair Display, serif',
                            fontSize: '1.3rem', color: 'var(--charcoal)', marginBottom: '0.5rem',
                        }}>
                            No {activeFilter === 'all' ? '' : activeFilter} appointments
                        </h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                            {activeFilter === 'all' ? "You haven't booked anything yet." : `No ${activeFilter} appointments to show.`}
                        </p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {filtered.map((a, i) => {
                            const status = statusConfig[a.status] || statusConfig.pending;
                            const isReviewed = reviewedIds.includes(a._id);
                            return (
                                <div
                                    key={a._id}
                                    className="fade-up appt-row"
                                    style={{
                                        animationDelay: `${i * 0.05}s`,
                                        opacity: 0,
                                        background: 'white',
                                        borderRadius: 'var(--radius)',
                                        border: '1px solid var(--border)',
                                        boxShadow: 'var(--shadow-sm)',
                                        padding: '1.5rem 2rem',
                                        display: 'grid',
                                        gridTemplateColumns: '1fr 1fr 1fr 1fr auto',
                                        alignItems: 'center',
                                        gap: '1.5rem',
                                    }}
                                >
                                    {/* Service */}
                                    <div>
                                        <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.25rem' }}>Service</p>
                                        <p style={{ fontFamily: 'Playfair Display, serif', fontWeight: '600', color: 'var(--charcoal)', fontSize: '1rem' }}>
                                            {a.service?.name}
                                        </p>
                                        <p style={{ color: 'var(--gold-dark)', fontWeight: '600', fontSize: '0.9rem' }}>
                                            ${a.totalPrice}
                                        </p>
                                    </div>

                                    {/* Date */}
                                    <div>
                                        <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.25rem' }}>Date</p>
                                        <p style={{ fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.95rem' }}>
                                            {new Date(a.appointmentDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                                        </p>
                                    </div>

                                    {/* Time */}
                                    <div>
                                        <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.25rem' }}>Time</p>
                                        <p style={{ fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.95rem' }}>
                                            {a.startTime} – {a.endTime}
                                        </p>
                                    </div>

                                    {/* Status */}
                                    <div>
                                        <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.25rem' }}>Status</p>
                                        <span style={{
                                            display: 'inline-block',
                                            padding: '0.25rem 0.75rem',
                                            borderRadius: '99px',
                                            fontSize: '0.75rem',
                                            fontWeight: '600',
                                            background: status.bg,
                                            color: status.color,
                                        }}>
                                            {status.label}
                                        </span>
                                    </div>

                                    {/* Actions */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
                                        {a.status !== 'cancelled' && a.status !== 'completed' && (
                                            <button
                                                onClick={() => handleCancel(a._id)}
                                                style={{
                                                    background: 'none', border: '1px solid #fca5a5',
                                                    color: '#ef4444', padding: '0.35rem 0.875rem',
                                                    borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                                                    fontSize: '0.8rem', fontWeight: '600',
                                                    fontFamily: 'DM Sans, sans-serif',
                                                    transition: 'all 0.2s',
                                                }}
                                                onMouseEnter={e => { e.target.style.background = '#fee2e2'; }}
                                                onMouseLeave={e => { e.target.style.background = 'none'; }}
                                            >
                                                Cancel
                                            </button>
                                        )}
                                        {a.status === 'completed' && !isReviewed && (
                                            <button
                                                onClick={() => setSelectedAppointment(a)}
                                                style={{
                                                    background: 'rgba(201,168,76,0.08)',
                                                    border: '1px solid rgba(201,168,76,0.3)',
                                                    color: 'var(--gold-dark)',
                                                    padding: '0.35rem 0.875rem',
                                                    borderRadius: 'var(--radius-sm)',
                                                    cursor: 'pointer',
                                                    fontSize: '0.8rem', fontWeight: '600',
                                                    fontFamily: 'DM Sans, sans-serif',
                                                    transition: 'all 0.2s',
                                                }}
                                                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(201,168,76,0.15)'; }}
                                                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(201,168,76,0.08)'; }}
                                            >
                                                ★ Review
                                            </button>
                                        )}
                                        {a.status === 'completed' && isReviewed && (
                                            <span style={{ fontSize: '0.8rem', color: '#065f46', fontWeight: '600' }}>✓ Reviewed</span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {selectedAppointment && (
                <ReviewModal
                    appointment={selectedAppointment}
                    onClose={() => setSelectedAppointment(null)}
                    onSubmitted={fetchData}
                />
            )}

            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
};

export default MyAppointments;