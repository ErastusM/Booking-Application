import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { appointmentService, availabilityService, earningsService, providerServiceService, categoryService, blockedTimeService, clientCRMService, messageService, packageService, retentionService, teamService } from '../services';
import { useAuthContext } from '../context/AuthContext';
import OnboardingWizard from '../components/OnboardingWizard';
import SuggestionBox from '../components/SuggestionBox';

const statusConfig = {
    pending: { label: 'Pending', bg: '#fef3c7', color: '#92400e' },
    confirmed: { label: 'Confirmed', bg: '#dbeafe', color: '#1e40af' },
    completed: { label: 'Completed', bg: '#d1fae5', color: '#065f46' },
    cancelled: { label: 'Cancelled', bg: '#fee2e2', color: '#991b1b' },
};

const ProviderDashboard = () => {
    const { user, setUser } = useAuthContext();
    const [showWizard, setShowWizard] = useState(false);
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
    const [catalogueCategory, setCatalogueCategory] = useState('all');
    const [catalogueSearch, setCatalogueSearch] = useState('');
    const [currentDate, setCurrentDate] = useState(new Date());
    const [calendarView, setCalendarView] = useState('day');
    const [selectedDay, setSelectedDay] = useState(null);
    const [viewMenuOpen, setViewMenuOpen] = useState(false);
    const [addMenuOpen, setAddMenuOpen] = useState(false);
    const [blockedTimes, setBlockedTimes] = useState([]);
    const [showBlockedTimeForm, setShowBlockedTimeForm] = useState(false);
    const [editingBlockedTime, setEditingBlockedTime] = useState(null);
    const [blockedTimeForm, setBlockedTimeForm] = useState({ blockType: 'Custom', title: '', date: '', startTime: '', endTime: '', reason: '', isRecurring: false, recurrenceType: 'weekly', recurrenceEndDate: '' });
    const [savingBlockedTime, setSavingBlockedTime] = useState(false);
    const [recurringActionModal, setRecurringActionModal] = useState(null);
    const [recurringMode, setRecurringMode] = useState('this');

    // CRM / Messages / Packages / Retention
    const [clients, setClients] = useState([]);
    const [loadingClients, setLoadingClients] = useState(false);
    const [selectedClient, setSelectedClient] = useState(null);
    const [clientDetail, setClientDetail] = useState(null);
    const [clientNoteForm, setClientNoteForm] = useState({ notes: '', allergies: '', conditions: '', internalNotes: '', tags: '', birthday: '' });
    const [savingClientNote, setSavingClientNote] = useState(false);

    const [conversations, setConversations] = useState([]);
    const [loadingConversations, setLoadingConversations] = useState(false);
    const [selectedConversation, setSelectedConversation] = useState(null);
    const [conversationMessages, setConversationMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [sendingMessage, setSendingMessage] = useState(false);

    const [myPackages, setMyPackages] = useState([]);
    const [loadingPackages, setLoadingPackages] = useState(false);
    const [showPackageForm, setShowPackageForm] = useState(false);
    const [packageForm, setPackageForm] = useState({ name: '', description: '', totalSessions: '', price: '', validityDays: '365' });
    const [savingPackage, setSavingPackage] = useState(false);

    const [retentionData, setRetentionData] = useState(null);
    const [loadingRetention, setLoadingRetention] = useState(false);

    // Team members
    const [teamMembers, setTeamMembers] = useState([]);
    const [loadingTeam, setLoadingTeam] = useState(false);
    const [showTeamForm, setShowTeamForm] = useState(false);
    const [editingMember, setEditingMember] = useState(null);
    const [teamForm, setTeamForm] = useState({ name: '', role: 'Staff', email: '', phone: '', color: '#c9a84c' });
    const [savingTeam, setSavingTeam] = useState(false);

    // Show onboarding wizard for providers who haven't completed setup
    useEffect(() => {
        if (user && user.role === 'provider' && !user.providerSetupComplete) {
            setShowWizard(true);
        }
    }, [user]);

    useEffect(() => {
        fetchAppointments();
        fetchAvailability();
        fetchMyServices();
        fetchCategories();
        fetchBlockedTimes();
    }, []);

    useEffect(() => {
        if (activeTab === 'earnings' && !earnings) fetchEarnings();
        if (activeTab === 'clients' && clients.length === 0) fetchClients();
        if (activeTab === 'messages' && conversations.length === 0) fetchConversations();
        if (activeTab === 'memberships' && myPackages.length === 0) fetchMyPackages();
        if (activeTab === 'retention' && !retentionData) fetchRetention();
        if (activeTab === 'team' && teamMembers.length === 0) fetchTeam();
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

    const fetchBlockedTimes = async () => {
        try {
            const res = await blockedTimeService.getMyBlockedTimes();
            setBlockedTimes(res.data.data);
        } catch { }
    };

    const openBlockedTimeForm = (item = null) => {
        if (item) {
            setEditingBlockedTime(item);
            setBlockedTimeForm({
                blockType: item.blockType || 'Custom',
                title: item.title || '',
                date: item.date,
                startTime: item.startTime,
                endTime: item.endTime,
                reason: item.reason || '',
                isRecurring: item.isRecurring,
                recurrenceType: item.recurrenceType || 'weekly',
                recurrenceEndDate: item.recurrenceEndDate || '',
            });
        } else {
            setEditingBlockedTime(null);
            setBlockedTimeForm({ blockType: 'Custom', title: '', date: new Date().toISOString().split('T')[0], startTime: '', endTime: '', reason: '', isRecurring: false, recurrenceType: 'weekly', recurrenceEndDate: '' });
        }
        setShowBlockedTimeForm(true);
    };

    const closeBlockedTimeForm = () => {
        setShowBlockedTimeForm(false);
        setEditingBlockedTime(null);
    };

    const handleBlockedTimeSubmit = async (e) => {
        e.preventDefault();
        if (editingBlockedTime && editingBlockedTime.isRecurring) {
            setRecurringActionModal({ action: 'update', item: editingBlockedTime });
            setRecurringMode('this');
            return;
        }
        await saveBlockedTime('this');
    };

    const saveBlockedTime = async (mode) => {
        setSavingBlockedTime(true);
        try {
            if (editingBlockedTime) {
                await blockedTimeService.updateBlockedTime(editingBlockedTime._id, {
                    startTime: blockedTimeForm.startTime,
                    endTime: blockedTimeForm.endTime,
                    reason: blockedTimeForm.reason,
                    updateMode: mode,
                });
            } else {
                await blockedTimeService.createBlockedTime(blockedTimeForm);
            }
            await fetchBlockedTimes();
            closeBlockedTimeForm();
            setRecurringActionModal(null);
        } catch { }
        setSavingBlockedTime(false);
    };

    const handleDeleteBlockedTime = (item) => {
        if (item.isRecurring) {
            setRecurringActionModal({ action: 'delete', item });
            setRecurringMode('this');
        } else {
            doDeleteBlockedTime(item._id, 'this');
        }
    };

    const doDeleteBlockedTime = async (id, mode) => {
        try {
            await blockedTimeService.deleteBlockedTime(id, { deleteMode: mode });
            await fetchBlockedTimes();
            setRecurringActionModal(null);
        } catch { }
    };

    const confirmRecurringAction = () => {
        if (!recurringActionModal) return;
        if (recurringActionModal.action === 'update') {
            saveBlockedTime(recurringMode);
        } else {
            doDeleteBlockedTime(recurringActionModal.item._id, recurringMode);
        }
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

    const fetchClients = async () => {
        setLoadingClients(true);
        try {
            const res = await clientCRMService.getMyClients();
            setClients(res.data.data);
        } catch { /* ignore */ } finally { setLoadingClients(false); }
    };

    const fetchClientDetail = async (customerId) => {
        try {
            const res = await clientCRMService.getClientDetail(customerId);
            setClientDetail(res.data.data);
            const note = res.data.data.note;
            if (note) setClientNoteForm({ notes: note.notes || '', allergies: note.allergies || '', conditions: note.conditions || '', internalNotes: note.internalNotes || '', tags: (note.tags || []).join(', '), birthday: note.birthday || '' });
            else setClientNoteForm({ notes: '', allergies: '', conditions: '', internalNotes: '', tags: '', birthday: '' });
        } catch { /* ignore */ }
    };

    const saveClientNote = async () => {
        if (!selectedClient) return;
        setSavingClientNote(true);
        try {
            const payload = { ...clientNoteForm, tags: clientNoteForm.tags.split(',').map(t => t.trim()).filter(Boolean) };
            await clientCRMService.upsertClientNote(selectedClient.customer._id, payload);
        } catch { /* ignore */ } finally { setSavingClientNote(false); }
    };

    const fetchConversations = async () => {
        setLoadingConversations(true);
        try {
            const res = await messageService.getConversations();
            setConversations(res.data.data);
        } catch { /* ignore */ } finally { setLoadingConversations(false); }
    };

    const openConversation = async (conv) => {
        setSelectedConversation(conv);
        try {
            const res = await messageService.getMessages(conv.appointment._id);
            setConversationMessages(res.data.data);
        } catch { /* ignore */ }
    };

    const handleSendMessage = async () => {
        if (!newMessage.trim() || !selectedConversation) return;
        setSendingMessage(true);
        try {
            const res = await messageService.sendMessage(selectedConversation.appointment._id, newMessage.trim());
            setConversationMessages(prev => [...prev, res.data.data]);
            setNewMessage('');
        } catch { /* ignore */ } finally { setSendingMessage(false); }
    };

    const fetchMyPackages = async () => {
        setLoadingPackages(true);
        try {
            const res = await packageService.getMyPackages();
            setMyPackages(res.data.data);
        } catch { /* ignore */ } finally { setLoadingPackages(false); }
    };

    const handleCreatePackage = async () => {
        setSavingPackage(true);
        try {
            const res = await packageService.createPackage({ ...packageForm, totalSessions: Number(packageForm.totalSessions), price: Number(packageForm.price), validityDays: Number(packageForm.validityDays) });
            setMyPackages(prev => [res.data.data, ...prev]);
            setShowPackageForm(false);
            setPackageForm({ name: '', description: '', totalSessions: '', price: '', validityDays: '365' });
        } catch { /* ignore */ } finally { setSavingPackage(false); }
    };

    const togglePackageActive = async (pkg) => {
        try {
            const res = await packageService.updatePackage(pkg._id, { isActive: !pkg.isActive });
            setMyPackages(prev => prev.map(p => p._id === pkg._id ? res.data.data : p));
        } catch { /* ignore */ }
    };

    const fetchRetention = async () => {
        setLoadingRetention(true);
        try {
            const res = await retentionService.getRetentionMetrics();
            setRetentionData(res.data.data);
        } catch { /* ignore */ } finally { setLoadingRetention(false); }
    };

    const fetchTeam = async () => {
        setLoadingTeam(true);
        try {
            const res = await teamService.getMyTeam();
            setTeamMembers(res.data.data);
        } catch { /* ignore */ } finally { setLoadingTeam(false); }
    };

    const openAddMember = () => {
        setEditingMember(null);
        setTeamForm({ name: '', role: 'Staff', email: '', phone: '', color: '#c9a84c' });
        setShowTeamForm(true);
    };

    const openEditMember = (m) => {
        setEditingMember(m);
        setTeamForm({ name: m.name, role: m.role, email: m.email, phone: m.phone, color: m.color });
        setShowTeamForm(true);
    };

    const handleSaveMember = async () => {
        if (!teamForm.name.trim()) return;
        setSavingTeam(true);
        try {
            if (editingMember) {
                const res = await teamService.updateMember(editingMember._id, teamForm);
                setTeamMembers(prev => prev.map(m => m._id === editingMember._id ? res.data.data : m));
            } else {
                const res = await teamService.addMember(teamForm);
                setTeamMembers(prev => [...prev, res.data.data]);
            }
            setShowTeamForm(false);
        } catch { /* ignore */ } finally { setSavingTeam(false); }
    };

    const handleDeleteMember = async (id) => {
        try {
            await teamService.deleteMember(id);
            setTeamMembers(prev => prev.filter(m => m._id !== id));
        } catch { /* ignore */ }
    };

    const handleToggleMemberActive = async (m) => {
        try {
            const res = await teamService.updateMember(m._id, { isActive: !m.isActive });
            setTeamMembers(prev => prev.map(x => x._id === m._id ? res.data.data : x));
        } catch { /* ignore */ }
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

    const getDaysInMonth = (date) => {
        const year = date.getFullYear();
        const month = date.getMonth();
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const days = [];
        for (let i = 0; i < firstDay; i++) days.push(null);
        for (let i = 1; i <= daysInMonth; i++) days.push(i);
        return days;
    };

    const getAppointmentsForDay = (day) => {
        if (!day) return [];
        return appointments.filter(a => {
            const d = new Date(a.appointmentDate);
            return (
                d.getDate() === day &&
                d.getMonth() === currentDate.getMonth() &&
                d.getFullYear() === currentDate.getFullYear()
            );
        });
    };

    const getWeekDays = (date) => {
        const start = new Date(date);
        start.setDate(date.getDate() - date.getDay());
        return Array.from({ length: 7 }, (_, i) => {
            const d = new Date(start);
            d.setDate(start.getDate() + i);
            return d;
        });
    };

    const getAppointmentsForDate = (date) => {
        return appointments.filter(a => {
            const d = new Date(a.appointmentDate);
            return (
                d.getDate() === date.getDate() &&
                d.getMonth() === date.getMonth() &&
                d.getFullYear() === date.getFullYear()
            );
        });
    };

    const statusCalendarColors = {
        pending:   { bg: '#FAC775', text: '#633806' },
        confirmed: { bg: '#B5D4F4', text: '#0C447C' },
        completed: { bg: '#C0DD97', text: '#27500A' },
        cancelled: { bg: '#F7C1C1', text: '#791F1F' },
    };

    const isOutsideWorkingHours = (date, hour) => {
        if (!availability) return false;
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const daySchedule = availability[dayNames[date.getDay()]];
        if (!daySchedule || !daySchedule.enabled) return true;
        const slot = daySchedule.slots[0];
        if (!slot) return true;
        const startHour = parseInt(slot.start.split(':')[0]);
        const endHour = parseInt(slot.end.split(':')[0]);
        return hour < startHour || hour >= endHour;
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
            {showWizard && (
                <OnboardingWizard
                    user={user}
                    onComplete={(updatedUser) => {
                        setUser(updatedUser);
                        setShowWizard(false);
                    }}
                />
            )}

            {/* Header */}
            <div style={{ background: 'var(--charcoal)', paddingTop: '9rem', paddingBottom: '3rem', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(ellipse at 70% 40%, rgba(201,168,76,0.1) 0%, transparent 60%)', pointerEvents: 'none' }} />
                <div className="container" style={{ position: 'relative' }}>
                    <p style={{ color: 'var(--gold)', fontSize: '0.75rem', fontWeight: '600', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Your Bookings</p>
                    <h1 style={{ fontFamily: 'Inter, sans-serif', fontSize: 'clamp(2rem, 4vw, 3rem)', fontWeight: '700', color: 'white' }}>Provider Dashboard</h1>
                    <Link to="/account" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', marginTop: '1rem', color: 'rgba(255,255,255,0.7)', fontFamily: 'Inter, sans-serif', fontSize: '0.85rem', textDecoration: 'none', border: '1px solid rgba(255,255,255,0.2)', padding: '0.4rem 0.9rem', borderRadius: 'var(--radius-sm)', transition: 'all 0.2s' }}
                        onMouseEnter={e => e.currentTarget.style.color = 'white'}
                        onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.7)'}
                    >👤 My Account</Link>
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
                    {appointmentTabs.map(tab => (
                        <button key={tab} onClick={() => setActiveTab(tab)} style={{
                            padding: '0.75rem 1.5rem', background: 'none', border: 'none',
                            borderBottom: activeTab === tab ? '2px solid var(--gold)' : '2px solid transparent',
                            color: activeTab === tab ? 'var(--gold-dark)' : 'var(--text-muted)',
                            fontWeight: activeTab === tab ? '600' : '400', fontSize: '0.875rem',
                            cursor: 'pointer', fontFamily: 'Inter, sans-serif',
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
                        {['calendar', 'services', 'availability', 'earnings', 'clients', 'messages', 'memberships', 'team'].map(tab => (
                            <button key={tab} onClick={() => setActiveTab(tab)} style={{
                                padding: '0.75rem 1.5rem', background: 'none', border: 'none',
                                borderBottom: activeTab === tab ? '2px solid var(--gold)' : '2px solid transparent',
                                color: activeTab === tab ? 'var(--gold-dark)' : 'var(--text-muted)',
                                fontWeight: activeTab === tab ? '600' : '400', fontSize: '0.875rem',
                                cursor: 'pointer', fontFamily: 'Inter, sans-serif',
                                transition: 'all 0.2s', marginBottom: '-1px', whiteSpace: 'nowrap',
                            }}>
                                {tab === 'calendar' ? '📅 Calendar' : tab === 'availability' ? '🗓 Availability' : tab === 'services' ? '✂️ Catalogue' : tab === 'earnings' ? '💵 Earnings' : tab === 'clients' ? '👥 Clients' : tab === 'messages' ? '💬 Messages' : tab === 'memberships' ? '🪪 Memberships' : '👤 Team'}
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
                                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: '1.1rem', color: 'var(--charcoal)', marginBottom: '0.35rem' }}>No {activeTab} appointments</p>
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
                                                <p style={{ fontFamily: 'Inter, sans-serif', fontWeight: '600', color: 'var(--charcoal)' }}>{a.customer?.name}</p>
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
                                                <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>{a.startTime} - {a.endTime}</p>
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
                                                <span style={{ padding: '0.25rem 0.75rem', borderRadius: '99px', fontSize: '0.72rem', fontWeight: '600', background: s.bg, color: s.color, marginBottom: '0.5rem' }}>{s.label}</span>
                                                {a.status === 'pending' && (
                                                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                                        <button onClick={() => handleStatusUpdate(a._id, 'confirmed')} style={{ background: '#d1fae5', border: '1px solid #6ee7b7', color: '#065f46', padding: '0.4rem 0.875rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600', fontFamily: 'Inter, sans-serif' }}>Accept</button>
                                                        <button onClick={() => handleStatusUpdate(a._id, 'cancelled')} style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#ef4444', padding: '0.4rem 0.875rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600', fontFamily: 'Inter, sans-serif' }}>Decline</button>
                                                    </div>
                                                )}
                                                {a.status === 'confirmed' && (
                                                    <button onClick={() => handleStatusUpdate(a._id, 'completed')} style={{ background: '#dbeafe', border: '1px solid #93c5fd', color: '#1e40af', padding: '0.4rem 0.875rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600', fontFamily: 'Inter, sans-serif' }}>Mark Complete</button>
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
                                <h2 style={{ fontFamily: 'Inter, sans-serif', fontSize: '1.3rem', fontWeight: '600', color: 'var(--charcoal)' }}>Service menu</h2>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>View and manage the services offered by your business</p>
                            </div>
                            <button onClick={() => { setShowServiceForm(!showServiceForm); setEditingService(null); setServiceForm({ name: '', description: '', price: '', duration: '', location: '', address: '', category: '' }); }} className="btn-primary" style={{ padding: '0.65rem 1.25rem', fontSize: '0.875rem' }}>
                                {showServiceForm ? '✕ Cancel' : '+ Add Service'}
                            </button>
                        </div>

                        <div style={{ marginBottom: '1.5rem' }}>
                            <input value={catalogueSearch} onChange={e => setCatalogueSearch(e.target.value)} placeholder="🔍 Search service name" className="input" style={{ maxWidth: '360px' }} />
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
                                    <label style={labelStyle}>Price (NAD)</label>
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

                        <div className="catalogue-grid" style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: '1.5rem', alignItems: 'start' }}>
                            {(() => {
                                const catalogueFiltered = myServices.filter(s => !catalogueSearch || (s.name || '').toLowerCase().includes(catalogueSearch.toLowerCase()));
                                const servicesInCategory = (catId) => catalogueFiltered.filter(s => {
                                    const sCat = s.category?._id || s.category || null;
                                    return catId === 'featured' ? !sCat : sCat === catId;
                                });
                                const sidebarItems = [
                                    { id: 'all', name: 'All categories', count: catalogueFiltered.length },
                                    ...categories.map(c => ({ id: c._id, name: c.name, count: servicesInCategory(c._id).length })),
                                    { id: 'featured', name: 'Featured', count: servicesInCategory('featured').length },
                                ];
                                const groups = catalogueCategory === 'all'
                                    ? [...categories.map(c => ({ id: c._id, name: c.name })), { id: 'featured', name: 'Featured' }]
                                    : [{ id: catalogueCategory, name: catalogueCategory === 'featured' ? 'Featured' : (categories.find(c => c._id === catalogueCategory)?.name || 'Category') }];
                                return (
                                    <>
                                        {/* Categories sidebar */}
                                        <div style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.25rem' }}>
                                            <h3 style={{ fontFamily: 'Inter, sans-serif', fontSize: '1.05rem', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '1rem' }}>Categories</h3>
                                            {sidebarItems.map(item => {
                                                const active = catalogueCategory === item.id;
                                                return (
                                                    <div key={item.id} style={{ display: 'flex', alignItems: 'center', marginBottom: '0.25rem' }}>
                                                        <button onClick={() => setCatalogueCategory(item.id)} style={{
                                                            flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                            padding: '0.6rem 0.75rem', borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer', textAlign: 'left',
                                                            background: active ? 'rgba(201,168,76,0.1)' : 'transparent',
                                                            color: active ? 'var(--gold-dark)' : 'var(--text-secondary)',
                                                            fontWeight: active ? '600' : '400', fontFamily: 'Inter, sans-serif', fontSize: '0.875rem',
                                                        }}>
                                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                                                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginLeft: '0.5rem' }}>{item.count}</span>
                                                        </button>
                                                        {item.id !== 'all' && item.id !== 'featured' && (
                                                            <button onClick={() => handleDeleteCategory(item.id)} title="Delete category" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1rem', lineHeight: 1, padding: '0 0.25rem' }}>×</button>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                            <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
                                                {showCategoryForm ? (
                                                    <form onSubmit={handleAddCategory} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                        <input value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} placeholder="Category name" className="input" autoFocus />
                                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                            <button type="submit" className="btn-primary" style={{ flex: 1, padding: '0.5rem', fontSize: '0.8rem' }}>Add</button>
                                                            <button type="button" onClick={() => { setShowCategoryForm(false); setNewCategoryName(''); }} style={{ flex: 1, padding: '0.5rem', fontSize: '0.8rem', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', color: 'var(--text-secondary)', fontFamily: 'Inter, sans-serif' }}>Cancel</button>
                                                        </div>
                                                    </form>
                                                ) : (
                                                    <button onClick={() => setShowCategoryForm(true)} style={{ background: 'none', border: 'none', color: 'var(--gold-dark)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600', fontFamily: 'Inter, sans-serif', padding: 0 }}>+ Add category</button>
                                                )}
                                            </div>
                                        </div>

                                        {/* Services list grouped by category */}
                                        <div>
                                            {catalogueFiltered.length === 0 ? (
                                                <div style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '4rem 2rem', textAlign: 'center' }}>
                                                    <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>✂️</div>
                                                    <p style={{ fontFamily: 'Inter, sans-serif', fontSize: '1.1rem', color: 'var(--charcoal)', marginBottom: '0.35rem' }}>{catalogueSearch ? 'No services match your search' : 'No services yet'}</p>
                                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>{catalogueSearch ? 'Try a different name' : 'Add your first service to start receiving bookings'}</p>
                                                </div>
                                            ) : (
                                                groups.map(group => {
                                                    const svcs = servicesInCategory(group.id);
                                                    if (svcs.length === 0) return null;
                                                    return (
                                                        <div key={group.id} style={{ marginBottom: '1.5rem' }}>
                                                            <h3 style={{ fontFamily: 'Inter, sans-serif', fontSize: '1.1rem', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '0.75rem' }}>{group.name}</h3>
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                                                {svcs.map(s => (
                                                                    <div key={s._id} style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', borderLeft: '3px solid var(--gold)', padding: '1rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                                                                        <div style={{ minWidth: 0 }}>
                                                                            <p style={{ fontFamily: 'Inter, sans-serif', fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.95rem', marginBottom: '0.2rem' }}>{s.name}</p>
                                                                            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{s.duration} min{s.location ? ` · 📍 ${s.location}` : ''}</p>
                                                                        </div>
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
                                                                            <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: '700', color: 'var(--charcoal)', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>NAD {s.price}</span>
                                                                            <button onClick={() => handleEditService(s)} style={{ background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.3)', color: 'var(--gold-dark)', padding: '0.35rem 0.875rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600', fontFamily: 'Inter, sans-serif' }}>Edit</button>
                                                                            <button onClick={() => handleDeleteService(s._id)} style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#ef4444', padding: '0.35rem 0.875rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600', fontFamily: 'Inter, sans-serif' }}>Delete</button>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </>
                                );
                            })()}
                        </div>
                    </div>
                )}

                {/* Availability tab */}
                {activeTab === 'availability' && (
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                            <div>
                                <h2 style={{ fontFamily: 'Inter, sans-serif', fontSize: '1.3rem', fontWeight: '600', color: 'var(--charcoal)' }}>Working Hours</h2>
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

                        {/* Blocked Times section */}
                        <div style={{ marginTop: '2rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                <div>
                                    <h2 style={{ fontFamily: 'Inter, sans-serif', fontSize: '1.1rem', fontWeight: '600', color: 'var(--charcoal)' }}>Blocked Times</h2>
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.825rem', marginTop: '0.2rem' }}>Block off time when you're unavailable</p>
                                </div>
                                {!showBlockedTimeForm && (
                                    <button onClick={() => openBlockedTimeForm()} className="btn-outline" style={{ padding: '0.55rem 1.1rem', fontSize: '0.825rem' }}>+ Add blocked time</button>
                                )}
                            </div>

                            {/* Add / Edit form — now handled by the right-side slide-in panel (showBlockedTimeForm) */}

                            {/* Blocked times list */}
                            {blockedTimes.length === 0 ? (
                                <div style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '2rem', textAlign: 'center' }}>
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No blocked times yet. Add one to mark times when you're unavailable.</p>
                                </div>
                            ) : (
                                <div style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                                    {blockedTimes.map((bt, i) => (
                                        <div key={bt._id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.875rem 1.25rem', borderBottom: i < blockedTimes.length - 1 ? '1px solid var(--border)' : 'none', gap: '1rem' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', minWidth: 0 }}>
                                                <div style={{ width: '38px', height: '38px', borderRadius: '8px', background: 'rgba(201,168,76,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', flexShrink: 0 }}>🚫</div>
                                                <div style={{ minWidth: 0 }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                        <span style={{ fontWeight: '600', fontSize: '0.875rem', color: 'var(--charcoal)' }}>{bt.date}</span>
                                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{bt.startTime} - {bt.endTime}</span>
                                                        {bt.isRecurring && (
                                                            <span style={{ fontSize: '0.68rem', fontWeight: '600', padding: '0.1rem 0.5rem', borderRadius: '99px', background: 'rgba(99,102,241,0.1)', color: '#4f46e5' }}>🔁 {bt.recurrenceType}</span>
                                                        )}
                                                    </div>
                                                    {bt.reason && <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bt.reason}</p>}
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                                                <button onClick={() => openBlockedTimeForm(bt)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.3rem 0.7rem', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Edit</button>
                                                <button onClick={() => handleDeleteBlockedTime(bt)} style={{ background: 'none', border: '1px solid #fca5a5', borderRadius: 'var(--radius-sm)', padding: '0.3rem 0.7rem', cursor: 'pointer', fontSize: '0.78rem', color: '#dc2626' }}>Delete</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Earnings tab */}
                {activeTab === 'earnings' && (
                    <div>
                        <div style={{ marginBottom: '1.5rem' }}>
                            <h2 style={{ fontFamily: 'Inter, sans-serif', fontSize: '1.3rem', fontWeight: '600', color: 'var(--charcoal)' }}>Earnings Overview</h2>
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
                                                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: '1.5rem', fontWeight: '700', color: 'var(--charcoal)', lineHeight: 1 }}>{s.value}</p>
                                                {s.sub && <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{s.sub}</p>}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
                                    <div style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem' }}>
                                        <h3 style={{ fontFamily: 'Inter, sans-serif', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '1.25rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border)' }}>Earnings by Service</h3>
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
                                        <h3 style={{ fontFamily: 'Inter, sans-serif', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '1.25rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border)' }}>Monthly Comparison</h3>
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
                                        <h3 style={{ fontFamily: 'Inter, sans-serif', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)' }}>Recent Transactions</h3>
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

                {/* Calendar tab */}
                {/* Calendar tab */}
                {activeTab === 'calendar' && (() => {
                    const ROW_H = 64;
                    const START_H = 7;
                    const END_H = 23;
                    const NUM_H = END_H - START_H;
                    const TOTAL_H = NUM_H * ROW_H;
                    const nowTs = new Date();
                    const fmtHour = (h) => h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h - 12} PM`;

                    const calCols = [
                        { id: 'me', name: (user?.name || 'Me').split(' ')[0], avatar: user?.avatar, color: '#c9a84c' },
                        ...teamMembers.filter(m => m.isActive !== false),
                    ];

                    const get3Days = (d) => [0,1,2].map(i => { const x = new Date(d); x.setDate(d.getDate()+i); return x; });

                    const fmtToolbar = () => {
                        if (calendarView === 'month') return currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                        if (calendarView === 'week') { const wd = getWeekDays(currentDate); return `${wd[0].toLocaleDateString('en-US',{month:'short',day:'numeric'})} \u2013 ${wd[6].toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`; }
                        if (calendarView === '3day') { const d3 = get3Days(currentDate); return `${d3[0].toLocaleDateString('en-US',{month:'short',day:'numeric'})} \u2013 ${d3[2].toLocaleDateString('en-US',{month:'short',day:'numeric'})}`; }
                        if (calendarView === 'google') return 'Google Calendar';
                        return currentDate.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short' });
                    };

                    const handlePrev = () => { const d = new Date(currentDate); if (calendarView==='month') d.setMonth(d.getMonth()-1); else if (calendarView==='week') d.setDate(d.getDate()-7); else if (calendarView==='3day') d.setDate(d.getDate()-3); else d.setDate(d.getDate()-1); setCurrentDate(d); setSelectedDay(null); };
                    const handleNext = () => { const d = new Date(currentDate); if (calendarView==='month') d.setMonth(d.getMonth()+1); else if (calendarView==='week') d.setDate(d.getDate()+7); else if (calendarView==='3day') d.setDate(d.getDate()+3); else d.setDate(d.getDate()+1); setCurrentDate(d); setSelectedDay(null); };

                    const viewLabels = { day: 'Day', '3day': '3 Day', week: 'Week', month: 'Month', google: '\uD83D\uDCC5 Google' };
                    const btnBase = { border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', background: 'white', fontFamily: 'Outfit, sans-serif', color: 'var(--charcoal)' };

                    // Convert "HH:MM" to pixel offset from START_H
                    const timeToY = (t) => { const [h,m] = t.split(':').map(Number); return (h - START_H) * ROW_H + (m / 60) * ROW_H; };
                    // Convert start/end time to pixel height (min 24px)
                    const durationPx = (s, e) => { const [sh,sm]=s.split(':').map(Number); const [eh,em]=e.split(':').map(Number); return Math.max(((eh*60+em)-(sh*60+sm))/60*ROW_H, 24); };

                    const dateToStr = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

                    const getBlockedForDate = (date) => {
                        const ds = dateToStr(date);
                        return blockedTimes.filter(b => b.date ? String(b.date).substring(0,10) === ds : false);
                    };

                    const handleSlotClick = (e, date) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const y = e.clientY - rect.top;
                        const rawMins = Math.round((y / ROW_H) * 60 / 15) * 15;
                        const totalMins = START_H * 60 + rawMins;
                        const pad = n => String(n).padStart(2,'0');
                        const sH = Math.min(Math.floor(totalMins/60), END_H - 1);
                        const sM = totalMins % 60;
                        const eH = Math.min(sH + 1, END_H);
                        openBlockedTimeForm(null);
                        setBlockedTimeForm(prev => ({ ...prev, date: dateToStr(date), startTime: `${pad(sH)}:${pad(sM)}`, endTime: `${pad(eH)}:${pad(sM)}` }));
                    };

                    // Renders the absolute-positioned content of a single time column
                    const renderCol = (date, appts, blocked, isNow) => (
                        <div style={{ position: 'relative', height: `${TOTAL_H}px`, cursor: 'crosshair' }}
                            onClick={(e) => handleSlotClick(e, date)}>
                            {/* Hour grid lines */}
                            {Array.from({ length: NUM_H }, (_,i) => (
                                <div key={i} style={{ position:'absolute', left:0, right:0, top:`${i*ROW_H}px`, height:`${ROW_H}px`, borderBottom:'1px solid var(--border)', pointerEvents:'none',
                                    background: isOutsideWorkingHours(date, i+START_H) ? 'repeating-linear-gradient(45deg,rgba(0,0,0,0.022),rgba(0,0,0,0.022) 4px,transparent 4px,transparent 8px)' : 'transparent' }} />
                            ))}
                            {/* 30-min half-lines */}
                            {Array.from({ length: NUM_H }, (_,i) => (
                                <div key={`hf${i}`} style={{ position:'absolute', left:0, right:0, top:`${i*ROW_H + ROW_H/2}px`, height:'1px', background:'rgba(0,0,0,0.04)', pointerEvents:'none' }} />
                            ))}
                            {/* Blocked times — hatched grey bars */}
                            {blocked.map((b,bi) => (
                                <div key={`b${bi}`} onClick={(e) => { e.stopPropagation(); openBlockedTimeForm(b); }}
                                    style={{ position:'absolute', left:'3px', right:'3px', zIndex:3, borderRadius:'4px', overflow:'hidden', cursor:'pointer', boxSizing:'border-box',
                                        top:`${timeToY(b.startTime)}px`, height:`${durationPx(b.startTime, b.endTime)}px`,
                                        background:'repeating-linear-gradient(45deg,rgba(100,100,100,0.07),rgba(100,100,100,0.07) 4px,white 4px,white 8px)',
                                        border:'1px solid #d1d5db', display:'flex', alignItems:'center', padding:'2px 6px', gap:'4px' }}>
                                    <span style={{ fontSize:'0.7rem' }}>\uD83D\uDEAB</span>
                                    <span style={{ fontSize:'0.7rem', color:'#6b7280', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{b.reason || b.title || 'Blocked'}</span>
                                </div>
                            ))}
                            {/* Appointment blocks — sized by duration */}
                            {appts.filter(a => a.startTime && a.endTime).map((a,ai) => {
                                const c = statusCalendarColors[a.status] || statusCalendarColors.pending;
                                const top = timeToY(a.startTime);
                                const h = durationPx(a.startTime, a.endTime);
                                return (
                                    <div key={`a${ai}`} onClick={(e) => e.stopPropagation()}
                                        style={{ position:'absolute', left:'3px', right:'3px', zIndex:4, borderRadius:'5px', overflow:'hidden', cursor:'pointer', boxSizing:'border-box',
                                            top:`${top}px`, height:`${h}px`, background:c.bg, color:c.text,
                                            borderLeft:`3px solid ${c.text}`, padding:'3px 6px', boxShadow:'0 1px 3px rgba(0,0,0,0.1)' }}>
                                        <div style={{ fontWeight:'700', fontSize:'0.75rem', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{a.customer?.name}</div>
                                        {h > 30 && <div style={{ fontSize:'0.68rem', opacity:0.85, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{a.service?.name}</div>}
                                        {h > 46 && <div style={{ fontSize:'0.65rem', opacity:0.7 }}>{a.startTime} \u2013 {a.endTime}</div>}
                                    </div>
                                );
                            })}
                            {/* Current time red line */}
                            {isNow && (() => {
                                const y = (nowTs.getHours()-START_H)*ROW_H + (nowTs.getMinutes()/60)*ROW_H;
                                return (y >= 0 && y <= TOTAL_H) ? (
                                    <div style={{ position:'absolute', left:0, right:0, top:`${y}px`, height:'2px', background:'#e53e3e', zIndex:6, pointerEvents:'none' }}>
                                        <div style={{ position:'absolute', left:'-5px', top:'-4px', width:'10px', height:'10px', borderRadius:'50%', background:'#e53e3e' }} />
                                    </div>
                                ) : null;
                            })()}
                        </div>
                    );

                    return (
                    <div onClick={() => { if (viewMenuOpen) setViewMenuOpen(false); if (addMenuOpen) setAddMenuOpen(false); }}>
                        {/* ── Fresha-style Toolbar ── */}
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem', flexWrap:'wrap', gap:'0.5rem' }}>
                            <div style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}>
                                <button onClick={e=>{e.stopPropagation();setCurrentDate(new Date());setSelectedDay(null);}} style={{...btnBase,padding:'0.45rem 0.9rem',fontSize:'0.82rem',fontWeight:'500',color:'var(--text-secondary)'}}>Today</button>
                                <button onClick={e=>{e.stopPropagation();handlePrev();}} style={{...btnBase,padding:'0.45rem 0.7rem',fontSize:'1.1rem',lineHeight:1}}>\u2039</button>
                                <span style={{fontFamily:'Outfit, sans-serif',fontSize:'0.9rem',fontWeight:'600',color:'var(--charcoal)',minWidth:'165px',textAlign:'center'}}>{fmtToolbar()}</span>
                                <button onClick={e=>{e.stopPropagation();handleNext();}} style={{...btnBase,padding:'0.45rem 0.7rem',fontSize:'1.1rem',lineHeight:1}}>\u203A</button>
                            </div>
                            <div style={{ display:'flex', gap:'0.5rem', alignItems:'center' }}>
                                {/* View dropdown */}
                                <div style={{ position:'relative' }} onClick={e=>e.stopPropagation()}>
                                    <button onClick={()=>{setViewMenuOpen(o=>!o);setAddMenuOpen(false);}} style={{...btnBase,padding:'0.45rem 0.85rem',fontSize:'0.82rem',fontWeight:'500',display:'flex',alignItems:'center',gap:'0.35rem'}}>
                                        <span>{viewLabels[calendarView]||'Day'}</span>
                                        <span style={{fontSize:'0.6rem',opacity:0.6}}>\u25be</span>
                                    </button>
                                    {viewMenuOpen && (
                                        <div style={{position:'absolute',top:'calc(100% + 4px)',right:0,background:'white',border:'1px solid var(--border)',borderRadius:'var(--radius-sm)',boxShadow:'var(--shadow-md)',zIndex:200,minWidth:'140px',overflow:'hidden'}}>
                                            {Object.entries(viewLabels).map(([v,l])=>(
                                                <button key={v} onClick={()=>{setCalendarView(v);setSelectedDay(null);setViewMenuOpen(false);}} style={{width:'100%',textAlign:'left',padding:'0.6rem 1rem',border:'none',borderBottom:'1px solid var(--border)',background:calendarView===v?'rgba(201,168,76,0.07)':'white',color:calendarView===v?'var(--gold-dark)':'var(--charcoal)',fontWeight:calendarView===v?'600':'400',fontSize:'0.85rem',cursor:'pointer',fontFamily:'Outfit, sans-serif'}}>{l}</button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                {/* + Add dropdown */}
                                <div style={{ position:'relative' }} onClick={e=>e.stopPropagation()}>
                                    <button onClick={()=>{setAddMenuOpen(o=>!o);setViewMenuOpen(false);}} style={{border:'none',borderRadius:'var(--radius-sm)',padding:'0.45rem 1rem',cursor:'pointer',background:'var(--charcoal)',color:'white',fontSize:'0.82rem',fontFamily:'Outfit, sans-serif',fontWeight:'600',display:'flex',alignItems:'center',gap:'0.35rem'}}>
                                        <span>+ Add</span>
                                        <span style={{fontSize:'0.6rem',opacity:0.75}}>\u25be</span>
                                    </button>
                                    {addMenuOpen && (
                                        <div style={{position:'absolute',top:'calc(100% + 4px)',right:0,background:'white',border:'1px solid var(--border)',borderRadius:'var(--radius-sm)',boxShadow:'var(--shadow-md)',zIndex:200,minWidth:'190px',overflow:'hidden'}}>
                                            {[['\uD83D\uDCC5','Appointment','pending'],['\uD83D\uDEAB','Blocked time','block']].map(([icon,label,key])=>(
                                                <button key={label} onClick={()=>{setAddMenuOpen(false);if(key==='block'){openBlockedTimeForm(null);}else{setActiveTab(key);}}} style={{width:'100%',textAlign:'left',padding:'0.7rem 1rem',border:'none',borderBottom:'1px solid var(--border)',background:'white',color:'var(--charcoal)',fontSize:'0.85rem',cursor:'pointer',fontFamily:'Outfit, sans-serif',display:'flex',alignItems:'center',gap:'0.5rem'}}>
                                                    <span>{icon}</span><span>{label}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* ── Month view ── */}
                        {calendarView === 'month' && (
                            <div style={{ display:'grid', gridTemplateColumns:selectedDay!==null?'1fr 300px':'1fr', gap:'1.5rem', alignItems:'start' }}>
                                <div style={{ background:'white', borderRadius:'var(--radius)', border:'1px solid var(--border)', boxShadow:'var(--shadow-sm)', overflow:'hidden' }}>
                                    <div style={{ display:'grid', gridTemplateColumns:'repeat(7, 1fr)', borderBottom:'1px solid var(--border)', background:'var(--warm-gray)' }}>
                                        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>(
                                            <div key={d} style={{ padding:'0.6rem', textAlign:'center', fontSize:'0.72rem', fontWeight:'600', color:'var(--text-muted)', letterSpacing:'0.08em', textTransform:'uppercase' }}>{d}</div>
                                        ))}
                                    </div>
                                    <div style={{ display:'grid', gridTemplateColumns:'repeat(7, 1fr)' }}>
                                        {getDaysInMonth(currentDate).map((day,i) => {
                                            const dayAppts = getAppointmentsForDay(day);
                                            const today = new Date();
                                            const isToday = day && today.getDate()===day && today.getMonth()===currentDate.getMonth() && today.getFullYear()===currentDate.getFullYear();
                                            const isSelected = selectedDay===day;
                                            return (
                                                <div key={i} onClick={()=>day&&setSelectedDay(isSelected?null:day)} style={{ minHeight:'90px', padding:'6px', borderRight:'1px solid var(--border)', borderBottom:'1px solid var(--border)', background:isSelected?'rgba(201,168,76,0.06)':day?'white':'var(--warm-gray)', cursor:day?'pointer':'default', transition:'background 0.15s' }} onMouseEnter={e=>{if(day&&!isSelected)e.currentTarget.style.background='var(--warm-gray)';}} onMouseLeave={e=>{if(day&&!isSelected)e.currentTarget.style.background='white';}}>
                                                    {day && (
                                                        <>
                                                            <div style={{ width:'24px', height:'24px', borderRadius:'50%', background:isToday?'var(--gold)':'transparent', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.78rem', fontWeight:isToday?'700':'400', color:isToday?'var(--charcoal)':'var(--text-secondary)', marginBottom:'4px' }}>{day}</div>
                                                            {dayAppts.slice(0,2).map((a,j)=>{ const c=statusCalendarColors[a.status]||statusCalendarColors.pending; return (<div key={j} style={{ fontSize:'0.68rem', padding:'1px 5px', borderRadius:'3px', marginBottom:'2px', background:c.bg, color:c.text, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{a.startTime} {a.service?.name}</div>); })}
                                                            {dayAppts.length>2 && <div style={{ fontSize:'0.65rem', color:'var(--text-muted)', padding:'1px 5px' }}>+{dayAppts.length-2} more</div>}
                                                        </>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                                {selectedDay !== null && (
                                    <div style={{ background:'white', borderRadius:'var(--radius)', border:'1px solid var(--border)', boxShadow:'var(--shadow-sm)', overflow:'hidden', position:'sticky', top:'100px' }}>
                                        <div style={{ padding:'1rem 1.25rem', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                                            <h3 style={{ fontFamily:'Outfit, sans-serif', fontSize:'1rem', fontWeight:'600', color:'var(--charcoal)', margin:0 }}>{new Date(currentDate.getFullYear(),currentDate.getMonth(),selectedDay).toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'})}</h3>
                                            <button onClick={()=>setSelectedDay(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', fontSize:'1.2rem', lineHeight:1, padding:0 }}>\u00d7</button>
                                        </div>
                                        <div style={{ padding:'1rem' }}>
                                            {getAppointmentsForDay(selectedDay).length===0 ? (
                                                <p style={{ color:'var(--text-muted)', fontSize:'0.875rem', textAlign:'center', padding:'1rem 0' }}>No appointments this day</p>
                                            ) : (
                                                <div style={{ display:'flex', flexDirection:'column', gap:'0.75rem' }}>
                                                    {getAppointmentsForDay(selectedDay).sort((a,b)=>a.startTime?.localeCompare(b.startTime)).map((a,i)=>{
                                                        const c=statusCalendarColors[a.status]||statusCalendarColors.pending;
                                                        return (
                                                            <div key={i} style={{ borderLeft:`3px solid ${c.bg}`, paddingLeft:'0.75rem', paddingTop:'0.25rem', paddingBottom:'0.25rem' }}>
                                                                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                                                                    <div>
                                                                        <p style={{ fontWeight:'600', color:'var(--charcoal)', fontSize:'0.875rem', margin:'0 0 0.15rem' }}>{a.service?.name}</p>
                                                                        <p style={{ color:'var(--text-muted)', fontSize:'0.78rem', margin:'0 0 0.15rem' }}>{a.customer?.name}</p>
                                                                        <p style={{ color:'var(--text-muted)', fontSize:'0.75rem', margin:0 }}>{a.startTime} \u2013 {a.endTime}</p>
                                                                    </div>
                                                                    <span style={{ fontSize:'0.7rem', fontWeight:'600', padding:'0.15rem 0.5rem', borderRadius:'99px', background:c.bg, color:c.text, whiteSpace:'nowrap' }}>{a.status}</span>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── Day view \u2014 Fresha team columns ── */}
                        {calendarView === 'day' && (
                            <div style={{ background:'white', borderRadius:'var(--radius)', border:'1px solid var(--border)', boxShadow:'var(--shadow-sm)', overflow:'auto' }}>
                                {/* Column headers */}
                                <div style={{ display:'grid', gridTemplateColumns:`64px repeat(${calCols.length}, minmax(160px,1fr))`, borderBottom:'2px solid var(--border)', background:'var(--warm-gray)', position:'sticky', top:0, zIndex:10 }}>
                                    <div style={{ borderRight:'1px solid var(--border)', padding:'0.5rem 0.5rem', display:'flex', alignItems:'flex-end' }}>
                                        <span style={{ fontSize:'0.62rem', color:'var(--text-muted)' }}>GMT+2</span>
                                    </div>
                                    {calCols.map((col,ci) => {
                                        const isToday = currentDate.toDateString()===nowTs.toDateString();
                                        return (
                                            <div key={ci} style={{ padding:'0.75rem 0.5rem', textAlign:'center', borderLeft:'1px solid var(--border)', display:'flex', flexDirection:'column', alignItems:'center', gap:'0.35rem' }}>
                                                <div style={{ width:'36px', height:'36px', borderRadius:'50%', background:col.avatar?'transparent':(col.color||'#c9a84c'), display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden', border:isToday&&ci===0?`2px solid ${col.color||'#c9a84c'}`:'2px solid transparent' }}>
                                                    {col.avatar?<img src={col.avatar} alt={col.name} style={{width:'100%',height:'100%',objectFit:'cover'}}/>:<span style={{color:'white',fontWeight:'700',fontSize:'0.85rem'}}>{(col.name||'?')[0]}</span>}
                                                </div>
                                                <span style={{ fontSize:'0.78rem', fontWeight:'600', color:'var(--charcoal)' }}>{col.name}</span>
                                                {ci===0 && <span style={{ fontSize:'0.65rem', color:'var(--text-muted)' }}>{getAppointmentsForDate(currentDate).length} appts</span>}
                                            </div>
                                        );
                                    })}
                                </div>
                                {/* Time grid body */}
                                <div style={{ display:'grid', gridTemplateColumns:`64px repeat(${calCols.length}, minmax(160px,1fr))` }}>
                                    {/* Hour labels */}
                                    <div style={{ background:'var(--warm-gray)', borderRight:'1px solid var(--border)' }}>
                                        {Array.from({length:NUM_H},(_,i)=>(
                                            <div key={i} style={{ height:`${ROW_H}px`, padding:'5px 8px', fontSize:'0.68rem', color:'var(--text-muted)', borderBottom:'1px solid var(--border)', boxSizing:'border-box' }}>{fmtHour(i+START_H)}</div>
                                        ))}
                                    </div>
                                    {/* Staff columns */}
                                    {calCols.map((col,ci) => (
                                        <div key={ci} style={{ borderLeft:'1px solid var(--border)' }}>
                                            {renderCol(
                                                currentDate,
                                                ci === 0 ? getAppointmentsForDate(currentDate) : [],
                                                ci === 0 ? getBlockedForDate(currentDate) : [],
                                                currentDate.toDateString()===nowTs.toDateString() && ci===0
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ── 3-Day view ── */}
                        {calendarView === '3day' && (() => {
                            const days3 = get3Days(currentDate);
                            return (
                                <div style={{ background:'white', borderRadius:'var(--radius)', border:'1px solid var(--border)', boxShadow:'var(--shadow-sm)', overflow:'auto' }}>
                                    <div style={{ display:'grid', gridTemplateColumns:'64px repeat(3, 1fr)', borderBottom:'2px solid var(--border)', background:'var(--warm-gray)', position:'sticky', top:0, zIndex:10 }}>
                                        <div style={{ borderRight:'1px solid var(--border)', padding:'0.5rem', display:'flex', alignItems:'flex-end' }}>
                                            <span style={{ fontSize:'0.62rem', color:'var(--text-muted)' }}>GMT+2</span>
                                        </div>
                                        {days3.map((d,i)=>{
                                            const isToday=d.toDateString()===nowTs.toDateString();
                                            return (
                                                <div key={i} style={{ padding:'0.6rem', textAlign:'center', borderLeft:'1px solid var(--border)' }}>
                                                    <div style={{ fontSize:'0.7rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em' }}>{d.toLocaleDateString('en-US',{weekday:'short'})}</div>
                                                    <div style={{ width:'32px', height:'32px', borderRadius:'50%', background:isToday?'var(--gold)':'transparent', display:'flex', alignItems:'center', justifyContent:'center', margin:'4px auto 0', fontSize:'0.9rem', fontWeight:isToday?'700':'400', color:isToday?'var(--charcoal)':'var(--text-secondary)' }}>{d.getDate()}</div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <div style={{ display:'grid', gridTemplateColumns:'64px repeat(3, 1fr)' }}>
                                        <div style={{ background:'var(--warm-gray)', borderRight:'1px solid var(--border)' }}>
                                            {Array.from({length:NUM_H},(_,i)=>(
                                                <div key={i} style={{ height:`${ROW_H}px`, padding:'5px 8px', fontSize:'0.68rem', color:'var(--text-muted)', borderBottom:'1px solid var(--border)', boxSizing:'border-box' }}>{fmtHour(i+START_H)}</div>
                                            ))}
                                        </div>
                                        {days3.map((d,di)=>(
                                            <div key={di} style={{ borderLeft:'1px solid var(--border)' }}>
                                                {renderCol(d, getAppointmentsForDate(d), getBlockedForDate(d), d.toDateString()===nowTs.toDateString())}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })()}

                        {/* ── Week view ── */}
                        {calendarView === 'week' && (() => {
                            const wdays = getWeekDays(currentDate);
                            return (
                                <div style={{ background:'white', borderRadius:'var(--radius)', border:'1px solid var(--border)', boxShadow:'var(--shadow-sm)', overflow:'auto' }}>
                                    <div style={{ display:'grid', gridTemplateColumns:'64px repeat(7, 1fr)', borderBottom:'2px solid var(--border)', background:'var(--warm-gray)', position:'sticky', top:0, zIndex:10 }}>
                                        <div style={{ borderRight:'1px solid var(--border)', padding:'0.5rem', display:'flex', alignItems:'flex-end' }}>
                                            <span style={{ fontSize:'0.62rem', color:'var(--text-muted)' }}>GMT+2</span>
                                        </div>
                                        {wdays.map((d,i)=>{
                                            const isToday=d.toDateString()===nowTs.toDateString();
                                            return (
                                                <div key={i} style={{ padding:'0.6rem', textAlign:'center', borderLeft:'1px solid var(--border)' }}>
                                                    <div style={{ fontSize:'0.7rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em' }}>{d.toLocaleDateString('en-US',{weekday:'short'})}</div>
                                                    <div style={{ width:'28px', height:'28px', borderRadius:'50%', background:isToday?'var(--gold)':'transparent', display:'flex', alignItems:'center', justifyContent:'center', margin:'3px auto 0', fontSize:'0.85rem', fontWeight:isToday?'700':'400', color:isToday?'var(--charcoal)':'var(--text-secondary)' }}>{d.getDate()}</div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <div style={{ display:'grid', gridTemplateColumns:'64px repeat(7, 1fr)' }}>
                                        <div style={{ background:'var(--warm-gray)', borderRight:'1px solid var(--border)' }}>
                                            {Array.from({length:NUM_H},(_,i)=>(
                                                <div key={i} style={{ height:`${ROW_H}px`, padding:'5px 8px', fontSize:'0.68rem', color:'var(--text-muted)', borderBottom:'1px solid var(--border)', boxSizing:'border-box' }}>{fmtHour(i+START_H)}</div>
                                            ))}
                                        </div>
                                        {wdays.map((d,di)=>(
                                            <div key={di} style={{ borderLeft:'1px solid var(--border)' }}>
                                                {renderCol(d, getAppointmentsForDate(d), getBlockedForDate(d), d.toDateString()===nowTs.toDateString())}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })()}

                        {/* ── Google Calendar view ── */}
                        {calendarView === 'google' && (
                            <div>
                                {user?.googleCalendarEmbedUrl ? (
                                    <div style={{ borderRadius:'var(--radius)', overflow:'hidden', border:'1px solid var(--border)', boxShadow:'var(--shadow-sm)' }}>
                                        <iframe src={user.googleCalendarEmbedUrl} style={{ width:'100%', height:'700px', border:'none', display:'block' }} title="Google Calendar" />
                                    </div>
                                ) : (
                                    <div style={{ background:'white', borderRadius:'var(--radius)', border:'1px solid var(--border)', boxShadow:'var(--shadow-sm)', padding:'5rem 2rem', textAlign:'center' }}>
                                        <div style={{ fontSize:'2.5rem', marginBottom:'0.75rem' }}>\uD83D\uDCC5</div>
                                        <p style={{ fontFamily:'Cormorant Garamond, serif', fontSize:'1.2rem', fontWeight:'700', color:'var(--charcoal)', marginBottom:'0.5rem' }}>Google Calendar not connected</p>
                                        <p style={{ color:'var(--text-muted)', fontSize:'0.875rem', maxWidth:'400px', margin:'0 auto 1.25rem' }}>Go to <strong>My Account \u2192 Personal settings \u2192 Google Calendar</strong> and paste your embed URL.</p>
                                        <Link to="/account" className="btn-primary" style={{ padding:'0.65rem 1.5rem', fontSize:'0.875rem', textDecoration:'none', display:'inline-block' }}>Go to Account settings</Link>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    );
                })()}

            {/* Clients tab */}
            {activeTab === 'clients' && (
                <div style={{ display: 'grid', gridTemplateColumns: selectedClient ? '1fr 380px' : '1fr', gap: '1.5rem', alignItems: 'start' }}>
                    <div style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1.3rem', fontWeight: '600', color: 'var(--charcoal)', margin: 0 }}>My Clients</h2>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{clients.length} total</span>
                        </div>
                        {loadingClients ? <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div> : (
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                                    <thead>
                                        <tr style={{ background: 'var(--warm-gray)', textAlign: 'left' }}>
                                            {['Client', 'Total Visits', 'Last Visit', 'Total Spend', ''].map(h => (
                                                <th key={h} style={{ padding: '0.75rem 1rem', fontWeight: '600', color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {clients.map((c, i) => (
                                            <tr key={i} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.1s' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--warm-gray)'} onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                                                <td style={{ padding: '0.875rem 1rem' }}>
                                                    <div style={{ fontWeight: '600', color: 'var(--charcoal)' }}>{c.customer?.name}</div>
                                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{c.customer?.email}</div>
                                                </td>
                                                <td style={{ padding: '0.875rem 1rem', color: 'var(--charcoal)', fontWeight: '500' }}>{c.visits}</td>
                                                <td style={{ padding: '0.875rem 1rem', color: 'var(--text-secondary)' }}>{c.lastVisit ? new Date(c.lastVisit).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                                                <td style={{ padding: '0.875rem 1rem', color: 'var(--gold-dark)', fontWeight: '600' }}>${c.totalSpend.toFixed(2)}</td>
                                                <td style={{ padding: '0.875rem 1rem' }}>
                                                    <button onClick={() => { setSelectedClient(c); fetchClientDetail(c.customer._id); }} style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.3)', color: 'var(--gold-dark)', padding: '0.3rem 0.75rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.78rem', fontWeight: '600' }}>View</button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {clients.length === 0 && <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>No clients yet. Clients will appear here once they book with you.</div>}
                            </div>
                        )}
                    </div>
                    {selectedClient && clientDetail && (
                        <div style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', position: 'sticky', top: '100px' }}>
                            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)', margin: 0 }}>{selectedClient.customer?.name}</h3>
                                <button onClick={() => { setSelectedClient(null); setClientDetail(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.2rem' }}>×</button>
                            </div>
                            <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '70vh', overflowY: 'auto' }}>
                                <div>
                                    <p style={{ fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Visit History</p>
                                    {clientDetail.appointments?.slice(0, 5).map((a, i) => (
                                        <div key={i} style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.82rem' }}>
                                            <div style={{ fontWeight: '600', color: 'var(--charcoal)' }}>{a.service?.name}</div>
                                            <div style={{ color: 'var(--text-muted)' }}>{new Date(a.appointmentDate).toLocaleDateString()} · {a.startTime} · ${a.totalPrice}</div>
                                            <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '4px', background: '#f3f4f6', color: 'var(--text-muted)' }}>{a.status}</span>
                                        </div>
                                    ))}
                                </div>
                                <div>
                                    <p style={{ fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Client Notes</p>
                                    {[['Notes', 'notes'], ['Allergies', 'allergies'], ['Conditions', 'conditions'], ['Internal Notes', 'internalNotes']].map(([label, key]) => (
                                        <div key={key} style={{ marginBottom: '0.75rem' }}>
                                            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>{label}</label>
                                            <textarea rows={2} value={clientNoteForm[key]} onChange={e => setClientNoteForm(prev => ({ ...prev, [key]: e.target.value }))} className="input" style={{ fontSize: '0.82rem', resize: 'none' }} />
                                        </div>
                                    ))}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.75rem' }}>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Tags (comma-separated)</label>
                                            <input value={clientNoteForm.tags} onChange={e => setClientNoteForm(prev => ({ ...prev, tags: e.target.value }))} className="input" style={{ fontSize: '0.82rem' }} placeholder="vip, regular" />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Birthday (MM-DD)</label>
                                            <input value={clientNoteForm.birthday} onChange={e => setClientNoteForm(prev => ({ ...prev, birthday: e.target.value }))} className="input" style={{ fontSize: '0.82rem' }} placeholder="03-15" />
                                        </div>
                                    </div>
                                    <button onClick={saveClientNote} disabled={savingClientNote} className="btn-primary" style={{ width: '100%', padding: '0.65rem', fontSize: '0.85rem' }}>
                                        {savingClientNote ? 'Saving...' : 'Save Notes'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Messages tab */}
            {activeTab === 'messages' && (
                <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '1.5rem', minHeight: '500px' }}>
                    <div style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
                            <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)', margin: 0 }}>Conversations</h3>
                        </div>
                        {loadingConversations ? <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div> : (
                            <div>
                                {conversations.length === 0 && <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>No messages yet</div>}
                                {conversations.map((conv, i) => (
                                    <div key={i} onClick={() => openConversation(conv)} style={{ padding: '0.875rem 1.25rem', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: selectedConversation?.appointment?._id === conv.appointment?._id ? 'rgba(201,168,76,0.06)' : 'white', transition: 'background 0.1s' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                            <span style={{ fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.875rem' }}>{conv.appointment?.customer?.name || conv.lastMessage?.sender?.name}</span>
                                            {conv.unread > 0 && <span style={{ background: 'var(--gold)', color: 'var(--charcoal)', fontSize: '0.68rem', fontWeight: '700', padding: '0.1rem 0.45rem', borderRadius: '99px' }}>{conv.unread}</span>}
                                        </div>
                                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conv.lastMessage?.content}</div>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>{conv.appointment?.service?.name}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    <div style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column' }}>
                        {!selectedConversation ? (
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>Select a conversation</div>
                        ) : (
                            <>
                                <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--border)' }}>
                                    <span style={{ fontWeight: '600', color: 'var(--charcoal)' }}>{selectedConversation.appointment?.customer?.name}</span>
                                    <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginLeft: '0.5rem' }}>· {selectedConversation.appointment?.service?.name}</span>
                                </div>
                                <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', minHeight: '300px', maxHeight: '420px' }}>
                                    {conversationMessages.map((msg, i) => {
                                        const isMe = msg.sender?._id === selectedConversation.appointment?.provider?._id || msg.sender?.name === selectedConversation.appointment?.provider?.name;
                                        return (
                                            <div key={i} style={{ display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
                                                <div style={{ maxWidth: '70%', padding: '0.5rem 0.875rem', borderRadius: '12px', background: isMe ? 'var(--gold)' : 'var(--warm-gray)', color: isMe ? 'var(--charcoal)' : 'var(--charcoal)', fontSize: '0.875rem' }}>
                                                    {msg.content}
                                                    <div style={{ fontSize: '0.65rem', color: isMe ? 'rgba(26,26,46,0.6)' : 'var(--text-muted)', marginTop: '0.25rem', textAlign: 'right' }}>
                                                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border)', display: 'flex', gap: '0.75rem' }}>
                                    <input value={newMessage} onChange={e => setNewMessage(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSendMessage()} placeholder="Type a message..." className="input" style={{ flex: 1 }} />
                                    <button onClick={handleSendMessage} disabled={sendingMessage || !newMessage.trim()} className="btn-primary" style={{ padding: '0.6rem 1.25rem' }}>Send</button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Packages tab */}
            {activeTab === 'memberships' && (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <div>
                            <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1.5rem', fontWeight: '600', color: 'var(--charcoal)', margin: 0 }}>Memberships</h2>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>Multi-session plans clients can purchase and redeem over time.</p>
                        </div>
                        <button onClick={() => { setShowPackageForm(true); setPackageForm({ name: '', description: '', price: '', totalSessions: '', validityDays: '365' }); }} className="btn-primary" style={{ padding: '0.65rem 1.25rem', fontSize: '0.875rem' }}>+ New Membership</button>
                    </div>

                    {showPackageForm && (
                        <div style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--gold)', padding: '1.75rem', marginBottom: '1.5rem', boxShadow: 'var(--shadow-sm)', marginTop: '1.5rem' }}>
                            <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1.2rem', fontWeight: '700', marginBottom: '1.25rem', color: 'var(--charcoal)' }}>
                                {packageForm.name ? `Editing: ${packageForm.name}` : 'New Membership Plan'}
                            </h3>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                                {[
                                    ['Plan Name', 'name', 'text', 'e.g. Monthly Grooming Plan'],
                                    ['Price (NAD)', 'price', 'number', '0'],
                                    ['Total Sessions', 'totalSessions', 'number', '5'],
                                    ['Validity (days)', 'validityDays', 'number', '365'],
                                ].map(([label, key, type, ph]) => (
                                    <div key={key}>
                                        <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</label>
                                        <input type={type} value={packageForm[key]} onChange={e => setPackageForm(prev => ({ ...prev, [key]: e.target.value }))} placeholder={ph} className="input" />
                                    </div>
                                ))}
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Description</label>
                                    <textarea value={packageForm.description} onChange={e => setPackageForm(prev => ({ ...prev, description: e.target.value }))} rows={2} className="input" style={{ resize: 'none' }} placeholder="What's included in this plan..." />
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '0.75rem' }}>
                                <button onClick={handleCreatePackage} disabled={savingPackage} className="btn-primary" style={{ padding: '0.65rem 1.5rem' }}>{savingPackage ? 'Saving...' : 'Save Plan'}</button>
                                <button onClick={() => setShowPackageForm(false)} className="btn-outline" style={{ padding: '0.65rem 1.25rem' }}>Cancel</button>
                            </div>
                        </div>
                    )}

                    {loadingPackages ? (
                        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>Loading...</div>
                    ) : myPackages.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '5rem 2rem', color: 'var(--text-muted)', background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', marginTop: '1.5rem' }}>
                            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🪪</div>
                            <p style={{ fontWeight: '600', fontSize: '1rem', color: 'var(--charcoal)', marginBottom: '0.35rem' }}>No membership plans yet</p>
                            <p style={{ fontSize: '0.875rem' }}>Create plans that let clients pre-purchase sessions at a discounted rate.</p>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: '1.25rem', marginTop: '1.5rem' }}>
                            {myPackages.map((pkg, i) => (
                                <div key={i} style={{ background: 'white', borderRadius: 'var(--radius)', border: `1px solid ${pkg.isActive ? 'var(--border)' : '#e5e7eb'}`, boxShadow: 'var(--shadow-sm)', overflow: 'hidden', opacity: pkg.isActive ? 1 : 0.7, display: 'flex', flexDirection: 'column' }}>
                                    {/* Gold stripe */}
                                    <div style={{ height: '4px', background: pkg.isActive ? 'var(--gold)' : '#e5e7eb' }} />
                                    <div style={{ padding: '1.5rem', flex: 1 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                                            <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1.15rem', fontWeight: '700', color: 'var(--charcoal)', margin: 0, flex: 1, paddingRight: '0.5rem' }}>{pkg.name}</h3>
                                            <span style={{ fontSize: '0.7rem', padding: '0.2rem 0.6rem', borderRadius: '99px', border: '1px solid', cursor: 'pointer', borderColor: pkg.isActive ? '#6ee7b7' : '#d1d5db', background: pkg.isActive ? '#d1fae5' : '#f3f4f6', color: pkg.isActive ? '#065f46' : '#6b7280', fontWeight: '700', whiteSpace: 'nowrap', flexShrink: 0 }}
                                                onClick={() => togglePackageActive(pkg)}>
                                                {pkg.isActive ? 'â— Active' : 'â—‹ Inactive'}
                                            </span>
                                        </div>
                                        {pkg.description && <p style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.5 }}>{pkg.description}</p>}
                                        <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem' }}>
                                            <div>
                                                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '2px' }}>Sessions</p>
                                                <p style={{ fontSize: '1.3rem', fontWeight: '700', color: 'var(--charcoal)', lineHeight: 1 }}>{pkg.totalSessions}</p>
                                            </div>
                                            <div>
                                                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '2px' }}>Valid for</p>
                                                <p style={{ fontSize: '1.3rem', fontWeight: '700', color: 'var(--charcoal)', lineHeight: 1 }}>{pkg.validityDays}d</p>
                                            </div>
                                            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                                                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '2px' }}>Price</p>
                                                <p style={{ fontSize: '1.5rem', fontWeight: '700', color: 'var(--gold-dark)', lineHeight: 1 }}>NAD {pkg.price}</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ padding: '0.75rem 1.5rem', borderTop: '1px solid var(--border)', display: 'flex', gap: '0.5rem' }}>
                                        <button
                                            onClick={() => { setPackageForm({ name: pkg.name, description: pkg.description, price: String(pkg.price), totalSessions: String(pkg.totalSessions), validityDays: String(pkg.validityDays) }); setShowPackageForm(true); }}
                                            style={{ flex: 1, background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.45rem', fontSize: '0.8rem', cursor: 'pointer', color: 'var(--text-secondary)', fontFamily: 'Inter, sans-serif' }}>
                                            Edit
                                        </button>
                                        <button
                                            onClick={async () => { if (window.confirm('Delete this membership plan?')) { await packageService.deletePackage(pkg._id); setMyPackages(prev => prev.filter(p => p._id !== pkg._id)); } }}
                                            style={{ flex: 1, background: 'none', border: '1px solid #fca5a5', borderRadius: 'var(--radius-sm)', padding: '0.45rem', fontSize: '0.8rem', cursor: 'pointer', color: '#dc2626', fontFamily: 'Inter, sans-serif' }}>
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ── TEAM TAB ── */}
            {activeTab === 'team' && (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <div>
                            <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1.5rem', fontWeight: '600', color: 'var(--charcoal)', margin: 0 }}>Team members</h2>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>Manage staff who take appointments at your business.</p>
                        </div>
                        <button onClick={openAddMember} className="btn-primary" style={{ padding: '0.65rem 1.25rem', fontSize: '0.875rem' }}>+ Add member</button>
                    </div>

                    {/* Add / Edit form */}
                    {showTeamForm && (
                        <div style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--gold)', padding: '1.75rem', marginBottom: '1.5rem', boxShadow: 'var(--shadow-sm)', marginTop: '1.5rem' }}>
                            <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1.2rem', fontWeight: '700', marginBottom: '1.25rem', color: 'var(--charcoal)' }}>
                                {editingMember ? 'Edit team member' : 'New team member'}
                            </h3>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                                {[
                                    ['Full name', 'name', 'text', 'e.g. Amara Ndongo'],
                                    ['Role / title', 'role', 'text', 'e.g. Barber, Nail Tech'],
                                    ['Email (optional)', 'email', 'email', 'staff@email.com'],
                                    ['Phone (optional)', 'phone', 'tel', '+264 81 000 0000'],
                                ].map(([label, key, type, ph]) => (
                                    <div key={key}>
                                        <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</label>
                                        <input type={type} value={teamForm[key]} onChange={e => setTeamForm(f => ({ ...f, [key]: e.target.value }))} placeholder={ph} className="input" />
                                    </div>
                                ))}
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Calendar colour</label>
                                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                        {['#c9a84c', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'].map(c => (
                                            <button key={c} type="button" onClick={() => setTeamForm(f => ({ ...f, color: c }))}
                                                style={{ width: '28px', height: '28px', borderRadius: '50%', background: c, border: teamForm.color === c ? '3px solid var(--charcoal)' : '2px solid transparent', cursor: 'pointer', flexShrink: 0 }} />
                                        ))}
                                    </div>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '0.75rem' }}>
                                <button onClick={handleSaveMember} disabled={savingTeam || !teamForm.name.trim()} className="btn-primary" style={{ padding: '0.65rem 1.5rem' }}>{savingTeam ? 'Saving...' : 'Save member'}</button>
                                <button onClick={() => setShowTeamForm(false)} className="btn-outline" style={{ padding: '0.65rem 1.25rem' }}>Cancel</button>
                            </div>
                        </div>
                    )}

                    {loadingTeam ? (
                        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>Loading...</div>
                    ) : teamMembers.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '5rem 2rem', color: 'var(--text-muted)', background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', marginTop: '1.5rem' }}>
                            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>👤</div>
                            <p style={{ fontWeight: '600', fontSize: '1rem', color: 'var(--charcoal)', marginBottom: '0.35rem' }}>No team members yet</p>
                            <p style={{ fontSize: '0.875rem' }}>Add staff members so you can assign them to appointments and track their schedule.</p>
                        </div>
                    ) : (
                        <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {teamMembers.map(m => (
                                <div key={m._id} style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                    {/* Colour avatar */}
                                    <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: m.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: '700', fontSize: '1rem', flexShrink: 0, textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>
                                        {m.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                                            <p style={{ fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.95rem', margin: 0 }}>{m.name}</p>
                                            <span style={{ fontSize: '0.75rem', background: 'var(--warm-gray)', color: 'var(--text-muted)', padding: '0.15rem 0.6rem', borderRadius: '99px' }}>{m.role}</span>
                                            {!m.isActive && <span style={{ fontSize: '0.7rem', background: '#fee2e2', color: '#991b1b', padding: '0.15rem 0.6rem', borderRadius: '99px', fontWeight: '600' }}>Inactive</span>}
                                        </div>
                                        <div style={{ display: 'flex', gap: '1.25rem', marginTop: '0.3rem', flexWrap: 'wrap' }}>
                                            {m.email && <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>{m.email}</p>}
                                            {m.phone && <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>{m.phone}</p>}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                                        <button onClick={() => handleToggleMemberActive(m)}
                                            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.35rem 0.75rem', fontSize: '0.75rem', cursor: 'pointer', color: 'var(--text-secondary)', fontFamily: 'Inter, sans-serif' }}>
                                            {m.isActive ? 'Deactivate' : 'Activate'}
                                        </button>
                                        <button onClick={() => openEditMember(m)}
                                            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.35rem 0.75rem', fontSize: '0.75rem', cursor: 'pointer', color: 'var(--text-secondary)', fontFamily: 'Inter, sans-serif' }}>
                                            Edit
                                        </button>
                                        <button onClick={() => window.confirm(`Remove ${m.name} from your team?`) && handleDeleteMember(m._id)}
                                            style={{ background: 'none', border: '1px solid #fca5a5', borderRadius: 'var(--radius-sm)', padding: '0.35rem 0.75rem', fontSize: '0.75rem', cursor: 'pointer', color: '#dc2626', fontFamily: 'Inter, sans-serif' }}>
                                            Remove
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            </div>

            {/* Recurring blocked time action modal */}
            {recurringActionModal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={e => { if (e.target === e.currentTarget) setRecurringActionModal(null); }}>
                    <div style={{ background: 'white', borderRadius: 'var(--radius) var(--radius) 0 0', padding: '2rem 1.5rem 2.5rem', width: '100%', maxWidth: '480px', position: 'relative' }}>
                        <button onClick={() => setRecurringActionModal(null)} style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.4rem', color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
                        <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1.4rem', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '0.5rem' }}>
                            {recurringActionModal.action === 'update' ? 'Update blocked time' : 'Delete blocked time'}
                        </h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>This blocked time is a recurring blocked time.</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.75rem' }}>
                            {[
                                { value: 'this', label: recurringActionModal.action === 'update' ? 'Update this blocked time only' : 'Delete this blocked time only' },
                                { value: 'thisAndFuture', label: recurringActionModal.action === 'update' ? 'Update this and future blocked times' : 'Delete this and future blocked times' },
                                { value: 'all', label: recurringActionModal.action === 'update' ? 'Update all blocked times' : 'Delete all blocked times' },
                            ].map(opt => (
                                <label key={opt.value} onClick={() => setRecurringMode(opt.value)} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.875rem 1rem', borderRadius: 'var(--radius-sm)', border: `1px solid ${recurringMode === opt.value ? 'var(--gold)' : 'var(--border)'}`, background: recurringMode === opt.value ? 'rgba(201,168,76,0.05)' : 'white', cursor: 'pointer', transition: 'all 0.15s' }}>
                                    <div style={{ width: '20px', height: '20px', borderRadius: '50%', border: `2px solid ${recurringMode === opt.value ? 'var(--gold)' : '#d1d5db'}`, background: recurringMode === opt.value ? 'var(--gold)' : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' }}>
                                        {recurringMode === opt.value && <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'white' }} />}
                                    </div>
                                    <span style={{ fontSize: '0.9rem', color: 'var(--charcoal)', fontWeight: recurringMode === opt.value ? '600' : '400' }}>{opt.label}</span>
                                </label>
                            ))}
                        </div>
                        <button onClick={confirmRecurringAction} disabled={savingBlockedTime} className="btn-primary" style={{ width: '100%', padding: '0.9rem', fontSize: '0.95rem' }}>
                            {savingBlockedTime ? 'Please wait...' : 'Confirm'}
                        </button>
                    </div>
                </div>
            )}

            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

            {/* Suggestion box — always visible for providers */}
            <SuggestionBox user={user} />

            {/* Fresha-style Add/Edit Blocked Time panel */}
            {showBlockedTimeForm && (
                <>
                    <div onClick={closeBlockedTimeForm} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1001, backdropFilter: 'blur(2px)' }} />
                    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: '400px', maxWidth: '95vw', background: 'white', boxShadow: '-8px 0 40px rgba(0,0,0,0.18)', zIndex: 1002, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
                        {/* Panel header */}
                        <div style={{ background: 'var(--charcoal)', padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                            <div>
                                <h2 style={{ fontFamily: 'Cormorant Garamond, serif', color: 'var(--gold)', fontSize: '1.25rem', fontWeight: '700', margin: '0 0 0.2rem' }}>
                                    {editingBlockedTime ? 'Edit Blocked Time' : 'Add blocked time'}
                                </h2>
                                <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.75rem', margin: 0 }}>Block off time when you're unavailable</p>
                            </div>
                            <button onClick={closeBlockedTimeForm} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: '1.5rem', lineHeight: 1, padding: 0 }}>×</button>
                        </div>

                        <form onSubmit={handleBlockedTimeSubmit} style={{ padding: '1.5rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                            {/* Block type */}
                            {!editingBlockedTime && (
                                <div>
                                    <p style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.65rem' }}>Block time type</p>
                                    <div style={{ display: 'flex', gap: '0.75rem' }}>
                                        {[
                                            { id: 'Custom', icon: '✏️', desc: 'New blocked time' },
                                            { id: 'Lunch',  icon: '🥗', desc: '30 mins · Unpaid' },
                                            { id: 'Break',  icon: '☕', desc: '15 mins · Break' },
                                            { id: 'Meeting',icon: '📋', desc: 'Team meeting' },
                                        ].map(t => (
                                            <button
                                                key={t.id} type="button"
                                                onClick={() => {
                                                    setBlockedTimeForm(p => ({
                                                        ...p,
                                                        blockType: t.id,
                                                        title: t.id !== 'Custom' ? t.id : p.title,
                                                        startTime: t.id === 'Lunch' ? '12:00' : t.id === 'Break' ? (p.startTime || '') : p.startTime,
                                                        endTime: t.id === 'Lunch' ? '12:30' : t.id === 'Break' ? '12:15' : p.endTime,
                                                    }));
                                                }}
                                                style={{
                                                    flex: 1, padding: '0.75rem 0.5rem', borderRadius: 'var(--radius-sm)',
                                                    border: `2px solid ${blockedTimeForm.blockType === t.id ? 'var(--gold)' : 'var(--border)'}`,
                                                    background: blockedTimeForm.blockType === t.id ? 'rgba(201,168,76,0.07)' : 'white',
                                                    cursor: 'pointer', textAlign: 'center',
                                                }}
                                            >
                                                <div style={{ fontSize: '1.2rem', marginBottom: '0.25rem' }}>{t.icon}</div>
                                                <div style={{ fontSize: '0.75rem', fontWeight: '700', color: blockedTimeForm.blockType === t.id ? 'var(--gold-dark)' : 'var(--charcoal)', fontFamily: 'Outfit, sans-serif' }}>{t.id}</div>
                                                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.1rem', fontFamily: 'Outfit, sans-serif' }}>{t.desc}</div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Title */}
                            <div>
                                <label style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '0.4rem' }}>Title <span style={{ fontWeight: 400, textTransform: 'none' }}>(Optional)</span></label>
                                <input className="input" type="text" placeholder="e.g. Lunch meeting" maxLength={80} value={blockedTimeForm.title || blockedTimeForm.reason} onChange={e => setBlockedTimeForm(p => ({ ...p, title: e.target.value, reason: e.target.value }))} style={{ width: '100%', boxSizing: 'border-box' }} />
                            </div>

                            {/* Date */}
                            {!editingBlockedTime && (
                                <div>
                                    <label style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '0.4rem' }}>Date</label>
                                    <input required className="input" type="date" value={blockedTimeForm.date} onChange={e => setBlockedTimeForm(p => ({ ...p, date: e.target.value }))} style={{ width: '100%', boxSizing: 'border-box' }} />
                                </div>
                            )}

                            {/* Start / End time */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                                <div>
                                    <label style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '0.4rem' }}>Start time</label>
                                    <input required className="input" type="time" value={blockedTimeForm.startTime} onChange={e => setBlockedTimeForm(p => ({ ...p, startTime: e.target.value }))} style={{ width: '100%', boxSizing: 'border-box' }} />
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '0.4rem' }}>End time</label>
                                    <input required className="input" type="time" value={blockedTimeForm.endTime} onChange={e => setBlockedTimeForm(p => ({ ...p, endTime: e.target.value }))} style={{ width: '100%', boxSizing: 'border-box' }} />
                                    {blockedTimeForm.startTime && blockedTimeForm.endTime && blockedTimeForm.endTime > blockedTimeForm.startTime && (
                                        <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                                            {Math.round((new Date(`2000-01-01T${blockedTimeForm.endTime}`) - new Date(`2000-01-01T${blockedTimeForm.startTime}`)) / 60000)} mins duration
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Team member display */}
                            <div>
                                <label style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '0.4rem' }}>Team member</label>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.65rem 0.875rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--warm-gray)' }}>
                                    <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: user?.avatar ? 'transparent' : 'var(--charcoal)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                        {user?.avatar ? <img src={user.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: 'var(--gold)', fontWeight: '700', fontSize: '0.8rem' }}>{user?.name?.[0]}</span>}
                                    </div>
                                    <span style={{ fontSize: '0.875rem', color: 'var(--charcoal)', fontFamily: 'Outfit, sans-serif', fontWeight: '500' }}>{user?.name}</span>
                                </div>
                            </div>

                            {/* Frequency */}
                            {!editingBlockedTime && (
                                <div>
                                    <label style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '0.4rem' }}>Frequency</label>
                                    <select className="input" value={blockedTimeForm.isRecurring ? blockedTimeForm.recurrenceType : 'none'} onChange={e => {
                                        if (e.target.value === 'none') setBlockedTimeForm(p => ({ ...p, isRecurring: false, recurrenceType: 'weekly' }));
                                        else setBlockedTimeForm(p => ({ ...p, isRecurring: true, recurrenceType: e.target.value }));
                                    }} style={{ width: '100%', boxSizing: 'border-box' }}>
                                        <option value="none">Doesn't repeat</option>
                                        <option value="daily">Daily</option>
                                        <option value="weekly">Weekly</option>
                                        <option value="monthly">Monthly</option>
                                    </select>
                                    {blockedTimeForm.isRecurring && (
                                        <div style={{ marginTop: '0.65rem' }}>
                                            <label style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '0.4rem' }}>End date <span style={{ fontWeight: 400, textTransform: 'none' }}>(Optional)</span></label>
                                            <input className="input" type="date" value={blockedTimeForm.recurrenceEndDate} onChange={e => setBlockedTimeForm(p => ({ ...p, recurrenceEndDate: e.target.value }))} style={{ width: '100%', boxSizing: 'border-box' }} />
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Description */}
                            <div>
                                <label style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '0.4rem' }}>Description <span style={{ fontWeight: 400, textTransform: 'none' }}>(Optional)</span></label>
                                <textarea className="input" rows={3} maxLength={255} placeholder="Add description or note" value={blockedTimeForm.reason} onChange={e => setBlockedTimeForm(p => ({ ...p, reason: e.target.value, title: p.title || e.target.value }))} style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'Outfit, sans-serif' }} />
                                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'right', marginTop: '0.25rem' }}>{(blockedTimeForm.reason || '').length}/255</p>
                            </div>

                            <div style={{ flexGrow: 1 }} />

                            {/* Save button */}
                            <button type="submit" disabled={savingBlockedTime} style={{ width: '100%', padding: '0.9rem', background: savingBlockedTime ? '#9ca3af' : 'var(--charcoal)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', fontFamily: 'Outfit, sans-serif', fontSize: '0.95rem', fontWeight: '700', cursor: savingBlockedTime ? 'not-allowed' : 'pointer', letterSpacing: '0.03em' }}>
                                {savingBlockedTime ? 'Saving...' : editingBlockedTime ? 'Update' : 'Save'}
                            </button>
                        </form>
                    </div>
                </>
            )}
        </div>
    );
};

export default ProviderDashboard;
