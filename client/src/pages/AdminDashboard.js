import React, { useEffect, useState, useRef } from 'react';
import { appointmentService, serviceService, userService } from '../services';

const statusConfig = {
    pending: { label: 'Pending', bg: '#fef3c7', color: '#92400e' },
    confirmed: { label: 'Confirmed', bg: '#dbeafe', color: '#1e40af' },
    completed: { label: 'Completed', bg: '#d1fae5', color: '#065f46' },
    cancelled: { label: 'Cancelled', bg: '#fee2e2', color: '#991b1b' },
};

const chipStyle = (active) => ({
    padding: '0.4rem 0.9rem', borderRadius: '99px', border: '1px solid',
    borderColor: active ? 'var(--gold)' : 'var(--border)',
    background: active ? 'rgba(201,168,76,0.12)' : 'white',
    color: active ? 'var(--gold-dark)' : 'var(--text-secondary)',
    fontSize: '0.78rem', fontWeight: active ? '600' : '400',
    cursor: 'pointer', fontFamily: 'Inter, sans-serif', textTransform: 'capitalize',
});

const Pagination = ({ page, pages, onChange }) => (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '1.25rem' }}>
        <button onClick={() => onChange(Math.max(1, page - 1))} disabled={page <= 1} style={{
            padding: '0.4rem 0.9rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'white',
            color: 'var(--text-secondary)', cursor: page <= 1 ? 'not-allowed' : 'pointer', opacity: page <= 1 ? 0.5 : 1,
            fontSize: '0.8rem', fontFamily: 'Inter, sans-serif',
        }}>← Prev</button>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Page {page} of {pages}</span>
        <button onClick={() => onChange(Math.min(pages, page + 1))} disabled={page >= pages} style={{
            padding: '0.4rem 0.9rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'white',
            color: 'var(--text-secondary)', cursor: page >= pages ? 'not-allowed' : 'pointer', opacity: page >= pages ? 0.5 : 1,
            fontSize: '0.8rem', fontFamily: 'Inter, sans-serif',
        }}>Next →</button>
    </div>
);

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

    // User filters + pagination
    const [userSearch, setUserSearch] = useState('');
    const [userRoleFilter, setUserRoleFilter] = useState('');
    const [userStatusFilter, setUserStatusFilter] = useState('');
    const [userPage, setUserPage] = useState(1);
    const [usersMeta, setUsersMeta] = useState({ total: 0, pages: 1 });

    // Appointment filter + pagination
    const [apptStatusFilter, setApptStatusFilter] = useState('');
    const [apptPage, setApptPage] = useState(1);
    const [apptMeta, setApptMeta] = useState({ total: 0, pages: 1 });

    const fetchUsers = async () => {
        try {
            const params = { page: userPage };
            if (userSearch.trim()) params.search = userSearch.trim();
            if (userRoleFilter) params.role = userRoleFilter;
            if (userStatusFilter) params.status = userStatusFilter;
            const res = await userService.getAllUsers(params);
            setUsers(res.data.data);
            setUsersMeta({ total: res.data.total, pages: res.data.pages || 1 });
        } catch {
            setError('Failed to load users');
        }
    };

    const fetchAppointments = async () => {
        try {
            const params = { page: apptPage };
            if (apptStatusFilter) params.status = apptStatusFilter;
            const res = await appointmentService.getAllAppointments(params);
            setAppointments(res.data.data);
            setApptMeta({ total: res.data.total, pages: res.data.pages || 1 });
        } catch {
            setError('Failed to load appointments');
        }
    };

    const fetchServices = async () => {
        try {
            const res = await serviceService.getAllServices();
            setServices(res.data.data);
        } catch {
            setError('Failed to load services');
        }
    };

    // Initial load
    useEffect(() => {
        (async () => {
            setLoading(true);
            await Promise.all([fetchAppointments(), fetchServices(), fetchUsers()]);
            setLoading(false);
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Refetch users when filters/page change (debounced for search)
    const usersMounted = useRef(false);
    useEffect(() => {
        if (!usersMounted.current) { usersMounted.current = true; return; }
        const t = setTimeout(fetchUsers, 300);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userSearch, userRoleFilter, userStatusFilter, userPage]);

    // Refetch appointments when status filter/page change
    const apptsMounted = useRef(false);
    useEffect(() => {
        if (!apptsMounted.current) { apptsMounted.current = true; return; }
        fetchAppointments();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [apptStatusFilter, apptPage]);

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
            await fetchServices();
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

    const handleToggleActive = async (id) => {
        try {
            const res = await userService.toggleUserActive(id);
            const isActive = res.data.data.isActive;
            setUsers(users.map(u => u._id === id ? { ...u, isActive } : u));
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to update user status');
        }
    };

    const tabs = ['appointments', 'services', 'users'];
    const stats = [
        { label: 'Total Appointments', value: apptMeta.total, icon: '📅' },
        { label: 'Total Services', value: services.length, icon: '✂️' },
        { label: 'Total Users', value: usersMeta.total, icon: '👥' },
        { label: 'Pending', value: appointments.filter(a => a.status === 'pending').length, icon: '⏳' },
    ];

    const inputStyle = {
        width: '100%', padding: '0.65rem 0.875rem',
        border: '1.5px solid var(--border)', borderRadius: 'var(--radius-sm)',
        fontFamily: 'Inter, sans-serif', fontSize: '0.875rem',
        color: 'var(--text-primary)', outline: 'none',
    };

    const labelStyle = {
        display: 'block', fontSize: '0.75rem', fontWeight: '600',
        color: 'var(--text-secondary)', marginBottom: '0.4rem',
        letterSpacing: '0.05em', textTransform: 'uppercase',
    };

    const tableWrapperStyle = {
        background: 'white', borderRadius: 'var(--radius)',
        border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)',
        overflow: 'hidden',
    };

    const thStyle = {
        padding: '0.875rem 1rem', textAlign: 'left',
        fontSize: '0.7rem', fontWeight: '600',
        color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase',
    };

    if (loading) return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}>
                <div style={{ width: '40px', height: '40px', border: '3px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 1rem' }} />
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Loading dashboard...</p>
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );

    return (
        <div style={{ background: 'var(--off-white)', minHeight: '100vh' }}>

            {/* Header */}
            <div style={{ background: 'var(--charcoal)', paddingTop: '9rem', paddingBottom: '3rem', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(ellipse at 80% 30%, rgba(201,168,76,0.1) 0%, transparent 60%)', pointerEvents: 'none' }} />
                <div className="container" style={{ position: 'relative' }}>
                    <p style={{ color: 'var(--gold)', fontSize: '0.75rem', fontWeight: '600', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Management</p>
                    <h1 style={{ fontFamily: 'Inter, sans-serif', fontSize: 'clamp(2rem, 4vw, 3rem)', fontWeight: '700', color: 'white' }}>Admin Dashboard</h1>
                </div>
            </div>

            <div className="container" style={{ paddingTop: '2.5rem', paddingBottom: '5rem' }}>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1.5rem' }}>
                    <a href="/bkplus-command/insights" style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                        background: 'var(--charcoal)', color: 'white',
                        padding: '0.6rem 1.25rem', borderRadius: 'var(--radius-sm)',
                        textDecoration: 'none', fontSize: '0.875rem', fontWeight: '600',
                        fontFamily: 'Inter, sans-serif',
                    }}>
                        📈 View Analytics
                    </a>
                </div>

                {/* Stats */}
                <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
                    {stats.map((s, i) => (
                        <div key={i} style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: 'rgba(201,168,76,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', flexShrink: 0 }}>
                                {s.icon}
                            </div>
                            <div>
                                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{s.label}</p>
                                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: '1.6rem', fontWeight: '700', color: 'var(--charcoal)', lineHeight: 1 }}>{s.value}</p>
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
                            cursor: 'pointer', fontFamily: 'Inter, sans-serif',
                            textTransform: 'capitalize', transition: 'all 0.2s', marginBottom: '-1px', whiteSpace: 'nowrap',
                        }}>
                            {tab.charAt(0).toUpperCase() + tab.slice(1)}
                        </button>
                    ))}
                </div>

                {/* Appointments tab */}
                {activeTab === 'appointments' && (
                    <div>
                        {/* Status filter toolbar */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                {['', 'pending', 'confirmed', 'completed', 'cancelled'].map(st => (
                                    <button key={st || 'all'} onClick={() => { setApptStatusFilter(st); setApptPage(1); }} style={chipStyle(apptStatusFilter === st)}>
                                        {st === '' ? 'All' : st}
                                    </button>
                                ))}
                            </div>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{apptMeta.total} total</span>
                        </div>

                        <div className="table-scroll" style={tableWrapperStyle}>
                            {appointments.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>No appointments found</div>
                            ) : (
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                                    <thead>
                                        <tr style={{ background: 'var(--warm-gray)', borderBottom: '1px solid var(--border)' }}>
                                            {['Customer', 'Service', 'Date', 'Time', 'Price', 'Status', 'Action'].map(h => (
                                                <th key={h} style={thStyle}>{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {appointments.map((a, i) => {
                                            const s = statusConfig[a.status] || statusConfig.pending;
                                            return (
                                                <tr key={a._id} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'white' : 'rgba(250,250,248,0.5)' }}>
                                                    <td style={{ padding: '0.875rem 1rem' }}>
                                                        <p style={{ fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.875rem' }}>{a.customer?.name}</p>
                                                        <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{a.customer?.email}</p>
                                                    </td>
                                                    <td style={{ padding: '0.875rem 1rem', color: 'var(--text-secondary)' }}>{a.service?.name}</td>
                                                    <td style={{ padding: '0.875rem 1rem', color: 'var(--text-secondary)' }}>{new Date(a.appointmentDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                                                    <td style={{ padding: '0.875rem 1rem', color: 'var(--text-secondary)' }}>{a.startTime} – {a.endTime}</td>
                                                <td style={{ padding: '0.875rem 1rem', fontWeight: '600', color: 'var(--charcoal)' }}>${a.totalPrice}</td>
                                                <td style={{ padding: '0.875rem 1rem' }}>
                                                    <span style={{ padding: '0.2rem 0.65rem', borderRadius: '99px', fontSize: '0.72rem', fontWeight: '600', background: s.bg, color: s.color }}>{s.label}</span>
                                                </td>
                                                <td style={{ padding: '0.875rem 1rem' }}>
                                                    <select value={a.status} onChange={e => handleUpdateStatus(a._id, e.target.value)} style={{ fontSize: '0.75rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.35rem 0.5rem', fontFamily: 'Inter, sans-serif', color: 'var(--text-secondary)', cursor: 'pointer', outline: 'none' }}>
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
                        {apptMeta.pages > 1 && (
                            <Pagination page={apptPage} pages={apptMeta.pages} onChange={setApptPage} />
                        )}
                    </div>
                )}

                {/* Services tab */}
                {activeTab === 'services' && (
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
                            <button onClick={() => { setShowServiceForm(!showServiceForm); setEditingService(null); setServiceForm({ name: '', description: '', price: '', duration: '' }); }} className="btn-primary" style={{ padding: '0.6rem 1.25rem', fontSize: '0.875rem' }}>
                                {showServiceForm ? '✕ Cancel' : '+ Add Service'}
                            </button>
                        </div>

                        {showServiceForm && (
                            <form onSubmit={handleServiceSubmit} style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem', marginBottom: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <label style={labelStyle}>Service Name</label>
                                    <input required value={serviceForm.name} onChange={e => setServiceForm({ ...serviceForm, name: e.target.value })} style={inputStyle} />
                                </div>
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <label style={labelStyle}>Description</label>
                                    <textarea required value={serviceForm.description} onChange={e => setServiceForm({ ...serviceForm, description: e.target.value })} rows="2" style={{ ...inputStyle, resize: 'vertical' }} />
                                </div>
                                <div>
                                    <label style={labelStyle}>Price ($)</label>
                                    <input required type="number" value={serviceForm.price} onChange={e => setServiceForm({ ...serviceForm, price: e.target.value })} style={inputStyle} />
                                </div>
                                <div>
                                    <label style={labelStyle}>Duration (min)</label>
                                    <input required type="number" value={serviceForm.duration} onChange={e => setServiceForm({ ...serviceForm, duration: e.target.value })} style={inputStyle} />
                                </div>
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <button type="submit" className="btn-primary" style={{ padding: '0.65rem 1.5rem', fontSize: '0.875rem' }}>
                                        {editingService ? 'Update Service' : 'Create Service'}
                                    </button>
                                </div>
                            </form>
                        )}

                        <div className="table-scroll" style={tableWrapperStyle}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                                <thead>
                                    <tr style={{ background: 'var(--warm-gray)', borderBottom: '1px solid var(--border)' }}>
                                        {['Name', 'Description', 'Price', 'Duration', 'Actions'].map(h => <th key={h} style={thStyle}>{h}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {services.map((s, i) => (
                                        <tr key={s._id} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'white' : 'rgba(250,250,248,0.5)' }}>
                                            <td style={{ padding: '0.875rem 1rem', fontWeight: '600', color: 'var(--charcoal)' }}>{s.name}</td>
                                            <td style={{ padding: '0.875rem 1rem', color: 'var(--text-muted)', maxWidth: '280px' }}>
                                                <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{s.description}</span>
                                            </td>
                                            <td style={{ padding: '0.875rem 1rem', fontWeight: '600', color: 'var(--gold-dark)' }}>${s.price}</td>
                                            <td style={{ padding: '0.875rem 1rem', color: 'var(--text-secondary)' }}>{s.duration} min</td>
                                            <td style={{ padding: '0.875rem 1rem' }}>
                                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                    <button onClick={() => handleEditService(s)} style={{ background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.3)', color: 'var(--gold-dark)', padding: '0.3rem 0.75rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '600', fontFamily: 'Inter, sans-serif' }}>Edit</button>
                                                    <button onClick={() => handleDeleteService(s._id)} style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#ef4444', padding: '0.3rem 0.75rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '600', fontFamily: 'Inter, sans-serif' }}>Delete</button>
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
                    <div>
                        {/* Filter toolbar */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                <input
                                    value={userSearch}
                                    onChange={e => { setUserSearch(e.target.value); setUserPage(1); }}
                                    placeholder="Search name or email…"
                                    style={{ ...inputStyle, width: '220px', padding: '0.5rem 0.75rem' }}
                                />
                                <select value={userRoleFilter} onChange={e => { setUserRoleFilter(e.target.value); setUserPage(1); }} style={{ ...inputStyle, width: 'auto', padding: '0.5rem 0.75rem', cursor: 'pointer' }}>
                                    <option value="">All roles</option>
                                    <option value="customer">Customers</option>
                                    <option value="provider">Providers</option>
                                    <option value="admin">Admins</option>
                                </select>
                                <select value={userStatusFilter} onChange={e => { setUserStatusFilter(e.target.value); setUserPage(1); }} style={{ ...inputStyle, width: 'auto', padding: '0.5rem 0.75rem', cursor: 'pointer' }}>
                                    <option value="">All statuses</option>
                                    <option value="active">Active</option>
                                    <option value="suspended">Suspended</option>
                                </select>
                            </div>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{usersMeta.total} total</span>
                        </div>

                        <div className="table-scroll" style={tableWrapperStyle}>
                            {users.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>No users found</div>
                            ) : (
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                                <thead>
                                    <tr style={{ background: 'var(--warm-gray)', borderBottom: '1px solid var(--border)' }}>
                                        {['User', 'Email', 'Phone', 'Role', 'Status', 'Actions'].map(h => <th key={h} style={thStyle}>{h}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {users.map((u, i) => (
                                        <tr key={u._id} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'white' : 'rgba(250,250,248,0.5)' }}>
                                            <td style={{ padding: '0.875rem 1rem' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                    <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: '700', color: 'var(--charcoal)', flexShrink: 0 }}>
                                                        {u.name?.charAt(0).toUpperCase()}
                                                    </div>
                                                    <span style={{ fontWeight: '600', color: 'var(--charcoal)' }}>{u.name}</span>
                                                </div>
                                            </td>
                                            <td style={{ padding: '0.875rem 1rem', color: 'var(--text-muted)' }}>{u.email}</td>
                                            <td style={{ padding: '0.875rem 1rem', color: 'var(--text-secondary)' }}>{u.phone || '—'}</td>
                                            <td style={{ padding: '0.875rem 1rem' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                    <span style={{
                                                        display: 'inline-block', padding: '0.2rem 0.65rem',
                                                        borderRadius: '99px', fontSize: '0.72rem', fontWeight: '600',
                                                        background: u.role === 'admin' ? '#fef3c7' : u.role === 'provider' ? '#dbeafe' : '#d1fae5',
                                                        color: u.role === 'admin' ? '#92400e' : u.role === 'provider' ? '#1e40af' : '#065f46',
                                                        textTransform: 'capitalize',
                                                    }}>
                                                        {u.role}
                                                    </span>
                                                    {u.role !== 'admin' && (
                                                        <button
                                                            onClick={() => handleRoleChange(u._id, 'admin')}
                                                            style={{
                                                                background: 'none', border: '1px solid var(--border)',
                                                                color: 'var(--text-muted)', padding: '0.2rem 0.5rem',
                                                                borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                                                                fontSize: '0.7rem', fontFamily: 'Inter, sans-serif',
                                                            }}
                                                        >
                                                            Make Admin
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                            <td style={{ padding: '0.875rem 1rem' }}>
                                                <span style={{
                                                    display: 'inline-block', padding: '0.2rem 0.65rem',
                                                    borderRadius: '99px', fontSize: '0.72rem', fontWeight: '600',
                                                    background: u.isActive === false ? '#fee2e2' : '#d1fae5',
                                                    color: u.isActive === false ? '#991b1b' : '#065f46',
                                                }}>
                                                    {u.isActive === false ? 'Suspended' : 'Active'}
                                                </span>
                                            </td>
                                            <td style={{ padding: '0.875rem 1rem' }}>
                                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                    {u.role !== 'admin' && (
                                                        <button onClick={() => handleToggleActive(u._id)} style={{
                                                            background: u.isActive === false ? '#d1fae5' : '#fef3c7',
                                                            border: u.isActive === false ? '1px solid #6ee7b7' : '1px solid #fcd34d',
                                                            color: u.isActive === false ? '#065f46' : '#92400e',
                                                            padding: '0.3rem 0.75rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                                                            fontSize: '0.75rem', fontWeight: '600', fontFamily: 'Inter, sans-serif',
                                                        }}>
                                                            {u.isActive === false ? 'Activate' : 'Suspend'}
                                                        </button>
                                                    )}
                                                    <button onClick={() => handleDeleteUser(u._id)} style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#ef4444', padding: '0.3rem 0.75rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '600', fontFamily: 'Inter, sans-serif' }}>Delete</button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            )}
                        </div>
                        {usersMeta.pages > 1 && (
                            <Pagination page={userPage} pages={usersMeta.pages} onChange={setUserPage} />
                        )}
                    </div>
                )}
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
};

export default AdminDashboard;