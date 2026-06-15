import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthContext } from '../context/AuthContext';
import { appointmentService, serviceService, waitingListService, providerMarketService, availabilityService } from '../services';
import { Calendar, Clock, CalendarX2 } from 'lucide-react';

const BookAppointment = () => {
    const { user } = useAuthContext();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    // â"€â"€ data â"€â"€
    const [services, setServices] = useState([]);
    const [providerInfo, setProviderInfo] = useState(null);

    // â"€â"€ selections â"€â"€
    const [selectedService, setSelectedService] = useState(null);
    const [selectedAddOns, setSelectedAddOns] = useState([]);
    const [selectedOption, setSelectedOption] = useState(null); // sub-option (mutually exclusive variant)
    const [optionSheet, setOptionSheet] = useState(null); // service pending option selection
    const [formData, setFormData] = useState({ service: '', appointmentDate: '', startTime: '', endTime: '', notes: '' });

    // â"€â"€ ui state â"€â"€
    const [step, setStep] = useState('form'); // 'form' | 'review'
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [providerAvailability, setProviderAvailability] = useState(null);
    const [availabilityError, setAvailabilityError] = useState('');
    const [bookedSlots, setBookedSlots] = useState([]); // [{startTime, endTime}]

    const effectivePrice    = selectedOption ? selectedOption.price    : (selectedService?.price    ?? 0);
    const effectiveDuration = selectedOption ? selectedOption.duration : (selectedService?.duration ?? 0);

    const totalPrice = selectedService
        ? effectivePrice + selectedAddOns.reduce((sum, a) => sum + a.price, 0)
        : 0;

    const totalDuration = selectedService
        ? effectiveDuration + selectedAddOns.reduce((sum, a) => sum + (a.duration || 0), 0)
        : 0;

    const handleServiceSelect = (service) => {
        if (service.options && service.options.length > 0) {
            setOptionSheet(service); // show picker first
        } else {
            setSelectedService(service);
            setSelectedOption(null);
            setSelectedAddOns([]);
            setFormData(prev => ({ ...prev, service: service._id }));
        }
    };

    const handleOptionConfirm = (option) => {
        setSelectedService(optionSheet);
        setSelectedOption(option);
        setSelectedAddOns([]);
        setFormData(prev => ({ ...prev, service: optionSheet._id }));
        setOptionSheet(null);
    };

    const toggleAddOn = (addOn) => {
        setSelectedAddOns(prev =>
            prev.some(a => a.name === addOn.name)
                ? prev.filter(a => a.name !== addOn.name)
                : [...prev, addOn]
        );
    };

    useEffect(() => {
        const providerId = searchParams.get('providerId');
        if (!providerId) return;
        availabilityService.getProviderAvailability(providerId)
            .then(res => setProviderAvailability(res.data.data.schedule))
            .catch(() => {});
    }, []);

    useEffect(() => {
        if (!providerAvailability || !formData.appointmentDate || !formData.startTime) {
            setAvailabilityError('');
            return;
        }
        const [y, m, d] = formData.appointmentDate.split('-').map(Number);
        const dayIndex = new Date(y, m - 1, d).getDay();
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const dayName = dayNames[dayIndex];
        const daySchedule = providerAvailability[dayName];
        const allWorkingHours = Object.entries(providerAvailability)
            .filter(([, v]) => v.enabled)
            .map(([day, v]) => {
                const hrs = (v.slots || []).filter(s => s?.start && s?.end).map(s => `${s.start}-${s.end}`).join(', ');
                return `${day.charAt(0).toUpperCase() + day.slice(1, 3)}: ${hrs}`;
            }).join('; ');
        if (!daySchedule || !daySchedule.enabled) {
            setAvailabilityError(`This provider is not available at this time. Working hours are ${allWorkingHours || 'not set'}`);
            return;
        }
        // Valid if the chosen start falls within ANY working block that day (split shifts)
        const dayHours = (daySchedule.slots || []).filter(s => s?.start && s?.end);
        const within = dayHours.some(s => formData.startTime >= s.start && formData.startTime < s.end);
        if (!within) {
            setAvailabilityError(`This provider is not available at this time. Working hours are ${dayHours.map(s => `${s.start}-${s.end}`).join(', ') || 'not set'}`);
            return;
        }
        setAvailabilityError('');
    }, [providerAvailability, formData.appointmentDate, formData.startTime]);

    useEffect(() => {
        if (!user) navigate('/login');
        const fetchServices = async () => {
            try {
                const providerId = searchParams.get('providerId');
                const preSelectedServiceId = searchParams.get('serviceId');
                let servicesData = [];

                if (providerId) {
                    const response = await providerMarketService.getProviderProfile(providerId);
                    setProviderInfo(response.data.data.provider);
                    const allCategories = Object.values(response.data.data.categories);
                    const seen = new Set();
                    allCategories.forEach(cat => {
                        cat.services.forEach(s => {
                            if (!seen.has(s._id)) {
                                seen.add(s._id);
                                servicesData.push(s);
                            }
                        });
                    });
                } else {
                    const response = await serviceService.getAllServices();
                    servicesData = response.data.data;
                }
                setServices(servicesData);
                if (preSelectedServiceId) {
                    const preSelected = servicesData.find(s => s._id === preSelectedServiceId);
                    if (preSelected) handleServiceSelect(preSelected);
                }
            } catch {
                setError('Failed to fetch services');
            }
        };
        fetchServices();
    }, [user, navigate]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleDateSelect = (dateStr) => {
        setFormData(prev => ({ ...prev, appointmentDate: dateStr, startTime: '', endTime: '' }));
        // Fetch already-booked slots for this provider+date
        const providerId = searchParams.get('providerId');
        if (providerId) {
            appointmentService.getBookedSlots(providerId, dateStr)
                .then(res => setBookedSlots(res.data.data || []))
                .catch(() => setBookedSlots([]));
        }
    };

    const handleTimeSelect = (time) => {
        const [hours, minutes] = time.split(':').map(Number);
        const totalMins = hours * 60 + minutes + (totalDuration || 30);
        const endH = Math.floor(totalMins / 60) % 24;
        const endM = totalMins % 60;
        setFormData(prev => ({
            ...prev,
            startTime: time,
            endTime: `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`,
        }));
    };

    const handleConfirm = async () => {
        setLoading(true);
        setError('');
        try {
            await appointmentService.createAppointment({ ...formData, selectedAddOns });
            const providerName = providerInfo?.name || '';
            navigate(`/appointments?confirmed=1&provider=${encodeURIComponent(providerName)}`);
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to book appointment');
            setStep('form');
        } finally {
            setLoading(false);
        }
    };

    const handleJoinWaitingList = async () => {
        if (!formData.service || !formData.appointmentDate || !formData.startTime) {
            setError('Please fill in service, date and start time first');
            return;
        }
        setError('');
        try {
            await waitingListService.join({ service: formData.service, provider: searchParams.get('providerId') || undefined, appointmentDate: formData.appointmentDate, startTime: formData.startTime, endTime: formData.endTime });
            const target = '/waiting-list?joined=1';
            navigate(target, { replace: true });
            // Fallback in case SPA navigation is interrupted by stale client chunks in production.
            setTimeout(() => {
                if (window.location.pathname !== '/waiting-list') {
                    window.location.assign(target);
                }
            }, 120);
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to join waiting list');
        }
    };

    const today = new Date().toISOString().split('T')[0];

    // Date strip — next 6 months (~180 days)
    const dateStrip = (() => {
        const days = [];
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        for (let i = 0; i < 180; i++) {
            const d = new Date(now);
            d.setDate(now.getDate() + i);
            days.push(d);
        }
        return days;
    })();

    // Generate time slot pills from provider availability (or 08:00–20:00 fallback).
    // Slots step by the selected service duration, span EVERY working block of the day
    // (so split shifts / lunch breaks are honoured), and never appear in the past.
    const generateTimeSlots = (dateStr) => {
        const duration = totalDuration || 30;
        const interval = duration;

        // Working blocks for the day — supports multiple slots (e.g. 09:00–12:00, 13:00–17:00)
        let blocks = [{ start: 8 * 60, end: 20 * 60 }];
        if (providerAvailability && dateStr) {
            const [y, m, d] = dateStr.split('-').map(Number);
            const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            const daySchedule = providerAvailability[dayNames[new Date(y, m - 1, d).getDay()]];
            if (!daySchedule?.enabled || !Array.isArray(daySchedule.slots) || daySchedule.slots.length === 0) return [];
            blocks = daySchedule.slots
                .filter(s => s?.start && s?.end)
                .map(s => {
                    const [sH, sM] = s.start.split(':').map(Number);
                    const [eH, eM] = s.end.split(':').map(Number);
                    return { start: sH * 60 + sM, end: eH * 60 + eM };
                })
                .filter(b => b.end > b.start)
                .sort((a, b) => a.start - b.start);
            if (blocks.length === 0) return [];
        }

        // Convert booked appointments to minute ranges
        const bookedRanges = bookedSlots.map(b => {
            const [bsH, bsM] = b.startTime.split(':').map(Number);
            const [beH, beM] = b.endTime.split(':').map(Number);
            return { start: bsH * 60 + bsM, end: beH * 60 + beM };
        });

        // For today, hide times that have already passed
        let minStart = -1;
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        if (dateStr === todayStr) minStart = now.getHours() * 60 + now.getMinutes();

        const slots = [];
        blocks.forEach(block => {
            for (let mins = block.start; mins + duration <= block.end; mins += interval) {
                if (mins < minStart) continue;
                const slotEnd = mins + duration;
                const isBooked = bookedRanges.some(b => mins < b.end && slotEnd > b.start);
                const h = Math.floor(mins / 60);
                const min = mins % 60;
                slots.push({ time: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`, isBooked });
            }
        });
        return slots;
    };

    const timeSlots = generateTimeSlots(formData.appointmentDate);
    const selectedSlotBooked = formData.startTime && timeSlots.find(s => s.time === formData.startTime)?.isBooked;
    const canReview = formData.service && formData.appointmentDate && formData.startTime && !availabilityError && !selectedSlotBooked;

    const labelStyle = { display: 'block', fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.5rem', letterSpacing: '0.05em', textTransform: 'uppercase' };
    const cardStyle = { background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '2rem', boxShadow: 'var(--shadow-sm)' };
    const stepBadge = (num) => (
        <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--gold)', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: '700', flexShrink: 0 }}>{num}</div>
    );

    const formattedDate = formData.appointmentDate
        ? new Date(formData.appointmentDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })
        : '';

    // â"€â"€â"€ REVIEW SCREEN â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    if (step === 'review') {
        return (
            <div style={{ background: 'var(--off-white)', minHeight: '100vh' }}>
                {/* Header */}
                <div style={{ background: 'var(--ink)', paddingTop: '9rem', paddingBottom: '3rem', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(ellipse at 20% 50%, rgba(201,168,76,0.05) 0%, transparent 60%)', pointerEvents: 'none' }} />
                    <div className="container" style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <button onClick={() => setStep('form')} style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 'var(--radius-sm)', padding: '0.5rem 1rem', color: 'white', cursor: 'pointer', fontSize: '0.85rem', fontFamily: 'Outfit, sans-serif' }}>&larr; Back</button>
                        <div>
                            <p style={{ color: 'var(--gold)', fontSize: '0.75rem', fontWeight: '600', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Almost there</p>
                            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.8rem, 4vw, 2.5rem)', fontWeight: '600', color: 'white' }}>Review & Confirm</h1>
                        </div>
                    </div>
                </div>

                <div className="container" style={{ paddingTop: '3rem', paddingBottom: '5rem' }}>
                    {error && <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b', padding: '0.875rem 1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>{error}</div>}

                    <div className="booking-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 340px', gap: '2rem', alignItems: 'start', paddingBottom: '5rem' }}>

                        {/* Left - booking details card */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                            {/* Provider + date/time block */}
                            <div style={cardStyle}>
                                {providerInfo && (
                                    <>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', paddingBottom: '1.25rem', borderBottom: '1px solid var(--border)', marginBottom: '1.25rem' }}>
                                            <div style={{ width: '56px', height: '56px', borderRadius: '50%', overflow: 'hidden', background: 'var(--warm-gray)', flexShrink: 0 }}>
                                                {providerInfo.avatar
                                                    ? <img src={providerInfo.avatar} alt={providerInfo.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                    : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontSize: '1.4rem', color: 'var(--gold)', fontWeight: '600' }}>{providerInfo.name?.charAt(0)}</div>
                                                }
                                            </div>
                                            <div>
                                                <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: '600', color: 'var(--charcoal)' }}>{providerInfo.name}</div>
                                                {providerInfo.providerCategory && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>{providerInfo.providerCategory}</div>}
                                                {providerInfo.businessProfile?.address && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '3px' }}>{providerInfo.businessProfile.address}</div>}
                                            </div>
                                        </div>
                                    </>
                                )}

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                        <Calendar size={16} strokeWidth={2} style={{ color: 'var(--gold-dark)', flexShrink: 0 }} />
                                        <span style={{ fontFamily: 'Outfit, sans-serif', color: 'var(--charcoal)', fontWeight: '500' }}>{formattedDate}</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                        <Clock size={16} strokeWidth={2} style={{ color: 'var(--gold-dark)', flexShrink: 0 }} />
                                        <span style={{ fontFamily: 'Outfit, sans-serif', color: 'var(--charcoal)', fontWeight: '500' }}>
                                            {formData.startTime}-{formData.endTime}
                                            <span style={{ color: 'var(--text-muted)', fontWeight: '400' }}> ({totalDuration} min)</span>
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Services + add-ons */}
                            <div style={cardStyle}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: '1rem', borderBottom: '1px solid var(--border)', marginBottom: '1rem' }}>
                                    <div>
                                        <div style={{ fontFamily: 'Outfit, sans-serif', fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.95rem' }}>{selectedService?.name}{selectedOption ? ` — ${selectedOption.name}` : ''}</div>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>{effectiveDuration} min{providerInfo ? ` with ${providerInfo.name}` : ''}</div>
                                    </div>
                                    <span style={{ fontFamily: 'Outfit, sans-serif', fontWeight: '700', color: 'var(--charcoal)' }}>NAD {effectivePrice}</span>
                                </div>
                                {selectedAddOns.map((addOn, i) => (
                                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '0.75rem', borderBottom: i < selectedAddOns.length - 1 ? '1px solid var(--border)' : 'none', marginBottom: i < selectedAddOns.length - 1 ? '0.75rem' : 0 }}>
                                        <div>
                                            <div style={{ fontFamily: 'Outfit, sans-serif', fontWeight: '500', color: 'var(--charcoal)', fontSize: '0.9rem' }}>{addOn.name}</div>
                                            {addOn.duration > 0 && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>+{addOn.duration} min</div>}
                                        </div>
                                        <span style={{ fontFamily: 'Outfit, sans-serif', fontWeight: '600', color: 'var(--charcoal)' }}>NAD {addOn.price}</span>
                                    </div>
                                ))}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '1rem', borderTop: '1px solid var(--border)', marginTop: '0.5rem' }}>
                                    <span style={{ fontFamily: 'Outfit, sans-serif', fontWeight: '700', color: 'var(--charcoal)' }}>Total</span>
                                    <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: '700', color: 'var(--charcoal)' }}>NAD {totalPrice}</span>
                                </div>
                            </div>

                            {/* Cancellation policy */}
                            <div style={cardStyle}>
                                <div style={{ fontFamily: 'Outfit, sans-serif', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.4rem' }}>Cancellation policy</div>
                                <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', fontFamily: 'Outfit, sans-serif' }}>Cancel for free anytime.</div>
                            </div>

                            {/* Notes */}
                            <div style={cardStyle}>
                                <div style={{ fontFamily: 'Outfit, sans-serif', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.75rem' }}>Comments or requests</div>
                                <textarea
                                    name="notes"
                                    value={formData.notes}
                                    onChange={handleChange}
                                    rows="3"
                                    placeholder="Anything you'd like us to know?"
                                    className="input"
                                    style={{ resize: 'vertical', fontFamily: 'Outfit, sans-serif' }}
                                />
                            </div>
                        </div>

                        {/* Right - sticky confirm panel (desktop only) */}
                        <div className="booking-confirm-desktop" style={{ position: 'sticky', top: '100px' }}>
                            <div style={{ ...cardStyle, padding: '1.5rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.35rem' }}>
                                    <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: '700', color: 'var(--charcoal)' }}>NAD {totalPrice}</span>
                                </div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'Outfit, sans-serif', marginBottom: '1.25rem' }}>Estimated total</div>
                                <button
                                    data-testid="booking-confirm"
                                    onClick={handleConfirm}
                                    disabled={loading}
                                    style={{ width: '100%', padding: '0.875rem', background: 'var(--ink)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: '0.95rem', fontWeight: '600', fontFamily: 'Outfit, sans-serif', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.85 : 1, letterSpacing: '0.03em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem' }}
                                >
                                    {loading && <span style={{ display: 'inline-block', width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />}
                                    {loading ? 'Confirming...' : 'Confirm'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Mobile sticky bottom confirm bar */}
                <div className="booking-confirm-mobile" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'var(--card-bg)', borderTop: '1px solid var(--border)', padding: '1rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 200, boxShadow: '0 -4px 20px rgba(0,0,0,0.08)' }}>
                    <div>
                        <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: '700', color: 'var(--charcoal)' }}>NAD {totalPrice}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'Outfit, sans-serif' }}>Estimated total</div>
                    </div>
                    <button data-testid="booking-confirm-mobile" onClick={handleConfirm} disabled={loading} style={{ padding: '0.875rem 2rem', background: 'var(--ink)', color: 'white', border: 'none', borderRadius: '99px', fontSize: '0.95rem', fontWeight: '700', fontFamily: 'Outfit, sans-serif', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.85 : 1, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        {loading && <span style={{ display: 'inline-block', width: '15px', height: '15px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />}
                        {loading ? 'Confirming...' : 'Confirm'}
                    </button>
                </div>
            </div>
        );
    }

    // ─── BOOKING FORM â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    return (
        <div style={{ background: 'var(--off-white)', minHeight: '100vh' }}>
            {/* Header */}
            <div style={{ background: 'var(--ink)', paddingTop: '9rem', paddingBottom: '3rem', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(ellipse at 20% 50%, rgba(201,168,76,0.05) 0%, transparent 60%)', pointerEvents: 'none' }} />
                <div className="container" style={{ position: 'relative' }}>
                    <p style={{ color: 'var(--gold)', fontSize: '0.75rem', fontWeight: '600', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Schedule Your Visit</p>
                    <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2rem, 4vw, 3rem)', fontWeight: '600', color: 'white' }}>Book an Appointment</h1>
                </div>
            </div>

            <div className="container" style={{ paddingTop: '3rem', paddingBottom: '5rem' }}>
                {error && <div role="alert" style={{ background: 'var(--danger-bg)', border: '1px solid #fca5a5', color: 'var(--danger-fg)', padding: '0.875rem 1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>{error}</div>}

                {/* Progress stepper */}
                {(() => {
                    const steps = [
                        { n: 1, label: 'Service', done: !!selectedService },
                        { n: 2, label: 'Date & time', done: !!formData.startTime },
                        { n: 3, label: 'Confirm', done: false },
                    ];
                    const currentIdx = !selectedService ? 0 : !formData.startTime ? 1 : 2;
                    return (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.75rem', maxWidth: '560px' }}>
                            {steps.map((s, i) => {
                                const active = i === currentIdx;
                                const complete = s.done && i < currentIdx;
                                return (
                                    <React.Fragment key={s.n}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                                            <div style={{
                                                width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: '0.8rem', fontWeight: '700', flexShrink: 0, transition: 'all var(--dur) var(--ease-out)',
                                                background: complete ? 'var(--gold)' : active ? 'var(--ink)' : 'var(--surface-sunken)',
                                                color: complete ? 'var(--ink)' : active ? 'var(--on-ink)' : 'var(--text-muted)',
                                                border: active && !complete ? '2px solid var(--gold)' : '2px solid transparent',
                                            }}>{complete ? '✓' : s.n}</div>
                                            <span style={{ fontSize: '0.82rem', fontWeight: active ? '700' : '500', color: active ? 'var(--charcoal)' : 'var(--text-muted)', whiteSpace: 'nowrap' }} className="hidden-mobile">{s.label}</span>
                                        </div>
                                        {i < steps.length - 1 && <div style={{ flex: 1, height: '2px', background: i < currentIdx ? 'var(--gold)' : 'var(--border)', borderRadius: '2px', transition: 'background var(--dur) ease', minWidth: '16px' }} />}
                                    </React.Fragment>
                                );
                            })}
                        </div>
                    );
                })()}

                <div className="booking-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: '2rem', alignItems: 'start' }}>

                    {/* Left - steps */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                        {/* Step 1 - Service */}
                        <div style={cardStyle}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                                {stepBadge(1)}
                                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: '600', color: 'var(--charcoal)' }}>Choose a Service</h2>
                            </div>
                            {services.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--text-muted)' }}>
                                    <div style={{ marginBottom: '0.5rem', display: 'flex', justifyContent: 'center' }}><CalendarX2 size={34} strokeWidth={1.5} style={{ color: 'var(--text-muted)' }} /></div>
                                    <p style={{ fontSize: '0.9rem', margin: 0 }}>No services available to book right now.</p>
                                </div>
                            ) : (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem' }}>
                                    {services.map(service => {
                                        const sel = selectedService?._id === service._id;
                                        return (
                                            <button key={service._id} type="button" data-testid="booking-service" onClick={() => handleServiceSelect(service)} style={{
                                                position: 'relative', padding: '1rem', border: '2px solid', cursor: 'pointer', textAlign: 'left', minHeight: '76px',
                                                transition: 'transform var(--dur-fast) var(--ease-out), border-color var(--dur) ease, background var(--dur) ease, box-shadow var(--dur) ease',
                                                fontFamily: 'Outfit, sans-serif', borderRadius: 'var(--radius)',
                                                borderColor: sel ? 'var(--gold)' : 'var(--border)',
                                                background: sel ? 'rgba(201,168,76,0.08)' : 'var(--card-bg)',
                                                boxShadow: sel ? 'var(--shadow-sm)' : 'none',
                                            }}
                                                onMouseEnter={e => { if (!sel) { e.currentTarget.style.borderColor = 'rgba(201,168,76,0.5)'; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; } }}
                                                onMouseLeave={e => { if (!sel) { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; } }}
                                            >
                                                {sel && <span aria-hidden="true" style={{ position: 'absolute', top: '0.65rem', right: '0.65rem', width: '20px', height: '20px', borderRadius: '50%', background: 'var(--gold)', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: '800' }}>✓</span>}
                                                <div style={{ fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.92rem', marginBottom: '0.4rem', paddingRight: sel ? '1.5rem' : 0 }}>{service.name}</div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                                    <span className="price" style={{ color: 'var(--gold-dark)', fontWeight: '700' }}>NAD {service.price}</span>
                                                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{service.duration} min</span>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Add-ons */}
                        {selectedService?.addOns?.length > 0 && (
                            <div style={cardStyle}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                                    {stepBadge(2)}
                                    <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: '600', color: 'var(--charcoal)' }}>Add-ons <span style={{ fontSize: '0.8rem', fontWeight: '400', color: 'var(--text-muted)', fontFamily: 'Outfit, sans-serif' }}>(optional)</span></h2>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                    {selectedService.addOns.map((addOn, i) => {
                                        const checked = selectedAddOns.some(a => a.name === addOn.name);
                                        return (
                                            <label key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.85rem 1rem', border: `2px solid ${checked ? 'var(--gold)' : 'var(--border)'}`, borderRadius: 'var(--radius-sm)', cursor: 'pointer', background: checked ? 'rgba(201,168,76,0.08)' : 'var(--card-bg)', transition: 'border-color var(--dur) ease, background var(--dur) ease' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                    <input type="checkbox" checked={checked} onChange={() => toggleAddOn(addOn)} style={{ accentColor: 'var(--gold)', width: '16px', height: '16px' }} />
                                                    <span style={{ fontWeight: '500', color: 'var(--charcoal)', fontSize: '0.9rem', fontFamily: 'Outfit, sans-serif' }}>{addOn.name}</span>
                                                    {addOn.duration > 0 && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>+{addOn.duration} min</span>}
                                                </div>
                                                <span style={{ color: 'var(--gold-dark)', fontWeight: '700', fontFamily: 'Outfit, sans-serif' }}>+NAD {addOn.price}</span>
                                            </label>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Date & Time */}
                        <div style={cardStyle}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                                {stepBadge(selectedService?.addOns?.length > 0 ? 3 : 2)}
                                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: '600', color: 'var(--charcoal)' }}>Pick a Date & Time</h2>
                            </div>

                            {/* Horizontal date strip */}
                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={labelStyle}>Select a date</label>
                                <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.5rem', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                                    {dateStrip.map((d, i) => {
                                        const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                                        const isSelected = formData.appointmentDate === dateStr;
                                        return (
                                            <button
                                                key={i}
                                                type="button"
                                                data-testid="booking-date"
                                                onClick={() => handleDateSelect(dateStr)}
                                                style={{
                                                    flexShrink: 0,
                                                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                                                    padding: '0.6rem 0.75rem', borderRadius: '12px',
                                                    border: `2px solid ${isSelected ? 'var(--gold)' : 'var(--border)'}`,
                                                    background: isSelected ? 'var(--gold)' : 'white',
                                                    color: 'var(--charcoal)',
                                                    cursor: 'pointer', minWidth: '52px', transition: 'all 0.15s',
                                                    fontFamily: 'Outfit, sans-serif',
                                                }}
                                            >
                                                <span style={{ fontSize: '0.62rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.7 }}>
                                                    {d.toLocaleDateString('en-US', { weekday: 'short' })}
                                                </span>
                                                <span style={{ fontSize: '1.2rem', fontWeight: '700', lineHeight: 1.2 }}>{d.getDate()}</span>
                                                <span style={{ fontSize: '0.62rem', opacity: 0.7 }}>
                                                    {d.toLocaleDateString('en-US', { month: 'short' })}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Time slot pills */}
                            {formData.appointmentDate && (
                                <div>
                                    <label style={labelStyle}>Pick a time</label>
                                    {timeSlots.length === 0 ? (
                                        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', padding: '0.75rem 0', fontFamily: 'Outfit, sans-serif' }}>
                                            No available slots on this day.
                                        </p>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                            {timeSlots.map((slot, i) => {
                                                const isSelected = formData.startTime === slot.time;
                                                return (
                                                    <button
                                                        key={i}
                                                        type="button"
                                                        data-testid={slot.isBooked ? 'booking-time-booked' : 'booking-time'}
                                                        onClick={() => {
                                                            if (slot.isBooked) {
                                                                handleTimeSelect(slot.time);
                                                            } else {
                                                                handleTimeSelect(slot.time);
                                                            }
                                                        }}
                                                        style={{
                                                            width: '100%',
                                                            padding: '1rem 1.25rem',
                                                            borderRadius: '12px',
                                                            border: `2px solid ${slot.isBooked ? '#e5e7eb' : isSelected ? 'var(--gold)' : 'var(--border)'}`,
                                                            background: slot.isBooked ? '#f9fafb' : isSelected ? 'rgba(201,168,76,0.08)' : 'white',
                                                            color: slot.isBooked ? '#9ca3af' : isSelected ? 'var(--gold-dark)' : 'var(--charcoal)',
                                                            fontWeight: isSelected ? '600' : '400',
                                                            fontSize: '1rem',
                                                            cursor: 'pointer',
                                                            fontFamily: 'Outfit, sans-serif',
                                                            textAlign: 'left',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'space-between',
                                                            transition: 'all 0.15s',
                                                        }}
                                                    >
                                                        <span>{slot.time}</span>
                                                        {slot.isBooked && (
                                                            <span style={{ fontSize: '0.72rem', color: '#9ca3af', fontStyle: 'italic' }}>Taken — tap to join waitlist</span>
                                                        )}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}

                        {/* Show waitlist prompt if selected slot is taken */}
                        {selectedSlotBooked && (
                            <div style={{ marginTop: '1rem', background: '#fef3c7', border: '1px solid #fcd34d', color: '#92400e', padding: '0.875rem 1rem', borderRadius: 'var(--radius-sm)', fontSize: '0.875rem', fontFamily: 'Outfit, sans-serif' }}>
                                <strong>This slot is already taken.</strong> You can join the waiting list and we'll notify you if it opens up.
                            </div>
                        )}

                        {availabilityError && (
                                <div style={{ marginTop: '1rem', background: '#fef3c7', border: '1px solid #fcd34d', color: '#92400e', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem' }}>
                                    {availabilityError}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right - summary + proceed */}
                    <div className="booking-summary" style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '2rem', boxShadow: 'var(--shadow-sm)', position: 'sticky', top: '100px' }}>
                        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border)' }}>
                            Booking Summary
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
                            {[
                                { label: 'Service', value: selectedService?.name || '—' },
                                { label: 'Duration', value: selectedService ? `${totalDuration} min` : '—' },
                                { label: 'Date', value: formattedDate || '—' },
                                { label: 'Time', value: formData.startTime ? `${formData.startTime} - ${formData.endTime}` : '—' },
                            ].map(({ label, value }) => (
                                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                                    <span style={{ color: 'var(--text-secondary)', fontFamily: 'Outfit, sans-serif' }}>{label}</span>
                                    <span style={{ fontWeight: '600', color: 'var(--charcoal)', fontFamily: 'Outfit, sans-serif' }}>{value}</span>
                                </div>
                            ))}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 0', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', marginBottom: '1.5rem' }}>
                            <span style={{ fontWeight: '600', color: 'var(--charcoal)', fontFamily: 'Outfit, sans-serif' }}>Total</span>
                            <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: '700', color: 'var(--charcoal)' }}>
                                {selectedService ? `NAD ${totalPrice}` : '—'}
                            </span>
                        </div>
                        <button
                            data-testid="booking-continue"
                            onClick={() => { setError(''); setStep('review'); }}
                            disabled={!canReview}
                            className="btn-primary"
                            style={{ width: '100%', padding: '0.875rem', marginBottom: '0.75rem', opacity: canReview ? 1 : 0.5 }}
                        >
                            Review &amp; Confirm &rarr;
                        </button>
                        {selectedSlotBooked && formData.startTime && (
                            <button onClick={handleJoinWaitingList} disabled={loading} className="btn-outline" style={{ width: '100%', padding: '0.875rem', marginBottom: '0.75rem' }}>
                                Join Waiting List
                            </button>
                        )}
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'Outfit, sans-serif', textAlign: 'center', marginTop: '1rem', lineHeight: 1.5 }}>
                            Free cancellation up to 24 hours before your appointment.
                        </p>
                    </div>
                </div>
            </div>
            {/* Mobile sticky bottom bar — shown only on mobile via CSS */}
            {selectedService && (
                <div className="booking-mobile-bar">
                    <div>
                        <div style={{ fontWeight: '700', fontSize: '1.1rem', color: 'var(--charcoal)', fontFamily: 'Outfit, sans-serif' }}>NAD {totalPrice}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'Outfit, sans-serif' }}>1 item · {totalDuration} min</div>
                    </div>
                    {selectedSlotBooked && formData.startTime ? (
                        <button
                            onClick={handleJoinWaitingList}
                            disabled={loading}
                            style={{ background: 'var(--ink)', color: 'white', border: 'none', borderRadius: '99px', padding: '0.75rem 1.5rem', fontWeight: '600', cursor: 'pointer', fontSize: '0.9rem', fontFamily: 'Outfit, sans-serif', whiteSpace: 'nowrap' }}
                        >
                            Join Waitlist
                        </button>
                    ) : (
                        <button
                            data-testid="booking-continue-mobile"
                            onClick={() => { setError(''); setStep('review'); }}
                            disabled={!canReview}
                            style={{ background: 'var(--ink)', color: 'white', border: 'none', borderRadius: '99px', padding: '0.75rem 1.75rem', fontWeight: '600', cursor: canReview ? 'pointer' : 'not-allowed', opacity: canReview ? 1 : 0.5, fontSize: '0.95rem', fontFamily: 'Outfit, sans-serif', whiteSpace: 'nowrap' }}
                        >
                            Continue →
                        </button>
                    )}
                </div>
            )}
        {/* ── Service options bottom sheet (Fresha-style) ── */}
        {optionSheet && (
            <>
                <div onClick={() => setOptionSheet(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 900, backdropFilter: 'blur(2px)' }} />
                <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'var(--card-bg)', borderRadius: '20px 20px 0 0', zIndex: 901, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 -8px 40px rgba(0,0,0,0.2)' }}>
                    <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: '700', color: 'var(--charcoal)', margin: 0 }}>{optionSheet.name}</h2>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0.2rem 0 0' }}>Select an option · Required</p>
                        </div>
                        <button onClick={() => setOptionSheet(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.6rem', color: 'var(--text-muted)', lineHeight: 1, padding: 0 }}>×</button>
                    </div>
                    <div style={{ padding: '0.5rem 0' }}>
                        {optionSheet.options.map((opt, i) => (
                            <button
                                key={i}
                                type="button"
                                onClick={() => handleOptionConfirm(opt)}
                                style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '1.1rem 1.5rem', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', textAlign: 'left', gap: '1rem' }}
                            >
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: '600', color: 'var(--charcoal)', fontFamily: 'Outfit, sans-serif', fontSize: '0.95rem' }}>{opt.name}</div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>{opt.duration} min</div>
                                    {opt.description && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px', lineHeight: 1.5 }}>{opt.description}</div>}
                                    <div style={{ fontWeight: '700', color: 'var(--charcoal)', marginTop: '6px', fontFamily: 'Outfit, sans-serif' }}>NAD {opt.price}</div>
                                </div>
                                <div style={{ width: '22px', height: '22px', borderRadius: '50%', border: '2px solid var(--border)', flexShrink: 0, marginTop: '2px' }} />
                            </button>
                        ))}
                    </div>
                    <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>from </span>
                            <span style={{ fontWeight: '700', color: 'var(--charcoal)', fontFamily: 'Outfit, sans-serif' }}>NAD {Math.min(...optionSheet.options.map(o => o.price))}</span>
                            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: '0.4rem' }}>{Math.min(...optionSheet.options.map(o => o.duration))} – {Math.max(...optionSheet.options.map(o => o.duration))} min</span>
                        </div>
                        <button onClick={() => setOptionSheet(null)} style={{ padding: '0.65rem 1.5rem', background: 'var(--warm-gray)', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: '600', color: 'var(--text-secondary)', fontFamily: 'Outfit, sans-serif' }}>Add</button>
                    </div>
                </div>
            </>
        )}
        </div>
    );
};

export default BookAppointment;
