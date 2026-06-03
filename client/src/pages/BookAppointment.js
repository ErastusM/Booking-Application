import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthContext } from '../context/AuthContext';
import { appointmentService, serviceService, waitingListService, providerMarketService, availabilityService } from '../services';

const BookAppointment = () => {
    const { user } = useAuthContext();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    // â”€â”€ data â”€â”€
    const [services, setServices] = useState([]);
    const [providerInfo, setProviderInfo] = useState(null);

    // â”€â”€ selections â”€â”€
    const [selectedService, setSelectedService] = useState(null);
    const [selectedAddOns, setSelectedAddOns] = useState([]);
    const [formData, setFormData] = useState({ service: '', appointmentDate: '', startTime: '', endTime: '', notes: '' });

    // â”€â”€ ui state â”€â”€
    const [step, setStep] = useState('form'); // 'form' | 'review'
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [providerAvailability, setProviderAvailability] = useState(null);
    const [availabilityError, setAvailabilityError] = useState('');

    const totalPrice = selectedService
        ? selectedService.price + selectedAddOns.reduce((sum, a) => sum + a.price, 0)
        : 0;

    const totalDuration = selectedService
        ? selectedService.duration + selectedAddOns.reduce((sum, a) => sum + (a.duration || 0), 0)
        : 0;

    const handleServiceSelect = (service) => {
        setSelectedService(service);
        setSelectedAddOns([]);
        setFormData(prev => ({ ...prev, service: service._id }));
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
                const slot = v.slots[0];
                return `${day.charAt(0).toUpperCase() + day.slice(1, 3)}: ${slot?.start}â€“${slot?.end}`;
            }).join(', ');
        if (!daySchedule || !daySchedule.enabled) {
            setAvailabilityError(`This provider is not available at this time. Working hours are ${allWorkingHours || 'not set'}`);
            return;
        }
        const slot = daySchedule.slots[0];
        if (slot && (formData.startTime < slot.start || formData.startTime >= slot.end)) {
            setAvailabilityError(`This provider is not available at this time. Working hours are ${slot.start}â€“${slot.end}`);
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
        if (name === 'startTime' && selectedService) {
            const [hours, minutes] = value.split(':').map(Number);
            const totalMins = hours * 60 + minutes + totalDuration;
            const endH = Math.floor(totalMins / 60) % 24;
            const endM = totalMins % 60;
            setFormData(prev => ({ ...prev, startTime: value, endTime: `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}` }));
        } else {
            setFormData(prev => ({ ...prev, [name]: value }));
        }
    };

    const canReview = formData.service && formData.appointmentDate && formData.startTime && !availabilityError;

    const handleConfirm = async () => {
        setLoading(true);
        setError('');
        try {
            await appointmentService.createAppointment({ ...formData, selectedAddOns });
            navigate('/appointments?confirmed=1');
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
            await waitingListService.join({ service: formData.service, appointmentDate: formData.appointmentDate, startTime: formData.startTime, endTime: formData.endTime });
            navigate('/appointments?waitlisted=1');
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to join waiting list');
        }
    };

    const today = new Date().toISOString().split('T')[0];
    const labelStyle = { display: 'block', fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.5rem', letterSpacing: '0.05em', textTransform: 'uppercase' };
    const cardStyle = { background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '2rem', boxShadow: 'var(--shadow-sm)' };
    const stepBadge = (num) => (
        <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--gold)', color: 'var(--charcoal)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: '700', flexShrink: 0 }}>{num}</div>
    );

    const formattedDate = formData.appointmentDate
        ? new Date(formData.appointmentDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })
        : '';

    // â”€â”€â”€ REVIEW SCREEN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (step === 'review') {
        return (
            <div style={{ background: 'var(--off-white)', minHeight: '100vh' }}>
                {/* Header */}
                <div style={{ background: 'var(--charcoal)', paddingTop: '9rem', paddingBottom: '3rem', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(ellipse at 20% 50%, rgba(201,168,76,0.1) 0%, transparent 60%)', pointerEvents: 'none' }} />
                    <div className="container" style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <button onClick={() => setStep('form')} style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 'var(--radius-sm)', padding: '0.5rem 1rem', color: 'white', cursor: 'pointer', fontSize: '0.85rem', fontFamily: 'Outfit, sans-serif' }}>â† Back</button>
                        <div>
                            <p style={{ color: 'var(--gold)', fontSize: '0.75rem', fontWeight: '600', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Almost there</p>
                            <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 'clamp(1.8rem, 4vw, 2.5rem)', fontWeight: '600', color: 'white' }}>Review & Confirm</h1>
                        </div>
                    </div>
                </div>

                <div className="container" style={{ paddingTop: '3rem', paddingBottom: '5rem' }}>
                    {error && <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b', padding: '0.875rem 1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>{error}</div>}

                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 340px', gap: '2rem', alignItems: 'start' }}>

                        {/* Left â€” booking details card */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                            {/* Provider + date/time block */}
                            <div style={cardStyle}>
                                {providerInfo && (
                                    <>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', paddingBottom: '1.25rem', borderBottom: '1px solid var(--border)', marginBottom: '1.25rem' }}>
                                            <div style={{ width: '56px', height: '56px', borderRadius: '50%', overflow: 'hidden', background: 'var(--warm-gray)', flexShrink: 0 }}>
                                                {providerInfo.avatar
                                                    ? <img src={providerInfo.avatar} alt={providerInfo.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                    : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Cormorant Garamond, serif', fontSize: '1.4rem', color: 'var(--gold)', fontWeight: '600' }}>{providerInfo.name?.charAt(0)}</div>
                                                }
                                            </div>
                                            <div>
                                                <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1.1rem', fontWeight: '600', color: 'var(--charcoal)' }}>{providerInfo.name}</div>
                                                {providerInfo.providerCategory && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>{providerInfo.providerCategory}</div>}
                                            </div>
                                        </div>
                                    </>
                                )}

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                        <span style={{ fontSize: '1rem' }}>ðŸ“…</span>
                                        <span style={{ fontFamily: 'Outfit, sans-serif', color: 'var(--charcoal)', fontWeight: '500' }}>{formattedDate}</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                        <span style={{ fontSize: '1rem' }}>ðŸ•</span>
                                        <span style={{ fontFamily: 'Outfit, sans-serif', color: 'var(--charcoal)', fontWeight: '500' }}>
                                            {formData.startTime}â€“{formData.endTime}
                                            <span style={{ color: 'var(--text-muted)', fontWeight: '400' }}> ({totalDuration} min)</span>
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Services + add-ons */}
                            <div style={cardStyle}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: '1rem', borderBottom: '1px solid var(--border)', marginBottom: '1rem' }}>
                                    <div>
                                        <div style={{ fontFamily: 'Outfit, sans-serif', fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.95rem' }}>{selectedService?.name}</div>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>{selectedService?.duration} min{providerInfo ? ` with ${providerInfo.name}` : ''}</div>
                                    </div>
                                    <span style={{ fontFamily: 'Outfit, sans-serif', fontWeight: '700', color: 'var(--charcoal)' }}>NAD {selectedService?.price}</span>
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
                                    <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1.3rem', fontWeight: '700', color: 'var(--charcoal)' }}>NAD {totalPrice}</span>
                                </div>
                            </div>

                            {/* Cancellation policy */}
                            <div style={cardStyle}>
                                <div style={{ fontFamily: 'Outfit, sans-serif', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.4rem' }}>Cancellation policy</div>
                                <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', fontFamily: 'Outfit, sans-serif' }}>Cancel for free up to 24 hours before your appointment.</div>
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

                        {/* Right â€” sticky confirm panel */}
                        <div style={{ position: 'sticky', top: '100px' }}>
                            <div style={{ ...cardStyle, padding: '1.5rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.35rem' }}>
                                    <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1.6rem', fontWeight: '700', color: 'var(--charcoal)' }}>NAD {totalPrice}</span>
                                </div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'Outfit, sans-serif', marginBottom: '1.25rem' }}>To pay in-store</div>
                                <button
                                    onClick={handleConfirm}
                                    disabled={loading}
                                    style={{ width: '100%', padding: '0.875rem', background: 'var(--charcoal)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: '0.95rem', fontWeight: '600', fontFamily: 'Outfit, sans-serif', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1, letterSpacing: '0.03em' }}
                                >
                                    {loading ? 'Confirming...' : 'Confirm'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // â”€â”€â”€ BOOKING FORM â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    return (
        <div style={{ background: 'var(--off-white)', minHeight: '100vh' }}>
            {/* Header */}
            <div style={{ background: 'var(--charcoal)', paddingTop: '9rem', paddingBottom: '3rem', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(ellipse at 20% 50%, rgba(201,168,76,0.1) 0%, transparent 60%)', pointerEvents: 'none' }} />
                <div className="container" style={{ position: 'relative' }}>
                    <p style={{ color: 'var(--gold)', fontSize: '0.75rem', fontWeight: '600', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Schedule Your Visit</p>
                    <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 'clamp(2rem, 4vw, 3rem)', fontWeight: '600', color: 'white' }}>Book an Appointment</h1>
                </div>
            </div>

            <div className="container" style={{ paddingTop: '3rem', paddingBottom: '5rem' }}>
                {error && <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b', padding: '0.875rem 1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>{error}</div>}

                <div className="booking-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '2rem', alignItems: 'start' }}>

                    {/* Left â€” steps */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                        {/* Step 1 â€” Service */}
                        <div style={cardStyle}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                                {stepBadge(1)}
                                <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1.25rem', fontWeight: '600', color: 'var(--charcoal)' }}>Choose a Service</h2>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem' }}>
                                {services.map(service => (
                                    <button key={service._id} type="button" onClick={() => handleServiceSelect(service)} style={{
                                        padding: '1rem', border: '2px solid', cursor: 'pointer', textAlign: 'left',
                                        transition: 'all 0.2s ease', fontFamily: 'Outfit, sans-serif', borderRadius: 'var(--radius-sm)',
                                        borderColor: selectedService?._id === service._id ? 'var(--gold)' : 'var(--border)',
                                        background: selectedService?._id === service._id ? 'rgba(201,168,76,0.06)' : 'white',
                                    }}>
                                        <div style={{ fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.9rem', marginBottom: '0.35rem' }}>{service.name}</div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span style={{ color: 'var(--gold-dark)', fontWeight: '700' }}>NAD {service.price}</span>
                                            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{service.duration} min</span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Add-ons */}
                        {selectedService?.addOns?.length > 0 && (
                            <div style={cardStyle}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                                    {stepBadge(2)}
                                    <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1.25rem', fontWeight: '600', color: 'var(--charcoal)' }}>Add-ons <span style={{ fontSize: '0.8rem', fontWeight: '400', color: 'var(--text-muted)', fontFamily: 'Outfit, sans-serif' }}>(optional)</span></h2>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                    {selectedService.addOns.map((addOn, i) => {
                                        const checked = selectedAddOns.some(a => a.name === addOn.name);
                                        return (
                                            <label key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', border: `2px solid ${checked ? 'var(--gold)' : 'var(--border)'}`, borderRadius: 'var(--radius-sm)', cursor: 'pointer', background: checked ? 'rgba(201,168,76,0.06)' : 'white', transition: 'all 0.15s' }}>
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
                                <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1.25rem', fontWeight: '600', color: 'var(--charcoal)' }}>Pick a Date & Time</h2>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <label style={labelStyle}>Date</label>
                                    <input type="date" name="appointmentDate" value={formData.appointmentDate} onChange={handleChange} min={today} required className="input" />
                                </div>
                                <div>
                                    <label style={labelStyle}>Start Time</label>
                                    <input type="time" name="startTime" value={formData.startTime} onChange={handleChange} required className="input" />
                                </div>
                                <div>
                                    <label style={labelStyle}>End Time</label>
                                    <input type="time" name="endTime" value={formData.endTime} onChange={handleChange} required className="input" style={{ background: selectedService ? 'var(--warm-gray)' : 'white' }} readOnly={!!selectedService} />
                                    {selectedService && <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>Auto-calculated from duration</p>}
                                </div>
                                {availabilityError && (
                                    <div style={{ gridColumn: '1 / -1', background: '#fef3c7', border: '1px solid #fcd34d', color: '#92400e', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem' }}>
                                        {availabilityError}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Right â€” summary + proceed */}
                    <div className="booking-summary" style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '2rem', boxShadow: 'var(--shadow-sm)', position: 'sticky', top: '100px' }}>
                        <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1.25rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border)' }}>
                            Booking Summary
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
                            {[
                                { label: 'Service', value: selectedService?.name || 'â€”' },
                                { label: 'Duration', value: selectedService ? `${totalDuration} min` : 'â€”' },
                                { label: 'Date', value: formattedDate || 'â€”' },
                                { label: 'Time', value: formData.startTime ? `${formData.startTime} â€“ ${formData.endTime}` : 'â€”' },
                            ].map(({ label, value }) => (
                                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                                    <span style={{ color: 'var(--text-secondary)', fontFamily: 'Outfit, sans-serif' }}>{label}</span>
                                    <span style={{ fontWeight: '600', color: 'var(--charcoal)', fontFamily: 'Outfit, sans-serif' }}>{value}</span>
                                </div>
                            ))}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 0', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', marginBottom: '1.5rem' }}>
                            <span style={{ fontWeight: '600', color: 'var(--charcoal)', fontFamily: 'Outfit, sans-serif' }}>Total</span>
                            <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1.5rem', fontWeight: '700', color: 'var(--charcoal)' }}>
                                {selectedService ? `NAD ${totalPrice}` : 'â€”'}
                            </span>
                        </div>
                        <button
                            onClick={() => { setError(''); setStep('review'); }}
                            disabled={!canReview}
                            className="btn-primary"
                            style={{ width: '100%', padding: '0.875rem', marginBottom: '0.75rem', opacity: canReview ? 1 : 0.5 }}
                        >
                            Review & Confirm â†’
                        </button>
                        <button onClick={handleJoinWaitingList} disabled={loading} className="btn-outline" style={{ width: '100%', padding: '0.875rem' }}>
                            Join Waiting List Instead
                        </button>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'Outfit, sans-serif', textAlign: 'center', marginTop: '1rem', lineHeight: 1.5 }}>
                            Free cancellation up to 24 hours before your appointment.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BookAppointment;
