import React, { useEffect, useState } from 'react';
import { appointmentService, availabilityService, earningsService, providerServiceService, categoryService } from '../services';

const statusConfig = {
    pending: { label: 'Pending', bg: '#fef3c7', color: '#92400e' },
    confirmed: { label: 'Confirmed', bg: '#dbeafe', color: '#1e40af' },
    completed: { label: 'Completed', bg: '#d1fae5', color: '#065f46' },
    cancelled: { label: 'Cancelled', bg: '#fee2e2', color: '#991b1b' },
};

const ProviderDashboard = () => {
    const [appointments, setAppointments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [activeTab, setActiveTab] = useState('pending');
    const [availability, setAvailability] = useState(null);
    const [savingAvailability, setSavingAvailability] = useState(false);
    const [availabilitySuccess, setAvailabilitySuccess] = useState('');
    const [earnings, setEarnings] = useState(null);
    const [loadingEarnings, setLoadingEarnings] = useState(false);
    const [myServices, setMyServices] = useState([]);
    const [showServiceForm, setShowServiceForm] = useState(false);
    const [editingService, setEditingService] = useState(null);
    const [savingService, setSavingService] = useState(false);
    const [serviceForm, setServiceForm] = useState({ name: '', description: '', price: '', duration: '', location: '', address: '', category: '' });
    const [categories, setCategories] = useState([]);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [showCategoryForm, setShowCategoryForm] = useState(false);

    useEffect(() => {
        fetchAppointments();
        fetchAvailability();
        fetchMyServices();
        fetchCategories();
    }, []);

    useEffect(() => {
        if (activeTab === 'earnings' && !earnings) {
            fetchEarnings();
        }
    }, [activeTab]);

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

    const fetchAvailability = async () => {
        try {
            const res = await availabilityService.getMyAvailability();
            setAvailability(res.data.data.schedule);
        } catch { }
    };

    const fetchEarnings = async () => {
        setLoadingEarnings(true);
        try {
            const res = await earningsService.getMyEarnings();
            setEarnings(res.data.data);
        } catch {
            setError('Failed to load earnings');
        } finally {
            setLoadingEarnings(false);
        }
    };

    const fetchMyServices = async () => {
        try {
            const res = await providerServiceService.getMyServices();
            setMyServices(res.data.data);
        } catch { }
    };

    const fetchCategories = async () => {
        try {
            const res = await categoryService.getMyCategories();
            setCategories(res.data.data);
        } catch { }
    };

    const handleSaveAvailability = async () => {
        setSavingAvailability(true);
        setAvailabilitySuccess('');
        try {
            await availabilityService.updateMyAvailability(availability);
            setAvailabilitySuccess('Availability saved successfully!');
            setTimeout(() => setAvailabilitySuccess(''), 3000);
        } catch {
            setError('Failed to save availability');
        } finally {
            setSavingAvailability(false);
        }
    };

    const handleDayToggle = (day) => {
        setAvailability(prev => ({ ...prev, [day]: { ...prev[day], enabled: !prev[day].enabled } }));
    };

    const handleTimeChange = (day, field, value) => {
        setAvailability(prev => ({ ...prev, [day]: { ...prev[day], slots: [{ ...prev[day].slots[0], [field]: value }] } }));
    };

    const handleStatusUpdate = async (id, status) => {
        try {
            await appointmentService.updateAppointmentStatus(id, status);
            setAppointments(appointments.map(a => a._id === id ? { ...a, status } : a));
        } catch {
            setError('Failed to update appointment');
        }
    };

    const handleServiceSubmit = async (e) => {
        e.preventDefault();
        setSavingService(true);
        try {
            if (editingService) {
                await providerServiceService.updateMyService(editingService._id, serviceForm);
            } else {
                await providerServiceService.createMyService(serviceForm);
            }
            await fetchMyServices();
            setShowServiceForm(false);
            setEditingService(null);
            setServiceForm({ name: '', description: '', price: '', duration: '', location: '', address: '', category: '' });
        } catch {
            setError('Failed to save service');
        } finally {
            setSavingService(false);
        }
    };

    const handleEditService = (s) => {
        setEditingService(s);
        setServiceForm({ name: s.name, description: s.description, price: s.price, duration: s.duration, location: s.location || '', address: s.address || '', category: s.category?._id || s.category || '' });
        setShowServiceForm(true);
    };

    const handleDeleteService = async (id) => {
        if (window.confirm('Delete this service?')) {
            try {
                await providerServiceService.deleteMyService(id);
                setMyServices(myServices.filter(s => s._id !== id));
            } catch {
                setError('Failed to delete service');
            }
        }
    };

    const handleAddCategory = async (e) => {
        e.preventDefault();
        if (!newCategoryName.trim()) return;
        try {
            await categoryService.createCategory(newCategoryName);
            await fetchCategories();
            setNewCategoryName('');
            setShowCategoryForm(false);
        } catch {
            setError('Failed to add category');
        }
    };

    const handleDeleteCategory = async (id) => {
        if (window.confirm('Delete this category? Services will become uncategorized.')) {
            try {
                await categoryService.deleteCategory(id);
                await fetchCategories();
            } catch {
                setError('Failed to delete category');
            }
        }
    };

    const appointmentTabs = ['pending', 'confirmed', 'completed', 'cancelled'];
    const filtered = appointments.filter(a => a.status === activeTab);
    const counts = appointmentTabs.reduce((acc, t) => {
        acc[t] = appointments.filter(a => a.status === t).length;
        return acc;
    }, {});

    const stats = [
        { label: 'Total', value: appointments.length, icon: '📋' },
        { label: 'Pending', value: counts.pending, icon: '⏳' },
        { label: 'Confirmed', value: counts.confirmed, icon: '✅' },
        { label: 'Completed', value: counts.completed, icon: '🏆' },
    ];

    const labelStyle = { display: 'block', fontSize: '0.78rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.4rem', letterSpacing: '0.05em', textTransform: 'uppercase' };

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
                            <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: 'rgba(201,168,76,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', flexShrink: 0 }}>{s.icon}</div>
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
                    {appointmentTabs.map(tab => (
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
                    <div style={{ marginLeft: 'auto', display: 'flex' }}>
                        {['services', 'availability', 'earnings'].map(tab => (
                            <button key={tab} onClick={() => setActiveTab(tab)} style={{
                                padding: '0.75rem 1.5rem', background: 'none', border: 'none',
                                borderBottom: activeTab === tab ? '2px solid var(--gold)' : '2px solid transparent',
                                color: activeTab === tab ? 'var(--gold-dark)' : 'var(--text-muted)',
                                fontWeight: activeTab === tab ? '600' : '400', fontSize: '0.875rem',
                                cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
                                transition: 'all 0.2s', marginBottom: '-1px', whiteSpace: 'nowrap',
                            }}>
                                {tab === 'availability' ? '🗓 Availability' : tab === 'services' ? '✂️ My Services' : '💵 Earnings'}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Appointment tabs */}
                {appointmentTabs.includes(activeTab) && (
                    <>
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
                    </>
                )}

                {/* My Services tab */}
                {activeTab === 'services' && (
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                            <div>
                                <h2 style={{ fontFamily: 'Playfair Display, serif', fontSize: '1.3rem', fontWeight: '600', color: 'var(--charcoal)' }}>My Services</h2>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Manage the services you offer to customers</p>
                            </div>
                            <button onClick={() => { setShowServiceForm(!showServiceForm); setEditingService(null); setServiceForm({ name: '', description: '', price: '', duration: '', location: '', address: '', category: '' }); }} className="btn-primary" style={{ padding: '0.65rem 1.25rem', fontSize: '0.875rem' }}>
                                {showServiceForm ? '✕ Cancel' : '+ Add Service'}
                            </button>
                        </div>

                        {showServiceForm && (
                            <form onSubmit={handleServiceSubmit} style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem', marginBottom: '1.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <label style={labelStyle}>Service Name</label>
                                    <input required value={serviceForm.name} onChange={e => setServiceForm({ ...serviceForm, name: e.target.value })} className="input" placeholder="e.g. Classic Haircut" />
                                </div>
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <label style={labelStyle}>Description</label>
                                    <textarea required value={serviceForm.description} onChange={e => setServiceForm({ ...serviceForm, description: e.target.value })} rows="2" className="input" style={{ resize: 'vertical' }} placeholder="Describe what's included..." />
                                </div>
                                <div>
                                    <label style={labelStyle}>Price ($)</label>
                                    <input required type="number" value={serviceForm.price} onChange={e => setServiceForm({ ...serviceForm, price: e.target.value })} className="input" placeholder="25" />
                                </div>
                                <div>
                                    <label style={labelStyle}>Duration (min)</label>
                                    <input required type="number" value={serviceForm.duration} onChange={e => setServiceForm({ ...serviceForm, duration: e.target.value })} className="input" placeholder="30" />
                                </div>
                                <div>
                                    <label style={labelStyle}>City / Area</label>
                                    <input value={serviceForm.location} onChange={e => setServiceForm({ ...serviceForm, location: e.target.value })} className="input" placeholder="e.g. Windhoek" />
                                </div>
                                <div>
                                    <label style={labelStyle}>Street Address</label>
                                    <input value={serviceForm.address} onChange={e => setServiceForm({ ...serviceForm, address: e.target.value })} className="input" placeholder="e.g. 123 Independence Ave" />
                                </div>
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <label style={labelStyle}>Category</label>
                                    <select value={serviceForm.category || ''} onChange={e => setServiceForm({ ...serviceForm, category: e.target.value })} className="input">
                                        <option value="">✦ Featured (uncategorized)</option>
                                        {categories.map(cat => (
                                            <option key={cat._id} value={cat._id}>{cat.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '0.75rem' }}>
                                    <button type="submit" disabled={savingService} className="btn-primary" style={{ padding: '0.65rem 1.5rem', fontSize: '0.875rem' }}>
                                        {savingService ? 'Saving...' : editingService ? 'Update Service' : 'Add Service'}
                                    </button>
                                </div>
                            </form>
                        )}

                        {myServices.length === 0 ? (
                            <div style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '4rem 2rem', textAlign: 'center' }}>
                                <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>✂️</div>
                                <p style={{ fontFamily: 'Playfair Display, serif', fontSize: '1.1rem', color: 'var(--charcoal)', marginBottom: '0.35rem' }}>No services yet</p>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Add your first service to start receiving bookings</p>
                            </div>
                        ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
                                {myServices.map(s => (
                                    <div key={s._id} style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                                        <div style={{ height: '4px', background: 'linear-gradient(to right, var(--gold-dark), var(--gold-light))' }} />
                                        <div style={{ padding: '1.5rem' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                                                <h3 style={{ fontFamily: 'Playfair Display, serif', fontSize: '1.1rem', fontWeight: '600', color: 'var(--charcoal)' }}>{s.name}</h3>
                                                <span style={{ background: 'var(--warm-gray)', color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: '600', padding: '0.2rem 0.6rem', borderRadius: '99px', whiteSpace: 'nowrap', marginLeft: '0.5rem' }}>{s.duration} min</span>
                                            </div>
                                            {s.category && (
                                                <span style={{ display: 'inline-block', background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.2)', color: 'var(--gold-dark)', fontSize: '0.72rem', fontWeight: '600', padding: '0.15rem 0.6rem', borderRadius: '99px', marginBottom: '0.5rem' }}>
                                                    {categories.find(c => c._id === (s.category?._id || s.category))?.name || 'Featured'}
                                                </span>
                                            )}
                                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.6, marginBottom: '1rem' }}>{s.description}</p>
                                            {s.location && (
                                                <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '0.25rem' }}>
                                                    📍 {s.location}{s.address ? ` · ${s.address}` : ''}
                                                </p>
                                            )}
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
                                                <span style={{ fontFamily: 'Playfair Display, serif', fontSize: '1.4rem', fontWeight: '700', color: 'var(--charcoal)' }}>${s.price}</span>
                                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                    <button onClick={() => handleEditService(s)} style={{ background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.3)', color: 'var(--gold-dark)', padding: '0.35rem 0.875rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600', fontFamily: 'DM Sans, sans-serif' }}>Edit</button>
                                                    <button onClick={() => handleDeleteService(s._id)} style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#ef4444', padding: '0.35rem 0.875rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600', fontFamily: 'DM Sans, sans-serif' }}>Delete</button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Categories management */}
                        <div style={{ marginTop: '2rem', paddingTop: '2rem', borderTop: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                <h3 style={{ fontFamily: 'Playfair Display, serif', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)' }}>My Categories</h3>
                                <button onClick={() => setShowCategoryForm(!showCategoryForm)} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)', padding: '0.35rem 0.875rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.8rem', fontFamily: 'DM Sans, sans-serif' }}>
                                    {showCategoryForm ? 'Cancel' : '+ Add Category'}
                                </button>
                            </div>

                            {showCategoryForm && (
                                <form onSubmit={handleAddCategory} style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
                                    <input value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} placeholder="e.g. Hair Services" className="input" style={{ flex: 1 }} />
                                    <button type="submit" className="btn-primary" style={{ padding: '0.65rem 1.25rem', fontSize: '0.875rem', whiteSpace: 'nowrap' }}>Add</button>
                                </form>
                            )}

                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                <div style={{ padding: '0.35rem 0.875rem', borderRadius: '99px', background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.3)', fontSize: '0.8rem', fontWeight: '600', color: 'var(--gold-dark)' }}>
                                    ✦ Featured
                                </div>
                                {categories.map(cat => (
                                    <div key={cat._id} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.35rem 0.875rem', borderRadius: '99px', background: 'var(--warm-gray)', border: '1px solid var(--border)', fontSize: '0.8rem', fontWeight: '500', color: 'var(--text-secondary)' }}>
                                        {cat.name}
                                        <button onClick={() => handleDeleteCategory(cat._id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1, padding: 0 }}>×</button>
                                    </div>
                                ))}
                                {categories.length === 0 && !showCategoryForm && (
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', alignSelf: 'center' }}>No categories yet — services appear under Featured by default</p>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Availability tab */}
                {activeTab === 'availability' && (
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                            <div>
                                <h2 style={{ fontFamily: 'Playfair Display, serif', fontSize: '1.3rem', fontWeight: '600', color: 'var(--charcoal)' }}>Working Hours</h2>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Set the days and hours you are available for bookings</p>
                            </div>
                            <button onClick={handleSaveAvailability} disabled={savingAvailability} className="btn-primary" style={{ padding: '0.65rem 1.5rem', fontSize: '0.875rem' }}>
                                {savingAvailability ? 'Saving...' : 'Save Changes'}
                            </button>
                        </div>

                        {availabilitySuccess && (
                            <div style={{ background: '#d1fae5', border: '1px solid #6ee7b7', color: '#065f46', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
                                {availabilitySuccess}
                            </div>
                        )}

                        {availability && (
                            <div style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                                {Object.entries(availability).map(([day, config], i) => (
                                    <div key={day} style={{ display: 'grid', gridTemplateColumns: '140px 80px 1fr', alignItems: 'center', gap: '1.5rem', padding: '1rem 1.5rem', borderBottom: i < 6 ? '1px solid var(--border)' : 'none', background: config.enabled ? 'white' : 'var(--warm-gray)', transition: 'background 0.2s' }}>
                                        <span style={{ fontWeight: '600', color: config.enabled ? 'var(--charcoal)' : 'var(--text-muted)', fontSize: '0.9rem', textTransform: 'capitalize' }}>{day}</span>
                                        <div>
                                            <button onClick={() => handleDayToggle(day)} style={{ width: '44px', height: '24px', borderRadius: '99px', border: 'none', background: config.enabled ? 'var(--gold)' : '#d1d5db', cursor: 'pointer', position: 'relative', transition: 'background 0.2s' }}>
                                                <div style={{ width: '18px', height: '18px', borderRadius: '50%', background: 'white', position: 'absolute', top: '3px', left: config.enabled ? '23px' : '3px', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                                            </button>
                                        </div>
                                        {config.enabled ? (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                <input type="time" value={config.slots[0]?.start || '09:00'} onChange={e => handleTimeChange(day, 'start', e.target.value)} className="input" style={{ maxWidth: '140px', padding: '0.4rem 0.75rem', fontSize: '0.875rem' }} />
                                                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', flexShrink: 0 }}>to</span>
                                                <input type="time" value={config.slots[0]?.end || '17:00'} onChange={e => handleTimeChange(day, 'end', e.target.value)} className="input" style={{ maxWidth: '140px', padding: '0.4rem 0.75rem', fontSize: '0.875rem' }} />
                                            </div>
                                        ) : (
                                            <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem', fontStyle: 'italic' }}>Not available</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Earnings tab */}
                {activeTab === 'earnings' && (
                    <div>
                        <div style={{ marginBottom: '1.5rem' }}>
                            <h2 style={{ fontFamily: 'Playfair Display, serif', fontSize: '1.3rem', fontWeight: '600', color: 'var(--charcoal)' }}>Earnings Overview</h2>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Track your income from completed appointments</p>
                        </div>

                        {loadingEarnings ? (
                            <div style={{ textAlign: 'center', padding: '4rem' }}>
                                <div style={{ width: '40px', height: '40px', border: '3px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
                            </div>
                        ) : earnings ? (
                            <>
                                <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                                    {[
                                        { label: 'Total Earned', value: `$${earnings.totalEarned.toLocaleString()}`, icon: '💰', sub: 'All time' },
                                        { label: 'This Month', value: `$${earnings.thisMonthEarned.toLocaleString()}`, icon: '📅', sub: `Last month: $${earnings.lastMonthEarned}` },
                                        { label: 'Completed Jobs', value: earnings.completedCount, icon: '✅', sub: 'Total completed' },
                                        { label: 'Growth', value: `${earnings.growth >= 0 ? '+' : ''}${earnings.growth}%`, icon: '📈', sub: 'vs last month' },
                                    ].map((s, i) => (
                                        <div key={i} style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                            <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: 'rgba(201,168,76,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', flexShrink: 0 }}>{s.icon}</div>
                                            <div>
                                                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{s.label}</p>
                                                <p style={{ fontFamily: 'Playfair Display, serif', fontSize: '1.5rem', fontWeight: '700', color: 'var(--charcoal)', lineHeight: 1 }}>{s.value}</p>
                                                {s.sub && <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{s.sub}</p>}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
                                    <div style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem' }}>
                                        <h3 style={{ fontFamily: 'Playfair Display, serif', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '1.25rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border)' }}>Earnings by Service</h3>
                                        {earnings.earningsByService.length === 0 ? (
                                            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No completed paid appointments yet</p>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                                                {earnings.earningsByService.map((s, i) => {
                                                    const max = earnings.earningsByService[0]?.total || 1;
                                                    return (
                                                        <div key={i}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                                                                <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', fontWeight: '500' }}>{s.name}</span>
                                                                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                                                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{s.count} job{s.count !== 1 ? 's' : ''}</span>
                                                                    <span style={{ fontSize: '0.875rem', fontWeight: '700', color: 'var(--charcoal)' }}>${s.total}</span>
                                                                </div>
                                                            </div>
                                                            <div style={{ height: '6px', borderRadius: '99px', background: 'var(--warm-gray)', overflow: 'hidden' }}>
                                                                <div style={{ height: '100%', borderRadius: '99px', background: 'var(--gold)', width: `${(s.total / max) * 100}%`, transition: 'width 0.5s ease' }} />
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>

                                    <div style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem' }}>
                                        <h3 style={{ fontFamily: 'Playfair Display, serif', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '1.25rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border)' }}>Monthly Comparison</h3>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                                            {[
                                                { label: 'This Month', value: earnings.thisMonthEarned, color: 'var(--gold)' },
                                                { label: 'Last Month', value: earnings.lastMonthEarned, color: 'var(--charcoal)' },
                                            ].map((item, i) => {
                                                const max = Math.max(earnings.thisMonthEarned, earnings.lastMonthEarned, 1);
                                                return (
                                                    <div key={i}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                                            <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', fontWeight: '500' }}>{item.label}</span>
                                                            <span style={{ fontSize: '1rem', fontWeight: '700', color: 'var(--charcoal)' }}>${item.value}</span>
                                                        </div>
                                                        <div style={{ height: '10px', borderRadius: '99px', background: 'var(--warm-gray)', overflow: 'hidden' }}>
                                                            <div style={{ height: '100%', borderRadius: '99px', background: item.color, width: `${(item.value / max) * 100}%`, transition: 'width 0.5s ease' }} />
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                            <div style={{ paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
                                                <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                                                    {earnings.growth >= 0 ? '📈' : '📉'} {Math.abs(earnings.growth)}% {earnings.growth >= 0 ? 'increase' : 'decrease'} from last month
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                                    <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)' }}>
                                        <h3 style={{ fontFamily: 'Playfair Display, serif', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)' }}>Recent Transactions</h3>
                                    </div>
                                    {earnings.recentTransactions.length === 0 ? (
                                        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}><p>No transactions yet</p></div>
                                    ) : (
                                        <div className="table-scroll">
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                                                <thead>
                                                    <tr style={{ background: 'var(--warm-gray)', borderBottom: '1px solid var(--border)' }}>
                                                        {['Customer', 'Service', 'Date', 'Amount', 'Status'].map(h => (
                                                            <th key={h} style={{ padding: '0.875rem 1rem', textAlign: 'left', fontSize: '0.7rem', fontWeight: '600', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{h}</th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {earnings.recentTransactions.map((t, i) => (
                                                        <tr key={t._id} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'white' : 'rgba(250,250,248,0.5)' }}>
                                                            <td style={{ padding: '0.875rem 1rem', fontWeight: '600', color: 'var(--charcoal)' }}>{t.customerName}</td>
                                                            <td style={{ padding: '0.875rem 1rem', color: 'var(--text-secondary)' }}>{t.serviceName}</td>
                                                            <td style={{ padding: '0.875rem 1rem', color: 'var(--text-secondary)' }}>{new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                                                            <td style={{ padding: '0.875rem 1rem', fontWeight: '700', color: 'var(--charcoal)' }}>${t.amount}</td>
                                                            <td style={{ padding: '0.875rem 1rem' }}>
                                                                <span style={{ padding: '0.2rem 0.65rem', borderRadius: '99px', fontSize: '0.72rem', fontWeight: '600', background: t.paymentStatus === 'paid' ? '#d1fae5' : '#fef3c7', color: t.paymentStatus === 'paid' ? '#065f46' : '#92400e' }}>
                                                                    {t.paymentStatus === 'paid' ? 'Paid' : 'Pending'}
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : (
                            <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
                                <p>Failed to load earnings data</p>
                            </div>
                        )}
                    </div>
                )}

            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
};

export default ProviderDashboard;