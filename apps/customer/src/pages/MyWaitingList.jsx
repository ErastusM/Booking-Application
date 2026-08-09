import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { waitingListService } from '../services';
import { apptLocalDate } from '../utils/date';

const MyWaitingList = () => {
    const [searchParams] = useSearchParams();
    const justJoined = searchParams.get('joined') === '1';
    const [entries, setEntries] = useState([]);
    const [notifications, setNotifications] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [listRes, notifRes] = await Promise.all([
                waitingListService.getMyList(),
                waitingListService.getNotifications(),
            ]);
            setEntries(listRes.data.data || []);
            setNotifications(notifRes.data.data || []);
        } catch {
            setError('Failed to load waiting list');
        } finally {
            setLoading(false);
        }
    };

    const handleLeave = async (id) => {
        if (window.confirm('Leave this waiting list?')) {
            try {
                await waitingListService.leave(id);
                setEntries(entries.filter(e => e._id !== id));
            } catch {
                setError('Failed to leave waiting list');
            }
        }
    };

    if (loading) return (
        <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}>
                <div style={{
                    width: '40px', height: '40px',
                    border: '3px solid var(--border)',
                    borderTopColor: 'var(--gold)',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                    margin: '0 auto 1rem',
                }} />
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Loading...</p>
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );

    return (
        <div style={{ background: 'var(--off-white)', minHeight: '100dvh' }}>

            {/* Header */}
            <div style={{
                background: 'var(--ink)',
                paddingTop: 'var(--page-hero-pad-top)',
                paddingBottom: '3rem',
                position: 'relative',
                overflow: 'hidden',
            }}>
                <div style={{
                    position: 'absolute', inset: 0,
                    backgroundImage: 'radial-gradient(ellipse at 60% 50%, rgba(240,62,22,0.045) 0%, transparent 60%)',
                    pointerEvents: 'none',
                }} />
                <div className="container" style={{ position: 'relative' }}>
                    <p style={{
                        color: 'var(--gold)', fontSize: '0.75rem', fontWeight: '600',
                        letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '0.75rem',
                    }}>Queue Status</p>
                    <h1 style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: 'clamp(2rem, 4vw, 3rem)',
                        fontWeight: '600', color: 'white',
                    }}>
                        My Waiting List
                    </h1>
                </div>
            </div>

            <div className="container" style={{ paddingTop: '3rem', paddingBottom: '5rem', maxWidth: '760px' }}>

                {justJoined && (
                    <div style={{
                        background: '#dbeafe', border: '1px solid #93c5fd',
                        color: '#1e40af', padding: '0.875rem 1rem',
                        borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.875rem',
                    }}>
                        <strong>Added to waiting list.</strong> We will notify you if a matching slot opens up.
                    </div>
                )}

                {error && (
                    <div style={{
                        background: '#fee2e2', border: '1px solid #fca5a5',
                        color: '#991b1b', padding: '0.75rem 1rem',
                        borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.875rem',
                    }}>
                        {error}
                    </div>
                )}

                {/* Promotions */}
                {notifications.length > 0 && (
                    <div style={{ marginBottom: '2rem' }}>
                        <h2 style={{
                            fontFamily: 'var(--font-body)',
                            fontSize: '1.2rem', fontWeight: '600',
                            color: 'var(--charcoal)', marginBottom: '1rem',
                        }}>
                            🎉 Good News
                        </h2>
                        {notifications.map(n => (
                            <div key={n._id} style={{
                                background: 'linear-gradient(135deg, #d1fae5, #ecfdf5)',
                                border: '1px solid #6ee7b7',
                                borderRadius: 'var(--radius)',
                                padding: '1.25rem 1.5rem',
                                marginBottom: '0.75rem',
                            }}>
                                <p style={{ fontWeight: '600', color: '#065f46', fontSize: '0.95rem' }}>
                                    You've been promoted for <strong>{n.service?.name}</strong>!
                                </p>
                                <p style={{ color: '#047857', fontSize: '0.85rem', marginTop: '0.35rem' }}>
                                    {apptLocalDate(n.appointmentDate)?.toLocaleDateString('en-US', {
                                        weekday: 'long', month: 'long', day: 'numeric'
                                    })} at {n.startTime} — your appointment has been confirmed.
                                </p>
                            </div>
                        ))}
                    </div>
                )}

                {/* Waiting entries */}
                {entries.length === 0 ? (
                    <div style={{
                        background: 'var(--card-bg)',
                        borderRadius: 'var(--radius)',
                        border: '1px solid var(--border)',
                        padding: '5rem 2rem',
                        textAlign: 'center',
                    }}>
                        <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>⏳</div>
                        <h3 style={{
                            fontFamily: 'var(--font-body)',
                            fontSize: '1.3rem', color: 'var(--charcoal)', marginBottom: '0.5rem',
                        }}>
                            No active queues
                        </h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.6 }}>
                            When a slot you want is fully booked, you can join its waiting list
                            and we'll automatically book you in if a spot opens up.
                        </p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {entries.map((entry, i) => (
                            <div
                                key={entry._id}
                                className="fade-up"
                                style={{
                                    animationDelay: `${i * 0.06}s`,
                                    opacity: 0,
                                    background: 'var(--card-bg)',
                                    borderRadius: 'var(--radius)',
                                    border: '1px solid var(--border)',
                                    boxShadow: 'var(--shadow-sm)',
                                    padding: '1.5rem 2rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '1.5rem',
                                    flexWrap: 'wrap',
                                }}
                            >
                                {/* Position badge */}
                                <div style={{
                                    width: '56px',
                                    height: '56px',
                                    borderRadius: '50%',
                                    background: entry.position === 1
                                        ? 'var(--gold)'
                                        : 'var(--warm-gray)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0,
                                    border: entry.position === 1 ? '2px solid var(--gold-dark)' : '2px solid var(--border)',
                                }}>
                                    <span style={{
                                        fontSize: '0.6rem',
                                        fontWeight: '600',
                                        color: entry.position === 1 ? 'var(--charcoal)' : 'var(--text-muted)',
                                        letterSpacing: '0.05em',
                                        textTransform: 'uppercase',
                                        lineHeight: 1,
                                    }}>No.</span>
                                    <span style={{
                                        fontSize: '1.3rem',
                                        fontWeight: '600',
                                        fontFamily: 'var(--font-body)',
                                        color: entry.position === 1 ? 'var(--charcoal)' : 'var(--text-secondary)',
                                        lineHeight: 1,
                                    }}>
                                        {entry.position}
                                    </span>
                                </div>

                                {/* Info */}
                                <div style={{ flex: 1 }}>
                                    <h3 style={{
                                        fontFamily: 'var(--font-body)',
                                        fontSize: '1.1rem',
                                        fontWeight: '600',
                                        color: 'var(--charcoal)',
                                        marginBottom: '0.35rem',
                                    }}>
                                        {entry.service?.name}
                                    </h3>
                                    <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                                            📅 {apptLocalDate(entry.appointmentDate)?.toLocaleDateString('en-US', {
                                                weekday: 'long', month: 'long', day: 'numeric'
                                            })}
                                        </span>
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                                            🕐 {entry.startTime} — {entry.endTime}
                                        </span>
                                        <span style={{ color: 'var(--gold-dark)', fontSize: '0.85rem', fontWeight: '600' }}>
                                            ${entry.service?.price} · {entry.service?.duration} min
                                        </span>
                                    </div>
                                    {entry.position === 1 && (
                                        <div style={{
                                            marginTop: '0.5rem',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '0.35rem',
                                            background: 'rgba(240,62,22,0.1)',
                                            border: '1px solid rgba(240,62,22,0.3)',
                                            borderRadius: '99px',
                                            padding: '0.2rem 0.75rem',
                                            fontSize: '0.75rem',
                                            fontWeight: '600',
                                            color: 'var(--gold-dark)',
                                        }}>
                                            ✦ You're next in line!
                                        </div>
                                    )}
                                </div>

                                {/* Leave button */}
                                <button
                                    onClick={() => handleLeave(entry._id)}
                                    style={{
                                        background: 'none',
                                        border: '1px solid var(--border)',
                                        color: 'var(--text-muted)',
                                        padding: '0.5rem 1rem',
                                        borderRadius: 'var(--radius-sm)',
                                        cursor: 'pointer',
                                        fontSize: '0.8rem',
                                        fontWeight: '600',
                                        fontFamily: 'var(--font-body)',
                                        transition: 'all 0.2s',
                                        whiteSpace: 'nowrap',
                                        flexShrink: 0,
                                    }}
                                    onMouseEnter={e => {
                                        e.currentTarget.style.borderColor = '#fca5a5';
                                        e.currentTarget.style.color = '#ef4444';
                                    }}
                                    onMouseLeave={e => {
                                        e.currentTarget.style.borderColor = 'var(--border)';
                                        e.currentTarget.style.color = 'var(--text-muted)';
                                    }}
                                >
                                    Leave Queue
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
};

export default MyWaitingList;