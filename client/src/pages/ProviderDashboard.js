import React, { useEffect, useState } from 'react';
import { appointmentService } from '../services';

const statusConfig = {
    pending:   { label: 'Pending',   bg: '#fef3c7', color: '#92400e' },
    confirmed: { label: 'Confirmed', bg: '#dbeafe', color: '#1e40af' },
    completed: { label: 'Completed', bg: '#d1fae5', color: '#065f46' },
    cancelled: { label: 'Cancelled', bg: '#fee2e2', color: '#991b1b' },
};

const ProviderDashboard = () => {
    const [appointments, setAppointments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [activeTab, setActiveTab] = useState('pending');

    useEffect(() => { fetchAppointments(); }, []);

    const fetchAppointments = async () => {
        setLoading(true);
        try {
            const res = await appointmentService.getAllAppointments();
            setAppointments(res.data.data);
        } catch {
            setError('Failed to load appointments');
        } finally {
            setLoading(false);
        }
    };

    const handleStatusUpdate = async (id, status) => {
        try {
            await appointmentService.updateAppointmentStatus(id, status);
            setAppointments(appointments.map(a => a._id === id ? { ...a, status } : a));
        } catch {
            setError('Failed to update appointment');
        }
    };

    const tabs = ['pending', 'confirmed', 'completed', 'cancelled'];
    const filtered = appointments.filter(a => a.status === activeTab);
    const counts = tabs.reduce((acc, t) => {
        acc[t] = appointments.filter(a => a.status === t).length;
        return acc;
    }, {});

    const stats = [
        { label: 'Total', value: appointments.length, icon: '📋' },
        { label: 'Pending', value: counts.pending, icon: '⏳' },
        { label: 'Confirmed', value: counts.confirmed, icon: '✅' },
        { label: 'Completed', value: counts.completed, icon: '🏆' },
    ];

    if (loading) return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}>
                <div style={{ width: '40px', height: '40px', border: '3px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 1rem' }} />
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Loading...</p>
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );

    return (
        <div style={{ background: 'var(--off-white)', minHeight: '100vh' }}>

            {/* Header */}
            <div style={{ background: 'var(--charcoal)', paddingTop: '9rem', paddingBottom: '3rem', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(ellipse at 70% 40%, rgba(201,168,76,0.1) 0%, transparent 60%)', pointerEvents: 'none' }} />
                <div className="container" style={{ position: 'relative' }}>
                    <p style={{ color: 'var(--gold)', fontSize: '0.75rem', fontWeight: '600', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Your Bookings</p>
                    <h1 style={{ fontFamily: 'Playfair Display, serif', fontSize: 'clamp(2rem, 4vw, 3rem)', fontWeight: '700', color: 'white' }}>Provider Dashboard</h1>
                </div>
            </div>

            <div className="container" style={{ paddingTop: '2.5rem', paddingBottom: '5rem' }}>

                {/* Stats */}
                <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
                    {stats.map((s, i) => (
                        <div key={i} style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: 'rgba(201,168,76,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', flexShrink: 0 }}>
                                {s.icon}
                            </div>
                            <div>
                                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{s.label}</p>
                                <p style={{ fontFamily: 'Playfair Display, serif', fontSize: '1.6rem', fontWeight: '700', color: 'var(--charcoal)', lineHeight: 1 }}>{s.value}</p>
                            </div>
                        </div>
                    ))}
                </div>

                {error && (
                    <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
                        {error}
                    </div>
                )}

                {/* Tabs */}
                <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '1.5rem', overflowX: 'auto' }}>
                    {tabs.map(tab => (
                        <button key={tab} onClick={() => setActiveTab(tab)} style={{
                            padding: '0.75rem 1.5rem', background: 'none', border: 'none',
                            borderBottom: activeTab === tab ? '2px solid var(--gold)' : '2px solid transparent',
                            color: activeTab === tab ? 'var(--gold-dark)' : 'var(--text-muted)',
                            fontWeight: activeTab === tab ? '600' : '400', fontSize: '0.875rem',
                            cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
                            textTransform: 'capitalize', transition: 'all 0.2s',
                            marginBottom: '-1px', whiteSpace: 'nowrap',
                        }}>
                            {tab.charAt(0).toUpperCase() + tab.slice(1)}
                            {counts[tab] > 0 && (
                                <span style={{ marginLeft: '0.4rem', background: activeTab === tab ? 'var(--gold)' : 'var(--warm-gray)', color: activeTab === tab ? 'var(--charcoal)' : 'var(--text-muted)', fontSize: '0.7rem', fontWeight: '700', padding: '0.1rem 0.45rem', borderRadius: '99px' }}>
                                    {counts[tab]}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Appointments */}
                {filtered.length === 0 ? (
                    <div style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '4rem 2rem', textAlign: 'center' }}>
                        <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📭</div>
                        <p style={{ fontFamily: 'Playfair Display, serif', fontSize: '1.1rem', color: 'var(--charcoal)', marginBottom: '0.35rem' }}>No {activeTab} appointments</p>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Check back later or switch tabs to see other bookings.</p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {filtered.map((a, i) => {
                            const s = statusConfig[a.status] || statusConfig.pending;
                            return (
                                <div key={a._id} className="fade-up provider-card" style={{
                                    animationDelay: `${i * 0.05}s`, opacity: 0,
                                    background: 'white', borderRadius: 'var(--radius)',
                                    border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)',
                                    padding: '1.5rem 2rem', display: 'grid',
                                    gridTemplateColumns: '1fr 1fr 1fr auto',
                                    alignItems: 'center', gap: '2rem',
                                }}>
                                    <div>
                                        <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.35rem' }}>Customer</p>
                                        <p style={{ fontFamily: 'Playfair Display, serif', fontWeight: '600', color: 'var(--charcoal)' }}>{a.customer?.name}</p>
                                        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{a.customer?.email}</p>
                                        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{a.customer?.phone}</p>
                                    </div>
                                    <div>
                                        <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.35rem' }}>Service</p>
                                        <p style={{ fontWeight: '600', color: 'var(--charcoal)' }}>{a.service?.name}</p>
                                        <p style={{ color: 'var(--gold-dark)', fontWeight: '600', fontSize: '0.875rem' }}>${a.service?.price} · {a.service?.duration} min</p>
                                    </div>
                                    <div>
                                        <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.35rem' }}>Date & Time</p>
                                        <p style={{ fontWeight: '600', color: 'var(--charcoal)' }}>{new Date(a.appointmentDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
                                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>{a.startTime} – {a.endTime}</p>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
                                        <span style={{ padding: '0.25rem 0.75rem', borderRadius: '99px', fontSize: '0.72rem', fontWeight: '600', background: s.bg, color: s.color, marginBottom: '0.5rem' }}>{s.label}</span>
                                        {a.status === 'pending' && (
                                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                                <button onClick={() => handleStatusUpdate(a._id, 'confirmed')} style={{ background: '#d1fae5', border: '1px solid #6ee7b7', color: '#065f46', padding: '0.4rem 0.875rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600', fontFamily: 'DM Sans, sans-serif' }}>Accept</button>
                                                <button onClick={() => handleStatusUpdate(a._id, 'cancelled')} style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#ef4444', padding: '0.4rem 0.875rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600', fontFamily: 'DM Sans, sans-serif' }}>Decline</button>
                                            </div>
                                        )}
                                        {a.status === 'confirmed' && (
                                            <button onClick={() => handleStatusUpdate(a._id, 'completed')} style={{ background: '#dbeafe', border: '1px solid #93c5fd', color: '#1e40af', padding: '0.4rem 0.875rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600', fontFamily: 'DM Sans, sans-serif' }}>Mark Complete</button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
};

export default ProviderDashboard;