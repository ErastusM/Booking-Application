import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthContext } from '../context/AuthContext';
import StripeWrapper from '../components/StripeWrapper';
import PaymentForm from '../components/PaymentForm';
import { appointmentService, serviceService, waitingListService, paymentService, providerMarketService, availabilityService } from '../services';

const BookAppointment = () => {
    const { user } = useAuthContext();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [services, setServices] = useState([]);
    const [selectedService, setSelectedService] = useState(null);
    const [selectedAddOns, setSelectedAddOns] = useState([]);
    const [formData, setFormData] = useState({ service: '', appointmentDate: '', startTime: '', endTime: '', notes: '' });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [clientSecret, setClientSecret] = useState('');
    const [paymentAmount, setPaymentAmount] = useState(0);
    const [createdAppointmentId, setCreatedAppointmentId] = useState('');
    const [showPayment, setShowPayment] = useState(false);
    const [providerAvailability, setProviderAvailability] = useState(null);
    const [availabilityError, setAvailabilityError] = useState('');

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

    const totalPrice = selectedService
        ? selectedService.price + selectedAddOns.reduce((sum, a) => sum + a.price, 0)
        : 0;

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
                return `${day.charAt(0).toUpperCase() + day.slice(1, 3)}: ${slot?.start}–${slot?.end}`;
            }).join(', ');

        if (!daySchedule || !daySchedule.enabled) {
            setAvailabilityError(`This provider is not available at this time. Working hours are ${allWorkingHours || 'not set'}`);
            return;
        }
        const slot = daySchedule.slots[0];
        if (slot && (formData.startTime < slot.start || formData.startTime >= slot.end)) {
            setAvailabilityError(`This provider is not available at this time. Working hours are ${slot.start}–${slot.end}`);
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
            const totalMinutes = hours * 60 + minutes + selectedService.duration;
            const endHours = Math.floor(totalMinutes / 60) % 24;
            const endMins = totalMinutes % 60;
            setFormData(prev => ({ ...prev, startTime: value, endTime: `${String(endHours).padStart(2, '0')}:${String(endMins).padStart(2, '0')}` }));
        } else {
            setFormData(prev => ({ ...prev, [name]: value }));
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true); setError(''); setSuccess('');
        try {
            const apptRes = await appointmentService.createAppointment({ ...formData, selectedAddOns });
            const appointmentId = apptRes.data.data._id;
            setCreatedAppointmentId(appointmentId);
            const paymentRes = await paymentService.createPaymentIntent(formData.service);
            setClientSecret(paymentRes.data.clientSecret);
            setPaymentAmount(paymentRes.data.amount);
            setShowPayment(true);
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to book appointment');
        } finally {
            setLoading(false);
        }
    };

    const handlePaymentSuccess = () => {
        setShowPayment(false);
        setSuccess('Payment successful! Your appointment is confirmed.');
        setTimeout(() => navigate('/appointments'), 2000);
    };

    const handlePaymentCancel = () => {
        setShowPayment(false);
        setError('Payment cancelled. Your appointment slot has been held for 10 minutes.');
    };

    const handleJoinWaitingList = async () => {
        if (!formData.service || !formData.appointmentDate || !formData.startTime) {
            setError('Please fill in service, date and start time first');
            return;
        }
        setError(''); setSuccess('');
        try {
            await waitingListService.join({ service: formData.service, appointmentDate: formData.appointmentDate, startTime: formData.startTime, endTime: formData.endTime });
            setSuccess("You've been added to the waiting list!");
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to join waiting list');
        }
    };

    const today = new Date().toISOString().split('T')[0];
    const labelStyle = { display: 'block', fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.5rem', letterSpacing: '0.05em', textTransform: 'uppercase' };
    const stepBadge = (num) => (
        <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--gold)', color: 'var(--charcoal)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: '700', flexShrink: 0 }}>{num}</div>
    );
    const cardStyle = { background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '2rem', boxShadow: 'var(--shadow-sm)' };

    return (
        <div style={{ background: 'var(--off-white)', minHeight: '100vh' }}>

            {/* Header */}
            <div style={{ background: 'var(--charcoal)', paddingTop: '9rem', paddingBottom: '3rem', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(ellipse at 20% 50%, rgba(201,168,76,0.1) 0%, transparent 60%)', pointerEvents: 'none' }} />
                <div className="container" style={{ position: 'relative' }}>
                    <p style={{ color: 'var(--gold)', fontSize: '0.75rem', fontWeight: '600', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Schedule Your Visit</p>
                    <h1 style={{ fontFamily: 'Inter, sans-serif', fontSize: 'clamp(2rem, 4vw, 3rem)', fontWeight: '700', color: 'white' }}>Book an Appointment</h1>
                </div>
            </div>

            <div className="container" style={{ paddingTop: '3rem', paddingBottom: '5rem' }}>

                {error && <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b', padding: '0.875rem 1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>{error}</div>}
                {success && <div style={{ background: '#d1fae5', border: '1px solid #6ee7b7', color: '#065f46', padding: '0.875rem 1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>{success}</div>}

                <div className="booking-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '2rem', alignItems: 'start' }}>

                    {/* Left — steps */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                        {/* Step 1 */}
                        <div style={cardStyle}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                                {stepBadge(1)}
                                <h2 style={{ fontFamily: 'Inter, sans-serif', fontSize: '1.2rem', fontWeight: '600', color: 'var(--charcoal)' }}>Choose a Service</h2>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem' }}>
                                {services.map(service => (
                                    <button key={service._id} type="button" onClick={() => handleServiceSelect(service)} style={{
                                        padding: '1rem', border: '2px solid', cursor: 'pointer', textAlign: 'left',
                                        transition: 'all 0.2s ease', fontFamily: 'Inter, sans-serif', borderRadius: 'var(--radius-sm)',
                                        borderColor: selectedService?._id === service._id ? 'var(--gold)' : 'var(--border)',
                                        background: selectedService?._id === service._id ? 'rgba(201,168,76,0.06)' : 'white',
                                    }}>
                                        <div style={{ fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.9rem', marginBottom: '0.35rem' }}>{service.name}</div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span style={{ color: 'var(--gold)', fontWeight: '700' }}>${service.price}</span>
                                            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{service.duration} min</span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Add-ons (shown when service has add-ons) */}
                        {selectedService?.addOns?.length > 0 && (
                            <div style={cardStyle}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                                    {stepBadge(2)}
                                    <h2 style={{ fontFamily: 'Inter, sans-serif', fontSize: '1.2rem', fontWeight: '600', color: 'var(--charcoal)' }}>Add-ons <span style={{ fontSize: '0.8rem', fontWeight: '400', color: 'var(--text-muted)' }}>(optional)</span></h2>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                    {selectedService.addOns.map((addOn, i) => {
                                        const checked = selectedAddOns.some(a => a.name === addOn.name);
                                        return (
                                            <label key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', border: `2px solid ${checked ? 'var(--gold)' : 'var(--border)'}`, borderRadius: 'var(--radius-sm)', cursor: 'pointer', background: checked ? 'rgba(201,168,76,0.06)' : 'white', transition: 'all 0.15s' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                    <input type="checkbox" checked={checked} onChange={() => toggleAddOn(addOn)} style={{ accentColor: 'var(--gold)', width: '16px', height: '16px' }} />
                                                    <span style={{ fontWeight: '500', color: 'var(--charcoal)', fontSize: '0.9rem' }}>{addOn.name}</span>
                                                    {addOn.duration > 0 && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>+{addOn.duration} min</span>}
                                                </div>
                                                <span style={{ color: 'var(--gold-dark)', fontWeight: '700' }}>+${addOn.price}</span>
                                            </label>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Step 2 or 3 depending on add-ons */}
                        <div style={cardStyle}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                                {stepBadge(2)}
                                <h2 style={{ fontFamily: 'Inter, sans-serif', fontSize: '1.2rem', fontWeight: '600', color: 'var(--charcoal)' }}>Pick a Date & Time</h2>
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

                        {/* Step 3 */}
                        <div style={cardStyle}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                                {stepBadge(3)}
                                <h2 style={{ fontFamily: 'Inter, sans-serif', fontSize: '1.2rem', fontWeight: '600', color: 'var(--charcoal)' }}>
                                    Special Requests <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '0.8rem', fontWeight: '400', color: 'var(--text-muted)' }}>(optional)</span>
                                </h2>
                            </div>
                            <textarea name="notes" value={formData.notes} onChange={handleChange} rows="3" placeholder="Any special requests or preferences..." className="input" style={{ resize: 'vertical' }} />
                        </div>
                    </div>

                    {/* Right — summary */}
                    <div className="booking-summary" style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '2rem', boxShadow: 'var(--shadow-sm)', position: 'sticky', top: '100px' }}>
                        <h3 style={{ fontFamily: 'Inter, sans-serif', fontSize: '1.2rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border)' }}>
                            Booking Summary
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
                            {[
                                { label: 'Service', value: selectedService?.name || '—' },
                                { label: 'Duration', value: selectedService ? `${selectedService.duration} min` : '—' },
                                { label: 'Date', value: formData.appointmentDate ? new Date(formData.appointmentDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '—' },
                                { label: 'Time', value: formData.startTime ? `${formData.startTime} – ${formData.endTime}` : '—' },
                            ].map(({ label, value }) => (
                                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
                                    <span style={{ fontWeight: '600', color: 'var(--charcoal)' }}>{value}</span>
                                </div>
                            ))}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 0', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', marginBottom: '1.5rem' }}>
                            <span style={{ fontWeight: '600', color: 'var(--charcoal)' }}>Total</span>
                            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '1.5rem', fontWeight: '700', color: 'var(--gold-dark)' }}>
                            {selectedService ? `$${totalPrice}` : '—'}
                            </span>
                        </div>
                        <button onClick={handleSubmit} disabled={loading || !formData.service || !formData.appointmentDate || !formData.startTime || !!availabilityError} className="btn-primary" style={{ width: '100%', padding: '0.875rem', marginBottom: '0.75rem' }}>
                            {loading ? 'Booking...' : 'Confirm Booking →'}
                        </button>
                        <button onClick={handleJoinWaitingList} disabled={loading} className="btn-outline" style={{ width: '100%', padding: '0.875rem' }}>
                            Join Waiting List Instead
                        </button>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '1rem', lineHeight: 1.5 }}>
                            Free cancellation up to 24 hours before your appointment.
                        </p>
                    </div>
                </div>
            </div>

            {showPayment && clientSecret && (
                <StripeWrapper clientSecret={clientSecret}>
                    <PaymentForm
                        appointmentId={createdAppointmentId}
                        amount={paymentAmount}
                        serviceName={selectedService?.name}
                        onSuccess={handlePaymentSuccess}
                        onCancel={handlePaymentCancel}
                    />
                </StripeWrapper>
            )}
        </div>
    );
};

export default BookAppointment;