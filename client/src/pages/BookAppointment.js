import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { appointmentService, serviceService, waitingListService } from '../services';
import { useAuthContext } from '../context/AuthContext';

const BookAppointment = () => {
    const { user } = useAuthContext();
    const navigate = useNavigate();
    const [services, setServices] = useState([]);
    const [selectedService, setSelectedService] = useState(null);
    const [formData, setFormData] = useState({
        service: '',
        appointmentDate: '',
        startTime: '',
        endTime: '',
        notes: '',
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    useEffect(() => {
        if (!user) navigate('/login');
        const fetchServices = async () => {
            try {
                const response = await serviceService.getAllServices();
                setServices(response.data.data);
            } catch {
                setError('Failed to fetch services');
            }
        };
        fetchServices();
    }, [user, navigate]);

    const handleServiceSelect = (service) => {
        setSelectedService(service);
        setFormData(prev => ({ ...prev, service: service._id }));
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));

        // Auto-calculate end time based on service duration
        if (name === 'startTime' && selectedService) {
            const [hours, minutes] = value.split(':').map(Number);
            const totalMinutes = hours * 60 + minutes + selectedService.duration;
            const endHours = Math.floor(totalMinutes / 60) % 24;
            const endMins = totalMinutes % 60;
            const endTime = `${String(endHours).padStart(2, '0')}:${String(endMins).padStart(2, '0')}`;
            setFormData(prev => ({ ...prev, startTime: value, endTime }));
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        setSuccess('');
        try {
            await appointmentService.createAppointment(formData);
            setSuccess('Appointment booked successfully!');
            setTimeout(() => navigate('/appointments'), 2000);
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to book appointment');
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
        setSuccess('');
        try {
            await waitingListService.join({
                service: formData.service,
                appointmentDate: formData.appointmentDate,
                startTime: formData.startTime,
                endTime: formData.endTime,
            });
            setSuccess("You've been added to the waiting list! We'll notify you when a slot opens.");
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to join waiting list');
        }
    };

    const today = new Date().toISOString().split('T')[0];

    return (
        <div style={{ background: 'var(--off-white)', minHeight: '100vh' }}>

            {/* Page header */}
            <div style={{
                background: 'var(--charcoal)',
                paddingTop: '9rem',
                paddingBottom: '3rem',
                position: 'relative',
                overflow: 'hidden',
            }}>
                <div style={{
                    position: 'absolute',
                    inset: 0,
                    backgroundImage: 'radial-gradient(ellipse at 20% 50%, rgba(201,168,76,0.1) 0%, transparent 60%)',
                    pointerEvents: 'none',
                }} />
                <div className="container" style={{ position: 'relative' }}>
                    <p style={{
                        color: 'var(--gold)',
                        fontSize: '0.75rem',
                        fontWeight: '600',
                        letterSpacing: '0.15em',
                        textTransform: 'uppercase',
                        marginBottom: '0.75rem',
                    }}>
                        Schedule Your Visit
                    </p>
                    <h1 style={{
                        fontFamily: 'Playfair Display, serif',
                        fontSize: 'clamp(2rem, 4vw, 3rem)',
                        fontWeight: '700',
                        color: 'white',
                    }}>
                        Book an Appointment
                    </h1>
                </div>
            </div>

            <div className="container" style={{ paddingTop: '3rem', paddingBottom: '5rem' }}>

                {error && (
                    <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b', padding: '0.875rem 1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
                        {error}
                    </div>
                )}
                {success && (
                    <div style={{ background: '#d1fae5', border: '1px solid #6ee7b7', color: '#065f46', padding: '0.875rem 1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
                        {success}
                    </div>
                )}

                <div className="booking-grid" style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 380px',
                    gap: '2rem',
                    alignItems: 'start',
                }}>

                    {/* Left — form */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                        {/* Alerts */}
                        {error && (
                            <div style={{
                                background: '#fee2e2',
                                border: '1px solid #fca5a5',
                                color: '#991b1b',
                                padding: '0.875rem 1rem',
                                borderRadius: 'var(--radius-sm)',
                                fontSize: '0.875rem',
                            }}>
                                {error}
                            </div>
                        )}
                        {success && (
                            <div style={{
                                background: '#d1fae5',
                                border: '1px solid #6ee7b7',
                                color: '#065f46',
                                padding: '0.875rem 1rem',
                                borderRadius: 'var(--radius-sm)',
                                fontSize: '0.875rem',
                            }}>
                                {success}
                            </div>
                        )}

                        {/* Step 1 — Service selection */}
                        <div style={{
                            background: 'white',
                            borderRadius: 'var(--radius)',
                            border: '1px solid var(--border)',
                            padding: '2rem',
                            boxShadow: 'var(--shadow-sm)',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                                <div style={{
                                    width: '28px',
                                    height: '28px',
                                    borderRadius: '50%',
                                    background: 'var(--gold)',
                                    color: 'var(--charcoal)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '0.8rem',
                                    fontWeight: '700',
                                    flexShrink: 0,
                                }}>1</div>
                                <h2 style={{
                                    fontFamily: 'Playfair Display, serif',
                                    fontSize: '1.2rem',
                                    fontWeight: '600',
                                    color: 'var(--charcoal)',
                                }}>
                                    Choose a Service
                                </h2>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
                                {services.map(service => (
                                    <button
                                        key={service._id}
                                        type="button"
                                        onClick={() => handleServiceSelect(service)}
                                        style={{
                                            padding: '1rem',
                                            border: '2px solid',
                                            borderColor: selectedService?._id === service._id ? 'var(--gold)' : 'var(--border)',
                                            borderRadius: 'var(--radius-sm)',
                                            background: selectedService?._id === service._id ? 'rgba(201,168,76,0.06)' : 'white',
                                            cursor: 'pointer',
                                            textAlign: 'left',
                                            transition: 'all 0.2s ease',
                                            fontFamily: 'DM Sans, sans-serif',
                                        }}
                                    >
                                        <div style={{
                                            fontWeight: '600',
                                            color: 'var(--charcoal)',
                                            fontSize: '0.9rem',
                                            marginBottom: '0.35rem',
                                        }}>
                                            {service.name}
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span style={{ color: 'var(--gold)', fontWeight: '700', fontSize: '1rem' }}>
                                                ${service.price}
                                            </span>
                                            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                                                {service.duration} min
                                            </span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Step 2 — Date & Time */}
                        <div style={{
                            background: 'white',
                            borderRadius: 'var(--radius)',
                            border: '1px solid var(--border)',
                            padding: '2rem',
                            boxShadow: 'var(--shadow-sm)',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                                <div style={{
                                    width: '28px',
                                    height: '28px',
                                    borderRadius: '50%',
                                    background: 'var(--gold)',
                                    color: 'var(--charcoal)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '0.8rem',
                                    fontWeight: '700',
                                    flexShrink: 0,
                                }}>2</div>
                                <h2 style={{
                                    fontFamily: 'Playfair Display, serif',
                                    fontSize: '1.2rem',
                                    fontWeight: '600',
                                    color: 'var(--charcoal)',
                                }}>
                                    Pick a Date & Time
                                </h2>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <label style={{
                                        display: 'block',
                                        fontSize: '0.8rem',
                                        fontWeight: '600',
                                        color: 'var(--text-secondary)',
                                        marginBottom: '0.5rem',
                                        letterSpacing: '0.05em',
                                        textTransform: 'uppercase',
                                    }}>
                                        Date
                                    </label>
                                    <input
                                        type="date"
                                        name="appointmentDate"
                                        value={formData.appointmentDate}
                                        onChange={handleChange}
                                        min={today}
                                        required
                                        className="input"
                                    />
                                </div>
                                <div>
                                    <label style={{
                                        display: 'block',
                                        fontSize: '0.8rem',
                                        fontWeight: '600',
                                        color: 'var(--text-secondary)',
                                        marginBottom: '0.5rem',
                                        letterSpacing: '0.05em',
                                        textTransform: 'uppercase',
                                    }}>
                                        Start Time
                                    </label>
                                    <input
                                        type="time"
                                        name="startTime"
                                        value={formData.startTime}
                                        onChange={handleChange}
                                        required
                                        className="input"
                                    />
                                </div>
                                <div>
                                    <label style={{
                                        display: 'block',
                                        fontSize: '0.8rem',
                                        fontWeight: '600',
                                        color: 'var(--text-secondary)',
                                        marginBottom: '0.5rem',
                                        letterSpacing: '0.05em',
                                        textTransform: 'uppercase',
                                    }}>
                                        End Time
                                    </label>
                                    <input
                                        type="time"
                                        name="endTime"
                                        value={formData.endTime}
                                        onChange={handleChange}
                                        required
                                        className="input"
                                        style={{ background: 'var(--warm-gray)' }}
                                        readOnly={!!selectedService}
                                    />
                                    {selectedService && (
                                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                            Auto-calculated from service duration
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Step 3 — Notes */}
                        <div style={{
                            background: 'white',
                            borderRadius: 'var(--radius)',
                            border: '1px solid var(--border)',
                            padding: '2rem',
                            boxShadow: 'var(--shadow-sm)',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                                <div style={{
                                    width: '28px',
                                    height: '28px',
                                    borderRadius: '50%',
                                    background: 'var(--gold)',
                                    color: 'var(--charcoal)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '0.8rem',
                                    fontWeight: '700',
                                    flexShrink: 0,
                                }}>3</div>
                                <h2 style={{
                                    fontFamily: 'Playfair Display, serif',
                                    fontSize: '1.2rem',
                                    fontWeight: '600',
                                    color: 'var(--charcoal)',
                                }}>
                                    Special Requests
                                    <span style={{ fontFamily: 'DM Sans', fontSize: '0.8rem', fontWeight: '400', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                                        (optional)
                                    </span>
                                </h2>
                            </div>
                            <textarea
                                name="notes"
                                value={formData.notes}
                                onChange={handleChange}
                                rows="3"
                                placeholder="Any special requests or preferences for your barber..."
                                className="input"
                                style={{ resize: 'vertical' }}
                            />
                        </div>
                    </div>

                    {/* Right — summary */}
                    <div className="booking-summary" style={{
                        background: 'white',
                        borderRadius: 'var(--radius)',
                        border: '1px solid var(--border)',
                        padding: '2rem',
                        boxShadow: 'var(--shadow-sm)',
                        position: 'sticky',
                        top: '100px',
                    }}>
                        <h3 style={{
                            fontFamily: 'Playfair Display, serif',
                            fontSize: '1.2rem',
                            fontWeight: '600',
                            color: 'var(--charcoal)',
                            marginBottom: '1.5rem',
                            paddingBottom: '1rem',
                            borderBottom: '1px solid var(--border)',
                        }}>
                            Booking Summary
                        </h3>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                                <span style={{ color: 'var(--text-secondary)' }}>Service</span>
                                <span style={{ fontWeight: '600', color: 'var(--charcoal)' }}>
                                    {selectedService?.name || '—'}
                                </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                                <span style={{ color: 'var(--text-secondary)' }}>Duration</span>
                                <span style={{ fontWeight: '600', color: 'var(--charcoal)' }}>
                                    {selectedService ? `${selectedService.duration} min` : '—'}
                                </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                                <span style={{ color: 'var(--text-secondary)' }}>Date</span>
                                <span style={{ fontWeight: '600', color: 'var(--charcoal)' }}>
                                    {formData.appointmentDate
                                        ? new Date(formData.appointmentDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                                        : '—'}
                                </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                                <span style={{ color: 'var(--text-secondary)' }}>Time</span>
                                <span style={{ fontWeight: '600', color: 'var(--charcoal)' }}>
                                    {formData.startTime ? `${formData.startTime} – ${formData.endTime}` : '—'}
                                </span>
                            </div>
                        </div>

                        {/* Total */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '1rem 0',
                            borderTop: '1px solid var(--border)',
                            borderBottom: '1px solid var(--border)',
                            marginBottom: '1.5rem',
                        }}>
                            <span style={{ fontWeight: '600', color: 'var(--charcoal)' }}>Total</span>
                            <span style={{
                                fontFamily: 'Playfair Display, serif',
                                fontSize: '1.5rem',
                                fontWeight: '700',
                                color: 'var(--gold-dark)',
                            }}>
                                {selectedService ? `$${selectedService.price}` : '—'}
                            </span>
                        </div>

                        <button
                            onClick={handleSubmit}
                            disabled={loading || !formData.service || !formData.appointmentDate || !formData.startTime}
                            className="btn-primary"
                            style={{ width: '100%', padding: '0.875rem', marginBottom: '0.75rem' }}
                        >
                            {loading ? 'Booking...' : 'Confirm Booking →'}
                        </button>

                        <button
                            onClick={handleJoinWaitingList}
                            disabled={loading}
                            className="btn-outline"
                            style={{ width: '100%', padding: '0.875rem' }}
                        >
                            Join Waiting List Instead
                        </button>

                        <p style={{
                            fontSize: '0.75rem',
                            color: 'var(--text-muted)',
                            textAlign: 'center',
                            marginTop: '1rem',
                            lineHeight: 1.5,
                        }}>
                            Free cancellation up to 24 hours before your appointment.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BookAppointment;