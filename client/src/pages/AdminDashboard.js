import React, { useEffect, useState, useRef } from 'react';
import { appointmentService, serviceService, userService, providerWalletService, walletService } from '../services';
import { CalendarDays, Scissors, Users, Clock } from 'lucide-react';

const nMoney = (n) => `N$${Number(n || 0).toFixed(2)}`;

const statusConfig = {
    pending: { label: 'Pending', bg: '#fef3c7', color: '#92400e' },
    confirmed: { label: 'Confirmed', bg: '#dbeafe', color: '#1e40af' },
    completed: { label: 'Completed', bg: '#d1fae5', color: '#065f46' },
    cancelled: { label: 'Cancelled', bg: '#fee2e2', color: '#991b1b' },
    'no-show': { label: 'No-show', bg: '#ede9fe', color: '#5b21b6' },
};

const chipStyle = (active) => ({
    padding: '0.4rem 0.9rem', borderRadius: '99px', border: '1px solid',
    borderColor: active ? 'var(--gold)' : 'var(--border)',
    background: active ? 'rgba(201,168,76,0.12)' : 'white',
    color: active ? 'var(--gold-dark)' : 'var(--text-secondary)',
    fontSize: '0.78rem', fontWeight: active ? '600' : '400',
    cursor: 'pointer', fontFamily: 'Outfit, sans-serif', textTransform: 'capitalize',
});

const Pagination = ({ page, pages, onChange }) => (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '1.25rem' }}>
        <button onClick={() => onChange(Math.max(1, page - 1))} disabled={page <= 1} style={{
            padding: '0.4rem 0.9rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--card-bg)',
            color: 'var(--text-secondary)', cursor: page <= 1 ? 'not-allowed' : 'pointer', opacity: page <= 1 ? 0.5 : 1,
            fontSize: '0.8rem', fontFamily: 'Outfit, sans-serif',
        }}>← Prev</button>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Page {page} of {pages}</span>
        <button onClick={() => onChange(Math.min(pages, page + 1))} disabled={page >= pages} style={{
            padding: '0.4rem 0.9rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--card-bg)',
            color: 'var(--text-secondary)', cursor: page >= pages ? 'not-allowed' : 'pointer', opacity: page >= pages ? 0.5 : 1,
            fontSize: '0.8rem', fontFamily: 'Outfit, sans-serif',
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

    // Provider-platform wallet (admin oversight)
    const [pwSummary, setPwSummary] = useState(null);
    const [pwTopups, setPwTopups] = useState([]);
    const [pwWallets, setPwWallets] = useState([]);
    const [clientTopUps, setClientTopUps] = useState([]); // consumer wallet top-ups awaiting allocation
    const [pwAdjust, setPwAdjust] = useState(null); // provider wallet being adjusted

    const fetchProviderWalletData = async () => {
        try {
            const [s, t, w, ct] = await Promise.all([
                providerWalletService.getAdminSummary(),
                providerWalletService.getTopUps(),
                providerWalletService.getAllWallets(),
                walletService.adminGetClientTopUps(),
            ]);
            setPwSummary(s.data.data); setPwTopups(t.data.data || []); setPwWallets(w.data.data || []);
            setClientTopUps(ct.data.data || []);
        } catch { /* ignore */ }
    };

    useEffect(() => { if (activeTab === 'wallet') fetchProviderWalletData(); }, [activeTab]);

    const resolveProviderTopUp = async (id, approve) => {
        try {
            approve ? await providerWalletService.approveTopUp(id) : await providerWalletService.rejectTopUp(id);
            fetchProviderWalletData();
        } catch (err) { alert(err.response?.data?.message || 'Could not update top-up'); }
    };

    const resolveClientTopUp = async (id, approve) => {
        try {
            approve ? await walletService.adminApproveClientTopUp(id) : await walletService.adminRejectClientTopUp(id);
            fetchProviderWalletData();
        } catch (err) { alert(err.response?.data?.message || 'Could not update top-up'); }
    };

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

    const tabs = ['appointments', 'services', 'users', 'wallet'];
    const stats = [
        { label: 'Total Appointments', value: apptMeta.total, Icon: CalendarDays },
        { label: 'Total Services', value: services.length, Icon: Scissors },
        { label: 'Total Users', value: usersMeta.total, Icon: Users },
        { label: 'Pending', value: appointments.filter(a => a.status === 'pending').length, Icon: Clock },
    ];

    const inputStyle = {
        width: '100%', padding: '0.65rem 0.875rem',
        border: '1.5px solid var(--border)', borderRadius: 'var(--radius-sm)',
        fontFamily: 'var(--font-body)', fontSize: '0.875rem',
        color: 'var(--text-primary)', outline: 'none',
    };

    const labelStyle = {
        display: 'block', fontSize: '0.75rem', fontWeight: '600',
        color: 'var(--text-secondary)', marginBottom: '0.4rem',
        letterSpacing: '0.05em', textTransform: 'uppercase',
    };

    const tableWrapperStyle = {
        background: 'var(--card-bg)', borderRadius: 'var(--radius)',
        border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)',
        overflow: 'hidden',
    };

    const thStyle = {
        padding: '0.875rem 1rem', textAlign: 'left',
        fontSize: '0.7rem', fontWeight: '600',
        color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase',
    };

    if (loading) return (
        <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}>
                <div style={{ width: '40px', height: '40px', border: '3px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 1rem' }} />
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Loading dashboard...</p>
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );

    return (
        <div style={{ background: 'var(--off-white)', minHeight: '100dvh' }}>

            {/* Header */}
                <div style={{ background: 'var(--ink)', paddingTop: '9rem', paddingBottom: '3rem', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(ellipse at 80% 30%, rgba(201,168,76,0.05) 0%, transparent 60%)', pointerEvents: 'none' }} />
                <div className="container" style={{ position: 'relative' }}>
                    <p style={{ color: 'var(--gold)', fontSize: '0.75rem', fontWeight: '600', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Management</p>
                    <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2.2rem, 4vw, 3.25rem)', fontWeight: '700', color: 'white', lineHeight: 1.05, marginBottom: '0.35rem' }}>Admin Dashboard</h1>
                    <p style={{ color: 'rgba(255,255,255,0.62)', fontSize: '0.98rem', maxWidth: '56ch', lineHeight: 1.65 }}>
                        Oversee appointments, services, and users with a clearer hierarchy and faster decision-making.
                    </p>
                </div>
            </div>

            <div className="container" style={{ paddingTop: '2.5rem', paddingBottom: '5rem' }}>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1.5rem' }}>
                    <a href="/bkplus-command/insights" style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                        background: 'var(--ink)', color: 'white',
                        padding: '0.6rem 1.25rem', borderRadius: 'var(--radius-sm)',
                        textDecoration: 'none', fontSize: '0.875rem', fontWeight: '600',
                        fontFamily: 'Outfit, sans-serif',
                    }}>
                        📈 View Analytics
                    </a>
                </div>

                {/* Stats */}
                <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
                    {stats.map((s, i) => (
                        <div key={i} style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.2rem 1.4rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <div style={{ width: '46px', height: '46px', borderRadius: '12px', background: 'rgba(201,168,76,0.12)', color: 'var(--gold-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                <s.Icon size={20} strokeWidth={2} />
                            </div>
                            <div>
                                <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginBottom: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</p>
                                <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.85rem', fontWeight: '700', color: 'var(--charcoal)', lineHeight: 1 }}>{s.value}</p>
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
                <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border)', marginBottom: '1.5rem', overflowX: 'auto', paddingBottom: '0.35rem' }}>
                    {tabs.map(tab => (
                        <button key={tab} onClick={() => setActiveTab(tab)} style={{
                            padding: '0.65rem 1rem', background: activeTab === tab ? 'rgba(201,168,76,0.1)' : 'white', border: '1px solid',
                            borderColor: activeTab === tab ? 'var(--gold)' : 'var(--border)',
                            borderRadius: '999px',
                            color: activeTab === tab ? 'var(--gold-dark)' : 'var(--text-secondary)',
                            fontWeight: activeTab === tab ? '700' : '500', fontSize: '0.85rem',
                            cursor: 'pointer', fontFamily: 'Outfit, sans-serif',
                            textTransform: 'capitalize', transition: 'all 0.2s', whiteSpace: 'nowrap',
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
                                                        <p style={{ color: 'var(--text-muted)', fontSize: '0.7rem', fontFamily: 'monospace', letterSpacing: '0.05em', marginTop: '0.15rem' }}>
                                                            Ref {a.bookingReference || (a._id ? a._id.slice(-8).toUpperCase() : '—')}
                                                        </p>
                                                    </td>
                                                    <td style={{ padding: '0.875rem 1rem', color: 'var(--text-secondary)' }}>{a.service?.name}</td>
                                                    <td style={{ padding: '0.875rem 1rem', color: 'var(--text-secondary)' }}>{new Date(a.appointmentDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                                                    <td style={{ padding: '0.875rem 1rem', color: 'var(--text-secondary)' }}>{a.startTime} – {a.endTime}</td>
                                                <td style={{ padding: '0.875rem 1rem', fontWeight: '600', color: 'var(--charcoal)' }}>${a.totalPrice}</td>
                                                <td style={{ padding: '0.875rem 1rem' }}>
                                                    <span style={{ padding: '0.2rem 0.65rem', borderRadius: '99px', fontSize: '0.72rem', fontWeight: '600', background: s.bg, color: s.color }}>{s.label}</span>
                                                </td>
                                                <td style={{ padding: '0.875rem 1rem' }}>
                                                    <select value={a.status} onChange={e => handleUpdateStatus(a._id, e.target.value)} style={{ fontSize: '0.75rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.35rem 0.5rem', fontFamily: 'var(--font-body)', color: 'var(--text-secondary)', cursor: 'pointer', outline: 'none' }}>
                                                        <option value="pending">Pending</option>
                                                        <option value="confirmed">Confirmed</option>
                                                        <option value="completed">Completed</option>
                                                        <option value="cancelled">Cancelled</option>
                                                        <option value="no-show">No-show</option>
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
                            <form onSubmit={handleServiceSubmit} style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem', marginBottom: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
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
                                                    <button onClick={() => handleEditService(s)} style={{ background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.3)', color: 'var(--gold-dark)', padding: '0.3rem 0.75rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '600', fontFamily: 'var(--font-body)' }}>Edit</button>
                                                    <button onClick={() => handleDeleteService(s._id)} style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#ef4444', padding: '0.3rem 0.75rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '600', fontFamily: 'var(--font-body)' }}>Delete</button>
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
                                                    <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: '700', color: 'var(--ink)', flexShrink: 0 }}>
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
                                                                fontSize: '0.7rem', fontFamily: 'var(--font-body)',
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
                                                            fontSize: '0.75rem', fontWeight: '600', fontFamily: 'var(--font-body)',
                                                        }}>
                                                            {u.isActive === false ? 'Activate' : 'Suspend'}
                                                        </button>
                                                    )}
                                                    <button onClick={() => handleDeleteUser(u._id)} style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#ef4444', padding: '0.3rem 0.75rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '600', fontFamily: 'var(--font-body)' }}>Delete</button>
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

                {activeTab === 'wallet' && (
                    <div>
                        {/* Provider account balances the platform holds */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                            {[
                                { label: 'Total provider funds', val: nMoney(pwSummary?.totalHeld), accent: true },
                                { label: 'Provider accounts', val: pwSummary?.walletCount ?? 0 },
                                { label: 'Pending top-ups', val: pwSummary?.pendingTopUps ?? 0 },
                            ].map((c) => (
                                <div key={c.label} style={{ background: c.accent ? 'rgba(201,168,76,0.1)' : 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1.1rem 1.25rem' }}>
                                    <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>{c.label}</div>
                                    <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: '700', color: c.accent ? 'var(--gold-dark)' : 'var(--charcoal)' }}>{c.val}</div>
                                </div>
                            ))}
                        </div>

                        {/* Provider top-up requests (with proof) */}
                        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: '1.5rem' }}>
                            <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: '600', color: 'var(--charcoal)', margin: 0 }}>Provider top-up requests</h3>
                                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{pwTopups.filter((t) => t.status === 'pending').length} pending</span>
                            </div>
                            {pwTopups.length === 0 ? (
                                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>No top-up requests yet.</div>
                            ) : pwTopups.slice(0, 40).map((t) => (
                                <div key={t._id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', padding: '0.9rem 1.5rem', borderBottom: '1px solid var(--border)' }}>
                                    <div style={{ minWidth: 0 }}>
                                        <p style={{ margin: 0, fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.9rem' }}>{t.provider?.name || 'Provider'} · {nMoney(t.amount)}</p>
                                        <p style={{ margin: '0.1rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                            {new Date(t.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{t.method === 'cash' ? ' · cash' : ''}{t.reference ? ` · ${t.reference}` : ''}
                                            {t.proofUrl && <> · <a href={t.proofUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--gold-dark)' }}>View {t.proofType === 'pdf' ? 'PDF' : 'proof'}</a></>}
                                        </p>
                                    </div>
                                    {t.status === 'pending' ? (
                                        <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                                            <button onClick={() => resolveProviderTopUp(t._id, true)} className="btn-primary" style={{ padding: '0.35rem 0.9rem', fontSize: '0.8rem' }}>Approve</button>
                                            <button onClick={() => resolveProviderTopUp(t._id, false)} className="btn-outline" style={{ padding: '0.35rem 0.9rem', fontSize: '0.8rem' }}>Reject</button>
                                        </div>
                                    ) : (
                                        <span style={{ fontSize: '0.72rem', fontWeight: '600', padding: '0.2rem 0.6rem', borderRadius: '99px', textTransform: 'capitalize', background: t.status === 'approved' ? '#d1fae5' : '#fee2e2', color: t.status === 'approved' ? '#065f46' : '#991b1b' }}>{t.status}</span>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* Client (consumer) wallet top-up requests — admin can allocate too */}
                        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: '1.5rem' }}>
                            <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: '600', color: 'var(--charcoal)', margin: 0 }}>Client wallet top-ups</h3>
                                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{clientTopUps.filter((t) => t.status === 'pending').length} pending</span>
                            </div>
                            {clientTopUps.length === 0 ? (
                                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>No client top-up requests yet.</div>
                            ) : clientTopUps.slice(0, 40).map((t) => (
                                <div key={t._id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', padding: '0.9rem 1.5rem', borderBottom: '1px solid var(--border)' }}>
                                    <div style={{ minWidth: 0 }}>
                                        <p style={{ margin: 0, fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.9rem' }}>{t.customer?.name || 'Client'} → {t.provider?.name || 'Provider'} · {nMoney(t.amount)}</p>
                                        <p style={{ margin: '0.1rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                            {new Date(t.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{t.method === 'cash' ? ' · cash' : ''}{t.reference ? ` · ${t.reference}` : ''}
                                            {t.proofUrl && <> · <a href={t.proofUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--gold-dark)' }}>View proof</a></>}
                                        </p>
                                    </div>
                                    {t.status === 'pending' ? (
                                        <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                                            <button onClick={() => resolveClientTopUp(t._id, true)} className="btn-primary" style={{ padding: '0.35rem 0.9rem', fontSize: '0.8rem' }}>Approve</button>
                                            <button onClick={() => resolveClientTopUp(t._id, false)} className="btn-outline" style={{ padding: '0.35rem 0.9rem', fontSize: '0.8rem' }}>Reject</button>
                                        </div>
                                    ) : (
                                        <span style={{ fontSize: '0.72rem', fontWeight: '600', padding: '0.2rem 0.6rem', borderRadius: '99px', textTransform: 'capitalize', background: t.status === 'approved' ? '#d1fae5' : '#fee2e2', color: t.status === 'approved' ? '#065f46' : '#991b1b' }}>{t.status}</span>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* Provider balances + manual credit/debit */}
                        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                            <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--border)' }}>
                                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: '600', color: 'var(--charcoal)', margin: 0 }}>Provider balances</h3>
                            </div>
                            {pwWallets.length === 0 ? (
                                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>No provider wallets yet.</div>
                            ) : (
                                <div style={{ overflowX: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                        <thead><tr style={{ background: 'var(--warm-gray)', textAlign: 'left' }}>{['Provider', 'Balance', ''].map((h) => <th key={h} style={{ padding: '0.6rem 1rem', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>{h}</th>)}</tr></thead>
                                        <tbody>
                                            {pwWallets.map((w) => (
                                                <tr key={w._id} style={{ borderBottom: '1px solid var(--border)' }}>
                                                    <td style={{ padding: '0.7rem 1rem' }}><div style={{ fontWeight: '600', color: 'var(--charcoal)' }}>{w.provider?.name || '—'}</div><div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{w.provider?.email}</div></td>
                                                    <td style={{ padding: '0.7rem 1rem', fontWeight: '700', color: 'var(--gold-dark)' }}>{nMoney(w.balance)}</td>
                                                    <td style={{ padding: '0.7rem 1rem', textAlign: 'right' }}><button onClick={() => setPwAdjust(w)} className="btn-outline" style={{ padding: '0.3rem 0.8rem', fontSize: '0.78rem' }}>Credit / Debit</button></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        {pwAdjust && (
                            <AdminAdjustModal
                                wallet={pwAdjust}
                                onClose={() => setPwAdjust(null)}
                                onDone={() => { setPwAdjust(null); fetchProviderWalletData(); }}
                            />
                        )}
                    </div>
                )}
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
};

// Admin credits or debits a provider's platform balance (applies immediately).
const AdminAdjustModal = ({ wallet, onClose, onDone }) => {
    const [direction, setDirection] = useState('credit');
    const [amount, setAmount] = useState('');
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const submit = async (e) => {
        e.preventDefault();
        const amt = parseFloat(amount);
        if (!(amt > 0)) { setError('Enter a valid amount'); return; }
        setBusy(true); setError('');
        try {
            await providerWalletService.adjustBalance({ providerId: wallet.provider?._id || wallet.provider, amount: amt, direction, reason });
            onDone();
        } catch (err) { setError(err.response?.data?.message || 'Could not adjust'); setBusy(false); }
    };
    return (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(26,26,46,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '1rem' }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', width: '100%', maxWidth: '400px', overflow: 'hidden' }}>
                <div style={{ padding: '1.1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
                    <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: '700', color: 'var(--charcoal)', margin: 0 }}>Adjust · {wallet.provider?.name}</h2>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.2rem 0 0' }}>Current balance {nMoney(wallet.balance)}</p>
                </div>
                <form onSubmit={submit} style={{ padding: '1.25rem' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                        {[{ v: 'credit', t: 'Credit (add)' }, { v: 'debit', t: 'Debit (remove)' }].map((o) => (
                            <button key={o.v} type="button" onClick={() => setDirection(o.v)} style={{
                                flex: 1, padding: '0.55rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontFamily: 'Outfit, sans-serif', fontWeight: '600', fontSize: '0.82rem',
                                border: `1.5px solid ${direction === o.v ? 'var(--gold)' : 'var(--border)'}`,
                                background: direction === o.v ? 'rgba(201,168,76,0.1)' : 'var(--card-bg)', color: direction === o.v ? 'var(--gold-dark)' : 'var(--text-secondary)',
                            }}>{o.t}</button>
                        ))}
                    </div>
                    <input type="number" min="1" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount (N$)" className="input" style={{ width: '100%', marginBottom: '0.75rem' }} required />
                    <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (e.g. manual deposit, correction)" className="input" style={{ width: '100%', marginBottom: '1rem' }} maxLength={200} />
                    {error && <p style={{ color: '#dc2626', fontSize: '0.85rem', margin: '0 0 0.75rem' }}>{error}</p>}
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button type="submit" disabled={busy} className="btn-primary" style={{ flex: 1, padding: '0.75rem' }}>{busy ? 'Saving…' : 'Apply'}</button>
                        <button type="button" onClick={onClose} className="btn-outline" style={{ padding: '0.75rem 1.1rem' }}>Cancel</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AdminDashboard;