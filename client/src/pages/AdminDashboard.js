import React, { useEffect, useState } from 'react';
import { appointmentService, serviceService, userService } from '../services';

const statusConfig = {
    pending:   { label: 'Pending',   bg: '#fef3c7', color: '#92400e' },
    confirmed: { label: 'Confirmed', bg: '#dbeafe', color: '#1e40af' },
    completed: { label: 'Completed', bg: '#d1fae5', color: '#065f46' },
    cancelled: { label: 'Cancelled', bg: '#fee2e2', color: '#991b1b' },
};

const AdminDashboard = () => {
    const [activeTab, setActiveTab] = useState('appointments');
    const [appointments, setAppointments] = useState([]);
    const [services, setServices] = useState([]);
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showServiceForm, setShowServiceForm] = useState(false);
    const [editingService, setEditingService] = useState(null);
    const [serviceForm, setServiceForm] = useState({ name: '', description: '', price: '', duration: '' });

    useEffect(() => { fetchAll(); }, []);

    const fetchAll = async () => {
        setLoading(true);
        try {
            const [apptRes, svcRes, userRes] = await Promise.all([
                appointmentService.getAllAppointments(),
                serviceService.getAllServices(),
                userService.getAllUsers(),
            ]);
            setAppointments(apptRes.data.data);
            setServices(svcRes.data.data);
            setUsers(userRes.data.data);
        } catch {
            setError('Failed to load dashboard data');
        } finally {
            setLoading(false);
        }
    };

    const handleUpdateStatus = async (id, status) => {
        try {
            await appointmentService.updateAppointmentStatus(id, status);
            setAppointments(appointments.map(a => a._id === id ? { ...a, status } : a));
        } catch {
            setError('Failed to update status');
        }
    };

    const handleServiceSubmit = async (e) => {
        e.preventDefault();
        try {
            if (editingService) {
                await serviceService.updateService(editingService._id, serviceForm);
            } else {
                await serviceService.createService(serviceForm);
            }
            await fetchAll();
            setShowServiceForm(false);
            setEditingService(null);
            setServiceForm({ name: '', description: '', price: '', duration: '' });
        } catch {
            setError('Failed to save service');
        }
    };

    const handleEditService = (s) => {
        setEditingService(s);
        setServiceForm({ name: s.name, description: s.description, price: s.price, duration: s.duration });
        setShowServiceForm(true);
    };

    const handleDeleteService = async (id) => {
        if (window.confirm('Delete this service?')) {
            try {
                await serviceService.deleteService(id);
                setServices(services.filter(s => s._id !== id));
            } catch {
                setError('Failed to delete service');
            }
        }
    };

    const handleDeleteUser = async (id) => {
        if (window.confirm('Delete this user?')) {
            try {
                await userService.deleteUser(id);
                setUsers(users.filter(u => u._id !== id));
            } catch {
                setError('Failed to delete user');
            }
        }
    };

    const handleRoleChange = async (id, role) => {
        try {
            await userService.updateUserRole(id, role);
            setUsers(users.map(u => u._id === id ? { ...u, role } : u));
        } catch {
            setError('Failed to update role');
        }
    };

    const tabs = ['appointments', 'services', 'users'];
    const stats = [
        { label: 'Total Appointments', value: appointments.length, icon: '📅' },
        { label: 'Total Services', value: services.length, icon: '✂️' },
        { label: 'Total Users', value: users.length, icon: '👥' },
        { label: 'Pending', value: appointments.filter(a => a.status === 'pending').length, icon: '⏳' },
    ];

    const inputStyle = {
        width: '100%',
        padding: '0.65rem 0.875rem',
        border: '1.5px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        fontFamily: 'DM Sans, sans-serif',
        fontSize: '0.875rem',
        color: 'var(--text-primary)',
        outline: 'none',
    };

    const labelStyle = {
        display: 'block',
        fontSize: '0.75rem',
        fontWeight: '600',
        color: 'var(--text-secondary)',
        marginBottom: '0.4rem',
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
    };

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
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Loading dashboard...</p>
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
                    backgroundImage: 'radial-gradient(ellipse at 80% 30%, rgba(201,168,76,0.1) 0%, transparent 60%)',
                    pointerEvents: 'none',
                }} />
                <div className="container" style={{ position: 'relative' }}>
                    <p style={{
                        color: 'var(--gold)', fontSize: '0.75rem', fontWeight: '600',
                        letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '0.75rem',
                    }}>Management</p>
                    <h1 style={{
                        fontFamily: 'Playfair Display, serif',
                        fontSize: 'clamp(2rem, 4vw, 3rem)',
                        fontWeight: '700', color: 'white',
                    }}>
                        Admin Dashboard
                    </h1>
                </div>
            </div>

            <div className="container" style={{ paddingTop: '2.5rem', paddingBottom: '5rem' }}>

                {/* Stats */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: '1rem',
                    marginBottom: '2rem',
                }}>
                    {stats.map((s, i) => (
                        <div key={i} style={{
                            background: 'white',
                            borderRadius: 'var(--radius)',
                            border: '1px solid var(--border)',
                            boxShadow: 'var(--shadow-sm)',
                            padding: '1.25rem 1.5rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '1rem',
                        }}>
                            <div style={{
                                width: '44px', height: '44px',
                                borderRadius: '10px',
                                background: 'rgba(201,168,76,0.1)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '1.2rem', flexShrink: 0,
                            }}>
                                {s.icon}
                            </div>
                            <div>
                                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{s.label}</p>
                                <p style={{
                                    fontFamily: 'Playfair Display, serif',
                                    fontSize: '1.6rem', fontWeight: '700',
                                    color: 'var(--charcoal)', lineHeight: 1,
                                }}>{s.value}</p>
                            </div>
                        </div>
                    ))}
                </div>

                {error && (
                    <div style={{
                        background: '#fee2e2', border: '1px solid #fca5a5',
                        color: '#991b1b', padding: '0.75rem 1rem',
                        borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.875rem',
                    }}>
                        {error}
                    </div>
                )}

                {/* Tabs */}
                <div style={{
                    display: 'flex', gap: '0',
                    borderBottom: '1px solid var(--border)',
                    marginBottom: '1.5rem',
                }}>
                    {tabs.map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            style={{
                                padding: '0.75rem 1.5rem',
                                background: 'none', border: 'none',
                                borderBottom: activeTab === tab ? '2px solid var(--gold)' : '2px solid transparent',
                                color: activeTab === tab ? 'var(--gold-dark)' : 'var(--text-muted)',
                                fontWeight: activeTab === tab ? '600' : '400',
                                fontSize: '0.875rem',
                                cursor: 'pointer',
                                fontFamily: 'DM Sans, sans-serif',
                                textTransform: 'capitalize',
                                transition: 'all 0.2s',
                                marginBottom: '-1px',
                            }}
                        >
                            {tab.charAt(0).toUpperCase() + tab.slice(1)}
                        </button>
                    ))}
                </div>

                {/* Appointments tab */}
                {activeTab === 'appointments' && (
                    <div style={{
                        background: 'white',
                        borderRadius: 'var(--radius)',
                        border: '1px solid var(--border)',
                        boxShadow: 'var(--shadow-sm)',
                        overflow: 'hidden',
                    }}>
                        {appointments.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
                                No appointments yet
                            </div>
                        ) : (
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                                <thead>
                                    <tr style={{ background: 'var(--warm-gray)', borderBottom: '1px solid var(--border)' }}>
                                        {['Customer', 'Service', 'Date', 'Time', 'Price', 'Status', 'Action'].map(h => (
                                            <th key={h} style={{
                                                padding: '0.875rem 1rem',
                                                textAlign: 'left',
                                                fontSize: '0.7rem',
                                                fontWeight: '600',
                                                color: 'var(--text-muted)',
                                                letterSpacing: '0.08em',
                                                textTransform: 'uppercase',
                                            }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {appointments.map((a, i) => {
                                        const s = statusConfig[a.status] || statusConfig.pending;
                                        return (
                                            <tr key={a._id} style={{
                                                borderBottom: '1px solid var(--border)',
                                                background: i % 2 === 0 ? 'white' : 'rgba(250,250,248,0.5)',
                                            }}>
                                                <td style={{ padding: '0.875rem 1rem' }}>
                                                    <p style={{ fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.875rem' }}>{a.customer?.name}</p>
                                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{a.customer?.email}</p>
                                                </td>
                                                <td style={{ padding: '0.875rem 1rem', color: 'var(--text-secondary)' }}>{a.service?.name}</td>
                                                <td style={{ padding: '0.875rem 1rem', color: 'var(--text-secondary)' }}>
                                                    {new Date(a.appointmentDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                                </td>
                                                <td style={{ padding: '0.875rem 1rem', color: 'var(--text-secondary)' }}>{a.startTime} – {a.endTime}</td>
                                                <td style={{ padding: '0.875rem 1rem', fontWeight: '600', color: 'var(--charcoal)' }}>${a.totalPrice}</td>
                                                <td style={{ padding: '0.875rem 1rem' }}>
                                                    <span style={{
                                                        padding: '0.2rem 0.65rem',
                                                        borderRadius: '99px',
                                                        fontSize: '0.72rem',
                                                        fontWeight: '600',
                                                        background: s.bg,
                                                        color: s.color,
                                                    }}>{s.label}</span>
                                                </td>
                                                <td style={{ padding: '0.875rem 1rem' }}>
                                                    <select
                                                        value={a.status}
                                                        onChange={e => handleUpdateStatus(a._id, e.target.value)}
                                                        style={{
                                                            fontSize: '0.75rem',
                                                            border: '1px solid var(--border)',
                                                            borderRadius: 'var(--radius-sm)',
                                                            padding: '0.35rem 0.5rem',
                                                            fontFamily: 'DM Sans, sans-serif',
                                                            color: 'var(--text-secondary)',
                                                            cursor: 'pointer',
                                                            outline: 'none',
                                                        }}
                                                    >
                                                        <option value="pending">Pending</option>
                                                        <option value="confirmed">Confirmed</option>
                                                        <option value="completed">Completed</option>
                                                        <option value="cancelled">Cancelled</option>
                                                    </select>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}

                {/* Services tab */}
                {activeTab === 'services' && (
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
                            <button
                                onClick={() => {
                                    setShowServiceForm(!showServiceForm);
                                    setEditingService(null);
                                    setServiceForm({ name: '', description: '', price: '', duration: '' });
                                }}
                                className="btn-primary"
                                style={{ padding: '0.6rem 1.25rem', fontSize: '0.875rem' }}
                            >
                                {showServiceForm ? '✕ Cancel' : '+ Add Service'}
                            </button>
                        </div>

                        {showServiceForm && (
                            <form onSubmit={handleServiceSubmit} style={{
                                background: 'white',
                                borderRadius: 'var(--radius)',
                                border: '1px solid var(--border)',
                                boxShadow: 'var(--shadow-sm)',
                                padding: '1.5rem',
                                marginBottom: '1rem',
                                display: 'grid',
                                gridTemplateColumns: '1fr 1fr',
                                gap: '1rem',
                            }}>
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <label style={labelStyle}>Service Name</label>
                                    <input required value={serviceForm.name}
                                        onChange={e => setServiceForm({ ...serviceForm, name: e.target.value })}
                                        style={inputStyle} />
                                </div>
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <label style={labelStyle}>Description</label>
                                    <textarea required value={serviceForm.description}
                                        onChange={e => setServiceForm({ ...serviceForm, description: e.target.value })}
                                        rows="2" style={{ ...inputStyle, resize: 'vertical' }} />
                                </div>
                                <div>
                                    <label style={labelStyle}>Price ($)</label>
                                    <input required type="number" value={serviceForm.price}
                                        onChange={e => setServiceForm({ ...serviceForm, price: e.target.value })}
                                        style={inputStyle} />
                                </div>
                                <div>
                                    <label style={labelStyle}>Duration (min)</label>
                                    <input required type="number" value={serviceForm.duration}
                                        onChange={e => setServiceForm({ ...serviceForm, duration: e.target.value })}
                                        style={inputStyle} />
                                </div>
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <button type="submit" className="btn-primary" style={{ padding: '0.65rem 1.5rem', fontSize: '0.875rem' }}>
                                        {editingService ? 'Update Service' : 'Create Service'}
                                    </button>
                                </div>
                            </form>
                        )}

                        <div style={{
                            background: 'white',
                            borderRadius: 'var(--radius)',
                            border: '1px solid var(--border)',
                            boxShadow: 'var(--shadow-sm)',
                            overflow: 'hidden',
                        }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                                <thead>
                                    <tr style={{ background: 'var(--warm-gray)', borderBottom: '1px solid var(--border)' }}>
                                        {['Name', 'Description', 'Price', 'Duration', 'Actions'].map(h => (
                                            <th key={h} style={{
                                                padding: '0.875rem 1rem', textAlign: 'left',
                                                fontSize: '0.7rem', fontWeight: '600',
                                                color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase',
                                            }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {services.map((s, i) => (
                                        <tr key={s._id} style={{
                                            borderBottom: '1px solid var(--border)',
                                            background: i % 2 === 0 ? 'white' : 'rgba(250,250,248,0.5)',
                                        }}>
                                            <td style={{ padding: '0.875rem 1rem', fontWeight: '600', color: 'var(--charcoal)' }}>{s.name}</td>
                                            <td style={{ padding: '0.875rem 1rem', color: 'var(--text-muted)', maxWidth: '280px' }}>
                                                <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                                    {s.description}
                                                </span>
                                            </td>
                                            <td style={{ padding: '0.875rem 1rem', fontWeight: '600', color: 'var(--gold-dark)' }}>${s.price}</td>
                                            <td style={{ padding: '0.875rem 1rem', color: 'var(--text-secondary)' }}>{s.duration} min</td>
                                            <td style={{ padding: '0.875rem 1rem' }}>
                                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                    <button onClick={() => handleEditService(s)} style={{
                                                        background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.3)',
                                                        color: 'var(--gold-dark)', padding: '0.3rem 0.75rem',
                                                        borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                                                        fontSize: '0.75rem', fontWeight: '600', fontFamily: 'DM Sans, sans-serif',
                                                    }}>Edit</button>
                                                    <button onClick={() => handleDeleteService(s._id)} style={{
                                                        background: '#fee2e2', border: '1px solid #fca5a5',
                                                        color: '#ef4444', padding: '0.3rem 0.75rem',
                                                        borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                                                        fontSize: '0.75rem', fontWeight: '600', fontFamily: 'DM Sans, sans-serif',
                                                    }}>Delete</button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Users tab */}
                {activeTab === 'users' && (
                    <div style={{
                        background: 'white',
                        borderRadius: 'var(--radius)',
                        border: '1px solid var(--border)',
                        boxShadow: 'var(--shadow-sm)',
                        overflow: 'hidden',
                    }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                            <thead>
                                <tr style={{ background: 'var(--warm-gray)', borderBottom: '1px solid var(--border)' }}>
                                    {['User', 'Email', 'Phone', 'Role', 'Actions'].map(h => (
                                        <th key={h} style={{
                                            padding: '0.875rem 1rem', textAlign: 'left',
                                            fontSize: '0.7rem', fontWeight: '600',
                                            color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase',
                                        }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {users.map((u, i) => (
                                    <tr key={u._id} style={{
                                        borderBottom: '1px solid var(--border)',
                                        background: i % 2 === 0 ? 'white' : 'rgba(250,250,248,0.5)',
                                    }}>
                                        <td style={{ padding: '0.875rem 1rem' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                <div style={{
                                                    width: '32px', height: '32px',
                                                    borderRadius: '50%',
                                                    background: 'var(--gold)',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    fontSize: '0.75rem', fontWeight: '700',
                                                    color: 'var(--charcoal)', flexShrink: 0,
                                                }}>
                                                    {u.name?.charAt(0).toUpperCase()}
                                                </div>
                                                <span style={{ fontWeight: '600', color: 'var(--charcoal)' }}>{u.name}</span>
                                            </div>
                                        </td>
                                        <td style={{ padding: '0.875rem 1rem', color: 'var(--text-muted)' }}>{u.email}</td>
                                        <td style={{ padding: '0.875rem 1rem', color: 'var(--text-secondary)' }}>{u.phone || '—'}</td>
                                        <td style={{ padding: '0.875rem 1rem' }}>
                                            <select
                                                value={u.role}
                                                onChange={e => handleRoleChange(u._id, e.target.value)}
                                                style={{
                                                    fontSize: '0.75rem', border: '1px solid var(--border)',
                                                    borderRadius: 'var(--radius-sm)', padding: '0.35rem 0.5rem',
                                                    fontFamily: 'DM Sans, sans-serif', cursor: 'pointer', outline: 'none',
                                                }}
                                            >
                                                <option value="customer">Customer</option>
                                                <option value="provider">Provider</option>
                                                <option value="admin">Admin</option>
                                            </select>
                                        </td>
                                        <td style={{ padding: '0.875rem 1rem' }}>
                                            <button onClick={() => handleDeleteUser(u._id)} style={{
                                                background: '#fee2e2', border: '1px solid #fca5a5',
                                                color: '#ef4444', padding: '0.3rem 0.75rem',
                                                borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                                                fontSize: '0.75rem', fontWeight: '600', fontFamily: 'DM Sans, sans-serif',
                                            }}>Delete</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
};

export default AdminDashboard;