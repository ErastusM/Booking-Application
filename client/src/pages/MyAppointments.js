import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { appointmentService, reviewService, messageService } from '../services';
import ReviewModal from '../components/ReviewModal';
import IntakeFormModal from '../components/IntakeFormModal';
import RescheduleModal from '../components/RescheduleModal';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import { useAuthContext } from '../context/AuthContext';
import { mapsUrl } from '../utils/maps';
import { CalendarClock, CalendarPlus, MessageSquare, ClipboardList, Star, X, RefreshCw, MapPin, Copy, Check, ChevronDown } from 'lucide-react';

const statusConfig = {
    pending:   { label: 'Pending',   bg: '#fef3c7', color: '#92400e' },
    confirmed: { label: 'Confirmed', bg: '#dbeafe', color: '#1e40af' },
    completed: { label: 'Completed', bg: '#d1fae5', color: '#065f46' },
    cancelled: { label: 'Cancelled', bg: '#fee2e2', color: '#991b1b' },
    'no-show': { label: 'No-show',   bg: '#ede9fe', color: '#5b21b6' },
};

const buildGCalUrl = (a) => {
    try {
        const pad = (n) => String(n).padStart(2, '0');
        const base = new Date(a.appointmentDate);
        const [sh, sm] = (a.startTime || '09:00').split(':').map(Number);
        const [eh, em] = (a.endTime || '10:00').split(':').map(Number);
        const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), sh, sm);
        const end = new Date(base.getFullYear(), base.getMonth(), base.getDate(), eh, em);
        const fmt = (d) => `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
        return `https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(a.service?.name || 'Appointment')}&dates=${fmt(start)}/${fmt(end)}&details=${encodeURIComponent('Booked via Bookplus')}`;
    } catch (_) { return '#'; }
};

const MyAppointments = () => {
    const navigate = useNavigate();
    const { user } = useAuthContext();
    const [searchParams] = useSearchParams();
    const justConfirmed = searchParams.get('confirmed') === '1';
    const justWaitlisted = searchParams.get('waitlisted') === '1';
    const confirmedProvider = searchParams.get('provider') || '';
    const [appointments, setAppointments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [reviewedIds, setReviewedIds] = useState([]);
    const [selectedAppointment, setSelectedAppointment] = useState(null);
    const [activeFilter, setActiveFilter] = useState('all');
    const [showCancelModal, setShowCancelModal] = useState(null); // appointment object
    const [rescheduleAppt, setRescheduleAppt] = useState(null); // appointment being rescheduled (popup)
    const [showConfirmedBanner, setShowConfirmedBanner] = useState(justConfirmed);
    const [showWaitlistedBanner, setShowWaitlistedBanner] = useState(justWaitlisted);
    const [msgModal, setMsgModal] = useState(null);       // appointment object
    const [formsModalApptId, setFormsModalApptId] = useState(null); // appointment id for intake forms
    const [msgThread, setMsgThread] = useState([]);
    const [msgText, setMsgText] = useState('');
    const [loadingMsgs, setLoadingMsgs] = useState(false);
    const [sendingMsg, setSendingMsg] = useState(false);
    const [gettingThere, setGettingThere] = useState(null); // appointment id whose map is expanded
    const [copiedRef, setCopiedRef] = useState(null);        // booking ref just copied
    const msgEndRef = React.useRef(null);

    // Booking reference: stable, human-quotable code for support. New bookings carry
    // a stored reference; older ones fall back to a deterministic slice of their id.
    const bookingRef = (a) => a.bookingReference || (a._id ? a._id.slice(-8).toUpperCase() : '—');
    const copyRef = (ref) => {
        try { navigator.clipboard?.writeText(ref); } catch (_) { /* clipboard may be blocked */ }
        setCopiedRef(ref);
        setTimeout(() => setCopiedRef((c) => (c === ref ? null : c)), 1800);
    };

    useEffect(() => { fetchData(); }, []);

    // Live updates — refresh the bookings list on an interval and when the tab
    // regains focus, so status changes (confirm/cancel/reschedule) appear on their own.
    useLiveRefresh(() => fetchData(), { intervalMs: 30000 });

    // Live chat — refresh the open message thread so replies appear without reload.
    useLiveRefresh(() => {
        if (msgModal) {
            messageService.getMessages(msgModal._id)
                .then(res => setMsgThread(res.data.data || [])).catch(() => {});
        }
    }, { intervalMs: 8000, enabled: !!msgModal });

    useEffect(() => {
        if (searchParams.get('rescheduled') === '1') {
            setSuccess('Appointment rescheduled and confirmed.');
            const t = setTimeout(() => setSuccess(''), 12000);
            return () => clearTimeout(t);
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!justConfirmed && !justWaitlisted) return;
        const t = setTimeout(() => {
            setShowConfirmedBanner(false);
            setShowWaitlistedBanner(false);
        }, 15000);
        return () => clearTimeout(t);
    }, []);

    const fetchData = async () => {
        try {
            const [apptRes, reviewRes] = await Promise.all([
                appointmentService.getCustomerAppointments(),
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

    const handleCancel = (appointment) => {
        setShowCancelModal(appointment);
    };

    const confirmCancel = async () => {
        const id = showCancelModal._id;
        setShowCancelModal(null);
        try {
            await appointmentService.cancelAppointment(id, 'Cancelled by customer');
            setAppointments(appointments.map(a => a._id === id ? { ...a, status: 'cancelled' } : a));
            setSuccess('Appointment cancelled successfully.');
            setTimeout(() => setSuccess(''), 15000);
        } catch {
            setError('Failed to cancel appointment');
        }
    };

    const openMsgModal = async (appointment) => {
        setMsgModal(appointment);
        setMsgThread([]);
        setMsgText('');
        setLoadingMsgs(true);
        try {
            const res = await messageService.getMessages(appointment._id);
            setMsgThread(res.data.data || []);
        } catch { /* no prior messages is fine */ }
        setLoadingMsgs(false);
    };

    const sendMsg = async (e) => {
        e.preventDefault();
        if (!msgText.trim() || sendingMsg) return;
        setSendingMsg(true);
        try {
            const res = await messageService.sendMessage(msgModal._id, msgText.trim());
            setMsgThread(prev => [...prev, res.data.data]);
            setMsgText('');
            setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
        } catch {
            setError('Failed to send message');
        }
        setSendingMsg(false);
    };

    // Reschedule opens an availability-aware popup right here (no navigating/scrolling).
    // It can only pick genuinely open slots and auto-confirms when the slot is free.
    const goReschedule = (a) => setRescheduleAppt(a);

    const filters = ['all', 'pending', 'confirmed', 'completed', 'cancelled'];

    // Combine the appointment's calendar date with its start time into one sortable
    // instant. setHours on the parsed date keeps it consistent with how the date is
    // displayed elsewhere (both read the same local calendar day).
    const apptStamp = (a) => {
        const d = new Date(a.appointmentDate);
        if (isNaN(d)) return 0;
        const [h = 0, m = 0] = (a.startTime || '00:00').split(':').map(Number);
        d.setHours(h, m, 0, 0);
        return d.getTime();
    };

    // Sort by date + time so the list reads chronologically: upcoming appointments
    // soonest-first, then past ones most-recent-first. Without this the list came back
    // in arbitrary server order (e.g. Apr 30 above Apr 25), which made it hard to scan.
    const sortByDateTime = (list) => {
        const now = Date.now();
        return [...list].sort((a, b) => {
            const ta = apptStamp(a), tb = apptStamp(b);
            const aUpcoming = ta >= now, bUpcoming = tb >= now;
            if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
            return aUpcoming ? ta - tb : tb - ta;
        });
    };

    const filtered = sortByDateTime(
        activeFilter === 'all' ? appointments : appointments.filter(a => a.status === activeFilter)
    );
    const counts = filters.reduce((acc, f) => {
        acc[f] = f === 'all' ? appointments.length : appointments.filter(a => a.status === f).length;
        return acc;
    }, {});

    const labelStyle = { fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.25rem' };

    if (loading) return (
        <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}>
                <div style={{ width: '40px', height: '40px', border: '3px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 1rem' }} />
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Loading appointments...</p>
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );

    return (
        <div style={{ background: 'var(--off-white)', minHeight: '100dvh' }}>

            {/* Header */}
            <div style={{ background: 'var(--ink)', paddingTop: '9rem', paddingBottom: '3rem', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(ellipse at 80% 50%, rgba(201,168,76,0.045) 0%, transparent 60%)', pointerEvents: 'none' }} />
                <div className="container" style={{ position: 'relative' }}>
                    <p style={{ color: 'var(--gold)', fontSize: '0.75rem', fontWeight: '600', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Your Schedule</p>
                    <h1 style={{ fontFamily: 'var(--font-body)', fontSize: 'clamp(2rem, 4vw, 3rem)', fontWeight: '700', color: 'white' }}>My Appointments</h1>
                </div>
            </div>

            <div className="container" style={{ paddingTop: '2.5rem', paddingBottom: '5rem' }}>

                {showConfirmedBanner && (
                    <div style={{ background: '#d1fae5', border: '1px solid #6ee7b7', color: '#065f46', padding: '1rem 1.25rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.75rem', fontFamily: 'Outfit, sans-serif' }}>
                        <span style={{ fontSize: '1.2rem' }}>✅</span>
                        <div>
                            <strong>Appointment confirmed{confirmedProvider ? ` with ${confirmedProvider}` : ''}!</strong>
                            {user?.name ? ` ${user.name.split(' ')[0]}, y` : ' Y'}ou'll receive a confirmation email shortly. See you there.
                        </div>
                    </div>
                )}

                {showWaitlistedBanner && (
                    <div style={{ background: '#dbeafe', border: '1px solid #93c5fd', color: '#1e40af', padding: '1rem 1.25rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.75rem', fontFamily: 'Outfit, sans-serif' }}>
                        <span style={{ fontSize: '1.2rem' }}>🔔</span>
                        <div><strong>Added to waiting list.</strong> We'll notify you if a slot opens up.</div>
                    </div>
                )}

                {error && (
                    <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
                        {error}
                    </div>
                )}

                {success && (
                    <div style={{ background: '#d1fae5', border: '1px solid #6ee7b7', color: '#065f46', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        ✅ {success}
                    </div>
                )}

                {/* Rebook your last visit — one tap */}
                {(() => {
                    const past = [...appointments]
                        .filter(a => a.service && (a.status === 'completed' || new Date(a.appointmentDate) < new Date()))
                        .sort((a, b) => new Date(b.appointmentDate) - new Date(a.appointmentDate));
                    const last = past[0];
                    if (!last) return null;
                    const providerId = last.service?.provider || '';
                    const serviceId = last.service?._id || '';
                    return (
                        <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', padding: '1.1rem 1.4rem', marginBottom: '1.5rem' }}>
                            <div>
                                <p style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', margin: '0 0 0.25rem', fontWeight: '700' }}>Book again</p>
                                <p style={{ margin: 0, color: 'var(--charcoal)', fontWeight: '600' }}>{last.service?.name}<span style={{ color: 'var(--text-muted)', fontWeight: '400' }}> · last on {new Date(last.appointmentDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span></p>
                            </div>
                            <button onClick={() => navigate(`/book-appointment?providerId=${providerId}&serviceId=${serviceId}`)} className="btn btn--primary" style={{ flexShrink: 0 }}>
                                Rebook this →
                            </button>
                        </div>
                    );
                })()}

                {/* Filter tabs */}
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem', borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
                    {filters.map(f => (
                        <button key={f} onClick={() => setActiveFilter(f)} style={{
                            padding: '0.6rem 1.25rem', background: 'none', border: 'none',
                            borderBottom: activeFilter === f ? '2px solid var(--gold)' : '2px solid transparent',
                            color: activeFilter === f ? 'var(--gold-dark)' : 'var(--text-muted)',
                            fontWeight: activeFilter === f ? '600' : '400', fontSize: '0.875rem',
                            cursor: 'pointer', fontFamily: 'var(--font-body)',
                            textTransform: 'capitalize', whiteSpace: 'nowrap',
                            transition: 'all 0.2s', marginBottom: '-1px',
                        }}>
                            {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
                            {counts[f] > 0 && (
                                <span style={{ marginLeft: '0.4rem', background: activeFilter === f ? 'var(--gold)' : 'var(--warm-gray)', color: activeFilter === f ? 'var(--charcoal)' : 'var(--text-muted)', fontSize: '0.7rem', fontWeight: '700', padding: '0.1rem 0.45rem', borderRadius: '99px' }}>
                                    {counts[f]}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Appointments list */}
                {filtered.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '5rem 2rem', background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📅</div>
                        <h3 style={{ fontFamily: 'var(--font-body)', fontSize: '1.3rem', color: 'var(--charcoal)', marginBottom: '0.5rem' }}>
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
                                <div key={a._id} className="fade-up appt-row" style={{
                                    // Cap the stagger so long lists don't leave cards far down
                                    // the page stuck invisible (opacity:0) while you scroll.
                                    animationDelay: `${Math.min(i, 8) * 0.05}s`, opacity: 0,
                                    background: 'var(--card-bg)', borderRadius: 'var(--radius)',
                                    border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)',
                                    padding: '1.5rem 2rem', display: 'grid',
                                    gridTemplateColumns: '1fr 1fr 1fr 1fr auto',
                                    alignItems: 'center', gap: '1.5rem',
                                }}>
                                    <div>
                                        <p style={labelStyle}>Service</p>
                                        <p style={{ fontFamily: 'var(--font-body)', fontWeight: '600', color: 'var(--charcoal)', fontSize: '1rem' }}>{a.service?.name}</p>
                                        <p style={{ color: 'var(--gold-dark)', fontWeight: '600', fontSize: '0.9rem' }}>${a.totalPrice}</p>
                                    </div>
                                    <div>
                                        <p style={labelStyle}>Date</p>
                                        <p style={{ fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.95rem' }}>
                                            {new Date(a.appointmentDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                                        </p>
                                    </div>
                                    <div>
                                        <p style={labelStyle}>Time</p>
                                        <p style={{ fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.95rem' }}>{a.startTime} – {a.endTime}</p>
                                    </div>
                                    <div>
                                        <p style={labelStyle}>Status</p>
                                        <span style={{ display: 'inline-block', padding: '0.25rem 0.75rem', borderRadius: '99px', fontSize: '0.75rem', fontWeight: '600', background: status.bg, color: status.color }}>
                                            {status.label}
                                        </span>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'stretch', minWidth: '168px' }}>
                                        {(() => {
                                            const base = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', width: '100%', padding: '0.5rem 0.875rem', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', fontWeight: '600', fontFamily: 'var(--font-body)', cursor: 'pointer', textDecoration: 'none', boxSizing: 'border-box', lineHeight: 1.2 };
                                            const gold = { ...base, background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.3)', color: 'var(--gold-dark)' };
                                            const neutral = { ...base, background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)' };
                                            return (
                                                <>
                                                    {(a.status === 'pending' || a.status === 'confirmed') && (
                                                        <button onClick={() => goReschedule(a)} style={gold}>
                                                            <CalendarClock size={15} strokeWidth={2} /> Reschedule
                                                        </button>
                                                    )}
                                                    {(a.status === 'pending' || a.status === 'confirmed') && (
                                                        <a href={buildGCalUrl(a)} target="_blank" rel="noopener noreferrer" style={{ ...base, background: '#4285F4', border: '1px solid #4285F4', color: 'white' }}>
                                                            <CalendarPlus size={15} strokeWidth={2} /> Google Calendar
                                                        </a>
                                                    )}
                                                    {a.status !== 'cancelled' && a.status !== 'completed' && (
                                                        <button onClick={() => handleCancel(a)} style={{ ...base, background: 'none', border: '1px solid #fca5a5', color: '#ef4444' }}>
                                                            <X size={15} strokeWidth={2} /> Cancel
                                                        </button>
                                                    )}
                                                    {a.status === 'completed' && !isReviewed && (
                                                        <button onClick={() => setSelectedAppointment(a)} style={gold}>
                                                            <Star size={15} strokeWidth={2} /> Review
                                                        </button>
                                                    )}
                                                    {a.status === 'completed' && isReviewed && (
                                                        <span style={{ fontSize: '0.8rem', color: '#065f46', fontWeight: '600', textAlign: 'center' }}>✓ Reviewed</span>
                                                    )}
                                                    {a.status === 'completed' && (
                                                        <button onClick={() => navigate(`/book-appointment?providerId=${a.service?.provider || ''}&serviceId=${a.service?._id || ''}`)} style={gold}>
                                                            <RefreshCw size={15} strokeWidth={2} /> Book again
                                                        </button>
                                                    )}
                                                    {(a.status === 'pending' || a.status === 'confirmed' || a.status === 'completed') && (
                                                        <button onClick={() => openMsgModal(a)} style={neutral}>
                                                            <MessageSquare size={15} strokeWidth={2} /> Message
                                                        </button>
                                                    )}
                                                    {(a.status === 'pending' || a.status === 'confirmed') && (
                                                        <button onClick={() => setFormsModalApptId(a._id)} style={neutral}>
                                                            <ClipboardList size={15} strokeWidth={2} /> Forms
                                                        </button>
                                                    )}
                                                </>
                                            );
                                        })()}
                                    </div>

                                    {/* Footer: booking reference + "Getting there" (kept a <footer>, not a
                                        div, so the responsive .appt-row rules still target the actions column) */}
                                    {(() => {
                                        const prof = a.service?.provider?.providerProfile;
                                        const address = prof?.address || '';
                                        const bizName = prof?.businessName || a.service?.provider?.name || '';
                                        const ref = bookingRef(a);
                                        const open = gettingThere === a._id;
                                        return (
                                            <footer style={{ gridColumn: '1 / -1', marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                                                    <button
                                                        onClick={() => copyRef(ref)}
                                                        title="Copy booking reference"
                                                        aria-label={`Copy booking reference ${ref}`}
                                                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', minHeight: '36px', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'Outfit, sans-serif', fontSize: '0.78rem' }}
                                                    >
                                                        <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>Booking ref</span>
                                                        <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--charcoal)', letterSpacing: '0.08em' }}>{ref}</span>
                                                        {copiedRef === ref ? <Check size={14} color="#059669" /> : <Copy size={13} color="var(--text-muted)" />}
                                                    </button>
                                                    {address && (
                                                        <button
                                                            onClick={() => setGettingThere(open ? null : a._id)}
                                                            aria-expanded={open}
                                                            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', minHeight: '36px', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.4rem 0.7rem', cursor: 'pointer', color: 'var(--text-secondary)', fontFamily: 'Outfit, sans-serif', fontSize: '0.78rem', fontWeight: 600 }}
                                                        >
                                                            <MapPin size={14} /> Getting there
                                                            <ChevronDown size={14} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                                                        </button>
                                                    )}
                                                </div>
                                                {open && address && (
                                                    <div style={{ marginTop: '1rem' }}>
                                                        {bizName && <p style={{ fontWeight: 700, color: 'var(--charcoal)', fontSize: '0.9rem', margin: '0 0 0.2rem', fontFamily: 'var(--font-body)' }}>{bizName}</p>}
                                                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0 0 0.75rem', fontFamily: 'Outfit, sans-serif', lineHeight: 1.5 }}>{address}</p>
                                                        <iframe
                                                            title={`Map to ${bizName || 'appointment location'}`}
                                                            src={`https://maps.google.com/maps?q=${encodeURIComponent(address)}&z=15&output=embed`}
                                                            loading="lazy"
                                                            referrerPolicy="no-referrer-when-downgrade"
                                                            style={{ width: '100%', height: '200px', border: 0, borderRadius: 'var(--radius-sm)', display: 'block' }}
                                                        />
                                                        <a href={mapsUrl(address)} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', minHeight: '44px', marginTop: '0.5rem', color: 'var(--gold-dark)', fontWeight: 600, fontSize: '0.85rem', textDecoration: 'none', fontFamily: 'Outfit, sans-serif' }}>
                                                            Get directions →
                                                        </a>
                                                    </div>
                                                )}
                                            </footer>
                                        );
                                    })()}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Message Modal */}
            {msgModal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(26,26,46,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
                    <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', width: '100%', maxWidth: '480px', boxShadow: '0 20px 60px rgba(26,26,46,0.25)', display: 'flex', flexDirection: 'column', maxHeight: '80vh' }}>
                        {/* Header */}
                        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                            <div>
                                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: '700', color: 'var(--charcoal)', margin: 0 }}>
                                    Message Provider
                                </h2>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0.2rem 0 0', fontFamily: 'Outfit, sans-serif' }}>
                                    {msgModal.service?.name} · {new Date(msgModal.appointmentDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                </p>
                            </div>
                            <button onClick={() => setMsgModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.4rem', lineHeight: 1, padding: 0 }}>×</button>
                        </div>

                        {/* Thread */}
                        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {loadingMsgs ? (
                                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>Loading messages…</div>
                            ) : msgThread.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>No messages yet. Say hello!</div>
                            ) : msgThread.map((m, i) => {
                                const isMine = m.sender?._id === user?._id || m.sender === user?._id;
                                return (
                                    <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: isMine ? 'flex-end' : 'flex-start' }}>
                                        <div style={{
                                            maxWidth: '75%', padding: '0.6rem 0.9rem',
                                            borderRadius: isMine ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                                            background: isMine ? 'var(--charcoal)' : 'var(--warm-gray)',
                                            color: isMine ? 'white' : 'var(--charcoal)',
                                            fontSize: '0.875rem', lineHeight: '1.45', fontFamily: 'Outfit, sans-serif',
                                        }}>
                                            {m.content}
                                        </div>
                                        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '3px', fontFamily: 'Outfit, sans-serif' }}>
                                            {new Date(m.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                );
                            })}
                            <div ref={msgEndRef} />
                        </div>

                        {/* Input */}
                        <form onSubmit={sendMsg} style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border)', display: 'flex', gap: '0.75rem', flexShrink: 0 }}>
                            <input
                                value={msgText}
                                onChange={e => setMsgText(e.target.value)}
                                placeholder="Type a message…"
                                maxLength={2000}
                                className="input"
                                style={{ flex: 1, fontSize: '0.875rem' }}
                                autoFocus
                            />
                            <button type="submit" disabled={!msgText.trim() || sendingMsg} className="btn-primary" style={{ padding: '0.5rem 1.25rem', whiteSpace: 'nowrap' }}>
                                {sendingMsg ? '…' : 'Send'}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* Cancel-or-Reschedule Modal */}
            {showCancelModal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(26,26,46,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
                    <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', padding: '2rem', width: '100%', maxWidth: '420px', boxShadow: '0 20px 60px rgba(26,26,46,0.25)' }}>
                        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '0.5rem' }}>What would you like to do?</h2>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '2rem', fontFamily: 'Outfit, sans-serif', lineHeight: '1.5' }}>
                            <strong style={{ color: 'var(--charcoal)' }}>{showCancelModal.service?.name}</strong> on{' '}
                            {new Date(showCancelModal.appointmentDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at {showCancelModal.startTime}.
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <button
                                onClick={() => {
                                    const appt = showCancelModal;
                                    setShowCancelModal(null);
                                    goReschedule(appt);
                                }}
                                className="btn-primary"
                                style={{ padding: '0.9rem', fontSize: '0.95rem', textAlign: 'center' }}
                            >
                                🗓 Reschedule Instead
                            </button>
                            <button
                                onClick={confirmCancel}
                                style={{ padding: '0.9rem', background: 'none', border: '1.5px solid #fca5a5', color: '#dc2626', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.875rem', fontWeight: '600', fontFamily: 'Outfit, sans-serif', transition: 'background 0.2s' }}
                                onMouseEnter={e => e.currentTarget.style.background = '#fff1f2'}
                                onMouseLeave={e => e.currentTarget.style.background = 'none'}
                            >
                                Cancel Appointment
                            </button>
                            <button
                                onClick={() => setShowCancelModal(null)}
                                style={{ padding: '0.75rem', background: 'none', border: '1.5px solid var(--border)', color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.875rem', fontFamily: 'Outfit, sans-serif' }}
                            >
                                Go Back
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {selectedAppointment && (
                <ReviewModal appointment={selectedAppointment} onClose={() => setSelectedAppointment(null)} onSubmitted={fetchData} />
            )}

            {formsModalApptId && (
                <IntakeFormModal appointmentId={formsModalApptId} onClose={() => setFormsModalApptId(null)} />
            )}

            {rescheduleAppt && (
                <RescheduleModal
                    appointment={rescheduleAppt}
                    onClose={() => setRescheduleAppt(null)}
                    onDone={() => { setRescheduleAppt(null); setSuccess('Appointment rescheduled and confirmed.'); fetchData(); }}
                />
            )}

            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
};

export default MyAppointments;