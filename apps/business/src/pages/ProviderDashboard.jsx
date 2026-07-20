import React, { useEffect, useMemo, useState, useRef, lazy, Suspense } from 'react';
import { Link, useLocation } from 'react-router-dom';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { appointmentService, availabilityService, providerServiceService, categoryService, blockedTimeService, clientCRMService, messageService, packageService, teamService, waitingListService, earningsService, analyticsService, walletService, providerWalletService, authService } from '../services';
import { useAuthContext } from '../context/AuthContext';
// Lazy — pulls in the Google Maps SDK only when a new provider is onboarding,
// keeping it out of the main dashboard bundle.
const OnboardingWizard = lazy(() => import('../components/OnboardingWizard'));
import FormsManager from '../components/FormsManager';
import ApptFormsView from '../components/ApptFormsView';
import EnablePushBanner from '../components/EnablePushBanner';
import SetupChecklistNudge from '../components/SetupChecklistNudge';
import ServiceFormModal from '../components/ServiceFormModal';
import { Calendar, History, Scissors, CalendarClock, Clock, LayoutDashboard, TrendingUp, BarChart3, Users, ClipboardList, MessageSquare, Ticket, UserCog, CalendarPlus, Ban, Wallet as WalletIcon, ChevronDown, ChevronLeft, Send } from 'lucide-react';
import { cloudinaryAvatar } from '../utils/cloudinary';
import { NAMIBIAN_TOWNS, normalizeTown } from '../utils/namibiaTowns';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import { buildTimeSlots } from '../utils/bookingSlots';
import MiniCalendar from '../components/MiniCalendar';
import RecurrenceFields from '../components/RecurrenceFields';
import { currencySymbol } from '../utils/currency';
import { useToast } from '../components/Toast';
import { statusConfig, ContactActions, ChromeModal, CloseButton, StatsSkeleton, RowsSkeleton, Avatar, fmtConvTime } from './dashboard/primitives';
import { ProviderAccountTopUpModal, WalletAdjustmentModal } from './dashboard/WalletModals';
import StaffLanesDay from './dashboard/StaffLanesDay';

const ProviderDashboard = () => {
    const { user, setUser } = useAuthContext();
    // The business prices in its chosen currency; every money display uses this symbol.
    const curCode = user?.businessProfile?.currency || 'NAD';
    const curSym = currencySymbol(curCode);
    const nMoney = (n) => `${curSym}${Number(n || 0).toFixed(2)}`;
    const location = useLocation();
    const toast = useToast();
    const calendarRef = useRef(null);
    const fcWrapRef = useRef(null);
    // Day/week calendar fills the space from its top down to just above the bottom
    // nav, instead of a fixed 680px that left dead grey space on tall phones.
    // Measured (scroll-corrected) so it's accurate across screen sizes; falls back
    // to 680 if it can't measure. Month view keeps its natural 'auto' height.
    const [calHeight, setCalHeight] = useState(680);
    const [showWizard, setShowWizard] = useState(false);
    const [appointments, setAppointments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [activeTab, setActiveTab] = useState('calendar');
    const [availability, setAvailability] = useState(null);
    const [savingAvailability, setSavingAvailability] = useState(false);
    const [availabilitySuccess, setAvailabilitySuccess] = useState('');
    const [myServices, setMyServices] = useState([]);
    const [providerWaitlist, setProviderWaitlist] = useState([]);
    const [earnings, setEarnings] = useState(null);
    const [loadingEarnings, setLoadingEarnings] = useState(false);
    const [earningsError, setEarningsError] = useState('');
    const [earningsPreset, setEarningsPreset] = useState('month'); // week|month|lastMonth|30d|custom
    const [earningsRange, setEarningsRange] = useState({ from: '', to: '' });
    const [earningsChartMode, setEarningsChartMode] = useState('earned'); // earned|count
    const [insights, setInsights] = useState(null);
    const [loadingInsights, setLoadingInsights] = useState(false);
    const [insightsError, setInsightsError] = useState('');
    const [insightsPreset, setInsightsPreset] = useState('30d');
    const [insightsRange, setInsightsRange] = useState({ from: '', to: '' });
    const [showServiceForm, setShowServiceForm] = useState(false);
    const [editingService, setEditingService] = useState(null);
    const [categories, setCategories] = useState([]);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [showCategoryForm, setShowCategoryForm] = useState(false);
    const [catalogueCategory, setCatalogueCategory] = useState('all');
    const [catalogueSearch, setCatalogueSearch] = useState('');
    const [currentDate, setCurrentDate] = useState(new Date());
    const [calendarView, setCalendarView] = useState('day');
    const [calendarToast, setCalendarToast] = useState(null); // { msg, type }

    // Size the day/week calendar to fill from its top down to just above the fixed
    // bottom nav, instead of a hard 680px that left dead grey space on tall phones.
    // rect.top + scrollY = the wrapper's offset from the PAGE top, so the measurement
    // is stable no matter the scroll position. We recompute across a short settle
    // window after mount because the setup-nudge / suggestion cards above the calendar
    // load in asynchronously and shift its top down — a single measure at first paint
    // would lock in the wrong height. Also recomputed on every viewport resize.
    useEffect(() => {
        if (calendarView === 'month') return; // month grid keeps its natural height
        const recompute = () => {
            const el = fcWrapRef.current;
            if (!el) return;
            const absTop = el.getBoundingClientRect().top + window.scrollY;
            const bottomReserve = window.innerWidth <= 768 ? 96 : 32; // fixed bottom nav on phones
            setCalHeight(Math.max(460, Math.round(window.innerHeight - absTop - bottomReserve)));
        };
        // Re-measure at a few points so late-rendering content above the calendar
        // (nudge cards) can't leave it stuck at the initial-paint height.
        const timers = [0, 200, 500, 1000, 1600].map((ms) => setTimeout(recompute, ms));
        window.addEventListener('resize', recompute);
        return () => {
            timers.forEach(clearTimeout);
            window.removeEventListener('resize', recompute);
        };
    }, [calendarView]);
    const [blockedTimes, setBlockedTimes] = useState([]);
    const [showBlockedTimeForm, setShowBlockedTimeForm] = useState(false);
    const [editingBlockedTime, setEditingBlockedTime] = useState(null);
    const [blockedTimeForm, setBlockedTimeForm] = useState({ blockType: 'Custom', title: '', date: '', startTime: '', endTime: '', reason: '', isRecurring: false, recurrenceType: 'weekly', recurrenceEndDate: '', customDays: [], teamMember: '' });
    const [savingBlockedTime, setSavingBlockedTime] = useState(false);
    const [recurringActionModal, setRecurringActionModal] = useState(null);
    const [timeSelectionPreview, setTimeSelectionPreview] = useState(null);
    const [pendingMove, setPendingMove] = useState(null); // drag-to-move confirmation
    const [adjustHours, setAdjustHours] = useState(null); // tap-grayed-area → edit working hours
    const [savingAdjustHours, setSavingAdjustHours] = useState(false);
    const [recurringMode, setRecurringMode] = useState('this');
    const [showApptModal, setShowApptModal] = useState(false);
    const [apptForm, setApptForm] = useState({ serviceId: '', date: '', startTime: '', clientMode: 'existing', customerId: '', clientName: '', notes: '', isRecurring: false, recurrenceType: 'weekly', recurrenceInterval: 1, recurrenceEndDate: '', isGroup: false, groupClients: [{ name: '' }], teamMember: '' });
    const [clientPickerSearch, setClientPickerSearch] = useState('');
    const [calendarStaffFilter, setCalendarStaffFilter] = useState('all'); // 'all' | 'unassigned' | teamMember _id
    const [savingAppt, setSavingAppt] = useState(false);
    const [apptError, setApptError] = useState('');
    // Appointment history
    const [history, setHistory] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyPage, setHistoryPage] = useState(1);
    const [historyTotal, setHistoryTotal] = useState(0);
    // Recurring series cancel modal
    const [seriesCancelModal, setSeriesCancelModal] = useState(null); // { appt, mode }
    const [seriesCancelMode, setSeriesCancelMode] = useState('this');
    const [apptDetailModal, setApptDetailModal] = useState(null);
    const [apptRescheduleForm, setApptRescheduleForm] = useState({ appointmentDate: '', startTime: '' });
    const [savingApptDetail, setSavingApptDetail] = useState(false);
    const [apptDetailError, setApptDetailError] = useState('');
    const [showReschedule, setShowReschedule] = useState(false); // reschedule form is collapsed by default to keep actions reachable
    const [showApptContact, setShowApptContact] = useState(false); // contact options reveal when the provider taps the client name

    // Wallet (prepaid balances the provider holds for clients)
    const [walletSummary, setWalletSummary] = useState(null);
    const [walletSettings, setWalletSettings] = useState(null);
    const [walletTopups, setWalletTopups] = useState([]);
    const [walletClientWallets, setWalletClientWallets] = useState([]);
    const [walletAdjustments, setWalletAdjustments] = useState([]);
    const [walletLoading, setWalletLoading] = useState(false);
    const [walletSaving, setWalletSaving] = useState(false);
    const [adjustModal, setAdjustModal] = useState(null); // { wallet } for the adjustment composer
    const [providerBalance, setProviderBalance] = useState(null); // provider's own platform balance
    const [providerWalletTxns, setProviderWalletTxns] = useState([]);
    const [showAccountTopUp, setShowAccountTopUp] = useState(false);

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

    // Team members
    const [teamMembers, setTeamMembers] = useState([]);
    const [loadingTeam, setLoadingTeam] = useState(false);
    const [showTeamForm, setShowTeamForm] = useState(false);
    const [editingMember, setEditingMember] = useState(null);
    const [teamForm, setTeamForm] = useState({ name: '', role: 'Staff', email: '', phone: '', color: '#f03e16' });
    const [savingTeam, setSavingTeam] = useState(false);

    // Show onboarding wizard for providers who haven't completed setup
    useEffect(() => {
        if (user && user.role === 'provider' && !user.providerSetupComplete) {
            setShowWizard(true);
        }
    }, [user]);

    useEffect(() => {
        const tab = new URLSearchParams(location.search).get('tab');
        const validTabs = ['calendar', 'pending', 'confirmed', 'completed', 'cancelled', 'history', 'services', 'availability', 'overview', 'waitlist', 'earnings', 'insights', 'clients', 'messages', 'memberships', 'team', 'forms', 'wallet'];
        if (tab && validTabs.includes(tab)) {
            setActiveTab(tab);
        } else if (!tab) {
            // Bare /dashboard (e.g. the bottom-nav Dashboard button) → default view
            setActiveTab('calendar');
        }
    }, [location.search]);

    useEffect(() => { // eslint-disable-line react-hooks/exhaustive-deps
        // Run all initial fetches in parallel — don't wait for one before starting the next
        Promise.allSettled([
            fetchAppointments(),
            fetchAvailability(),
            fetchMyServices(),
            fetchCategories(),
            fetchBlockedTimes(),
        ]);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Live updates — keep the calendar/bookings fresh while the tab is open, so a
    // reschedule, new booking or cancellation shows up without a manual refresh.
    useLiveRefresh(() => { fetchAppointments(); fetchBlockedTimes(); }, { intervalMs: 25000 });

    // Live chat — refresh the open conversation so new messages appear without reload.
    useLiveRefresh(() => {
        if (activeTab === 'messages' && selectedConversation) {
            messageService.getMessages(selectedConversation.appointment._id)
                .then(res => setConversationMessages(res.data.data)).catch(() => {});
        }
    }, { intervalMs: 8000, enabled: activeTab === 'messages' && !!selectedConversation });

    useEffect(() => { // eslint-disable-line react-hooks/exhaustive-deps
        setError(''); // a stale error shouldn't follow the user across tabs
        if (activeTab === 'overview' || activeTab === 'waitlist') {
            waitingListService.getProviderList().then(r => setProviderWaitlist(r.data.data || [])).catch(() => {});
        }
        if (activeTab === 'earnings' && !earnings) fetchEarnings();
        if (activeTab === 'insights' && !insights) fetchInsights();
        if (activeTab === 'clients' && clients.length === 0) fetchClients();
        if (activeTab === 'messages' && conversations.length === 0) fetchConversations();
        if (activeTab === 'memberships' && myPackages.length === 0) fetchMyPackages();
        if (activeTab === 'team' && teamMembers.length === 0) fetchTeam();
        if (activeTab === 'history' && history.length === 0) fetchHistory(1);
        // Team needed for staff assignment + the calendar staff filter
        if (activeTab === 'calendar' && teamMembers.length === 0) fetchTeam();
        if (activeTab === 'wallet') fetchWalletData();
    }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

    // When the New Appointment modal opens, load the client list (for the "existing
    // client" picker) and the availability schedule (so the time picker matches the
    // app's availability-aware slots).
    useEffect(() => { // eslint-disable-line react-hooks/exhaustive-deps
        if (showApptModal && clients.length === 0) fetchClients();
        if (showApptModal && !availability) fetchAvailability();
    }, [showApptModal]); // eslint-disable-line react-hooks/exhaustive-deps

    const fetchAppointments = async () => {
        // Don't block the whole page — only set loading on first load
        if (appointments.length === 0) setLoading(true);
        try {
            // `all` so the calendar always has every booking (no pagination gaps)
            const res = await appointmentService.getAllAppointments({ all: true });
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
                teamMember: String(item.teamMember?._id || item.teamMember || ''),
            });
        } else {
            setEditingBlockedTime(null);
            setBlockedTimeForm({ blockType: 'Custom', title: '', date: new Date().toISOString().split('T')[0], startTime: '', endTime: '', reason: '', isRecurring: false, recurrenceType: 'weekly', recurrenceEndDate: '', teamMember: '' });
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
        // Optimistic update: close the panel and show the block immediately
        const optimisticEntry = {
            _id: 'tmp_' + Date.now(),
            provider: user?._id,
            date: blockedTimeForm.date,
            startTime: blockedTimeForm.startTime,
            endTime: blockedTimeForm.endTime,
            reason: blockedTimeForm.reason || blockedTimeForm.title || '',
            isRecurring: false,
            teamMember: blockedTimeForm.teamMember || null,
        };
        if (!editingBlockedTime) {
            setBlockedTimes(prev => [...prev, optimisticEntry]);
            closeBlockedTimeForm();
            setRecurringActionModal(null);
        }
        try {
            if (editingBlockedTime) {
                await blockedTimeService.updateBlockedTime(editingBlockedTime._id, {
                    startTime: blockedTimeForm.startTime,
                    endTime: blockedTimeForm.endTime,
                    reason: blockedTimeForm.reason,
                    updateMode: mode,
                });
            } else if (blockedTimeForm.isRecurring && blockedTimeForm.recurrenceType === 'custom') {
                // Expand custom days client-side
                const days = blockedTimeForm.customDays || [];
                if (days.length === 0) throw new Error('Please select at least one day.');
                const startDate = new Date(blockedTimeForm.date + 'T00:00:00');
                const endDate = blockedTimeForm.recurrenceEndDate
                    ? new Date(blockedTimeForm.recurrenceEndDate + 'T00:00:00')
                    : new Date(startDate.getTime() + 90 * 24 * 60 * 60 * 1000);
                const dates = [];
                const cur = new Date(startDate);
                while (cur <= endDate && dates.length < 365) {
                    if (days.includes(cur.getDay())) {
                        dates.push(`${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`);
                    }
                    cur.setDate(cur.getDate() + 1);
                }
                for (const d of dates) {
                    await blockedTimeService.createBlockedTime({
                        date: d,
                        startTime: blockedTimeForm.startTime,
                        endTime: blockedTimeForm.endTime,
                        reason: blockedTimeForm.reason || blockedTimeForm.title || '',
                        isRecurring: false,
                        teamMember: blockedTimeForm.teamMember || undefined,
                    });
                }
            } else {
                const payload = {
                    date: blockedTimeForm.date,
                    startTime: blockedTimeForm.startTime,
                    endTime: blockedTimeForm.endTime,
                    reason: blockedTimeForm.reason || blockedTimeForm.title || '',
                    isRecurring: blockedTimeForm.isRecurring,
                    recurrenceType: blockedTimeForm.isRecurring ? blockedTimeForm.recurrenceType : undefined,
                    recurrenceEndDate: blockedTimeForm.recurrenceEndDate || undefined,
                    teamMember: blockedTimeForm.teamMember || undefined,
                };
                await blockedTimeService.createBlockedTime(payload);
            }
            await fetchBlockedTimes();
            if (editingBlockedTime) {
                closeBlockedTimeForm();
                setRecurringActionModal(null);
            }
        } catch (err) {
            console.error('BlockedTime save error:', err?.response?.data || err);
            // Roll back optimistic entry on failure
            setBlockedTimes(prev => prev.filter(b => !String(b._id).startsWith('tmp_')));
            if (!editingBlockedTime) setShowBlockedTimeForm(true); // reopen if we closed it
            toast(err?.response?.data?.message || err?.message || 'Failed to save blocked time. Please try again.', 'error');
        } finally {
            setSavingBlockedTime(false);
        }
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
            closeBlockedTimeForm(); // also dismiss the edit panel when deleting from it
        } catch (err) {
            toast(err?.response?.data?.message || 'Couldn’t remove the blocked time. Please try again.', 'error');
        }
    };

    const confirmRecurringAction = () => {
        if (!recurringActionModal) return;
        if (recurringActionModal.action === 'update') {
            saveBlockedTime(recurringMode);
        } else {
            doDeleteBlockedTime(recurringActionModal.item._id, recurringMode);
        }
    };

    const fetchClients = async () => {
        setLoadingClients(true);
        try {
            const res = await clientCRMService.getMyClients();
            setClients(res.data.data);
        } catch { /* ignore */ } finally { setLoadingClients(false); }
    };

    const fetchWalletData = async () => {
        setWalletLoading(true);
        try {
            const [summary, settings, topups, cw, adj, mine] = await Promise.all([
                walletService.getProviderSummary(),
                walletService.getSettings(),
                walletService.getProviderTopups(),
                walletService.getProviderWallets(),
                walletService.getProviderAdjustments(),
                providerWalletService.getMyBalance(),
            ]);
            setWalletSummary(summary.data.data);
            setWalletSettings(settings.data.data);
            setWalletTopups(topups.data.data || []);
            setWalletClientWallets(cw.data.data || []);
            setWalletAdjustments(adj.data.data || []);
            setProviderBalance(mine.data.data?.wallet || null);
            setProviderWalletTxns(mine.data.data?.transactions || []);
        } catch { /* ignore */ } finally { setWalletLoading(false); }
    };

    const saveWalletSettings = async (patch) => {
        setWalletSaving(true);
        try {
            const res = await walletService.updateSettings({ ...walletSettings, ...patch });
            setWalletSettings(res.data.data);
        } catch (err) {
            setError(err.response?.data?.message || 'Could not save wallet settings');
        } finally { setWalletSaving(false); }
    };

    const resolveTopUp = async (id, approve) => {
        try {
            approve ? await walletService.approveTopUp(id) : await walletService.rejectTopUp(id);
            await fetchWalletData();
        } catch (err) { toast(err.response?.data?.message || 'Could not update top-up', 'error'); }
    };

    const submitAdjustment = async ({ customerId, amount, direction, reason, isRefund }) => {
        await walletService.createAdjustment({ customerId, amount, direction, reason, isRefund });
        setAdjustModal(null);
        await fetchWalletData();
    };

    // Resolve a preset (or custom range) into {from, to} YYYY-MM-DD strings
    const resolveEarningsRange = (preset, custom) => {
        const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const now = new Date();
        if (preset === 'custom' && custom?.from && custom?.to) return { from: custom.from, to: custom.to };
        if (preset === 'week') {
            const start = new Date(now); start.setDate(now.getDate() - now.getDay());
            return { from: fmt(start), to: fmt(now) };
        }
        if (preset === 'month') {
            return { from: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), to: fmt(now) };
        }
        if (preset === 'lastMonth') {
            return { from: fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: fmt(new Date(now.getFullYear(), now.getMonth(), 0)) };
        }
        // 30d default
        const start = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
        return { from: fmt(start), to: fmt(now) };
    };

    const fetchEarnings = async (preset = earningsPreset, custom = earningsRange) => {
        setLoadingEarnings(true);
        setEarningsError('');
        try {
            const { from, to } = resolveEarningsRange(preset, custom);
            const res = await earningsService.getMyEarnings({ from, to });
            setEarnings(res.data.data);
        } catch {
            setEarningsError('Could not load earnings. Tap retry.');
        } finally {
            setLoadingEarnings(false);
        }
    };

    const exportEarningsCsv = () => {
        if (!earnings) return;
        const rows = [['Date', `Earned (${curCode})`, 'Completed appointments']];
        earnings.overTime.forEach(d => rows.push([d.date, d.earned, d.count]));
        rows.push([]);
        rows.push(['Service', `Earned (${curCode})`, 'Completed']);
        earnings.byService.forEach(s => rows.push([s.name, s.earned, s.count]));
        const csv = rows.map(r => r.map(c => `"${String(c ?? '')}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `earnings-${earnings.range?.from?.slice(0, 10) || 'export'}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const fetchInsights = async (preset = insightsPreset, custom = insightsRange) => {
        setLoadingInsights(true);
        setInsightsError('');
        try {
            const { from, to } = resolveEarningsRange(preset, custom);
            const res = await analyticsService.getProviderAnalytics({ from, to });
            setInsights(res.data.data);
        } catch {
            setInsightsError('Could not load insights. Tap retry.');
        } finally {
            setLoadingInsights(false);
        }
    };

    const exportInsightsCsv = () => {
        if (!insights) return;
        const rows = [['Metric', 'Value']];
        rows.push(['Utilization %', insights.rates.utilizationPct]);
        rows.push(['No-show rate %', insights.rates.noShowRate]);
        rows.push(['Cancellation rate %', insights.rates.cancellationRate]);
        rows.push(['New clients', insights.clients.new]);
        rows.push(['Returning clients', insights.clients.returning]);
        rows.push(['Waitlist volume', insights.waitlistVolume]);
        rows.push([]);
        rows.push(['Date', 'Bookings']);
        insights.overTime.forEach(d => rows.push([d.date, d.count]));
        const csv = rows.map(r => r.map(c => `"${String(c ?? '')}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `insights-${insights.range?.from?.slice(0, 10) || 'export'}.csv`;
        a.click();
        URL.revokeObjectURL(url);
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

    // Jump from an appointment (or a client name) straight into that client's
    // full profile in the Clients tab.
    const openClientProfile = (customer) => {
        if (!customer?._id) return;
        setSelectedClient({ customer });
        fetchClientDetail(customer._id);
        setApptDetailModal(null);
        setActiveTab('clients');
    };

    // Open the in-app chat thread for a given appointment. `provider` is stamped
    // so the message bubbles align correctly (mine vs. the client's).
    const openChatForAppointment = (appt) => {
        if (!appt?._id) return;
        fetchConversations();
        openConversation({ appointment: { ...appt, provider: { _id: user?._id, name: user?.name } } });
        setApptDetailModal(null);
        setSelectedClient(null);
        setActiveTab('messages');
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

    const fetchTeam = async () => {
        setLoadingTeam(true);
        try {
            const res = await teamService.getMyTeam();
            setTeamMembers(res.data.data);
        } catch { /* ignore */ } finally { setLoadingTeam(false); }
    };

    const fetchHistory = async (page = 1) => {
        setHistoryLoading(true);
        try {
            const res = await appointmentService.getAppointmentHistory({ page, limit: 20 });
            setHistory(page === 1 ? (res.data.data || []) : prev => [...prev, ...(res.data.data || [])]);
            setHistoryTotal(res.data.total || 0);
            setHistoryPage(page);
        } catch { /* ignore */ } finally { setHistoryLoading(false); }
    };

    const handleSeriesCancel = async () => {
        if (!seriesCancelModal) return;
        try {
            await appointmentService.cancelAppointmentSeries(seriesCancelModal._id, seriesCancelMode);
            await fetchAppointments(); // {all:true} — a bare refetch truncates the calendar to 20
            setSeriesCancelModal(null);
        } catch { /* ignore */ }
    };

    const openAddMember = () => {
        setEditingMember(null);
        setTeamForm({ name: '', role: 'Staff', email: '', phone: '', color: '#f03e16' });
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
        setError('');
        // Completing a wallet-paid booking releases the client's reserved funds to
        // you (the server finalises the reservation). Make that explicit first.
        if (status === 'completed') {
            const appt = appointments.find(a => a._id === id);
            const isWallet = appt?.paymentMethod === 'wallet';
            const amount = appt?.totalPrice ?? appt?.service?.price;
            const who = appt?.customer?.name || 'the client';
            const msg = isWallet && amount != null
                ? `Mark this appointment complete?\n\nThis releases ${nMoney(amount)} from ${who}'s reserved balance to you. This can't be undone.`
                : 'Mark this appointment as complete?';
            if (!window.confirm(msg)) return;
        }
        // optimistic
        setAppointments(prev => prev.map(a => a._id === id ? { ...a, status } : a));
        try {
            await appointmentService.updateAppointmentStatus(id, status);
            // Re-sync from the server so calendar, counts and history all reflect it
            await fetchAppointments();
            setHistory([]); // invalidate so History refetches when next opened
        } catch {
            await fetchAppointments(); // roll back optimistic change
            setError('Failed to update appointment');
        }
    };

    const handleProviderReschedule = async (id, appointmentDate, startTime) => {
        setSavingApptDetail(true);
        setApptDetailError('');
        try {
            const res = await appointmentService.providerRescheduleAppointment(id, { appointmentDate, startTime });
            setAppointments(prev => prev.map(a => a._id === id ? { ...a, ...res.data.data } : a));
            setApptDetailModal(null);
        } catch (err) {
            setApptDetailError(err.response?.data?.message || 'Failed to reschedule');
        } finally {
            setSavingApptDetail(false);
        }
    };

    // Create/edit now live in <ServiceFormModal>; opening it just sets the target.
    const handleEditService = (s) => {
        setEditingService(s);
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

    const matchesStaffFilter = (a) => {
        if (calendarStaffFilter === 'all') return true;
        const tmId = a.teamMember?._id || a.teamMember || null;
        if (calendarStaffFilter === 'unassigned') return !tmId;
        return String(tmId) === String(calendarStaffFilter);
    };

    // Blocked time can be business-wide (teamMember null → blocks everyone, always
    // shown) or scoped to one staff member (shown when that member is in view).
    const blockMatchesStaffFilter = (b) => {
        const tmId = b.teamMember?._id || b.teamMember || null;
        if (!tmId) return true;
        if (calendarStaffFilter === 'all') return true;
        if (calendarStaffFilter === 'unassigned') return false;
        return String(tmId) === String(calendarStaffFilter);
    };

    const activeTeamMembers = teamMembers.filter(m => m.isActive !== false);

    const statusCalendarColors = {
        pending:   { bg: '#FEF3C7', text: '#92400E', borderColor: '#F59E0B' },
        confirmed: { bg: '#DBEAFE', text: '#1E40AF', borderColor: '#3B82F6' },
        completed: { bg: '#D1FAE5', text: '#065F46', borderColor: '#10B981' },
        cancelled: { bg: '#FEE2E2', text: '#991B1B', borderColor: '#EF4444' },
        'no-show': { bg: '#EDE9FE', text: '#5B21B6', borderColor: '#8B5CF6' },
    };

    const toDateKey = (dateObj) => {
        const d = new Date(dateObj);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    const toTimeKey = (dateObj) => {
        const d = new Date(dateObj);
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };

    const toDateString = (value) => {
        if (!value) return null;
        if (typeof value === 'string' && value.length >= 10) return value.slice(0, 10);
        return toDateKey(value);
    };

    const mergeDateAndTime = (dateValue, timeValue) => {
        const dateStr = toDateString(dateValue);
        if (!dateStr || !timeValue) return null;
        return new Date(`${dateStr}T${timeValue}:00`);
    };

    // Memoized so re-renders that DON'T change the underlying data (e.g. typing in the
    // reschedule form, which lives in this same big component) don't hand FullCalendar a
    // brand-new events array each render and force it to re-process the whole calendar.
    // That per-keystroke re-processing on the main thread was what froze the dashboard.
    const fullCalendarEvents = useMemo(() => {
        // Cancelled appointments are dropped from the calendar entirely — they free the slot and
        // the red blocks just add visual noise. They're still reachable via the Cancelled tab.
        const appointmentEvents = appointments.filter(a => a.status !== 'cancelled').filter(matchesStaffFilter).map(a => {
            const start = mergeDateAndTime(a.appointmentDate, a.startTime);
            const end = mergeDateAndTime(a.appointmentDate, a.endTime);
            const colors = statusCalendarColors[a.status] || statusCalendarColors.pending;
            if (!start || !end) return null;
            return {
                id: `appt_${a._id}`,
                title: a.service?.name || 'Appointment',
                start,
                end,
                backgroundColor: colors.bg,
                borderColor: colors.borderColor || colors.bg,
                textColor: colors.text,
                extendedProps: {
                    kind: 'appointment',
                    appointmentId: a._id,
                    // An appointment's client is a registered customer, a guest
                    // (guest checkout) or a provider-logged walk-in.
                    // walkInName/guestName MUST be checked before `customer`: a
                    // walk-in or group booking stores the PROVIDER's own id in
                    // `customer` (the model requires one, and there's no account
                    // for a walk-in), so reading `customer` first labelled every
                    // walk-in with the owner's own name instead of the client's.
                    customerName: a.walkInName || a.guestName || a.customer?.name || 'Client',
                    startTime: a.startTime,
                    endTime: a.endTime,
                    status: a.status,
                    staffName: a.teamMember?.name || null,
                    staffColor: a.teamMember?.color || null,
                    raw: a,
                },
            };
        }).filter(Boolean);

        const blockedEvents = blockedTimes.filter(blockMatchesStaffFilter).map(b => {
            const start = mergeDateAndTime(b.date, b.startTime);
            const end = mergeDateAndTime(b.date, b.endTime);
            if (!start || !end) return null;
            return {
                id: `block_${b._id}`,
                title: b.reason || b.title || 'Blocked',
                start,
                end,
                backgroundColor: '#e5e7eb',
                borderColor: '#d1d5db',
                textColor: '#374151',
                editable: false,
                extendedProps: {
                    kind: 'blocked',
                    blockedId: b._id,
                    raw: b,
                },
            };
        }).filter(Boolean);

        return [...appointmentEvents, ...blockedEvents];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [appointments, blockedTimes, calendarStaffFilter]);

    const getFullCalendarView = () => {
        if (calendarView === 'day' || calendarView === 'staff') return 'timeGridDay'; // 'staff' renders its own view; this is the remount fallback
        if (calendarView === '3day') return 'timeGridThreeDay';
        if (calendarView === 'week') return 'timeGridWeek';
        return 'dayGridMonth';
    };

    // Switch views in place (changeView) instead of remounting the whole
    // calendar via key= — keeps scroll position and avoids a flash/reflow.
    useEffect(() => {
        const api = calendarRef.current?.getApi?.();
        if (api && api.view.type !== getFullCalendarView()) {
            api.changeView(getFullCalendarView());
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [calendarView]);

    const handleFullCalendarSelect = (selection) => {
        // Offer a choice (appointment vs block) instead of jumping straight to a form.
        setApptError('');
        setTimeSelectionPreview({
            date: toDateKey(selection.start),
            startTime: toTimeKey(selection.start),
            endTime: selection.end ? toTimeKey(selection.end) : toTimeKey(selection.start),
        });
    };

    // Shared by the FullCalendar views and the staff-lanes view.
    const openApptDetail = (appt, { date, startTime } = {}) => {
        if (!appt) return;
        setApptRescheduleForm({
            appointmentDate: date || toDateString(appt.appointmentDate),
            startTime: startTime || appt.startTime,
        });
        setApptDetailError('');
        setShowReschedule(false);
        setShowApptContact(false);
        setApptDetailModal(appt);
    };

    const handleFullCalendarEventClick = (clickInfo) => {
        const event = clickInfo.event;
        if (event.extendedProps.kind === 'blocked') {
            const block = blockedTimes.find(b => b._id === event.extendedProps.blockedId);
            openBlockedTimeForm(block || null);
            return;
        }
        openApptDetail(event.extendedProps.raw || null, {
            date: toDateString(event.start),
            startTime: toTimeKey(event.start),
        });
    };

    const showCalendarToast = (msg, type = 'success') => {
        setCalendarToast({ msg, type });
        window.clearTimeout(showCalendarToast._t);
        showCalendarToast._t = window.setTimeout(() => setCalendarToast(null), 3200);
    };

    // On drop, don't save immediately — ask the provider to confirm the move first.
    // Works for both appointments and blocked time.
    const handleFullCalendarEventDrop = (dropInfo) => {
        const event = dropInfo.event;
        const kind = event.extendedProps.kind;
        if (kind !== 'appointment' && kind !== 'blocked') { dropInfo.revert(); return; }
        if (navigator.vibrate) { try { navigator.vibrate(12); } catch (_) {} }
        const appointmentDate = toDateString(event.start);
        const startTime = toTimeKey(event.start);
        const endTime = event.end ? toTimeKey(event.end) : undefined;
        setPendingMove({
            kind,
            info: dropInfo,
            id: kind === 'appointment' ? event.extendedProps.appointmentId : event.extendedProps.blockedId,
            title: event.title,
            appointmentDate, startTime, endTime,
            label: `${event.start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${startTime}${endTime ? `–${endTime}` : ''}`,
        });
    };

    const confirmPendingMove = async () => {
        if (!pendingMove) return;
        const { kind, id, appointmentDate, startTime, endTime, info } = pendingMove;
        try {
            if (kind === 'appointment') {
                const res = await appointmentService.providerRescheduleAppointment(id, { appointmentDate, startTime });
                setAppointments(prev => prev.map(a => a._id === id ? { ...a, ...res.data.data } : a));
            } else {
                await blockedTimeService.updateBlockedTime(id, { date: appointmentDate, startTime, endTime });
                await fetchBlockedTimes();
            }
            showCalendarToast(`Moved to ${pendingMove.label}`);
        } catch (err) {
            showCalendarToast(err.response?.data?.message || 'Could not move', 'error');
            info.revert();
        } finally {
            setPendingMove(null);
        }
    };

    const cancelPendingMove = () => {
        if (pendingMove) { pendingMove.info.revert(); setPendingMove(null); }
    };

    // Tap a grayed (non-working) slot → quick-edit that day's working hours.
    const handleCalendarDateClick = (info) => {
        if (!availability) return;
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const dayName = dayNames[info.date.getDay()];
        const cfg = availability[dayName] || {};
        const slot = cfg.slots?.[0];
        const mins = info.date.getHours() * 60 + info.date.getMinutes();
        const within = cfg.enabled && slot && (() => {
            const [sh, sm] = slot.start.split(':').map(Number);
            const [eh, em] = slot.end.split(':').map(Number);
            return mins >= sh * 60 + sm && mins < eh * 60 + em;
        })();
        if (within) return; // inside working hours — leave for drag-to-book
        setAdjustHours({
            day: dayName,
            label: info.date.toLocaleDateString('en-US', { weekday: 'long' }),
            enabled: cfg.enabled ?? true,
            start: slot?.start || '09:00',
            end: slot?.end || '17:00',
        });
    };

    const saveAdjustHours = async () => {
        if (!adjustHours) return;
        const { day, enabled, start, end } = adjustHours;
        if (enabled && start >= end) { showCalendarToast('End time must be after start time', 'error'); return; }
        setSavingAdjustHours(true);
        const next = { ...availability, [day]: { enabled, slots: [{ start, end }] } };
        try {
            await availabilityService.updateMyAvailability(next);
            setAvailability(next);
            showCalendarToast(`Working hours updated for ${adjustHours.label}`);
            setAdjustHours(null);
        } catch {
            showCalendarToast('Could not update hours', 'error');
        } finally {
            setSavingAdjustHours(false);
        }
    };

    // Resize-to-change-duration. Sends an explicit endTime.
    const handleFullCalendarEventResize = async (resizeInfo) => {
        const event = resizeInfo.event;
        if (event.extendedProps.kind !== 'appointment') {
            resizeInfo.revert();
            return;
        }
        try {
            const appointmentId = event.extendedProps.appointmentId;
            const appointmentDate = toDateString(event.start);
            const startTime = toTimeKey(event.start);
            const endTime = event.end ? toTimeKey(event.end) : undefined;
            const res = await appointmentService.providerRescheduleAppointment(appointmentId, { appointmentDate, startTime, endTime });
            setAppointments(prev => prev.map(a => a._id === appointmentId ? { ...a, ...res.data.data } : a));
            showCalendarToast(`Duration updated · ${startTime}–${endTime}`);
        } catch (err) {
            showCalendarToast(err.response?.data?.message || 'Could not change duration', 'error');
            resizeInfo.revert();
        }
    };

    const appointmentTabs = ['pending', 'confirmed', 'completed', 'cancelled'];
    // Earliest booking first (date + start time), so the soonest is always at the top.
    const apptTime = (a) => {
        const d = new Date(a.appointmentDate);
        if (isNaN(d)) return 0;
        const [h = 0, m = 0] = (a.startTime || '00:00').split(':').map(Number);
        d.setHours(h, m, 0, 0);
        return d.getTime();
    };
    const filtered = appointments
        .filter(a => a.status === activeTab)
        .sort((x, y) => apptTime(x) - apptTime(y));
    const counts = appointmentTabs.reduce((acc, t) => {
        acc[t] = appointments.filter(a => a.status === t).length;
        return acc;
    }, {});

    const stats = [
        { label: 'Total', value: appointments.length, Icon: ClipboardList },
        { label: 'Pending', value: counts.pending, Icon: CalendarClock },
        { label: 'Confirmed', value: counts.confirmed, Icon: Calendar },
        { label: 'Completed', value: counts.completed, Icon: TrendingUp },
    ];

    // Personal, at-a-glance greeting for the dashboard landing (iOS feel)
    const _now = new Date();
    const greeting = _now.getHours() < 12 ? 'Good morning' : _now.getHours() < 18 ? 'Good afternoon' : 'Good evening';
    const firstName = (user?.name || '').trim().split(' ')[0];
    const todayLabel = _now.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' });
    const todaysAppts = appointments.filter(a => {
        const d = new Date(a.appointmentDate);
        return d.toDateString() === _now.toDateString() && a.status !== 'cancelled';
    });
    const todaysCount = todaysAppts.length;
    // "Coming up" = today's appointments that haven't finished yet, so a booking
    // that already ended this morning doesn't get advertised as still pending.
    const upcomingTodayCount = todaysAppts.filter(a => {
        const end = mergeDateAndTime(a.appointmentDate, a.endTime || a.startTime);
        return !end || end.getTime() > _now.getTime();
    }).length;

    // Build FullCalendar businessHours from the provider's availability so the
    // calendar greys out non-working time (and constrains drag/resize to it).
    const businessHoursConfig = useMemo(() => {
        if (!availability) return false;
        const idx = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
        const out = [];
        Object.entries(availability).forEach(([day, cfg]) => {
            if (cfg?.enabled && Array.isArray(cfg.slots)) {
                cfg.slots.forEach(s => { if (s?.start && s?.end) out.push({ daysOfWeek: [idx[day]], startTime: s.start, endTime: s.end }); });
            }
        });
        return out.length ? out : false;
    }, [availability]);

    // Span the calendar to the provider's ACTUAL working hours AND anything already
    // scheduled outside them (appointments / blocked times), widening the default
    // 07:00–22:00 window as needed — so nothing bookable or booked is hidden off-grid.
    // The calendar shows the full 24h day (non-working hours are greyed via
    // businessHours below); open it scrolled to the earliest hour the provider
    // works, falling back to 07:00.
    const calendarScrollTime = useMemo(() => {
        let minM = 7 * 60;
        if (availability) {
            Object.values(availability).forEach(cfg => {
                if (cfg?.enabled && Array.isArray(cfg.slots)) {
                    cfg.slots.forEach(s => {
                        const [sh, sm] = String(s?.start || '').split(':').map(Number);
                        if (Number.isFinite(sh)) minM = Math.min(minM, sh * 60 + (sm || 0));
                    });
                }
            });
        }
        const h = Math.max(0, Math.floor(minM / 60));
        return `${String(h).padStart(2, '0')}:00:00`;
    }, [availability]);

    const labelStyle = { display: 'block', fontSize: '0.78rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.4rem', letterSpacing: '0.05em', textTransform: 'uppercase' };

    return (
        <div style={{ background: 'var(--off-white)', minHeight: '100dvh' }}>
            {showWizard && (
                <Suspense fallback={null}>
                    <OnboardingWizard
                        user={user}
                        onComplete={(updatedUser) => {
                            setUser(updatedUser);
                            setShowWizard(false);
                        }}
                    />
                </Suspense>
            )}

            {/* Header */}
            <div className="provider-header" style={{ background: 'var(--ink)', paddingTop: 'var(--page-hero-pad-top)', paddingBottom: '1.75rem', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(ellipse at 70% 40%, rgba(240,62,22,0.05) 0%, transparent 60%)', pointerEvents: 'none' }} />
                <div className="container" style={{ position: 'relative' }}>
                    <p style={{ color: 'var(--gold)', fontSize: '0.75rem', fontWeight: '600', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>{todayLabel}</p>
                    <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2.2rem, 4vw, 3.25rem)', fontWeight: '700', color: 'white', lineHeight: 1.05, marginBottom: '0.5rem' }}>
                        {greeting}{firstName ? <>, <span style={{ color: 'var(--gold)' }}>{firstName}</span></> : ''}
                    </h1>
                    <p style={{ color: 'rgba(255,255,255,0.62)', fontSize: '0.98rem', maxWidth: '56ch', lineHeight: 1.65, marginBottom: '1.25rem' }}>
                        {upcomingTodayCount > 0
                            ? `You have ${upcomingTodayCount} appointment${upcomingTodayCount > 1 ? 's' : ''} coming up today.`
                            : todaysCount > 0
                                ? "You're all caught up — no more appointments today."
                                : 'No appointments scheduled for today.'}
                    </p>
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <Link to="/account" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', color: 'rgba(255,255,255,0.7)', fontFamily: 'var(--font-body)', fontSize: '0.85rem', textDecoration: 'none', border: '1px solid rgba(255,255,255,0.2)', padding: '0.45rem 0.9rem', borderRadius: 'var(--radius-sm)', transition: 'all 0.2s' }}
                        onMouseEnter={e => e.currentTarget.style.color = 'white'}
                        onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.7)'}
                    ><UserCog size={15} strokeWidth={2} /> My Account</Link>
                    </div>
                </div>
            </div>

            <div className="container" style={{ paddingTop: '1.5rem', paddingBottom: '5rem' }}>

                <EnablePushBanner />
                <SetupChecklistNudge />

                {error && (
                    <div role="alert" style={{ background: 'var(--danger-bg)', border: '1px solid #fca5a5', color: 'var(--danger-fg)', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
                        {error}
                    </div>
                )}
                {loading && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0', marginBottom: '1rem' }}>
                        <div style={{ width: '16px', height: '16px', border: '2px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Loading appointments...</span>
                        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                    </div>
                )}

                {/* The in-page tab strip was removed — navigation now lives in the top
                    nav (Calendar / Clients / Earnings / Catalogue / More) and Settings,
                    reaching each view via /dashboard?tab=. */}

                {/* Appointment tabs */}
                {appointmentTabs.includes(activeTab) && (
                    <>
                        {filtered.length === 0 ? (
                            <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '4rem 2rem', textAlign: 'center' }}>
                                <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📭</div>
                                <p style={{ fontFamily: 'var(--font-body)', fontSize: '1.1rem', color: 'var(--charcoal)', marginBottom: '0.35rem' }}>No {activeTab} appointments</p>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Check back later or switch tabs to see other bookings.</p>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                {filtered.map((a, i) => {
                                    const s = statusConfig[a.status] || statusConfig.pending;
                                    return (
                                        <div key={a._id} className="fade-up provider-card appt-card-grid" style={{
                                            animationDelay: `${i * 0.05}s`, opacity: 0,
                                            background: 'var(--card-bg)', borderRadius: 'var(--radius)',
                                            border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)',
                                            padding: '1.5rem 2rem', display: 'grid',
                                            gridTemplateColumns: '1fr 1fr 1fr auto',
                                            alignItems: 'center', gap: '2rem',
                                        }}>
                                            <div>
                                                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.35rem' }}>Customer</p>
                                                <p style={{ fontFamily: 'var(--font-body)', fontWeight: '600', color: 'var(--charcoal)' }}>{a.walkInName || a.customer?.name}</p>
                                                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{a.customer?.email}</p>
                                                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{a.customer?.phone}</p>
                                            </div>
                                            <div>
                                                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.35rem' }}>Service</p>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                    <p style={{ fontWeight: '600', color: 'var(--charcoal)', margin: 0 }}>{a.service?.name}</p>
                                                    {a.isRecurring && <span title="Recurring appointment" style={{ fontSize: '0.7rem', background: 'rgba(240,62,22,0.12)', color: 'var(--gold-dark)', borderRadius: '99px', padding: '0.1rem 0.4rem', fontWeight: '700' }}>↻</span>}
                                                </div>
                                                <p style={{ color: 'var(--gold-dark)', fontWeight: '600', fontSize: '0.875rem' }}>{curSym} {a.service?.price} · {a.service?.duration} min</p>
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
                                                        <button onClick={() => handleStatusUpdate(a._id, 'confirmed')} style={{ background: '#d1fae5', border: '1px solid #6ee7b7', color: '#065f46', padding: '0.4rem 0.875rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600', fontFamily: 'var(--font-body)' }}>Accept</button>
                                                        <button onClick={() => handleStatusUpdate(a._id, 'cancelled')} style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#ef4444', padding: '0.4rem 0.875rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600', fontFamily: 'var(--font-body)' }}>Decline</button>
                                                    </div>
                                                )}
                                                {a.status === 'confirmed' && (
                                                    <button onClick={() => handleStatusUpdate(a._id, 'completed')} style={{ background: '#dbeafe', border: '1px solid #93c5fd', color: '#1e40af', padding: '0.4rem 0.875rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600', fontFamily: 'var(--font-body)' }}>Mark Complete</button>
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
                                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: '600', color: 'var(--charcoal)' }}>Service menu</h2>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>View and manage the services offered by your business</p>
                            </div>
                            <button onClick={() => { setEditingService(null); setShowServiceForm(true); }} className="btn-primary" style={{ padding: '0.65rem 1.25rem', fontSize: '0.875rem' }}>
                                + Add Service
                            </button>
                        </div>

                        <div style={{ marginBottom: '1.5rem' }}>
                            <div style={{ position: 'relative', maxWidth: '360px' }}>
                                <svg
                                    width="16" height="16" viewBox="0 0 24 24" fill="none"
                                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                                    aria-hidden="true"
                                    style={{ position: 'absolute', left: '0.875rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }}
                                >
                                    <circle cx="11" cy="11" r="8" />
                                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                                </svg>
                                <input value={catalogueSearch} onChange={e => setCatalogueSearch(e.target.value)} placeholder="Search service name" aria-label="Search services" className="input" style={{ paddingLeft: '2.5rem' }} />
                            </div>
                        </div>

                        <ServiceFormModal
                            open={showServiceForm}
                            editing={editingService}
                            categories={categories}
                            onClose={() => { setShowServiceForm(false); setEditingService(null); }}
                            onSaved={async () => { await fetchMyServices(); setShowServiceForm(false); setEditingService(null); }}
                            onCategoriesChanged={fetchCategories}
                        />

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
                                        <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.25rem' }}>
                                            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '1rem' }}>Categories</h3>
                                            {sidebarItems.map(item => {
                                                const active = catalogueCategory === item.id;
                                                return (
                                                    <div key={item.id} style={{ display: 'flex', alignItems: 'center', marginBottom: '0.25rem' }}>
                                                        <button onClick={() => setCatalogueCategory(item.id)} style={{
                                                            flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                            padding: '0.6rem 0.75rem', borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer', textAlign: 'left',
                                                            background: active ? 'rgba(240,62,22,0.1)' : 'transparent',
                                                            color: active ? 'var(--gold-dark)' : 'var(--text-secondary)',
                                                            fontWeight: active ? '600' : '400', fontFamily: 'var(--font-body)', fontSize: '0.875rem',
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
                                                            <button type="button" onClick={() => { setShowCategoryForm(false); setNewCategoryName(''); }} style={{ flex: 1, padding: '0.5rem', fontSize: '0.8rem', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', color: 'var(--text-secondary)', fontFamily: 'var(--font-body)' }}>Cancel</button>
                                                        </div>
                                                    </form>
                                                ) : (
                                                    <button onClick={() => setShowCategoryForm(true)} style={{ background: 'none', border: 'none', color: 'var(--gold-dark)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600', fontFamily: 'var(--font-body)', padding: 0 }}>+ Add category</button>
                                                )}
                                            </div>
                                        </div>

                                        {/* Services list grouped by category */}
                                        <div>
                                            {catalogueFiltered.length === 0 ? (
                                                <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '4rem 2rem', textAlign: 'center' }}>
                                                    <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>✂️</div>
                                                    <p style={{ fontFamily: 'var(--font-body)', fontSize: '1.1rem', color: 'var(--charcoal)', marginBottom: '0.35rem' }}>{catalogueSearch ? 'No services match your search' : 'No services yet'}</p>
                                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>{catalogueSearch ? 'Try a different name' : 'Add your first service to start receiving bookings'}</p>
                                                </div>
                                            ) : (
                                                groups.map(group => {
                                                    const svcs = servicesInCategory(group.id);
                                                    if (svcs.length === 0) return null;
                                                    return (
                                                        <div key={group.id} style={{ marginBottom: '1.5rem' }}>
                                                            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '0.75rem' }}>{group.name}</h3>
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                                                {svcs.map(s => (
                                                                    <div key={s._id} style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', borderLeft: '3px solid var(--gold)', padding: '1rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                                                                        <div style={{ minWidth: 0 }}>
                                                                            <p style={{ fontFamily: 'var(--font-body)', fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.95rem', marginBottom: '0.2rem' }}>{s.name}</p>
                                                                            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{s.duration} min{s.location ? ` · 📍 ${s.location}` : ''}</p>
                                                                        </div>
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
                                                                            <span style={{ fontFamily: 'var(--font-body)', fontWeight: '700', color: 'var(--charcoal)', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{curSym} {s.price}</span>
                                                                            <button onClick={() => handleEditService(s)} style={{ background: 'rgba(240,62,22,0.1)', border: '1px solid rgba(240,62,22,0.3)', color: 'var(--gold-dark)', padding: '0.35rem 0.875rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600', fontFamily: 'var(--font-body)' }}>Edit</button>
                                                                            <button onClick={() => handleDeleteService(s._id)} style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#ef4444', padding: '0.35rem 0.875rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600', fontFamily: 'var(--font-body)' }}>Delete</button>
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
                                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: '600', color: 'var(--charcoal)' }}>Working Hours</h2>
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
                            <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                                {Object.entries(availability).map(([day, config], i) => (
                                    <div key={day} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', padding: '1.05rem 1.25rem', borderBottom: i < 6 ? '1px solid var(--border)' : 'none', background: config.enabled ? 'var(--card-bg)' : 'var(--surface-sunken)', transition: 'background 0.2s' }}>
                                        <div style={{ minWidth: 0, flex: 1 }}>
                                            <div style={{ fontWeight: '600', color: config.enabled ? 'var(--charcoal)' : 'var(--text-muted)', fontSize: '1rem', textTransform: 'capitalize', marginBottom: config.enabled ? '0.55rem' : 0 }}>{day}</div>
                                            {config.enabled ? (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                    <input type="time" value={config.slots[0]?.start || '09:00'} onChange={e => handleTimeChange(day, 'start', e.target.value)} className="input" style={{ width: '112px', maxWidth: '42vw', padding: '0.45rem 0.6rem', fontSize: '0.9rem' }} />
                                                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', flexShrink: 0 }}>to</span>
                                                    <input type="time" value={config.slots[0]?.end || '17:00'} onChange={e => handleTimeChange(day, 'end', e.target.value)} className="input" style={{ width: '112px', maxWidth: '42vw', padding: '0.45rem 0.6rem', fontSize: '0.9rem' }} />
                                                </div>
                                            ) : (
                                                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Not available</div>
                                            )}
                                        </div>
                                        <button onClick={() => handleDayToggle(day)} aria-label={`Toggle ${day}`} style={{ width: '50px', height: '30px', borderRadius: '99px', border: 'none', background: config.enabled ? 'var(--gold)' : '#cbd0d8', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0, alignSelf: 'center' }}>
                                            <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'white', position: 'absolute', top: '3px', left: '3px', transform: config.enabled ? 'translateX(20px)' : 'translateX(0)', transition: 'transform 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.25)' }} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Blocked Times section */}
                        <div style={{ marginTop: '2rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                <div>
                                    <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: '600', color: 'var(--charcoal)' }}>Blocked Times</h2>
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.825rem', marginTop: '0.2rem' }}>Block off time when you're unavailable</p>
                                </div>
                                {!showBlockedTimeForm && (
                                    <button onClick={() => openBlockedTimeForm()} className="btn-outline" style={{ padding: '0.55rem 1.1rem', fontSize: '0.825rem' }}>+ Add blocked time</button>
                                )}
                            </div>

                            {/* Add / Edit form — now handled by the right-side slide-in panel (showBlockedTimeForm) */}

                            {/* Blocked times list */}
                            {blockedTimes.length === 0 ? (
                                <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '2rem', textAlign: 'center' }}>
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No blocked times yet. Add one to mark times when you're unavailable.</p>
                                </div>
                            ) : (
                                <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                                    {blockedTimes.map((bt, i) => (
                                        <div key={bt._id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.875rem 1.25rem', borderBottom: i < blockedTimes.length - 1 ? '1px solid var(--border)' : 'none', gap: '1rem' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', minWidth: 0 }}>
                                                <div style={{ width: '38px', height: '38px', borderRadius: '8px', background: 'rgba(240,62,22,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', flexShrink: 0 }}>🚫</div>
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

                {/* Overview tab — non-financial business stats */}
                {activeTab === 'overview' && (() => {
                    const todayStr = new Date().toDateString();
                    const now = new Date();
                    const todays = appointments.filter(a => new Date(a.appointmentDate).toDateString() === todayStr && a.status !== 'cancelled');
                    const upcoming = appointments.filter(a => new Date(a.appointmentDate) >= now && a.status === 'confirmed');
                    const completedAll = appointments.filter(a => a.status === 'completed');
                    const cancelledAll = appointments.filter(a => a.status === 'cancelled');
                    const byService = Object.values(appointments.reduce((acc, a) => {
                        const name = a.service?.name || 'Other';
                        acc[name] = acc[name] || { name, count: 0 };
                        acc[name].count += 1;
                        return acc;
                    }, {})).sort((a, b) => b.count - a.count).slice(0, 6);
                    const recent = [...appointments].sort((a, b) => new Date(b.appointmentDate) - new Date(a.appointmentDate)).slice(0, 8);
                    const clientNames = new Set(appointments.map(a => a.customer?._id || a.walkInName).filter(Boolean));
                    return (
                        <div>
                            <div style={{ marginBottom: '1.5rem' }}>
                                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: '600', color: 'var(--charcoal)' }}>Business Overview</h2>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Your bookings at a glance</p>
                            </div>

                            <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                                {[
                                    { label: "Today's Bookings", value: todays.length, icon: '📅', sub: 'Scheduled today' },
                                    { label: 'Upcoming', value: upcoming.length, icon: '⏳', sub: 'Confirmed ahead' },
                                    { label: 'Completed', value: completedAll.length, icon: '✅', sub: 'All time' },
                                    { label: 'Clients Served', value: clientNames.size, icon: '👥', sub: `${cancelledAll.length} cancellations` },
                                ].map((s, i) => (
                                    <div key={i} style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                        <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: 'rgba(240,62,22,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', flexShrink: 0 }}>{s.icon}</div>
                                        <div>
                                            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{s.label}</p>
                                            <p style={{ fontFamily: 'var(--font-body)', fontSize: '1.5rem', fontWeight: '700', color: 'var(--charcoal)', lineHeight: 1 }}>{s.value}</p>
                                            {s.sub && <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{s.sub}</p>}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="provider-profile-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
                                <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem' }}>
                                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '1.25rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border)' }}>Popular Services</h3>
                                    {byService.length === 0 ? (
                                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No bookings yet</p>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                                            {byService.map((s, i) => {
                                                const max = byService[0]?.count || 1;
                                                return (
                                                    <div key={i}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                                                            <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', fontWeight: '500', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                                                            <span style={{ fontSize: '0.875rem', fontWeight: '700', color: 'var(--charcoal)', flexShrink: 0, whiteSpace: 'nowrap' }}>{s.count} booking{s.count !== 1 ? 's' : ''}</span>
                                                        </div>
                                                        <div style={{ height: '6px', borderRadius: '99px', background: 'var(--warm-gray)', overflow: 'hidden' }}>
                                                            <div style={{ height: '100%', borderRadius: '99px', background: 'var(--gold)', width: `${(s.count / max) * 100}%`, transition: 'width 0.5s ease' }} />
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>

                                <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem' }}>
                                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '1.25rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border)' }}>Booking Status</h3>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                        {['pending', 'confirmed', 'completed', 'cancelled'].map(st => {
                                            const cnt = appointments.filter(a => a.status === st).length;
                                            const total = Math.max(appointments.length, 1);
                                            const cfg = statusConfig[st];
                                            return (
                                                <div key={st}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                                                        <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', fontWeight: '500', textTransform: 'capitalize' }}>{cfg?.label || st}</span>
                                                        <span style={{ fontSize: '0.875rem', fontWeight: '700', color: 'var(--charcoal)' }}>{cnt}</span>
                                                    </div>
                                                    <div style={{ height: '8px', borderRadius: '99px', background: 'var(--warm-gray)', overflow: 'hidden' }}>
                                                        <div style={{ height: '100%', borderRadius: '99px', background: cfg?.bg || 'var(--gold)', width: `${(cnt / total) * 100}%`, transition: 'width 0.5s ease' }} />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>

                            {providerWaitlist.length > 0 && (
                                <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem', marginBottom: '1.5rem' }}>
                                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border)' }}>
                                        Waiting List <span style={{ fontSize: '0.75rem', fontWeight: '700', background: 'rgba(240,62,22,0.12)', color: 'var(--gold-dark)', borderRadius: '99px', padding: '0.15rem 0.6rem', marginLeft: '0.4rem' }}>{providerWaitlist.length}</span>
                                    </h3>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                        {providerWaitlist.slice(0, 6).map((w) => (
                                            <div key={w._id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                                                <div>
                                                    <p style={{ fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.875rem', margin: 0 }}>{w.customer?.name}</p>
                                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: 0 }}>{w.service?.name} · {new Date(w.appointmentDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at {w.startTime}</p>
                                                </div>
                                                <span style={{ fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-muted)', background: 'var(--warm-gray)', borderRadius: '99px', padding: '0.2rem 0.65rem', whiteSpace: 'nowrap' }}>#{w.position} in queue</span>
                                            </div>
                                        ))}
                                        {providerWaitlist.length > 6 && <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>+{providerWaitlist.length - 6} more waiting</p>}
                                    </div>
                                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.85rem', marginBottom: 0 }}>Clients are promoted automatically when a matching slot opens up.</p>
                                </div>
                            )}

                            <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                                <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)' }}>
                                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)' }}>Recent Activity</h3>
                                </div>
                                {recent.length === 0 ? (
                                    <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}><p>No bookings yet</p></div>
                                ) : (
                                    <div className="table-scroll">
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                                            <thead>
                                                <tr style={{ background: 'var(--warm-gray)', borderBottom: '1px solid var(--border)' }}>
                                                    {['Client', 'Service', 'Date', 'Time', 'Status'].map(h => (
                                                        <th key={h} style={{ padding: '0.875rem 1rem', textAlign: 'left', fontSize: '0.7rem', fontWeight: '600', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{h}</th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {recent.map((a) => {
                                                    const cfg = statusConfig[a.status] || statusConfig.pending;
                                                    return (
                                                        <tr key={a._id} style={{ borderBottom: '1px solid var(--border)' }}>
                                                            <td style={{ padding: '0.875rem 1rem', fontWeight: '600', color: 'var(--charcoal)' }}>{a.walkInName || a.customer?.name || '—'}</td>
                                                            <td style={{ padding: '0.875rem 1rem', color: 'var(--text-secondary)' }}>{a.service?.name}</td>
                                                            <td style={{ padding: '0.875rem 1rem', color: 'var(--text-secondary)' }}>{new Date(a.appointmentDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                                                            <td style={{ padding: '0.875rem 1rem', color: 'var(--text-secondary)' }}>{a.startTime} – {a.endTime}</td>
                                                            <td style={{ padding: '0.875rem 1rem' }}>
                                                                <span style={{ padding: '0.2rem 0.65rem', borderRadius: '99px', fontSize: '0.72rem', fontWeight: '600', background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })()}

                {/* Waiting List tab */}
                {activeTab === 'waitlist' && (
                    <div>
                        <div style={{ marginBottom: '1.25rem' }}>
                            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: '600', color: 'var(--charcoal)' }}>Waiting List</h2>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Clients waiting for a slot. They're promoted automatically when a matching time opens up.</p>
                        </div>
                        {providerWaitlist.length === 0 ? (
                            <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '4rem 2rem', textAlign: 'center' }}>
                                <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>⏳</div>
                                <p style={{ fontFamily: 'var(--font-body)', fontSize: '1.1rem', color: 'var(--charcoal)', marginBottom: '0.35rem' }}>No one's waiting right now</p>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>When you're fully booked, clients can join the waiting list and you'll see them here.</p>
                            </div>
                        ) : (
                            <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '0.5rem 1.5rem' }}>
                                {providerWaitlist.map((w, i) => (
                                    <div key={w._id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', padding: '1rem 0', borderBottom: i < providerWaitlist.length - 1 ? '1px solid var(--border)' : 'none' }}>
                                        <div>
                                            <p style={{ fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.9rem', margin: 0 }}>{w.customer?.name}</p>
                                            <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: 0 }}>{w.service?.name} · {new Date(w.appointmentDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at {w.startTime}</p>
                                        </div>
                                        <span style={{ fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-muted)', background: 'var(--warm-gray)', borderRadius: '99px', padding: '0.2rem 0.65rem', whiteSpace: 'nowrap' }}>#{w.position} in queue</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Insights tab — operational (non-financial) analytics */}
                {activeTab === 'insights' && (
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem' }}>
                            <div>
                                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: '600', color: 'var(--charcoal)' }}>Insights</h2>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>How busy you are, when, and who's coming back.</p>
                            </div>
                            <button onClick={exportInsightsCsv} disabled={!insights} style={{ padding: '0.5rem 1rem', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', cursor: insights ? 'pointer' : 'not-allowed', fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)', fontFamily: 'var(--font-body)' }}>⬇ Export CSV</button>
                        </div>

                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
                            {[['week','This week'],['month','This month'],['lastMonth','Last month'],['30d','Last 30 days']].map(([key, label]) => (
                                <button key={key} onClick={() => { setInsightsPreset(key); fetchInsights(key); }} style={{
                                    padding: '0.4rem 1rem', borderRadius: '99px', border: '1.5px solid',
                                    borderColor: insightsPreset === key ? 'var(--gold)' : 'var(--border)',
                                    background: insightsPreset === key ? 'rgba(240,62,22,0.12)' : 'var(--card-bg)',
                                    color: insightsPreset === key ? 'var(--gold-dark)' : 'var(--text-secondary)',
                                    fontSize: '0.8rem', fontWeight: insightsPreset === key ? '600' : '400', cursor: 'pointer', fontFamily: 'var(--font-body)',
                                }}>{label}</button>
                            ))}
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center', marginLeft: '0.25rem' }}>
                                <input type="date" value={insightsRange.from} onChange={e => setInsightsRange(r => ({ ...r, from: e.target.value }))} className="input" style={{ fontSize: '0.78rem', padding: '0.35rem 0.5rem', flex: '1 1 120px', minWidth: 0 }} />
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>–</span>
                                <input type="date" value={insightsRange.to} onChange={e => setInsightsRange(r => ({ ...r, to: e.target.value }))} className="input" style={{ fontSize: '0.78rem', padding: '0.35rem 0.5rem', flex: '1 1 120px', minWidth: 0 }} />
                                <button onClick={() => { setInsightsPreset('custom'); fetchInsights('custom', insightsRange); }} disabled={!insightsRange.from || !insightsRange.to} style={{ padding: '0.4rem 0.85rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text-secondary)', fontSize: '0.78rem', fontWeight: '600', cursor: (insightsRange.from && insightsRange.to) ? 'pointer' : 'not-allowed', fontFamily: 'var(--font-body)' }}>Apply</button>
                            </div>
                        </div>

                        {loadingInsights ? (
                            <StatsSkeleton />
                        ) : insightsError ? (
                            <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
                                <p style={{ marginBottom: '1rem' }}>{insightsError}</p>
                                <button onClick={() => fetchInsights()} className="btn-primary" style={{ padding: '0.5rem 1.25rem', fontSize: '0.85rem' }}>Retry</button>
                            </div>
                        ) : insights ? (
                            <>
                                <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                                    {[
                                        { label: 'Utilization', value: `${insights.rates.utilizationPct}%`, icon: '⚡', sub: `${Math.round(insights.utilization.bookedMinutes / 60)}h booked` },
                                        { label: 'No-show rate', value: `${insights.rates.noShowRate}%`, icon: '🚫', sub: `${insights.totals.noShow} no-shows` },
                                        { label: 'New clients', value: insights.clients.new, icon: '✨', sub: `${insights.clients.returning} returning` },
                                        { label: 'Waitlist', value: insights.waitlistVolume, icon: '⏳', sub: 'Currently waiting' },
                                    ].map((s, i) => (
                                        <div key={i} style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                            <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: 'rgba(240,62,22,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', flexShrink: 0 }}>{s.icon}</div>
                                            <div>
                                                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{s.label}</p>
                                                <p style={{ fontFamily: 'var(--font-body)', fontSize: '1.5rem', fontWeight: '700', color: 'var(--charcoal)', lineHeight: 1 }}>{s.value}</p>
                                                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{s.sub}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="provider-profile-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
                                    <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem' }}>
                                        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '1.25rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border)' }}>Peak hours</h3>
                                        {(() => {
                                            const max = Math.max(...insights.peakHours.map(h => h.count), 1);
                                            return (
                                                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '140px' }}>
                                                    {insights.peakHours.map((h, i) => (
                                                        <div key={i} title={`${h.label}: ${h.count}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                                                            <div style={{ width: '100%', height: `${(h.count / max) * 100}%`, minHeight: h.count > 0 ? '3px' : '0', background: 'var(--gold)', borderRadius: '3px 3px 0 0', transition: 'height 0.4s ease' }} />
                                                        </div>
                                                    ))}
                                                </div>
                                            );
                                        })()}
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
                                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{insights.peakHours[0]?.label}</span>
                                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{insights.peakHours[insights.peakHours.length - 1]?.label}</span>
                                        </div>
                                    </div>

                                    <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem' }}>
                                        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '1.25rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border)' }}>Busiest days</h3>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                            {(() => {
                                                const max = Math.max(...insights.peakDays.map(d => d.count), 1);
                                                return insights.peakDays.map((d, i) => (
                                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                        <span style={{ fontSize: '0.78rem', fontWeight: '600', color: 'var(--text-secondary)', width: '34px', flexShrink: 0, textTransform: 'capitalize' }}>{d.day}</span>
                                                        <div style={{ flex: 1, height: '8px', borderRadius: '99px', background: 'var(--warm-gray)', overflow: 'hidden' }}>
                                                            <div style={{ height: '100%', borderRadius: '99px', background: 'var(--gold)', width: `${(d.count / max) * 100}%`, transition: 'width 0.5s ease' }} />
                                                        </div>
                                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', width: '20px', textAlign: 'right', flexShrink: 0 }}>{d.count}</span>
                                                    </div>
                                                ));
                                            })()}
                                        </div>
                                    </div>
                                </div>

                                <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem' }}>
                                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '1.25rem' }}>Bookings over time</h3>
                                    {(() => {
                                        const max = Math.max(...insights.overTime.map(d => d.count), 1);
                                        return (
                                            <>
                                                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '150px' }}>
                                                    {insights.overTime.map((d, i) => (
                                                        <div key={i} title={`${d.label}: ${d.count}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                                                            <div style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count > 0 ? '3px' : '0', background: 'var(--charcoal)', borderRadius: '3px 3px 0 0', transition: 'height 0.4s ease' }} />
                                                        </div>
                                                    ))}
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
                                                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{insights.overTime[0]?.label}</span>
                                                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{insights.overTime[insights.overTime.length - 1]?.label}</span>
                                                </div>
                                            </>
                                        );
                                    })()}
                                </div>
                            </>
                        ) : (
                            <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}><p>No insights yet</p></div>
                        )}
                    </div>
                )}

                {/* Earnings tab — value of completed appointments (reporting only) */}
                {activeTab === 'earnings' && (
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem' }}>
                            <div>
                                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: '600', color: 'var(--charcoal)' }}>Earnings</h2>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Value of your completed appointments. Collected in person.</p>
                            </div>
                            <button onClick={exportEarningsCsv} disabled={!earnings} style={{ padding: '0.5rem 1rem', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', cursor: earnings ? 'pointer' : 'not-allowed', fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)', fontFamily: 'var(--font-body)' }}>
                                ⬇ Export CSV
                            </button>
                        </div>

                        {/* Date range presets */}
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
                            {[['week','This week'],['month','This month'],['lastMonth','Last month'],['30d','Last 30 days']].map(([key, label]) => (
                                <button key={key} onClick={() => { setEarningsPreset(key); fetchEarnings(key); }} style={{
                                    padding: '0.4rem 1rem', borderRadius: '99px', border: '1.5px solid',
                                    borderColor: earningsPreset === key ? 'var(--gold)' : 'var(--border)',
                                    background: earningsPreset === key ? 'rgba(240,62,22,0.12)' : 'var(--card-bg)',
                                    color: earningsPreset === key ? 'var(--gold-dark)' : 'var(--text-secondary)',
                                    fontSize: '0.8rem', fontWeight: earningsPreset === key ? '600' : '400', cursor: 'pointer', fontFamily: 'var(--font-body)',
                                }}>{label}</button>
                            ))}
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center', marginLeft: '0.25rem' }}>
                                <input type="date" value={earningsRange.from} onChange={e => setEarningsRange(r => ({ ...r, from: e.target.value }))} className="input" style={{ fontSize: '0.78rem', padding: '0.35rem 0.5rem', flex: '1 1 120px', minWidth: 0 }} />
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>–</span>
                                <input type="date" value={earningsRange.to} onChange={e => setEarningsRange(r => ({ ...r, to: e.target.value }))} className="input" style={{ fontSize: '0.78rem', padding: '0.35rem 0.5rem', flex: '1 1 120px', minWidth: 0 }} />
                                <button onClick={() => { setEarningsPreset('custom'); fetchEarnings('custom', earningsRange); }} disabled={!earningsRange.from || !earningsRange.to} style={{ padding: '0.4rem 0.85rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text-secondary)', fontSize: '0.78rem', fontWeight: '600', cursor: (earningsRange.from && earningsRange.to) ? 'pointer' : 'not-allowed', fontFamily: 'var(--font-body)' }}>Apply</button>
                            </div>
                        </div>

                        {loadingEarnings ? (
                            <StatsSkeleton />
                        ) : earningsError ? (
                            <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
                                <p style={{ marginBottom: '1rem' }}>{earningsError}</p>
                                <button onClick={() => fetchEarnings()} className="btn-primary" style={{ padding: '0.5rem 1.25rem', fontSize: '0.85rem' }}>Retry</button>
                            </div>
                        ) : earnings ? (
                            <>
                                {/* KPI row */}
                                <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                                    {[
                                        { label: 'Earned (range)', value: `${curSym} ${earnings.totals.earned.toLocaleString()}`, icon: '💰', sub: `${earnings.totals.completedCount} completed` },
                                        { label: 'This month', value: `${curSym} ${earnings.thisMonth.earned.toLocaleString()}`, icon: '📅', sub: `${earnings.growthPct >= 0 ? '▲' : '▼'} ${Math.abs(earnings.growthPct)}% vs last month`, trend: earnings.growthPct },
                                        { label: 'Avg / appointment', value: `${curSym} ${earnings.totals.avgPerAppointment.toLocaleString()}`, icon: '📈', sub: 'In selected range' },
                                        { label: 'All-time earned', value: `${curSym} ${earnings.totals.allTimeEarned.toLocaleString()}`, icon: '🏆', sub: `${earnings.totals.allTimeCount} completed` },
                                    ].map((s, i) => (
                                        <div key={i} style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                            <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: 'rgba(240,62,22,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', flexShrink: 0 }}>{s.icon}</div>
                                            <div>
                                                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{s.label}</p>
                                                <p style={{ fontFamily: 'var(--font-body)', fontSize: '1.4rem', fontWeight: '700', color: 'var(--charcoal)', lineHeight: 1.1 }}>{s.value}</p>
                                                {s.sub && <p style={{ fontSize: '0.72rem', color: s.trend !== undefined ? (s.trend >= 0 ? '#059669' : '#dc2626') : 'var(--text-muted)', marginTop: '0.25rem' }}>{s.sub}</p>}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Earnings over time */}
                                <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem', marginBottom: '1.5rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                                        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)' }}>Earnings over time</h3>
                                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                                            {[['earned','Earnings'],['count','Bookings']].map(([k, lbl]) => (
                                                <button key={k} onClick={() => setEarningsChartMode(k)} style={{ padding: '0.3rem 0.8rem', borderRadius: '99px', border: '1.5px solid', borderColor: earningsChartMode === k ? 'var(--gold)' : 'var(--border)', background: earningsChartMode === k ? 'rgba(240,62,22,0.1)' : 'transparent', color: earningsChartMode === k ? 'var(--gold-dark)' : 'var(--text-muted)', fontSize: '0.75rem', fontWeight: '600', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>{lbl}</button>
                                            ))}
                                        </div>
                                    </div>
                                    {(() => {
                                        const data = earnings.overTime;
                                        const max = Math.max(...data.map(d => d[earningsChartMode]), 1);
                                        return (
                                            <>
                                                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '160px' }}>
                                                    {data.map((d, i) => (
                                                        <div key={i} title={`${d.label}: ${earningsChartMode === 'earned' ? curSym + ' ' + d.earned : d.count + ' booking(s)'}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                                                            <div style={{ height: `${(d[earningsChartMode] / max) * 100}%`, minHeight: d[earningsChartMode] > 0 ? '3px' : '0', background: 'var(--gold)', borderRadius: '3px 3px 0 0', transition: 'height 0.4s ease' }} />
                                                        </div>
                                                    ))}
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
                                                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{data[0]?.label}</span>
                                                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{data[data.length - 1]?.label}</span>
                                                </div>
                                            </>
                                        );
                                    })()}
                                </div>

                                {/* By service + by team */}
                                <div className="provider-profile-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
                                    <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem' }}>
                                        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '1.25rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border)' }}>Earnings by service</h3>
                                        {earnings.byService.length === 0 ? (
                                            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No completed appointments in this range</p>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                                                {earnings.byService.map((s, i) => {
                                                    const max = earnings.byService[0]?.earned || 1;
                                                    return (
                                                        <div key={i}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                                                                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: '500', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                                                                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexShrink: 0, whiteSpace: 'nowrap' }}>
                                                                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{s.count} job{s.count !== 1 ? 's' : ''}</span>
                                                                    <span style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--charcoal)' }}>{curSym} {s.earned.toLocaleString()}</span>
                                                                </div>
                                                            </div>
                                                            <div style={{ height: '6px', borderRadius: '99px', background: 'var(--warm-gray)', overflow: 'hidden' }}>
                                                                <div style={{ height: '100%', borderRadius: '99px', background: 'var(--gold)', width: `${(s.earned / max) * 100}%`, transition: 'width 0.5s ease' }} />
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>

                                    {earnings.topClients.length > 0 && (
                                        <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem' }}>
                                            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '1.25rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border)' }}>Top clients</h3>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                                                {earnings.topClients.map((c, i) => (
                                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                        <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: i === 0 ? 'var(--gold)' : 'var(--warm-gray)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: '700', color: i === 0 ? 'var(--ink)' : 'var(--text-muted)', flexShrink: 0 }}>{i + 1}</div>
                                                        <div style={{ flex: 1, minWidth: 0 }}>
                                                            <p style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--charcoal)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</p>
                                                            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>{c.count} visit{c.count !== 1 ? 's' : ''}</p>
                                                        </div>
                                                        <span style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--charcoal)', flexShrink: 0, whiteSpace: 'nowrap' }}>{curSym} {c.earned.toLocaleString()}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Recent completed */}
                                <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                                    <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)' }}>
                                        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)' }}>Recent completed appointments</h3>
                                    </div>
                                    {earnings.recent.length === 0 ? (
                                        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}><p>No completed appointments yet</p></div>
                                    ) : (
                                        <div className="table-scroll">
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                                                <thead>
                                                    <tr style={{ background: 'var(--warm-gray)', borderBottom: '1px solid var(--border)' }}>
                                                        {['Client', 'Service', 'Date', 'Time', 'Amount'].map(h => (
                                                            <th key={h} style={{ padding: '0.875rem 1rem', textAlign: 'left', fontSize: '0.7rem', fontWeight: '600', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{h}</th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {earnings.recent.map((r) => (
                                                        <tr key={r._id} style={{ borderBottom: '1px solid var(--border)' }}>
                                                            <td style={{ padding: '0.875rem 1rem', fontWeight: '600', color: 'var(--charcoal)' }}>{r.client}</td>
                                                            <td style={{ padding: '0.875rem 1rem', color: 'var(--text-secondary)' }}>{r.service}</td>
                                                            <td style={{ padding: '0.875rem 1rem', color: 'var(--text-secondary)' }}>{new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                                                            <td style={{ padding: '0.875rem 1rem', color: 'var(--text-secondary)' }}>{r.time}</td>
                                                            <td style={{ padding: '0.875rem 1rem', fontWeight: '700', color: 'var(--charcoal)' }}>{curSym} {r.amount.toLocaleString()}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : (
                            <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}><p>No earnings data yet</p></div>
                        )}
                    </div>
                )}

                {/* Calendar tab */}
                {activeTab === 'calendar' && (
                    <div>
                        {/* Floating scroll-to-top — FullCalendar captures touch gestures, so once
                            you reach the bottom it's hard to swipe the page back up. */}
                        <button
                            type="button"
                            aria-label="Scroll to top"
                            onClick={() => { try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) { window.scrollTo(0, 0); } }}
                            style={{ position: 'fixed', right: '16px', bottom: 'calc(104px + env(safe-area-inset-bottom, 0px))', zIndex: 1001, width: '44px', height: '44px', borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--card-bg)', color: 'var(--charcoal)', boxShadow: 'var(--shadow-md)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 15l-6-6-6 6" /></svg>
                        </button>
                        <div className="fc-toolbar-shell" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
                            <div style={{ display: 'inline-flex', background: 'var(--surface-sunken)', border: '1px solid var(--border)', borderRadius: '10px', padding: '3px', gap: '2px' }}>
                                {[['day', 'Day'], ['3day', '3 Day'], ['week', 'Week'], ['month', 'Month'], ...(activeTeamMembers.length > 0 ? [['staff', 'Staff']] : [])].map(([view, label]) => {
                                    const isActive = calendarView === view;
                                    return (
                                        <button
                                            key={view}
                                            onClick={() => {
                                                // currentDate tracks FullCalendar's datesSet range START
                                                // (Sunday / 1st grid cell), so entering the lanes view from
                                                // Week/Month would land days before the one being viewed.
                                                // Snap to FC's real anchor day instead.
                                                if (view === 'staff') {
                                                    const api = calendarRef.current?.getApi?.();
                                                    if (api) setCurrentDate(api.getDate());
                                                }
                                                setCalendarView(view);
                                            }}
                                            aria-pressed={isActive}
                                            style={{
                                                padding: '0.4rem 1rem',
                                                borderRadius: '8px',
                                                border: 'none',
                                                cursor: 'pointer',
                                                fontSize: '0.82rem',
                                                fontWeight: isActive ? '700' : '500',
                                                fontFamily: 'var(--font-body)',
                                                background: isActive ? 'var(--card-bg)' : 'transparent',
                                                color: isActive ? 'var(--charcoal)' : 'var(--text-secondary)',
                                                boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
                                                transition: 'background 0.18s var(--ease-out, ease), color 0.18s ease',
                                            }}
                                        >
                                            {label}
                                        </button>
                                    );
                                })}
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <button
                                    onClick={() => {
                                        setApptError('');
                                        setApptForm(prev => ({ ...prev, date: toDateKey(new Date()) }));
                                        setShowApptModal(true);
                                    }}
                                    className="btn-primary"
                                    style={{ padding: '0.5rem 0.9rem', fontSize: '0.82rem' }}
                                >
                                    + Appointment
                                </button>
                                <button
                                    onClick={() => openBlockedTimeForm(null)}
                                    className="btn-outline"
                                    style={{ padding: '0.5rem 0.9rem', fontSize: '0.82rem' }}
                                >
                                    + Block Time
                                </button>
                            </div>
                        </div>

                        {/* Staff filter — who's on the calendar. Chips mirror the view switcher. */}
                        {teamMembers.length > 0 && (
                            <div role="group" aria-label="Filter calendar by staff member" style={{ display: 'flex', gap: '0.45rem', overflowX: 'auto', marginBottom: '0.9rem', paddingBottom: '2px', WebkitOverflowScrolling: 'touch' }}>
                                {[
                                    { id: 'all', label: 'All staff' },
                                    { id: 'unassigned', label: `${(user?.name || 'Me').split(' ')[0]} (me)` },
                                    ...teamMembers.filter(m => m.isActive !== false).map(m => ({ id: String(m._id), label: m.name, color: m.color })),
                                ].map(({ id, label, color }) => {
                                    const isActive = String(calendarStaffFilter) === id;
                                    return (
                                        <button
                                            key={id}
                                            type="button"
                                            onClick={() => setCalendarStaffFilter(id)}
                                            aria-pressed={isActive}
                                            style={{
                                                display: 'inline-flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0,
                                                padding: '0.38rem 0.85rem', borderRadius: 'var(--radius-pill, 99px)', cursor: 'pointer',
                                                border: `1px solid ${isActive ? 'var(--gold)' : 'var(--border)'}`,
                                                background: isActive ? 'rgba(240,62,22,0.1)' : 'var(--card-bg)',
                                                color: isActive ? 'var(--gold-dark)' : 'var(--text-secondary)',
                                                fontSize: '0.8rem', fontWeight: isActive ? 700 : 500, fontFamily: 'var(--font-body)',
                                                whiteSpace: 'nowrap', transition: 'background 0.18s ease, color 0.18s ease, border-color 0.18s ease',
                                            }}
                                        >
                                            {color && <span aria-hidden="true" style={{ width: '8px', height: '8px', borderRadius: '50%', background: color, flexShrink: 0 }} />}
                                            {label}
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        <div ref={fcWrapRef} className="fc-bookplus-wrapper" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                            {calendarView === 'staff' && activeTeamMembers.length > 0 ? (
                                <StaffLanesDay
                                    date={currentDate}
                                    onDateChange={setCurrentDate}
                                    ownerName={user?.name}
                                    teamMembers={teamMembers}
                                    staffFilter={calendarStaffFilter}
                                    appointments={appointments}
                                    blockedTimes={blockedTimes}
                                    availability={availability}
                                    statusColors={statusCalendarColors}
                                    height={calHeight}
                                    onApptClick={openApptDetail}
                                    onBlockClick={(block) => openBlockedTimeForm(block)}
                                    onSlotClick={(sel) => { setApptError(''); setTimeSelectionPreview(sel); }}
                                />
                            ) : (
                            <FullCalendar
                                ref={calendarRef}
                                plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                                initialView={getFullCalendarView()}
                                initialDate={currentDate}
                                views={{ timeGridThreeDay: { type: 'timeGrid', duration: { days: 3 }, buttonText: '3 day' } }}
                                headerToolbar={{ left: 'prev,next', center: 'title', right: '' }}
                                height={calendarView === 'month' ? 'auto' : calHeight}
                                events={fullCalendarEvents}
                                businessHours={businessHoursConfig}
                                selectable
                                selectMirror={false}
                                longPressDelay={350}
                                eventLongPressDelay={350}
                                selectLongPressDelay={350}
                                editable
                                eventDurationEditable
                                eventResizableFromStart
                                dayMaxEvents={3}
                                slotMinTime="00:00:00"
                                slotMaxTime="24:00:00"
                                slotDuration="00:15:00"
                                slotLabelInterval="01:00:00"
                                slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
                                eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
                                slotEventOverlap={false}
                                eventMinHeight={42}
                                eventShortHeight={64}
                                allDaySlot={false}
                                nowIndicator
                                scrollTime={calendarScrollTime}
                                select={handleFullCalendarSelect}
                                dateClick={handleCalendarDateClick}
                                eventClick={handleFullCalendarEventClick}
                                eventDrop={handleFullCalendarEventDrop}
                                eventResize={handleFullCalendarEventResize}
                                datesSet={(arg) => setCurrentDate(arg.start)}
                                eventContent={(arg) => {
                                    const { kind, customerName, startTime, endTime, staffName, staffColor } = arg.event.extendedProps;
                                    if (kind !== 'appointment') {
                                        return (
                                            <div className="fc-event-blocked">
                                                <span>{arg.event.title}</span>
                                            </div>
                                        );
                                    }
                                    // Staff tag only when the calendar is showing everyone —
                                    // filtered to one member, it would just repeat the filter.
                                    const showStaffTag = staffName && calendarStaffFilter === 'all';
                                    return (
                                        <div className="fc-event-appt">
                                            <div className="fc-event-appt-time">{startTime}{endTime ? ` – ${endTime}` : ''}</div>
                                            <div className="fc-event-appt-client">{customerName}</div>
                                            <div className="fc-event-appt-service">{arg.event.title}</div>
                                            {showStaffTag && (
                                                <div className="fc-event-appt-staff">
                                                    <span className="fc-event-appt-staff-dot" style={{ background: staffColor || 'var(--gold)' }} aria-hidden="true" />
                                                    {staffName}
                                                </div>
                                            )}
                                        </div>
                                    );
                                }}
                            />
                            )}
                        </div>

                        {/* Drag/drop/resize feedback toast */}
                        {calendarToast && (
                            <div role="status" aria-live="polite" className="cal-toast" style={{
                                position: 'fixed', left: '50%', bottom: '28px', transform: 'translateX(-50%)', zIndex: 1300,
                                display: 'flex', alignItems: 'center', gap: '0.6rem',
                                background: 'var(--ink)', color: 'var(--on-ink)', padding: '0.75rem 1.15rem',
                                borderRadius: 'var(--radius-pill)', boxShadow: 'var(--shadow-lg)', fontSize: '0.85rem', fontWeight: '600',
                                maxWidth: '90vw',
                            }}>
                                <span aria-hidden="true" style={{ color: calendarToast.type === 'error' ? '#fca5a5' : 'var(--gold)' }}>
                                    {calendarToast.type === 'error' ? '✕' : '✓'}
                                </span>
                                {calendarToast.msg}
                            </div>
                        )}

                        {/* On selection release: ask whether to book a client or block the time */}
                        {timeSelectionPreview && (
                            <div onClick={() => setTimeSelectionPreview(null)} className="sheet-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(4,5,5,0.5)', backdropFilter: 'blur(2px)', zIndex: 1100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '0' }}>
                                <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" className="scale-in sheet-panel" style={{ width: '100%', maxWidth: '420px', background: 'var(--card-bg)', borderRadius: '20px 20px 0 0', boxShadow: 'var(--shadow-lg)', overflow: 'hidden', paddingBottom: 'env(safe-area-inset-bottom)' }}>
                                    <div style={{ padding: '1.5rem 1.5rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
                                        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: '700', color: 'var(--charcoal)', margin: 0 }}>What's this time for?</h3>
                                        <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                            {new Date(`${timeSelectionPreview.date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {timeSelectionPreview.startTime} – {timeSelectionPreview.endTime}
                                            {timeSelectionPreview.teamMember ? ` · ${teamMembers.find(m => String(m._id) === String(timeSelectionPreview.teamMember))?.name || 'Staff'}` : ''}
                                        </p>
                                    </div>
                                    <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                        <button onClick={() => {
                                            // teamMember is set when the selection came from a staff lane
                                            setApptForm(prev => ({ ...prev, date: timeSelectionPreview.date, startTime: timeSelectionPreview.startTime, teamMember: timeSelectionPreview.teamMember !== undefined ? timeSelectionPreview.teamMember : prev.teamMember }));
                                            setShowApptModal(true);
                                            setTimeSelectionPreview(null);
                                        }} className="btn-primary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.8rem' }}>
                                            <CalendarPlus size={18} strokeWidth={2} /> Add appointment
                                        </button>
                                        <button onClick={() => {
                                            openBlockedTimeForm(null);
                                            setBlockedTimeForm(prev => ({
                                                ...prev,
                                                date: timeSelectionPreview.date,
                                                startTime: timeSelectionPreview.startTime,
                                                endTime: timeSelectionPreview.endTime,
                                                teamMember: timeSelectionPreview.teamMember !== undefined ? timeSelectionPreview.teamMember : prev.teamMember,
                                            }));
                                            setTimeSelectionPreview(null);
                                        }} className="btn-outline" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.8rem' }}>
                                            <Ban size={18} strokeWidth={2} /> Block time
                                        </button>
                                        <button onClick={() => setTimeSelectionPreview(null)} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.85rem', padding: '0.4rem', marginTop: '0.1rem' }}>Cancel</button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Drag-to-move confirmation (appointments + blocked time) */}
                        {pendingMove && (
                            <div className="sheet-overlay" onClick={cancelPendingMove} style={{ position: 'fixed', inset: 0, background: 'rgba(4,5,5,0.5)', backdropFilter: 'blur(2px)', zIndex: 1100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                                <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" className="scale-in sheet-panel" style={{ width: '100%', maxWidth: '420px', background: 'var(--card-bg)', borderRadius: '20px 20px 0 0', boxShadow: 'var(--shadow-lg)', overflow: 'hidden', paddingBottom: 'env(safe-area-inset-bottom)' }}>
                                    <div style={{ padding: '1.5rem 1.5rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
                                        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: '700', color: 'var(--charcoal)', margin: 0 }}>
                                            Move {pendingMove.kind === 'blocked' ? 'blocked time' : 'appointment'}?
                                        </h3>
                                        <p style={{ margin: '0.4rem 0 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                            {pendingMove.title ? <strong style={{ color: 'var(--charcoal)' }}>{pendingMove.title}</strong> : null} → {pendingMove.label}
                                        </p>
                                    </div>
                                    <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                        <button onClick={confirmPendingMove} className="btn-primary" style={{ width: '100%', padding: '0.8rem' }}>Yes, move it</button>
                                        <button onClick={cancelPendingMove} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.9rem', padding: '0.5rem' }}>Keep where it was</button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Tap grayed area → adjust working hours for that day */}
                        {adjustHours && (
                            <div className="sheet-overlay" onClick={() => setAdjustHours(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(4,5,5,0.5)', backdropFilter: 'blur(2px)', zIndex: 1100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                                <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" className="scale-in sheet-panel" style={{ width: '100%', maxWidth: '420px', background: 'var(--card-bg)', borderRadius: '20px 20px 0 0', boxShadow: 'var(--shadow-lg)', overflow: 'hidden', paddingBottom: 'env(safe-area-inset-bottom)' }}>
                                    <div style={{ padding: '1.5rem 1.5rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
                                        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: '700', color: 'var(--charcoal)', margin: 0 }}>Adjust working hours</h3>
                                        <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{adjustHours.label}</p>
                                    </div>
                                    <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                                            <span style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--charcoal)' }}>Open this day</span>
                                            <button onClick={() => setAdjustHours(h => ({ ...h, enabled: !h.enabled }))} aria-label="Toggle open" style={{ width: '50px', height: '30px', borderRadius: '99px', border: 'none', background: adjustHours.enabled ? 'var(--gold)' : '#cbd0d8', cursor: 'pointer', position: 'relative', flexShrink: 0 }}>
                                                <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'white', position: 'absolute', top: '3px', left: '3px', transform: adjustHours.enabled ? 'translateX(20px)' : 'translateX(0)', transition: 'transform 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.25)' }} />
                                            </button>
                                        </label>
                                        {adjustHours.enabled && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                                <input type="time" value={adjustHours.start} onChange={e => setAdjustHours(h => ({ ...h, start: e.target.value }))} className="input" style={{ flex: 1, minWidth: 0, padding: '0.55rem 0.6rem' }} />
                                                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>to</span>
                                                <input type="time" value={adjustHours.end} onChange={e => setAdjustHours(h => ({ ...h, end: e.target.value }))} className="input" style={{ flex: 1, minWidth: 0, padding: '0.55rem 0.6rem' }} />
                                            </div>
                                        )}
                                        <button onClick={saveAdjustHours} disabled={savingAdjustHours} className="btn-primary" style={{ width: '100%', padding: '0.8rem', marginTop: '0.25rem' }}>
                                            {savingAdjustHours ? 'Saving…' : 'Save hours'}
                                        </button>
                                        <button onClick={() => setAdjustHours(null)} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.9rem', padding: '0.4rem' }}>Cancel</button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* History tab */}
                {activeTab === 'history' && (
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                            <div>
                                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: '700', color: 'var(--charcoal)', margin: 0 }}>Appointment History</h2>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Past appointments sorted newest first</p>
                            </div>
                            <span style={{ background: 'var(--warm-gray)', color: 'var(--text-secondary)', padding: '0.3rem 0.85rem', borderRadius: '99px', fontSize: '0.8rem', fontWeight: '600' }}>{historyTotal} total</span>
                        </div>
                        {historyLoading && history.length === 0 ? (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4rem', gap: '0.75rem' }}>
                                <div style={{ width: '18px', height: '18px', border: '2px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Loading history...</span>
                            </div>
                        ) : history.length === 0 ? (
                            <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '4rem 2rem', textAlign: 'center' }}>
                                <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🕐</div>
                                <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', color: 'var(--charcoal)', marginBottom: '0.35rem' }}>No past appointments yet</p>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Completed and past appointments will appear here.</p>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                {history.map(a => {
                                    const sc = statusConfig[a.status] || statusConfig.pending;
                                    return (
                                        <div key={a._id} style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1rem 1.25rem' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                                                <div style={{ minWidth: 0 }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                                                        <p style={{ fontWeight: '700', fontSize: '0.95rem', color: 'var(--charcoal)', margin: 0 }}>{a.walkInName || a.customer?.name || '—'}</p>
                                                        {a.isRecurring && <span title="Recurring" style={{ fontSize: '0.7rem', color: 'var(--gold-dark)', background: 'rgba(240,62,22,0.12)', padding: '0.1rem 0.4rem', borderRadius: '99px', fontWeight: '600' }}>↻ Recurring</span>}
                                                    </div>
                                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0 0 0.25rem' }}>{a.service?.name}</p>
                                                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: 0 }}>
                                                        {a.appointmentDate ? new Date(a.appointmentDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '—'} · {a.startTime}–{a.endTime}
                                                    </p>
                                                </div>
                                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.35rem', flexShrink: 0 }}>
                                                    <span style={{ fontSize: '0.72rem', fontWeight: '700', padding: '0.2rem 0.65rem', borderRadius: '99px', background: sc.bg, color: sc.color, textTransform: 'capitalize' }}>{a.status}</span>
                                                    <span style={{ fontSize: '0.875rem', fontWeight: '700', color: 'var(--charcoal)' }}>{curSym} {a.totalPrice || 0}</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                                {history.length < historyTotal && (
                                    <button onClick={() => fetchHistory(historyPage + 1)} disabled={historyLoading} style={{ width: '100%', padding: '0.85rem', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.875rem', fontWeight: '600' }}>
                                        {historyLoading ? 'Loading...' : 'Load more'}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                )}

            {/* Clients tab */}
            {activeTab === 'clients' && (
                <div className={`clients-grid${selectedClient ? ' has-selection' : ''}`} style={{ display: 'grid', gridTemplateColumns: selectedClient ? '1fr 380px' : '1fr', gap: '1.5rem', alignItems: 'start' }}>
                    <div className="clients-list" style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: '600', color: 'var(--charcoal)', margin: 0 }}>My Clients</h2>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{clients.length} total</span>
                        </div>
                        {loadingClients ? <RowsSkeleton /> : (
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
                                                <td style={{ padding: '0.875rem 1rem', color: 'var(--gold-dark)', fontWeight: '600' }}>{nMoney(c.totalSpend)}</td>
                                                <td style={{ padding: '0.875rem 1rem' }}>
                                                    <button onClick={() => { setSelectedClient(c); fetchClientDetail(c.customer._id); }} style={{ background: 'rgba(240,62,22,0.08)', border: '1px solid rgba(240,62,22,0.3)', color: 'var(--gold-dark)', padding: '0.3rem 0.75rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.78rem', fontWeight: '600' }}>View</button>
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
                        <div className="client-detail-panel" style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', position: 'sticky', top: 'calc(100px + env(safe-area-inset-top, 0px))' }}>
                            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)', margin: 0 }}>{selectedClient.customer?.name}</h3>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <button
                                        onClick={async () => {
                                            const id = selectedClient.customer?._id;
                                            if (id && window.confirm('Block this client? You won’t be able to book or message each other. You can unblock them in Account settings.')) {
                                                try { await authService.blockUser(id); toast('Client blocked.', 'success'); } catch { toast('Could not block client.', 'error'); }
                                            }
                                        }}
                                        style={{ background: 'none', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.72rem', padding: '0.25rem 0.6rem', borderRadius: 'var(--radius-sm)' }}
                                    >Block</button>
                                    <button onClick={() => { setSelectedClient(null); setClientDetail(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.2rem' }}>×</button>
                                </div>
                            </div>
                            <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '70vh', overflowY: 'auto' }}>
                                {/* Quick contact - call / email / chat */}
                                {(() => {
                                    const cust = selectedClient.customer;
                                    const latest = clientDetail.appointments?.[0];
                                    return (
                                        <div>
                                            {(cust?.phone || cust?.email) && (
                                                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.6rem', fontFamily: 'var(--font-body)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    {[cust?.phone, cust?.email].filter(Boolean).join('  /  ')}
                                                </p>
                                            )}
                                            <ContactActions
                                                phone={cust?.phone}
                                                email={cust?.email}
                                                onMessage={latest ? () => openChatForAppointment({ ...latest, customer: cust }) : undefined}
                                            />
                                        </div>
                                    );
                                })()}
                                <div>
                                    <p style={{ fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                                        Visit History {clientDetail.appointments?.length ? `(${clientDetail.appointments.length})` : ''}
                                    </p>
                                    {clientDetail.appointments?.length ? clientDetail.appointments.map((a, i) => (
                                        <div key={i} style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.82rem' }}>
                                            <div style={{ fontWeight: '600', color: 'var(--charcoal)' }}>{a.service?.name}</div>
                                            <div style={{ color: 'var(--text-muted)' }}>{new Date(a.appointmentDate).toLocaleDateString()} · {a.startTime} · {curSym} {a.totalPrice}</div>
                                            <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '4px', background: (statusConfig[a.status] || statusConfig.pending).bg, color: (statusConfig[a.status] || statusConfig.pending).color }}>{a.status}</span>
                                        </div>
                                    )) : (
                                        <div style={{ padding: '1rem 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>No appointment history yet for this client.</div>
                                    )}
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
                <div className={`messages-grid${selectedConversation ? ' has-selection' : ''}`} style={{ display: 'grid', gridTemplateColumns: '330px 1fr', gap: '1.5rem', minHeight: '560px' }}>
                    {/* Conversation list */}
                    <div className="messages-list" style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
                            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: '700', color: 'var(--charcoal)', margin: 0 }}>Messages</h3>
                        </div>
                        {loadingConversations ? (
                            <RowsSkeleton />
                        ) : conversations.length === 0 ? (
                            <div style={{ padding: '3.5rem 2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                                <MessageSquare size={28} style={{ opacity: 0.35 }} />
                                <p style={{ margin: '0.75rem 0 0', fontSize: '0.9rem' }}>No messages yet</p>
                            </div>
                        ) : (
                            <div style={{ overflowY: 'auto', flex: 1 }}>
                                {conversations.map((conv, i) => {
                                    const name = conv.appointment?.customer?.name || conv.lastMessage?.sender?.name || 'Client';
                                    const active = selectedConversation?.appointment?._id === conv.appointment?._id;
                                    return (
                                        <button key={i} onClick={() => openConversation(conv)} style={{
                                            width: '100%', textAlign: 'left', display: 'flex', gap: '0.75rem', alignItems: 'center',
                                            padding: '0.8rem 1rem', borderTop: 'none', borderLeft: 'none', borderRight: 'none',
                                            borderBottom: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'var(--font-body)',
                                            background: active ? 'rgba(240,62,22,0.08)' : 'transparent',
                                        }}>
                                            <Avatar name={name} />
                                            <div style={{ minWidth: 0, flex: 1 }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
                                                    <span style={{ fontWeight: 700, color: 'var(--charcoal)', fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                                                    {conv.lastMessage?.createdAt && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0 }}>{fmtConvTime(conv.lastMessage.createdAt)}</span>}
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.15rem' }}>
                                                    <span style={{ flex: 1, minWidth: 0, fontSize: '0.8rem', color: conv.unread > 0 ? 'var(--charcoal)' : 'var(--text-muted)', fontWeight: conv.unread > 0 ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {conv.lastMessage?.content || conv.appointment?.service?.name}
                                                    </span>
                                                    {conv.unread > 0 && <span style={{ flexShrink: 0, minWidth: '18px', height: '18px', padding: '0 5px', borderRadius: '99px', background: 'var(--gold)', color: 'var(--ink)', fontSize: '0.68rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{conv.unread}</span>}
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Thread */}
                    <div className="messages-thread" style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', minHeight: '560px' }}>
                        {!selectedConversation ? (
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.9rem', gap: '0.6rem' }}>
                                <MessageSquare size={32} style={{ opacity: 0.3 }} />
                                Select a conversation
                            </div>
                        ) : (
                            <>
                                {/* Header (back button shows on mobile) */}
                                <div style={{ padding: '0.8rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                    <button className="messages-back" onClick={() => setSelectedConversation(null)} aria-label="Back to conversations" style={{ display: 'none', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gold-dark)', padding: '0.25rem', marginLeft: '-0.25rem' }}>
                                        <ChevronLeft size={24} />
                                    </button>
                                    <Avatar name={selectedConversation.appointment?.customer?.name || 'Client'} size={38} />
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontWeight: 700, color: 'var(--charcoal)', fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedConversation.appointment?.customer?.name}</div>
                                        <div style={{ color: 'var(--text-muted)', fontSize: '0.76rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedConversation.appointment?.service?.name}</div>
                                    </div>
                                </div>
                                {/* Messages */}
                                <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem', minHeight: '300px' }}>
                                    {conversationMessages.map((msg, i) => {
                                        const isMe = msg.sender?._id === selectedConversation.appointment?.provider?._id || msg.sender?.name === selectedConversation.appointment?.provider?.name;
                                        return (
                                            <div key={i} style={{ display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
                                                <div style={{
                                                    maxWidth: '78%', padding: '0.5rem 0.8rem', fontSize: '0.9rem', lineHeight: 1.4,
                                                    borderRadius: isMe ? '18px 18px 5px 18px' : '18px 18px 18px 5px',
                                                    background: isMe ? 'var(--gold)' : 'var(--warm-gray)', color: 'var(--charcoal)',
                                                }}>
                                                    {msg.content}
                                                    <div style={{ fontSize: '0.62rem', color: isMe ? 'rgba(4,5,5,0.55)' : 'var(--text-muted)', marginTop: '0.2rem', textAlign: 'right' }}>
                                                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                {/* Composer */}
                                <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--border)', display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                                    <input value={newMessage} onChange={e => setNewMessage(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSendMessage()} placeholder="Message…" className="input" style={{ flex: 1, borderRadius: '999px', padding: '0.6rem 1rem' }} />
                                    <button onClick={handleSendMessage} disabled={sendingMessage || !newMessage.trim()} aria-label="Send message" style={{ flexShrink: 0, width: '42px', height: '42px', borderRadius: '50%', border: 'none', background: newMessage.trim() ? 'var(--gold)' : 'var(--border)', color: 'var(--ink)', cursor: newMessage.trim() ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s' }}>
                                        <Send size={18} />
                                    </button>
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
                            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: '600', color: 'var(--charcoal)', margin: 0 }}>Memberships</h2>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>Multi-session plans clients can enroll in and redeem over time.</p>
                        </div>
                        <button onClick={() => { setShowPackageForm(true); setPackageForm({ name: '', description: '', price: '', totalSessions: '', validityDays: '365' }); }} className="btn-primary" style={{ padding: '0.65rem 1.25rem', fontSize: '0.875rem' }}>+ New Membership</button>
                    </div>

                    {showPackageForm && (
                        <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--gold)', padding: '1.75rem', marginBottom: '1.5rem', boxShadow: 'var(--shadow-sm)', marginTop: '1.5rem' }}>
                            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: '700', marginBottom: '1.25rem', color: 'var(--charcoal)' }}>
                                {packageForm.name ? `Editing: ${packageForm.name}` : 'New Membership Plan'}
                            </h3>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                                {[
                                    ['Plan Name', 'name', 'text', 'e.g. Monthly Grooming Plan'],
                                    [`Price (${curCode})`, 'price', 'number', '0'],
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
                        <RowsSkeleton />
                    ) : myPackages.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '5rem 2rem', color: 'var(--text-muted)', background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', marginTop: '1.5rem' }}>
                            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🪪</div>
                            <p style={{ fontWeight: '600', fontSize: '1rem', color: 'var(--charcoal)', marginBottom: '0.35rem' }}>No membership plans yet</p>
                            <p style={{ fontSize: '0.875rem' }}>Create plans that let clients enroll in multi-session bundles.</p>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: '1.25rem', marginTop: '1.5rem' }}>
                            {myPackages.map((pkg, i) => (
                                <div key={i} style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: `1px solid ${pkg.isActive ? 'var(--border)' : '#e5e7eb'}`, boxShadow: 'var(--shadow-sm)', overflow: 'hidden', opacity: pkg.isActive ? 1 : 0.7, display: 'flex', flexDirection: 'column' }}>
                                    {/* Gold stripe */}
                                    <div style={{ height: '4px', background: pkg.isActive ? 'var(--gold)' : '#e5e7eb' }} />
                                    <div style={{ padding: '1.5rem', flex: 1 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                                            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: '700', color: 'var(--charcoal)', margin: 0, flex: 1, paddingRight: '0.5rem' }}>{pkg.name}</h3>
                                            <span style={{ fontSize: '0.7rem', padding: '0.2rem 0.6rem', borderRadius: '99px', border: '1px solid', cursor: 'pointer', borderColor: pkg.isActive ? '#6ee7b7' : '#d1d5db', background: pkg.isActive ? '#d1fae5' : '#f3f4f6', color: pkg.isActive ? '#065f46' : '#6b7280', fontWeight: '700', whiteSpace: 'nowrap', flexShrink: 0 }}
                                                onClick={() => togglePackageActive(pkg)}>
                                                {pkg.isActive ? '● Active' : '○ Inactive'}
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
                                                <p style={{ fontSize: '1.5rem', fontWeight: '700', color: 'var(--gold-dark)', lineHeight: 1 }}>{curSym} {pkg.price}</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ padding: '0.75rem 1.5rem', borderTop: '1px solid var(--border)', display: 'flex', gap: '0.5rem' }}>
                                        <button
                                            onClick={() => { setPackageForm({ name: pkg.name, description: pkg.description, price: String(pkg.price), totalSessions: String(pkg.totalSessions), validityDays: String(pkg.validityDays) }); setShowPackageForm(true); }}
                                            style={{ flex: 1, background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.45rem', fontSize: '0.8rem', cursor: 'pointer', color: 'var(--text-secondary)', fontFamily: 'var(--font-body)' }}>
                                            Edit
                                        </button>
                                        <button
                                            onClick={async () => { if (window.confirm('Delete this membership plan?')) { await packageService.deletePackage(pkg._id); setMyPackages(prev => prev.filter(p => p._id !== pkg._id)); } }}
                                            style={{ flex: 1, background: 'none', border: '1px solid #fca5a5', borderRadius: 'var(--radius-sm)', padding: '0.45rem', fontSize: '0.8rem', cursor: 'pointer', color: '#dc2626', fontFamily: 'var(--font-body)' }}>
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ── WALLET TAB ── */}
            {activeTab === 'wallet' && (
                <div>
                    {walletLoading && !walletSummary ? (
                        <RowsSkeleton />
                    ) : (
                        <>
                            {/* Your Bookplus account balance (provider ↔ platform) */}
                            <div style={{ background: 'linear-gradient(135deg, var(--ink), #1c1c1e)', borderRadius: 'var(--radius)', padding: '1.25rem 1.5rem', marginBottom: '1.5rem', display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                    <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.5)', marginBottom: '0.2rem' }}>Your Bookplus account balance</div>
                                    <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', fontWeight: '700', color: 'var(--gold)' }}>{nMoney(providerBalance?.balance)}</div>
                                    <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.45)', marginTop: '0.15rem' }}>Topped up by Bookplus once your payment is verified</div>
                                </div>
                                <button onClick={() => setShowAccountTopUp(true)} className="btn-primary" style={{ padding: '0.6rem 1.4rem' }}>Top up account</button>
                            </div>

                            {/* Recent account top-ups (provider ↔ platform) */}
                            {providerWalletTxns.length > 0 && (
                                <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: '1.5rem' }}>
                                    <div style={{ padding: '0.85rem 1.25rem', borderBottom: '1px solid var(--border)', fontSize: '0.78rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Your account activity</div>
                                    {providerWalletTxns.slice(0, 8).map((t) => (
                                        <div key={t._id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 1.25rem', borderBottom: '1px solid var(--border)', fontSize: '0.82rem' }}>
                                            <span style={{ color: 'var(--charcoal)' }}>
                                                {t.type === 'topup' ? 'Top-up' : t.type === 'credit' ? 'Credit' : 'Debit'}{t.reason ? ` · ${t.reason}` : ''}
                                                <span style={{ color: 'var(--text-muted)', marginLeft: '0.4rem' }}>{new Date(t.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                            </span>
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                                <strong style={{ color: t.type === 'debit' ? 'var(--danger)' : 'var(--success)' }}>{t.type === 'debit' ? '−' : '+'}{nMoney(t.amount)}</strong>
                                                <span style={{ fontSize: '0.68rem', fontWeight: '600', padding: '0.1rem 0.5rem', borderRadius: '99px', textTransform: 'capitalize', background: t.status === 'approved' ? '#d1fae5' : t.status === 'pending' ? '#fef3c7' : '#fee2e2', color: t.status === 'approved' ? '#065f46' : t.status === 'pending' ? '#92400e' : '#991b1b' }}>{t.status}</span>
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Headline figures */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                                {[
                                    { label: 'Funds held', val: walletSummary?.fundsHeld, accent: true },
                                    { label: 'Reserved', val: walletSummary?.totalReserved },
                                    { label: 'Available to clients', val: walletSummary?.totalAvailable },
                                    { label: 'Total deducted', val: walletSummary?.totalDeducted },
                                ].map((c) => (
                                    <div key={c.label} style={{ background: c.accent ? 'rgba(240,62,22,0.1)' : 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1.1rem 1.25rem' }}>
                                        <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>{c.label}</div>
                                        <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: '700', color: c.accent ? 'var(--gold-dark)' : 'var(--charcoal)' }}>{nMoney(c.val)}</div>
                                    </div>
                                ))}
                            </div>

                            {/* Settings */}
                            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)', padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
                                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: '600', color: 'var(--charcoal)', margin: '0 0 0.25rem' }}>Wallet settings</h3>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0 0 1rem' }}>Let clients prepay you and hold funds for upcoming bookings. You approve every deposit.</p>

                                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', padding: '0.75rem 0', borderTop: '1px solid var(--border)' }}>
                                    <div><div style={{ fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.9rem' }}>Enable wallet</div><div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Turn the prepaid wallet on for your clients</div></div>
                                    <button type="button" onClick={() => saveWalletSettings({ enabled: !walletSettings?.enabled })} disabled={walletSaving} style={{ width: '48px', height: '26px', borderRadius: '99px', border: 'none', cursor: 'pointer', background: walletSettings?.enabled ? 'var(--gold)' : '#d1d5db', position: 'relative', flexShrink: 0 }}>
                                        <span style={{ position: 'absolute', top: '3px', left: '3px', transform: walletSettings?.enabled ? 'translateX(22px)' : 'translateX(0)', width: '20px', height: '20px', borderRadius: '50%', background: 'white', transition: 'transform 0.2s' }} />
                                    </button>
                                </label>

                                <div style={{ padding: '0.75rem 0', borderTop: '1px solid var(--border)', opacity: walletSettings?.enabled ? 1 : 0.5, pointerEvents: walletSettings?.enabled ? 'auto' : 'none' }}>
                                    <div style={{ fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>Booking payment</div>
                                    {[
                                        { v: 'wallet_required', t: 'Require wallet funds to book', d: 'Clients must have enough available balance (recommended)' },
                                        { v: 'wallet_optional', t: 'Wallet optional', d: 'Clients can book without funds and pay later' },
                                    ].map((opt) => (
                                        <label key={opt.v} onClick={() => saveWalletSettings({ bookingPaymentMode: opt.v })} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', padding: '0.5rem 0', cursor: 'pointer' }}>
                                            <div style={{ width: '18px', height: '18px', borderRadius: '50%', border: `2px solid ${walletSettings?.bookingPaymentMode === opt.v ? 'var(--gold)' : '#cbd5e1'}`, background: walletSettings?.bookingPaymentMode === opt.v ? 'var(--gold)' : 'white', flexShrink: 0, marginTop: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{walletSettings?.bookingPaymentMode === opt.v && <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'white' }} />}</div>
                                            <div><div style={{ fontSize: '0.85rem', color: 'var(--charcoal)', fontWeight: walletSettings?.bookingPaymentMode === opt.v ? '600' : '400' }}>{opt.t}</div><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{opt.d}</div></div>
                                        </label>
                                    ))}
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', padding: '0.75rem 0', borderTop: '1px solid var(--border)' }}>
                                    <div><div style={{ fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.9rem' }}>Allow refunds</div><div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Offer wallet refunds to clients</div></div>
                                    <button type="button" onClick={() => saveWalletSettings({ refundsAllowed: !walletSettings?.refundsAllowed })} disabled={walletSaving} style={{ width: '48px', height: '26px', borderRadius: '99px', border: 'none', cursor: 'pointer', background: walletSettings?.refundsAllowed ? 'var(--gold)' : '#d1d5db', position: 'relative', flexShrink: 0 }}>
                                        <span style={{ position: 'absolute', top: '3px', left: '3px', transform: walletSettings?.refundsAllowed ? 'translateX(22px)' : 'translateX(0)', width: '20px', height: '20px', borderRadius: '50%', background: 'white', transition: 'transform 0.2s' }} />
                                    </button>
                                </div>

                                <div style={{ padding: '0.75rem 0', borderTop: '1px solid var(--border)' }}>
                                    <label style={{ display: 'block', fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.9rem', marginBottom: '0.4rem' }}>Balance expiry</label>
                                    <select value={walletSettings?.expiryMonths ?? ''} onChange={(e) => saveWalletSettings({ expiryMonths: e.target.value === '' ? null : Number(e.target.value) })} className="input" style={{ width: '100%', maxWidth: '260px' }}>
                                        <option value="">Never expire</option>
                                        <option value="6">Expire after 6 months</option>
                                        <option value="12">Expire after 12 months</option>
                                        <option value="24">Expire after 24 months</option>
                                    </select>
                                </div>

                                <div style={{ padding: '0.75rem 0 0', borderTop: '1px solid var(--border)' }}>
                                    <label style={{ display: 'block', fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.9rem', marginBottom: '0.4rem' }}>Payment instructions for clients</label>
                                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 0.5rem' }}>Shown when a client tops up — your bank account, eWallet, PayToday or deposit details.</p>
                                    <textarea defaultValue={walletSettings?.paymentInstructions || ''} key={walletSettings?.paymentInstructions} onBlur={(e) => { if (e.target.value !== (walletSettings?.paymentInstructions || '')) saveWalletSettings({ paymentInstructions: e.target.value }); }} rows={4} placeholder={'e.g.\nBank Windhoek · Acc 1234567890\nPayToday: 081 234 5678'} className="input" style={{ width: '100%', resize: 'vertical' }} />
                                    <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.35rem 0 0' }}>Saved when you click away. Online card payment is coming soon.</p>
                                </div>
                            </div>

                            {/* Pending top-up requests */}
                            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden', marginBottom: '1.5rem' }}>
                                <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: '600', color: 'var(--charcoal)', margin: 0 }}>Top-up requests</h3>
                                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{walletTopups.filter((t) => t.status === 'pending').length} pending</span>
                                </div>
                                {walletTopups.length === 0 ? (
                                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>No top-up requests yet.</div>
                                ) : (
                                    <div>
                                        {walletTopups.slice(0, 30).map((t) => (
                                            <div key={t._id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', padding: '0.9rem 1.5rem', borderBottom: '1px solid var(--border)' }}>
                                                <div style={{ minWidth: 0 }}>
                                                    <p style={{ margin: 0, fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.9rem' }}>{t.customer?.name || 'Client'} · {nMoney(t.amount)}</p>
                                                    <p style={{ margin: '0.1rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                        {new Date(t.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{t.reference ? ` · ${t.reference}` : ''}
                                                        {t.proofUrl && <> · <a href={t.proofUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--gold-dark)' }}>View proof</a></>}
                                                    </p>
                                                </div>
                                                {t.status === 'pending' ? (
                                                    <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                                                        <button onClick={() => resolveTopUp(t._id, true)} className="btn-primary" style={{ padding: '0.35rem 0.9rem', fontSize: '0.8rem' }}>Approve</button>
                                                        <button onClick={() => resolveTopUp(t._id, false)} className="btn-outline" style={{ padding: '0.35rem 0.9rem', fontSize: '0.8rem' }}>Reject</button>
                                                    </div>
                                                ) : (
                                                    <span style={{ fontSize: '0.75rem', fontWeight: '600', padding: '0.2rem 0.6rem', borderRadius: '99px', textTransform: 'capitalize', background: t.status === 'approved' ? '#d1fae5' : '#fee2e2', color: t.status === 'approved' ? '#065f46' : '#991b1b' }}>{t.status}</span>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Client balances */}
                            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden', marginBottom: '1.5rem' }}>
                                <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--border)' }}>
                                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: '600', color: 'var(--charcoal)', margin: 0 }}>Client balances</h3>
                                </div>
                                {walletClientWallets.length === 0 ? (
                                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>No client wallets yet.</div>
                                ) : (
                                    <div style={{ overflowX: 'auto' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                            <thead><tr style={{ background: 'var(--warm-gray)', textAlign: 'left' }}>{['Client', 'Available', 'Reserved', 'Total', ''].map((h) => <th key={h} style={{ padding: '0.6rem 1rem', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>{h}</th>)}</tr></thead>
                                            <tbody>
                                                {walletClientWallets.map((w) => (
                                                    <tr key={w._id} style={{ borderBottom: '1px solid var(--border)' }}>
                                                        <td style={{ padding: '0.7rem 1rem' }}><div style={{ fontWeight: '600', color: 'var(--charcoal)' }}>{w.customer?.name || '—'}</div><div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{w.customer?.email}</div></td>
                                                        <td style={{ padding: '0.7rem 1rem', fontWeight: '600', color: 'var(--gold-dark)' }}>{nMoney(w.availableBalance)}</td>
                                                        <td style={{ padding: '0.7rem 1rem', color: 'var(--text-secondary)' }}>{nMoney(w.reservedBalance)}</td>
                                                        <td style={{ padding: '0.7rem 1rem', color: 'var(--charcoal)' }}>{nMoney(w.totalBalance)}</td>
                                                        <td style={{ padding: '0.7rem 1rem', textAlign: 'right' }}><button onClick={() => setAdjustModal({ wallet: w })} className="btn-outline" style={{ padding: '0.3rem 0.8rem', fontSize: '0.78rem' }}>Adjust</button></td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>

                            {/* Adjustment history */}
                            {walletAdjustments.length > 0 && (
                                <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                                    <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--border)' }}>
                                        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: '600', color: 'var(--charcoal)', margin: 0 }}>Adjustments</h3>
                                    </div>
                                    {walletAdjustments.slice(0, 30).map((a) => (
                                        <div key={a._id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.8rem 1.5rem', borderBottom: '1px solid var(--border)', gap: '1rem' }}>
                                            <div style={{ minWidth: 0 }}>
                                                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--charcoal)', fontWeight: '500' }}>{a.customer?.name} · {a.direction === 'credit' ? 'Credit' : 'Debit'} {nMoney(a.amount)}{a.type === 'refund' ? ' (refund)' : ''}</p>
                                                {a.reason && <p style={{ margin: '0.1rem 0 0', fontSize: '0.74rem', color: 'var(--text-muted)' }}>{a.reason}</p>}
                                            </div>
                                            <span style={{ fontSize: '0.72rem', fontWeight: '600', padding: '0.2rem 0.6rem', borderRadius: '99px', textTransform: 'capitalize', background: a.status === 'approved' ? '#d1fae5' : a.status === 'pending' ? '#fef3c7' : '#fee2e2', color: a.status === 'approved' ? '#065f46' : a.status === 'pending' ? '#92400e' : '#991b1b' }}>{a.status}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}

                    {adjustModal && (
                        <WalletAdjustmentModal
                            wallet={adjustModal.wallet}
                            refundsAllowed={walletSettings?.refundsAllowed}
                            curSym={curSym}
                            onClose={() => setAdjustModal(null)}
                            onSubmit={submitAdjustment}
                        />
                    )}
                    {showAccountTopUp && (
                        <ProviderAccountTopUpModal
                            curSym={curSym}
                            onClose={() => setShowAccountTopUp(false)}
                            onDone={() => { setShowAccountTopUp(false); fetchWalletData(); }}
                        />
                    )}
                </div>
            )}

            {/* ── TEAM TAB ── */}
            {activeTab === 'forms' && <FormsManager />}

            {activeTab === 'team' && (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <div>
                            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: '600', color: 'var(--charcoal)', margin: 0 }}>Team members</h2>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>Manage staff who take appointments at your business.</p>
                        </div>
                        <button onClick={openAddMember} className="btn-primary" style={{ padding: '0.65rem 1.25rem', fontSize: '0.875rem' }}>+ Add member</button>
                    </div>

                    {/* Add / Edit form */}
                    {showTeamForm && (
                        <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--gold)', padding: '1.75rem', marginBottom: '1.5rem', boxShadow: 'var(--shadow-sm)', marginTop: '1.5rem' }}>
                            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: '700', marginBottom: '1.25rem', color: 'var(--charcoal)' }}>
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
                                        {['#f03e16', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'].map(c => (
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
                        <RowsSkeleton />
                    ) : teamMembers.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '5rem 2rem', color: 'var(--text-muted)', background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', marginTop: '1.5rem' }}>
                            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>👤</div>
                            <p style={{ fontWeight: '600', fontSize: '1rem', color: 'var(--charcoal)', marginBottom: '0.35rem' }}>No team members yet</p>
                            <p style={{ fontSize: '0.875rem' }}>Add staff members so you can assign them to appointments and track their schedule.</p>
                        </div>
                    ) : (
                        <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {teamMembers.map(m => (
                                <div key={m._id} style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
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
                                            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.35rem 0.75rem', fontSize: '0.75rem', cursor: 'pointer', color: 'var(--text-secondary)', fontFamily: 'var(--font-body)' }}>
                                            {m.isActive ? 'Deactivate' : 'Activate'}
                                        </button>
                                        <button onClick={() => openEditMember(m)}
                                            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.35rem 0.75rem', fontSize: '0.75rem', cursor: 'pointer', color: 'var(--text-secondary)', fontFamily: 'var(--font-body)' }}>
                                            Edit
                                        </button>
                                        <button onClick={() => window.confirm(`Remove ${m.name} from your team?`) && handleDeleteMember(m._id)}
                                            style={{ background: 'none', border: '1px solid #fca5a5', borderRadius: 'var(--radius-sm)', padding: '0.35rem 0.75rem', fontSize: '0.75rem', cursor: 'pointer', color: '#dc2626', fontFamily: 'var(--font-body)' }}>
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

            {/* Recurring blocked time action modal. z-index 1100 so it sits ABOVE the
                block-edit slide-in panel (z-1002) — otherwise, editing/deleting a
                recurring block opened this "this / all" chooser BEHIND the panel and
                looked like "Update did nothing". */}
            {recurringActionModal && (
                <div className="sheet-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={e => { if (e.target === e.currentTarget) setRecurringActionModal(null); }}>
                    <div className="sheet-panel" style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius) var(--radius) 0 0', padding: '2rem 1.5rem 2.5rem', width: '100%', maxWidth: '480px', position: 'relative' }}>
                        <button onClick={() => setRecurringActionModal(null)} style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.4rem', color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
                        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '0.5rem' }}>
                            {recurringActionModal.action === 'update' ? 'Update blocked time' : 'Delete blocked time'}
                        </h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>This blocked time is a recurring blocked time.</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.75rem' }}>
                            {[
                                { value: 'this', label: recurringActionModal.action === 'update' ? 'Update this blocked time only' : 'Delete this blocked time only' },
                                { value: 'thisAndFuture', label: recurringActionModal.action === 'update' ? 'Update this and future blocked times' : 'Delete this and future blocked times' },
                                { value: 'all', label: recurringActionModal.action === 'update' ? 'Update all blocked times' : 'Delete all blocked times' },
                            ].map(opt => (
                                <label key={opt.value} onClick={() => setRecurringMode(opt.value)} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.875rem 1rem', borderRadius: 'var(--radius-sm)', border: `1px solid ${recurringMode === opt.value ? 'var(--gold)' : 'var(--border)'}`, background: recurringMode === opt.value ? 'rgba(240,62,22,0.05)' : 'white', cursor: 'pointer', transition: 'all 0.15s' }}>
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

            <style>{`@keyframes spin { to { transform: rotate(360deg); } }
                /* Centered-modal entrance that keeps the translate(-50%,-50%) centering
                   (a plain scaleIn would drop the centering transform mid-animation). */
                @keyframes modalPop { from { opacity: 0; transform: translate(-50%,-50%) scale(0.96); } to { opacity: 1; transform: translate(-50%,-50%) scale(1); } }
                .appt-modal-pop { animation: modalPop var(--dur-slow) var(--ease-out) both; }
                @media (prefers-reduced-motion: reduce) { .appt-modal-pop { animation: none; } }`}</style>

            {/* Add Appointment modal */}
            {showApptModal && (
                <ChromeModal
                    onClose={() => { if (!savingAppt) setShowApptModal(false); }}
                    scrimStyle={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1001, backdropFilter: 'blur(2px)' }}
                    panelClassName="modal-center appt-modal-pop"
                    panelStyle={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: '420px', maxWidth: '95vw', maxHeight: '90dvh', display: 'flex', flexDirection: 'column', background: 'white', borderRadius: 'var(--radius)', boxShadow: '0 20px 60px rgba(0,0,0,0.25)', zIndex: 1002, overflow: 'hidden' }}
                >
                        <div style={{ background: 'var(--ink)', padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                            <div>
                                <h2 style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)', fontSize: '1.25rem', fontWeight: '700', margin: '0 0 0.15rem' }}>New Appointment</h2>
                                <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.75rem', margin: 0 }}>Book a slot for a client</p>
                            </div>
                            <CloseButton onClick={() => setShowApptModal(false)} />
                        </div>
                        <form onSubmit={async e => {
                            e.preventDefault();
                            setApptError('');
                            const svc = myServices.find(s => s._id === apptForm.serviceId);
                            if (!svc) { setApptError('Please select a service'); return; }
                            if (!apptForm.isGroup && apptForm.clientMode === 'existing' && !apptForm.customerId) {
                                setApptError('Please choose a client, or switch to Walk-in.'); return;
                            }
                            if (!apptForm.date) { setApptError('Please pick a date'); return; }
                            if (!apptForm.startTime) { setApptError('Please pick a start time'); return; }
                            const [h, m] = apptForm.startTime.split(':').map(Number);
                            const endMins = h * 60 + m + (svc.duration || 30);
                            const endTime = `${String(Math.floor(endMins / 60)).padStart(2,'0')}:${String(endMins % 60).padStart(2,'0')}`;
                            setSavingAppt(true);
                            try {
                                if (apptForm.isGroup) {
                                    const validClients = apptForm.groupClients.filter(c => c.name.trim());
                                    await appointmentService.createGroupBooking({
                                        service: apptForm.serviceId,
                                        appointmentDate: apptForm.date,
                                        startTime: apptForm.startTime,
                                        endTime,
                                        clients: validClients,
                                        notes: apptForm.notes,
                                        teamMember: apptForm.teamMember || undefined,
                                    });
                                } else {
                                    await appointmentService.createAppointment({
                                        service: apptForm.serviceId,
                                        appointmentDate: apptForm.date,
                                        startTime: apptForm.startTime,
                                        endTime,
                                        customerId: apptForm.clientMode === 'existing' ? (apptForm.customerId || undefined) : undefined,
                                        walkInName: apptForm.clientMode === 'walkin' ? (apptForm.clientName.trim() || undefined) : undefined,
                                        notes: apptForm.notes,
                                        teamMember: apptForm.teamMember || undefined,
                                        isRecurring: apptForm.isRecurring,
                                        recurrenceType: apptForm.isRecurring ? apptForm.recurrenceType : undefined,
                                        recurrenceInterval: apptForm.isRecurring ? apptForm.recurrenceInterval : undefined,
                                        recurrenceEndDate: apptForm.isRecurring && apptForm.recurrenceEndDate ? apptForm.recurrenceEndDate : undefined,
                                    });
                                }
                                await fetchAppointments(); // {all:true} — a bare refetch truncates the calendar to 20
                                setShowApptModal(false);
                            } catch (err) {
                                setApptError(err.response?.data?.message || 'Failed to create appointment');
                            } finally {
                                setSavingAppt(false);
                            }
                        }} style={{ padding: '1.5rem', overflowY: 'auto', minHeight: 0 }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Service</label>
                                    <select value={apptForm.serviceId} onChange={e => setApptForm(f => ({ ...f, serviceId: e.target.value }))} required className="input" style={{ width: '100%' }}>
                                        <option value="">Select a service</option>
                                        {myServices.map(s => <option key={s._id} value={s._id}>{s.name} ({s.duration} min)</option>)}
                                    </select>
                                    {myServices.length === 0 && <p style={{ fontSize: '0.75rem', color: '#dc2626', marginTop: '0.35rem' }}>No services found. Add services in the Catalogue tab first.</p>}
                                </div>
                                {teamMembers.length > 0 && (
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Staff member</label>
                                        <select value={apptForm.teamMember} onChange={e => setApptForm(f => ({ ...f, teamMember: e.target.value }))} className="input" style={{ width: '100%' }}>
                                            <option value="">Me / unassigned</option>
                                            {teamMembers.filter(m => m.isActive !== false).map(m => <option key={m._id} value={m._id}>{m.name}{m.role ? ` · ${m.role}` : ''}</option>)}
                                            {/* Booking from an inactive member's lane (they can still hold
                                                appointments) must not render a blank select */}
                                            {apptForm.teamMember && !teamMembers.some(m => String(m._id) === String(apptForm.teamMember) && m.isActive !== false) && (
                                                <option value={apptForm.teamMember}>
                                                    {teamMembers.find(m => String(m._id) === String(apptForm.teamMember))?.name || 'Staff member'} · inactive
                                                </option>
                                            )}
                                        </select>
                                    </div>
                                )}
                                {/* Group booking toggle */}
                                <div style={{ borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', padding: '0.75rem 1rem', background: apptForm.isGroup ? 'rgba(240,62,22,0.05)' : 'transparent' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: apptForm.isGroup ? '0.75rem' : 0 }}>
                                        <div>
                                            <span style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--charcoal)' }}>Group booking</span>
                                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: '0.4rem' }}>Book multiple clients at once</span>
                                        </div>
                                        <button type="button" onClick={() => setApptForm(f => ({ ...f, isGroup: !f.isGroup }))} style={{ width: '36px', height: '20px', borderRadius: '99px', border: 'none', background: apptForm.isGroup ? 'var(--gold)' : '#cbd5e1', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
                                            <span style={{ position: 'absolute', top: '2px', left: '2px', transform: apptForm.isGroup ? 'translateX(16px)' : 'translateX(0)', width: '16px', height: '16px', borderRadius: '50%', background: 'white', transition: 'transform 0.2s', display: 'block' }} />
                                        </button>
                                    </div>
                                    {apptForm.isGroup ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                            {apptForm.groupClients.map((c, i) => (
                                                <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                                    <input className="input" placeholder={`Client ${i + 1} name`} value={c.name} onChange={e => { const g = [...apptForm.groupClients]; g[i] = { ...g[i], name: e.target.value }; setApptForm(f => ({ ...f, groupClients: g })); }} style={{ flex: 1, fontSize: '0.85rem' }} />
                                                    {apptForm.groupClients.length > 1 && <button type="button" onClick={() => setApptForm(f => ({ ...f, groupClients: f.groupClients.filter((_, j) => j !== i) }))} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '1rem' }}>×</button>}
                                                </div>
                                            ))}
                                            <button type="button" onClick={() => setApptForm(f => ({ ...f, groupClients: [...f.groupClients, { name: '' }] }))} style={{ alignSelf: 'flex-start', fontSize: '0.75rem', padding: '0.25rem 0.65rem', border: '1px solid var(--gold)', borderRadius: 'var(--radius-sm)', background: 'rgba(240,62,22,0.08)', color: 'var(--gold-dark)', cursor: 'pointer', fontWeight: '600' }}>+ Add client</button>
                                        </div>
                                    ) : (
                                        <div>
                                            {/* Choose between an existing registered client and a walk-in */}
                                            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                                                {[{ mode: 'existing', label: 'Existing client' }, { mode: 'walkin', label: 'Walk-in client' }].map(opt => {
                                                    const active = apptForm.clientMode === opt.mode;
                                                    return (
                                                        <button key={opt.mode} type="button" onClick={() => setApptForm(f => ({ ...f, clientMode: opt.mode }))} style={{
                                                            flex: 1, padding: '0.5rem 0.4rem', borderRadius: 'var(--radius-sm)',
                                                            border: `1.5px solid ${active ? 'var(--gold)' : 'var(--border)'}`,
                                                            background: active ? 'rgba(240,62,22,0.1)' : 'white',
                                                            color: active ? 'var(--gold-dark)' : 'var(--text-secondary)',
                                                            fontWeight: active ? '700' : '500', fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'var(--font-body)',
                                                        }}>{opt.label}</button>
                                                    );
                                                })}
                                            </div>
                                            {apptForm.clientMode === 'existing' ? (
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Client</label>
                                                    {clients.length === 0 ? (
                                                        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
                                                            {loadingClients ? 'Loading your clients…' : 'No saved clients yet — switch to Walk-in to book by name.'}
                                                        </p>
                                                    ) : (
                                                        <>
                                                            <input type="text" value={clientPickerSearch} onChange={e => setClientPickerSearch(e.target.value)} placeholder="Search by name or email" className="input" style={{ width: '100%', marginBottom: '0.4rem' }} />
                                                            <select value={apptForm.customerId} onChange={e => setApptForm(f => ({ ...f, customerId: e.target.value }))} required className="input" style={{ width: '100%' }}>
                                                                <option value="">Select a client</option>
                                                                {clients
                                                                    .filter(c => c.customer && c.customer._id !== user?._id)
                                                                    .filter(c => {
                                                                        const q = clientPickerSearch.trim().toLowerCase();
                                                                        if (!q) return true;
                                                                        return (c.customer.name || '').toLowerCase().includes(q) || (c.customer.email || '').toLowerCase().includes(q);
                                                                    })
                                                                    .map(c => (
                                                                        <option key={c.customer._id} value={c.customer._id}>
                                                                            {c.customer.name}{c.customer.email ? ` — ${c.customer.email}` : ''}
                                                                        </option>
                                                                    ))}
                                                            </select>
                                                        </>
                                                    )}
                                                </div>
                                            ) : (
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Client Name <span style={{ fontWeight: '400', textTransform: 'none' }}>(optional)</span></label>
                                                    <input type="text" value={apptForm.clientName} onChange={e => setApptForm(f => ({ ...f, clientName: e.target.value }))} placeholder="e.g. John Smith" className="input" style={{ width: '100%' }} />
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date</label>
                                    <MiniCalendar value={apptForm.date} onChange={ds => setApptForm(f => ({ ...f, date: ds, startTime: '' }))} min={new Date().toISOString().split('T')[0]} />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Start Time</label>
                                    {(() => {
                                        if (!apptForm.date) return <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>Pick a date first.</p>;
                                        const svc = myServices.find(s => s._id === apptForm.serviceId);
                                        const duration = svc?.duration || 30;
                                        let blocks = [{ start: 8 * 60, end: 20 * 60 }];
                                        if (availability) {
                                            const [yy, mm, dd] = apptForm.date.split('-').map(Number);
                                            const dayName = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date(yy, mm - 1, dd).getDay()];
                                            const cfg = availability[dayName];
                                            if (cfg?.enabled && Array.isArray(cfg.slots)) {
                                                const b = cfg.slots.filter(s => s?.start && s?.end).map(s => { const [sh, sm] = s.start.split(':').map(Number); const [eh, em] = s.end.split(':').map(Number); return { start: sh * 60 + sm, end: eh * 60 + em }; }).filter(x => x.end > x.start);
                                                if (b.length) blocks = b;
                                            }
                                        }
                                        const bookedRanges = (appointments || []).filter(a => {
                                            const ad = new Date(a.appointmentDate);
                                            const ds = `${ad.getFullYear()}-${String(ad.getMonth() + 1).padStart(2, '0')}-${String(ad.getDate()).padStart(2, '0')}`;
                                            const tm = a.teamMember?._id || a.teamMember || '';
                                            return ds === apptForm.date && a.status !== 'cancelled' && (apptForm.teamMember ? String(tm) === String(apptForm.teamMember) : true);
                                        }).map(a => { const [sh, sm] = (a.startTime || '0:0').split(':').map(Number); const [eh, em] = (a.endTime || '0:0').split(':').map(Number); return { start: sh * 60 + sm, end: eh * 60 + em }; });
                                        let minStart = -1;
                                        const now = new Date();
                                        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
                                        if (apptForm.date === todayStr) minStart = now.getHours() * 60 + now.getMinutes();
                                        const slots = buildTimeSlots({ blocks, bookedRanges, duration, minStart });
                                        if (slots.length === 0) return <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>No open times that day.</p>;
                                        return (
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: '0.4rem', maxHeight: '180px', overflowY: 'auto' }}>
                                                {slots.map((s, i) => {
                                                    const sel = apptForm.startTime === s.time;
                                                    return (
                                                        <button key={i} type="button" disabled={s.isBooked} onClick={() => setApptForm(f => ({ ...f, startTime: s.time }))} style={{
                                                            padding: '0.5rem 0.3rem', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-body)', fontWeight: '600', fontSize: '0.82rem',
                                                            border: `1.5px solid ${sel ? 'var(--gold)' : 'var(--border)'}`,
                                                            background: sel ? 'var(--gold)' : s.isBooked ? 'var(--surface-sunken)' : 'var(--card-bg)',
                                                            color: sel ? 'var(--ink)' : s.isBooked ? 'var(--text-muted)' : 'var(--charcoal)',
                                                            textDecoration: s.isBooked ? 'line-through' : 'none', opacity: s.isBooked ? 0.6 : 1, cursor: s.isBooked ? 'not-allowed' : 'pointer',
                                                        }}>{s.time}</button>
                                                    );
                                                })}
                                            </div>
                                        );
                                    })()}
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Notes <span style={{ fontWeight: '400', textTransform: 'none' }}>(optional)</span></label>
                                    <textarea value={apptForm.notes} onChange={e => setApptForm(f => ({ ...f, notes: e.target.value }))} rows={3} placeholder="Any notes for this appointment..." className="input" style={{ width: '100%', resize: 'vertical' }} />
                                </div>
                                {/* Recurring — shared controls (Custom frequency + app calendar) */}
                                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                                    <RecurrenceFields
                                        value={{ isRecurring: apptForm.isRecurring, recurrenceType: apptForm.recurrenceType, recurrenceInterval: apptForm.recurrenceInterval || 1, recurrenceEndDate: apptForm.recurrenceEndDate }}
                                        onChange={(v) => setApptForm(f => ({ ...f, isRecurring: v.isRecurring, recurrenceType: v.recurrenceType, recurrenceInterval: v.recurrenceInterval, recurrenceEndDate: v.recurrenceEndDate }))}
                                        minDate={apptForm.date || undefined}
                                    />
                                </div>
                                {apptError && <p style={{ color: '#dc2626', fontSize: '0.85rem', margin: 0 }}>{apptError}</p>}
                                <button type="submit" disabled={savingAppt} style={{ width: '100%', padding: '0.9rem', background: savingAppt ? '#9ca3af' : 'var(--ink)', color: 'var(--on-ink)', border: 'none', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-body)', fontSize: '0.95rem', fontWeight: '700', cursor: savingAppt ? 'not-allowed' : 'pointer' }}>
                                    {savingAppt ? 'Saving...' : apptForm.isRecurring ? 'Book Recurring Series' : 'Book Appointment'}
                                </button>
                            </div>
                        </form>
                </ChromeModal>
            )}

            {/* Add/Edit Blocked Time panel */}
            {showBlockedTimeForm && (
                <ChromeModal
                    onClose={closeBlockedTimeForm}
                    scrimStyle={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1001, backdropFilter: 'blur(2px)' }}
                    panelClassName="block-time-panel"
                    panelStyle={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: '400px', maxWidth: '95vw', background: 'var(--card-bg)', boxShadow: '-8px 0 40px rgba(0,0,0,0.18)', zIndex: 1002, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}
                >
                        {/* Panel header */}
                        <div style={{ background: 'var(--ink)', padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                            <div>
                                <h2 style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)', fontSize: '1.25rem', fontWeight: '700', margin: '0 0 0.2rem' }}>
                                    {editingBlockedTime ? 'Edit Blocked Time' : 'Add blocked time'}
                                </h2>
                                <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.75rem', margin: 0 }}>Block off time when you're unavailable</p>
                            </div>
                            <CloseButton onClick={closeBlockedTimeForm} />
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
                                                    background: blockedTimeForm.blockType === t.id ? 'rgba(240,62,22,0.07)' : 'white',
                                                    cursor: 'pointer', textAlign: 'center',
                                                }}
                                            >
                                                <div style={{ fontSize: '1.2rem', marginBottom: '0.25rem' }}>{t.icon}</div>
                                                <div style={{ fontSize: '0.75rem', fontWeight: '700', color: blockedTimeForm.blockType === t.id ? 'var(--gold-dark)' : 'var(--charcoal)', fontFamily: 'var(--font-body)' }}>{t.id}</div>
                                                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.1rem', fontFamily: 'var(--font-body)' }}>{t.desc}</div>
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

                            {/* Who does this block apply to? Business-wide (blocks every lane) or one
                                staff member. The update API can't move a block between staff, so when
                                editing we show the scope read-only. */}
                            <div>
                                <label style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '0.4rem' }}>Applies to</label>
                                {!editingBlockedTime && activeTeamMembers.length > 0 ? (
                                    <select
                                        className="input"
                                        value={blockedTimeForm.teamMember}
                                        onChange={e => setBlockedTimeForm(p => ({ ...p, teamMember: e.target.value }))}
                                        style={{ width: '100%', boxSizing: 'border-box' }}
                                    >
                                        <option value="">Whole business (everyone)</option>
                                        {activeTeamMembers.map(m => <option key={m._id} value={m._id}>{m.name}{m.role ? ` · ${m.role}` : ''} only</option>)}
                                        {blockedTimeForm.teamMember && !activeTeamMembers.some(m => String(m._id) === String(blockedTimeForm.teamMember)) && (
                                            <option value={blockedTimeForm.teamMember}>
                                                {teamMembers.find(m => String(m._id) === String(blockedTimeForm.teamMember))?.name || 'Staff member'} · inactive
                                            </option>
                                        )}
                                    </select>
                                ) : (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.65rem 0.875rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--warm-gray)' }}>
                                        <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: user?.avatar && !blockedTimeForm.teamMember ? 'transparent' : 'var(--ink)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                            {user?.avatar && !blockedTimeForm.teamMember
                                                ? <img src={cloudinaryAvatar(user.avatar)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                : <span style={{ color: 'var(--gold)', fontWeight: '700', fontSize: '0.8rem' }}>{(blockedTimeForm.teamMember ? teamMembers.find(m => String(m._id) === blockedTimeForm.teamMember)?.name : user?.name)?.[0] || '?'}</span>}
                                        </div>
                                        <span style={{ fontSize: '0.875rem', color: 'var(--charcoal)', fontFamily: 'var(--font-body)', fontWeight: '500' }}>
                                            {blockedTimeForm.teamMember
                                                ? `${teamMembers.find(m => String(m._id) === blockedTimeForm.teamMember)?.name || 'Staff member'} only`
                                                : (activeTeamMembers.length > 0 ? 'Whole business (everyone)' : user?.name)}
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Frequency */}
                            {!editingBlockedTime && (
                                <div>
                                    <label style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '0.4rem' }}>Frequency</label>
                                    <select className="input" value={blockedTimeForm.isRecurring ? blockedTimeForm.recurrenceType : 'none'} onChange={e => {
                                        if (e.target.value === 'none') setBlockedTimeForm(p => ({ ...p, isRecurring: false, recurrenceType: 'weekly', customDays: [] }));
                                        else setBlockedTimeForm(p => ({ ...p, isRecurring: true, recurrenceType: e.target.value }));
                                    }} style={{ width: '100%', boxSizing: 'border-box' }}>
                                        <option value="none">Doesn't repeat</option>
                                        <option value="daily">Daily</option>
                                        <option value="weekly">Weekly</option>
                                        <option value="monthly">Monthly</option>
                                        <option value="custom">Custom (select days)</option>
                                    </select>
                                    {blockedTimeForm.isRecurring && blockedTimeForm.recurrenceType === 'custom' && (
                                        <div style={{ marginTop: '0.65rem' }}>
                                            <label style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '0.5rem' }}>Repeat on</label>
                                            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                                                {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d, i) => {
                                                    const selected = (blockedTimeForm.customDays || []).includes(i);
                                                    return (
                                                        <button key={d} type="button" onClick={() => setBlockedTimeForm(p => {
                                                            const days = p.customDays || [];
                                                            return { ...p, customDays: selected ? days.filter(x => x !== i) : [...days, i] };
                                                        })} style={{ width: '38px', height: '38px', borderRadius: '50%', border: `2px solid ${selected ? 'var(--gold)' : 'var(--border)'}`, background: selected ? 'var(--gold)' : 'var(--card-bg)', color: selected ? 'var(--charcoal)' : 'var(--text-secondary)', fontWeight: '600', fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>{d}</button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
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
                                <textarea className="input" rows={3} maxLength={255} placeholder="Add description or note" value={blockedTimeForm.reason} onChange={e => setBlockedTimeForm(p => ({ ...p, reason: e.target.value, title: p.title || e.target.value }))} style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'var(--font-body)' }} />
                                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'right', marginTop: '0.25rem' }}>{(blockedTimeForm.reason || '').length}/255</p>
                            </div>

                            <div style={{ flexGrow: 1 }} />

                            {/* Save button */}
                            <button type="submit" disabled={savingBlockedTime} style={{ width: '100%', padding: '0.9rem', background: savingBlockedTime ? '#9ca3af' : 'var(--ink)', color: 'var(--on-ink)', border: 'none', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-body)', fontSize: '0.95rem', fontWeight: '700', cursor: savingBlockedTime ? 'not-allowed' : 'pointer', letterSpacing: '0.03em' }}>
                                {savingBlockedTime ? 'Saving...' : editingBlockedTime ? 'Update' : 'Save'}
                            </button>

                            {/* Unblock / delete — only when editing an existing block. Opens the
                                recurring "this / all" chooser for repeating blocks, otherwise
                                removes it and closes the panel. */}
                            {editingBlockedTime && (
                                <button type="button" onClick={() => handleDeleteBlockedTime(editingBlockedTime)} disabled={savingBlockedTime} style={{ width: '100%', marginTop: '0.65rem', padding: '0.85rem', background: 'none', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-body)', fontSize: '0.9rem', fontWeight: '700', cursor: savingBlockedTime ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                                    <Ban size={16} /> Unblock this time
                                </button>
                            )}
                        </form>
                </ChromeModal>
            )}
            {/* Appointment detail / reschedule panel */}
            {apptDetailModal && (
                <ChromeModal
                    onClose={() => setApptDetailModal(null)}
                    scrimStyle={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1001, backdropFilter: 'blur(2px)' }}
                    panelClassName="block-time-panel"
                    panelStyle={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: '400px', maxWidth: '95vw', background: 'var(--card-bg)', boxShadow: '-8px 0 40px rgba(0,0,0,0.18)', zIndex: 1002, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}
                >
                        {/* Header */}
                        <div style={{ background: 'var(--ink)', padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                            <div>
                                <h2 style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)', fontSize: '1.25rem', fontWeight: '700', margin: '0 0 0.2rem' }}>Appointment</h2>
                                <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.75rem', margin: 0, fontFamily: 'var(--font-body)' }}>{apptDetailModal.service?.name}</p>
                            </div>
                            <CloseButton onClick={() => setApptDetailModal(null)} />
                        </div>

                        {/* Client card - tap the name to reveal contact options (call / email / chat) */}
                        {(() => {
                            // A client is a registered customer, a guest (guest checkout,
                            // contact captured but no account) or a walk-in the provider
                            // logged. Guests used to fall through to "Walk-in - no saved
                            // contact" even though we hold their name, email and phone.
                            //
                            // A walk-in has no account, but the model still demands a
                            // `customer`, so the booking stores the PROVIDER's own id as a
                            // placeholder. Taking that at face value showed the owner their
                            // OWN name, phone and email as if they were the client's — so a
                            // walk-in ignores `customer` entirely.
                            const isWalkIn = !!apptDetailModal.walkInName;
                            const cust = isWalkIn ? null : apptDetailModal.customer;
                            const isRegistered = !!cust?._id;
                            const displayName = apptDetailModal.walkInName || apptDetailModal.guestName || cust?.name || 'Client';
                            const phone = cust?.phone || apptDetailModal.guestPhone || '';
                            const email = cust?.email || apptDetailModal.guestEmail || '';
                            const subtitle = phone || email || (isRegistered ? '' : 'No saved contact');
                            const canContact = isRegistered || phone || email;
                            return (
                                <div style={{ padding: '1.1rem 1.5rem', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                                        {canContact ? (
                                            <button
                                                onClick={() => setShowApptContact(v => !v)}
                                                aria-expanded={showApptContact}
                                                aria-label={`${showApptContact ? 'Hide' : 'Show'} contact options for ${displayName}`}
                                                style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
                                            >
                                                <span style={{ minWidth: 0 }}>
                                                    <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: 700, color: 'var(--charcoal)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</span>
                                                    {subtitle && <span style={{ display: 'block', fontSize: '0.76rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-body)' }}>{subtitle}</span>}
                                                </span>
                                                <ChevronDown size={16} color="var(--text-muted)" style={{ flexShrink: 0, transform: showApptContact ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                                            </button>
                                        ) : (
                                            <div style={{ minWidth: 0 }}>
                                                <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: 700, color: 'var(--charcoal)', display: 'block' }}>{displayName}</span>
                                                {subtitle && <span style={{ display: 'block', fontSize: '0.76rem', color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>{subtitle}</span>}
                                            </div>
                                        )}
                                        {isRegistered && (
                                            <button onClick={() => openClientProfile(cust)} style={{ flexShrink: 0, fontSize: '0.72rem', fontWeight: 600, color: 'var(--gold-dark)', background: 'rgba(240,62,22,0.1)', border: '1px solid rgba(240,62,22,0.3)', borderRadius: 'var(--radius-sm)', padding: '0.4rem 0.6rem', cursor: 'pointer', fontFamily: 'var(--font-body)', whiteSpace: 'nowrap', minHeight: '36px' }}>Profile</button>
                                        )}
                                    </div>
                                    {showApptContact && canContact && (
                                        <div style={{ marginTop: '0.85rem' }}>
                                            <ContactActions
                                                phone={phone}
                                                email={email}
                                                onMessage={isRegistered ? () => openChatForAppointment(apptDetailModal) : undefined}
                                            />
                                        </div>
                                    )}
                                </div>
                            );
                        })()}

                        <div style={{ padding: '1.5rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {/* Details */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                                {[
                                    ['Service',   apptDetailModal.service?.name || '—'],
                                    ['Date',      apptDetailModal.appointmentDate ? new Date(apptDetailModal.appointmentDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '—'],
                                    ['Time',      `${apptDetailModal.startTime} – ${apptDetailModal.endTime}`],
                                    ['Duration',  apptDetailModal.service?.duration ? `${apptDetailModal.service.duration} min` : '—'],
                                    ['Price',     apptDetailModal.totalPrice ? `${curSym} ${apptDetailModal.totalPrice}` : '—'],
                                    ['Booking ref', apptDetailModal.bookingReference || (apptDetailModal._id ? apptDetailModal._id.slice(-8).toUpperCase() : '—')],
                                ].map(([label, value]) => (
                                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.7rem 0', borderBottom: '1px solid var(--border)' }}>
                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>{label}</span>
                                        <span style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--charcoal)', fontFamily: 'var(--font-body)' }}>{value}</span>
                                    </div>
                                ))}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.7rem 0' }}>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>Status</span>
                                    <span style={{ fontSize: '0.72rem', fontWeight: '700', padding: '0.2rem 0.7rem', borderRadius: '99px', background: (statusCalendarColors[apptDetailModal.status] || statusCalendarColors.pending).bg, color: (statusCalendarColors[apptDetailModal.status] || statusCalendarColors.pending).text, textTransform: 'capitalize' }}>
                                        {apptDetailModal.status}
                                    </span>
                                </div>
                            </div>

                            {/* Intake / consent forms for this appointment */}
                            <ApptFormsView appointmentId={apptDetailModal._id} />

                            {/* Reschedule - collapsed by default so it doesn't push the actions down */}
                            {apptDetailModal.status !== 'cancelled' && apptDetailModal.status !== 'completed' && (
                                <div style={{ background: 'var(--warm-gray)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                                    <button onClick={() => setShowReschedule(s => !s)} aria-expanded={showReschedule} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.85rem 1rem', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
                                        <span style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--charcoal)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Reschedule</span>
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', transform: showReschedule ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>{'▾'}</span>
                                    </button>
                                    {showReschedule && (
                                    <div style={{ padding: '0 1rem 1rem' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.85rem' }}>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.3rem', fontFamily: 'var(--font-body)' }}>New date</label>
                                            <input type="date" className="input" value={apptRescheduleForm.appointmentDate} onChange={e => setApptRescheduleForm(f => ({ ...f, appointmentDate: e.target.value }))} style={{ fontSize: '0.85rem', padding: '0.5rem 0.75rem' }} />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.3rem', fontFamily: 'var(--font-body)' }}>Start time</label>
                                            <input type="time" className="input" value={apptRescheduleForm.startTime} onChange={e => setApptRescheduleForm(f => ({ ...f, startTime: e.target.value }))} style={{ fontSize: '0.85rem', padding: '0.5rem 0.75rem' }} />
                                        </div>
                                    </div>
                                    {apptDetailError && <p style={{ color: 'var(--danger)', fontSize: '0.8rem', marginBottom: '0.75rem', fontFamily: 'var(--font-body)' }}>{apptDetailError}</p>}
                                    <button
                                        onClick={() => handleProviderReschedule(apptDetailModal._id, apptRescheduleForm.appointmentDate, apptRescheduleForm.startTime)}
                                        disabled={savingApptDetail || !apptRescheduleForm.appointmentDate || !apptRescheduleForm.startTime}
                                        style={{ width: '100%', padding: '0.75rem', background: 'var(--ink)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', cursor: savingApptDetail ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-body)', fontWeight: '600', fontSize: '0.875rem', opacity: savingApptDetail ? 0.7 : 1 }}
                                    >
                                        {savingApptDetail ? 'Saving...' : 'Save new time \u2192'}
                                    </button>
                                    </div>
                                    )}
                                </div>
                            )}

                            <div style={{ flexGrow: 1 }} />

                            {/* Quick status actions */}
                            {(apptDetailModal.status === 'pending' || apptDetailModal.status === 'confirmed') && (
                                <div style={{ display: 'flex', gap: '0.6rem' }}>
                                    {apptDetailModal.status === 'pending' && (
                                        <button
                                            onClick={async () => { await handleStatusUpdate(apptDetailModal._id, 'confirmed'); setApptDetailModal(null); }}
                                            style={{ flex: 1, padding: '0.8rem', background: '#d1fae5', color: '#065f46', border: '1px solid #6ee7b7', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontFamily: 'var(--font-body)', fontWeight: '600', fontSize: '0.85rem' }}
                                        >
                                            Confirm
                                        </button>
                                    )}
                                    <button
                                        onClick={async () => { await handleStatusUpdate(apptDetailModal._id, 'completed'); setApptDetailModal(null); }}
                                        style={{ flex: 1, padding: '0.8rem', background: 'rgba(240,62,22,0.1)', color: 'var(--gold-dark)', border: '1px solid var(--gold)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontFamily: 'var(--font-body)', fontWeight: '600', fontSize: '0.85rem' }}
                                    >
                                        Complete
                                    </button>
                                    <button
                                        onClick={async () => {
                                            if (window.confirm('Mark this appointment as a no-show?')) {
                                                await handleStatusUpdate(apptDetailModal._id, 'no-show');
                                                setApptDetailModal(null);
                                            }
                                        }}
                                        style={{ flex: 1, padding: '0.8rem', background: '#ede9fe', color: '#5b21b6', border: '1px solid #c4b5fd', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontFamily: 'var(--font-body)', fontWeight: '600', fontSize: '0.85rem' }}
                                    >
                                        No-show
                                    </button>
                                </div>
                            )}

                            {/* Cancel button — smart: if recurring, offer series cancel */}
                            {apptDetailModal.status !== 'cancelled' && apptDetailModal.status !== 'completed' && (
                                apptDetailModal.isRecurring ? (
                                    <button
                                        onClick={() => { setSeriesCancelModal(apptDetailModal); setSeriesCancelMode('this'); setApptDetailModal(null); }}
                                        style={{ width: '100%', padding: '0.875rem', background: 'none', color: 'var(--danger)', border: '1.5px solid #fca5a5', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontFamily: 'var(--font-body)', fontWeight: '600', fontSize: '0.875rem' }}
                                    >
                                        Cancel appointment…
                                    </button>
                                ) : (
                                    <button
                                        onClick={async () => {
                                            if (window.confirm('Cancel this appointment?')) {
                                                await handleStatusUpdate(apptDetailModal._id, 'cancelled');
                                                setApptDetailModal(null);
                                            }
                                        }}
                                        style={{ width: '100%', padding: '0.875rem', background: 'none', color: 'var(--danger)', border: '1.5px solid #fca5a5', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontFamily: 'var(--font-body)', fontWeight: '600', fontSize: '0.875rem' }}
                                    >
                                        Cancel appointment
                                    </button>
                                )
                            )}
                        </div>
                </ChromeModal>
            )}

            {/* Recurring series cancel modal */}
            {seriesCancelModal && (
                <>
                    <div onClick={() => setSeriesCancelModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1100, backdropFilter: 'blur(2px)' }} />
                    <div className="modal-center" style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: '380px', maxWidth: '95vw', background: 'var(--card-bg)', borderRadius: 'var(--radius)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', zIndex: 1101, overflow: 'hidden' }}>
                        <div style={{ background: 'var(--ink)', padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h2 style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)', fontSize: '1.2rem', fontWeight: '700', margin: 0 }}>Cancel recurring appointment</h2>
                            <button onClick={() => setSeriesCancelModal(null)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: '1.5rem', lineHeight: 1, padding: 0 }}>×</button>
                        </div>
                        <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: 0 }}>This appointment is part of a recurring series. What would you like to cancel?</p>
                            {[
                                { value: 'this', label: 'This appointment only' },
                                { value: 'thisAndFuture', label: 'This and all future occurrences' },
                                { value: 'all', label: 'All appointments in the series' },
                            ].map(opt => (
                                <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.875rem 1rem', borderRadius: 'var(--radius-sm)', border: `2px solid ${seriesCancelMode === opt.value ? 'var(--gold)' : 'var(--border)'}`, background: seriesCancelMode === opt.value ? 'rgba(240,62,22,0.06)' : 'var(--card-bg)', cursor: 'pointer', transition: 'all 0.15s' }}>
                                    <input type="radio" value={opt.value} checked={seriesCancelMode === opt.value} onChange={() => setSeriesCancelMode(opt.value)} style={{ accentColor: 'var(--gold)', width: '18px', height: '18px', flexShrink: 0 }} />
                                    <span style={{ fontSize: '0.9rem', color: 'var(--charcoal)', fontWeight: seriesCancelMode === opt.value ? '600' : '400' }}>{opt.label}</span>
                                </label>
                            ))}
                            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                                <button onClick={() => setSeriesCancelModal(null)} style={{ flex: 1, padding: '0.85rem', background: 'var(--warm-gray)', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontFamily: 'var(--font-body)', fontWeight: '600', color: 'var(--text-secondary)' }}>Keep</button>
                                <button onClick={handleSeriesCancel} style={{ flex: 1, padding: '0.85rem', background: '#ef4444', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontFamily: 'var(--font-body)', fontWeight: '700', color: 'white' }}>Cancel</button>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default ProviderDashboard;
