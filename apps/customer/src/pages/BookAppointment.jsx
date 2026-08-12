import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuthContext } from '../context/AuthContext';
import { appointmentService, serviceService, waitingListService, providerMarketService, availabilityService, walletService } from '../services';
import { Calendar, Clock, CalendarX2 } from 'lucide-react';
import { buildTimeSlots } from '../utils/bookingSlots';
import { cloudinaryAvatar } from '../utils/cloudinary';
import { currencySymbol } from '../utils/currency';
import { mapsUrl } from '../utils/maps';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import RecurrenceFields from '../components/RecurrenceFields';
import StatusOverlay from '../components/StatusOverlay';
import AuthPrompt from '../components/AuthPrompt';
import { track } from '../services/client';

// The API answers a signed-out request with "No token, authorization denied".
// That's server-speak for "you're signed out" — never show it. Anything else
// (a real validation/conflict message) is worth surfacing as-is.
const friendlyError = (err, fallback) =>
    (err?.response?.status === 401 ? 'Please sign in to continue.' : (err?.response?.data?.message || fallback));

const BookAppointment = () => {
    const { user } = useAuthContext();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const rescheduleId = searchParams.get('reschedule'); // present → reschedule mode

    // Funnel: user entered the booking flow (fresh booking vs. reschedule).
    useEffect(() => { track('booking_start', { reschedule: !!rescheduleId }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // â"€â"€ data â"€â"€
    const [services, setServices] = useState([]);
    const [providerInfo, setProviderInfo] = useState(null);

    // â"€â"€ selections â"€â"€
    const [selectedService, setSelectedService] = useState(null);
    const [staffList, setStaffList] = useState([]);
    const [selectedStaff, setSelectedStaff] = useState(null); // null = any available professional
    const [selectedAddOns, setSelectedAddOns] = useState([]);
    const [selectedOption, setSelectedOption] = useState(null); // sub-option (mutually exclusive variant)
    const [optionSheet, setOptionSheet] = useState(null); // service pending option selection
    const [formData, setFormData] = useState({ service: '', appointmentDate: '', startTime: '', endTime: '', notes: '' });

    // â"€â"€ ui state â"€â"€
    const [step, setStep] = useState('form'); // 'form' | 'review'
    const [loading, setLoading] = useState(false);
    const [joining, setJoining] = useState(false); // waiting-list join in flight
    const [error, setError] = useState('');
    const [confirmedOverlay, setConfirmedOverlay] = useState(null); // full-screen success moment → { subtitle, next }
    const [authPrompt, setAuthPrompt] = useState(null); // signed-out + needs an account → { title, message, allowGuest }
    const [providerAvailability, setProviderAvailability] = useState(null);
    const [availabilityError, setAvailabilityError] = useState('');
    const [bookedSlots, setBookedSlots] = useState([]); // [{startTime, endTime}]
    // The selected member's shift working window for the chosen date, or null for
    // "no shift — use business hours". A shift REPLACES business hours for that
    // date (models/Shift), so when present it becomes the slot picker's base
    // window and can extend past published closing. Empty array = rostered day off.
    const [shiftWindow, setShiftWindow] = useState(null);
    const [calendarMonth, setCalendarMonth] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; });
    const [wallet, setWallet] = useState(null); // this provider's wallet + settings (when wallet is enabled)
    const [recurrence, setRecurrence] = useState({ isRecurring: false, recurrenceType: 'weekly', recurrenceInterval: 1, recurrenceEndDate: '' });
    const [paymentMethod, setPaymentMethod] = useState('cash'); // 'wallet' | 'cash' (when the provider's wallet is on)
    const [guest, setGuest] = useState({ name: '', email: '', phone: '' }); // guest checkout (no account)
    const guestReady = !!(guest.name.trim() && guest.email.trim()); // required to confirm as a guest
    // The long date grid + time-slot list can scroll well past the top, and on
    // mobile the fixed bottom bar makes it easy to get stranded — show a "back to
    // top" button once the user has scrolled down so they can always return.
    const [showScrollTop, setShowScrollTop] = useState(false);

    const effectivePrice    = selectedOption ? selectedOption.price    : (selectedService?.price    ?? 0);
    const effectiveDuration = selectedOption ? selectedOption.duration : (selectedService?.duration ?? 0);

    const totalPrice = selectedService
        ? effectivePrice + selectedAddOns.reduce((sum, a) => sum + a.price, 0)
        : 0;

    const totalDuration = selectedService
        ? effectiveDuration + selectedAddOns.reduce((sum, a) => sum + (a.duration || 0), 0)
        : 0;

    // Wallet chosen but the balance can't cover it — the summary panel already warns
    // about this, but nothing stopped the customer proceeding anyway; gate both the
    // "Review & Confirm" step-over and the final Confirm on it too.
    const walletShort = !!(wallet?.settings?.enabled && paymentMethod === 'wallet' && selectedService && totalPrice > (wallet.wallet?.availableBalance ?? 0));

    // Which provider are we booking? Prefer the URL, but fall back to the selected
    // service's owner so availability + booked slots still load in the generic
    // (no ?providerId) flow — otherwise the time list silently shows a generic
    // 08:00–20:00 window instead of the provider's real working hours.
    const urlProviderId = searchParams.get('providerId');
    const effectiveProviderId = urlProviderId || selectedService?.provider?._id || selectedService?.provider || null;
    // Prices show in the booked business's currency (defaults to NAD).
    const curSym = currencySymbol(providerInfo?.currency);

    // Group the service list under its categories (each service carries its
    // populated `category` = {_id, name, order}; unassigned ones fall under
    // "Other services"). Headers only show when there's more than one group.
    const groupedServices = useMemo(() => {
        const map = new Map();
        services.forEach((s) => {
            const cat = s.category;
            const key = cat?._id || '__other__';
            if (!map.has(key)) map.set(key, { key, name: cat?.name || 'Other services', order: cat?.order ?? 9999, isOther: !cat, services: [] });
            map.get(key).services.push(s);
        });
        // Real categories first (by their order), the "Other" bucket last.
        return [...map.values()].sort((a, b) => (a.isOther - b.isOther) || (a.order - b.order) || a.name.localeCompare(b.name));
    }, [services]);
    const showCategoryHeaders = groupedServices.length > 1;

    const handleServiceSelect = (service) => {
        if (service.options && service.options.length > 0) {
            setOptionSheet(service); // show picker first
        } else {
            setSelectedService(service);
            setSelectedOption(null);
            setSelectedAddOns([]);
            // Clear any time picked earlier: it was end-timed for a different service.
            setFormData(prev => ({ ...prev, service: service._id, startTime: '', endTime: '' }));
        }
    };

    const handleOptionConfirm = (option) => {
        setSelectedService(optionSheet);
        setSelectedOption(option);
        setSelectedAddOns([]);
        // A different option means a different length — force a fresh time pick.
        setFormData(prev => ({ ...prev, service: optionSheet._id, startTime: '', endTime: '' }));
        setOptionSheet(null);
    };

    const toggleAddOn = (addOn) => {
        setSelectedAddOns(prev =>
            prev.some(a => a.name === addOn.name)
                ? prev.filter(a => a.name !== addOn.name)
                : [...prev, addOn]
        );
        // Adding/removing an add-on changes the total duration, so a previously
        // picked time no longer maps to the right end time. Clear it (the server now
        // rejects a window that doesn't match the service length) so the customer
        // re-picks against the new duration rather than getting a confirm-time error.
        setFormData(prev => ({ ...prev, startTime: '', endTime: '' }));
    };

    useEffect(() => {
        if (!effectiveProviderId) { setProviderAvailability(null); return; }
        availabilityService.getProviderAvailability(effectiveProviderId)
            .then(res => setProviderAvailability(res.data.data.schedule))
            .catch(() => setProviderAvailability(null));
    }, [effectiveProviderId]);

    // Load this provider's wallet (balance + settings) so we can show the prepaid
    // balance and warn before a wallet-required booking that can't be covered.
    useEffect(() => {
        // Guests have no wallet — skip the (401-ing) fetch and always pay cash.
        if (!user || !effectiveProviderId) { setWallet(null); return; }
        walletService.getMyWalletWithProvider(effectiveProviderId)
            .then(res => {
                setWallet(res.data.data);
                const s = res.data.data?.settings;
                // Default the payment method to the provider's preference; the client can switch.
                if (s?.enabled) setPaymentMethod(s.bookingPaymentMode === 'wallet_required' ? 'wallet' : 'cash');
            })
            .catch(() => setWallet(null));
    }, [effectiveProviderId, user]);

    // Bookable staff for this provider + service (Epic 2.5). Empty list = the
    // business has no roster — the picker stays hidden and booking behaves
    // exactly as before (owner-column, any-available on the server).
    useEffect(() => {
        if (!effectiveProviderId) { setStaffList([]); setSelectedStaff(null); return; }
        providerMarketService.getProviderStaff(effectiveProviderId, selectedService?._id)
            .then(res => {
                const list = res.data.data || [];
                setStaffList(list);
                // Keep a still-valid selection — resetting unconditionally races
                // a click made while the refetch was in flight and silently
                // reverts the user's pick to "any professional".
                setSelectedStaff(prev => (prev && list.some(m => m._id === prev._id)) ? prev : null);
            })
            .catch(() => { setStaffList([]); setSelectedStaff(null); });
    }, [effectiveProviderId, selectedService?._id]);

    // Load booked slots for the chosen provider + date. Re-runs if the provider only
    // becomes known once a service is selected (generic flow), keeping "taken" slots accurate.
    // `stale` guards against an out-of-order response (e.g. a fast date-to-date flip)
    // painting an earlier request's slots over the day the user is actually looking at.
    useEffect(() => {
        if (!effectiveProviderId || !formData.appointmentDate) { setBookedSlots([]); setShiftWindow(null); return; }
        let stale = false;
        appointmentService.getBookedSlots(effectiveProviderId, formData.appointmentDate, selectedStaff?._id || undefined)
            .then(res => { if (!stale) { setBookedSlots(res.data.data || []); setShiftWindow(res.data.shiftWindow ?? null); } })
            .catch(() => { if (!stale) { setBookedSlots([]); setShiftWindow(null); } });
        return () => { stale = true; };
    }, [effectiveProviderId, formData.appointmentDate, selectedStaff]);

    // Live updates — while a date is open, keep its taken/free slots current so a
    // slot freed or grabbed by someone else reflects without a manual refresh.
    useLiveRefresh(() => {
        appointmentService.getBookedSlots(effectiveProviderId, formData.appointmentDate, selectedStaff?._id || undefined)
            .then(res => { setBookedSlots(res.data.data || []); setShiftWindow(res.data.shiftWindow ?? null); })
            .catch(() => {});
    }, { intervalMs: 20000, enabled: !!(effectiveProviderId && formData.appointmentDate) });

    // Toggle the floating "back to top" button based on how far the page is scrolled.
    useEffect(() => {
        const onScroll = () => setShowScrollTop(window.scrollY > 320);
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    const scrollToTop = () => {
        try { window.scrollTo({ top: 0, left: 0, behavior: 'smooth' }); }
        catch { window.scrollTo(0, 0); }
    };

    useEffect(() => {
        // A chosen member's shift is authoritative for its date and can run past
        // business hours, so validate the picked time against the shift window
        // rather than the published hours — otherwise a legitimately bookable
        // late-shift slot would be flagged as "outside working hours" and, via
        // canReview, block the booking the server would accept. Empty window is a
        // rostered day off: nothing that day is valid.
        if (selectedStaff && shiftWindow !== null) {
            if (!formData.appointmentDate || !formData.startTime) { setAvailabilityError(''); return; }
            const within = shiftWindow.some(s => formData.startTime >= s.start && formData.startTime < s.end);
            setAvailabilityError(within ? '' : 'That staff member is not rostered on at this time. Please pick another slot.');
            return;
        }
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
            setAvailabilityError(`This business is not available at this time. Working hours are ${allWorkingHours || 'not set'}`);
            return;
        }
        // Valid if the chosen start falls within ANY working block that day (split shifts)
        const dayHours = (daySchedule.slots || []).filter(s => s?.start && s?.end);
        const within = dayHours.some(s => formData.startTime >= s.start && formData.startTime < s.end);
        if (!within) {
            setAvailabilityError(`This business is not available at this time. Working hours are ${dayHours.map(s => `${s.start}-${s.end}`).join(', ') || 'not set'}`);
            return;
        }
        setAvailabilityError('');
    }, [providerAvailability, formData.appointmentDate, formData.startTime, selectedStaff, shiftWindow]);

    // Re-runs whenever the ?providerId query param itself changes (not just on mount) —
    // e.g. navigating from one business's booking link to another's, or to the generic
    // (no-provider) flow — so the service list/prices/provider info never linger stale
    // from whichever business was loaded first. A previously made selection is cleared
    // when the provider actually changes so a stale price/duration can't carry over.
    const prevUrlProviderIdRef = useRef(urlProviderId);
    useEffect(() => {
        // Guest checkout: no login required to browse services or book. Signed-in
        // users are picked up automatically; guests supply contact details at the
        // confirm step.
        const providerChanged = prevUrlProviderIdRef.current !== urlProviderId;
        prevUrlProviderIdRef.current = urlProviderId;
        const fetchServices = async () => {
            try {
                if (providerChanged) {
                    setSelectedService(null);
                    setSelectedOption(null);
                    setSelectedAddOns([]);
                    setFormData(prev => ({ ...prev, service: '', startTime: '', endTime: '' }));
                }
                const preSelectedServiceId = searchParams.get('serviceId');
                let servicesData = [];

                if (urlProviderId) {
                    const response = await providerMarketService.getProviderProfile(urlProviderId);
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
                    // No provider in the URL: the generic-flow effect below resolves
                    // providerInfo once a service picks one. Clear any stale info left
                    // over from a previous ?providerId visit.
                    setProviderInfo(null);
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, navigate, urlProviderId]);

    // Generic flow (no ?providerId): providerInfo isn't loaded by the effect above, so
    // the review screen would otherwise show the default cancellation policy/currency
    // even though the picked service belongs to a real provider. Resolve it once the
    // service selection tells us who that provider is.
    useEffect(() => {
        if (urlProviderId) return; // already loaded (with the full catalogue) above
        if (!effectiveProviderId) { setProviderInfo(null); return; }
        let stale = false;
        providerMarketService.getProviderProfile(effectiveProviderId)
            .then(res => { if (!stale) setProviderInfo(res.data.data.provider); })
            .catch(() => { if (!stale) setProviderInfo(null); });
        return () => { stale = true; };
    }, [urlProviderId, effectiveProviderId]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleDateSelect = (dateStr) => {
        setFormData(prev => ({ ...prev, appointmentDate: dateStr, startTime: '', endTime: '' }));
        // Booked slots are loaded by the effect keyed on (provider, date).
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

    // Synchronous double-submit guard. `loading` state alone cannot stop the second
    // of two fast taps: React batches the state update, so both handlers run before
    // the button is re-rendered as disabled. That posted two bookings — and because
    // the server's slot check is not atomic, both could be created, along with two
    // wallet holds. A ref flips immediately, in the same tick.
    const confirmInFlight = useRef(false);

    const handleConfirm = async () => {
        if (confirmInFlight.current) return;
        confirmInFlight.current = true;
        try {
            await doConfirm();
        } finally {
            confirmInFlight.current = false;
        }
    };

    const doConfirm = async () => {
        // Guests must leave contact details so we can send the confirmation + a
        // manage link. Guard here too (buttons are also disabled) and stay put.
        if (!rescheduleId && !user && !guestReady) {
            setError('Please enter your name and email to confirm your booking.');
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }
        setLoading(true);
        setError('');
        try {
            if (rescheduleId) {
                await appointmentService.rescheduleAppointment(rescheduleId, {
                    appointmentDate: formData.appointmentDate,
                    startTime: formData.startTime,
                });
                navigate('/appointments?rescheduled=1');
            } else {
                const res = await appointmentService.createAppointment({
                    ...formData,
                    selectedAddOns,
                    // The chosen variant's NAME — the server resolves its real price
                    // from the catalogue so the booking records what the customer was
                    // quoted, not the base service price.
                    ...(selectedOption?.name ? { selectedOptionName: selectedOption.name } : {}),
                    ...(selectedStaff?._id ? { teamMember: selectedStaff._id } : {}),
                    ...(wallet?.settings?.enabled ? { paymentMethod } : {}),
                    // Guest checkout: send contact details instead of relying on a session.
                    ...(!user ? { guestName: guest.name.trim(), guestEmail: guest.email.trim(), guestPhone: guest.phone.trim() } : {}),
                    ...(recurrence.isRecurring ? {
                        isRecurring: true,
                        recurrenceType: recurrence.recurrenceType,
                        recurrenceInterval: recurrence.recurrenceInterval,
                        recurrenceEndDate: recurrence.recurrenceEndDate || undefined,
                    } : {}),
                });
                const created = res?.data?.data;
                const newAppt = Array.isArray(created) ? created[0] : created;
                const providerName = providerInfo?.name || '';
                // Funnel: booking completed (guest vs. account, and which provider).
                track('booking_confirm', { guest: !user, providerId: providerInfo?._id });
                // Celebrate first with the full-screen moment, then land somewhere
                // useful: signed-in users go to their bookings list; guests (who have
                // no account) go to their token-based manage page.
                if (user) {
                    const params = new URLSearchParams({ confirmed: '1' });
                    if (newAppt?._id) params.set('apptId', newAppt._id);
                    if (providerName) params.set('provider', providerName);
                    setConfirmedOverlay({
                        subtitle: providerName ? `You're booked with ${providerName}.` : "You're all set — see you soon.",
                        next: `/appointments?${params.toString()}`,
                    });
                } else {
                    setConfirmedOverlay({
                        subtitle: providerName
                            ? `You're booked with ${providerName}. We've emailed your confirmation.`
                            : "You're all set — we've emailed your confirmation.",
                        next: newAppt?.manageToken ? `/manage/${newAppt.manageToken}` : '/',
                    });
                }
            }
        } catch (err) {
            // A 401 here means the session lapsed (a fresh booking is guest-friendly
            // and never needs one). Offer the ways forward instead of the raw text —
            // guest only when it can actually work, i.e. NOT for a reschedule, which
            // is tied to the account that owns the appointment.
            if (err.response?.status === 401) {
                setAuthPrompt({
                    title: rescheduleId ? 'Sign in to reschedule' : 'Sign in to finish booking',
                    message: rescheduleId
                        ? 'Changing an existing appointment needs the account it was booked with. You can also use the “Manage booking” link from your confirmation email.'
                        : 'Your session has expired. Sign in to finish — or just carry on as a guest and we’ll email your confirmation.',
                    allowGuest: !rescheduleId,
                    guestLabel: 'Continue as guest',
                });
                setLoading(false);
                return;
            }
            // Stay ON the review screen so the Confirm button doesn't vanish —
            // the review-step error banner shows the reason; scroll it into view.
            setError(friendlyError(err, rescheduleId ? 'Failed to reschedule appointment' : 'Failed to book appointment'));
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } finally {
            setLoading(false);
        }
    };

    // A waiting list can't take guests: the entry is keyed to a real customer so we
    // can reach them when the slot frees up. So ask up-front instead of firing a
    // request that 401s and dumps "No token, authorization denied" in the banner.
    const waitlistAuthPrompt = {
        title: 'Sign in to join the waiting list',
        message: 'Joining a waiting list needs an account — that’s how we reach you the moment this slot frees up. (Booking an open slot works without one.)',
        allowGuest: false,
    };

    const handleJoinWaitingList = async () => {
        if (!formData.service || !formData.appointmentDate || !formData.startTime) {
            setError('Please fill in service, date and start time first');
            return;
        }
        if (!user) { setError(''); setAuthPrompt(waitlistAuthPrompt); return; }
        setError('');
        setJoining(true);
        try {
            await waitingListService.join({ service: formData.service, provider: effectiveProviderId || undefined, appointmentDate: formData.appointmentDate, startTime: formData.startTime, endTime: formData.endTime });
            const target = '/waiting-list?joined=1';
            navigate(target, { replace: true });
            // Fallback in case SPA navigation is interrupted by stale client chunks in production.
            setTimeout(() => {
                if (window.location.pathname !== '/waiting-list') {
                    window.location.assign(target);
                }
            }, 120);
        } catch (err) {
            // Session expired mid-flow → prompt rather than leak the 401 text.
            if (err.response?.status === 401) setAuthPrompt(waitlistAuthPrompt);
            else setError(friendlyError(err, 'Failed to join waiting list'));
            setJoining(false);
        }
    };

    // ── Booking calendar: navigable month grid, today → MONTHS_AHEAD months out ──
    const MONTHS_AHEAD = 4;
    const startOfToday = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
    const maxDate = (() => { const d = new Date(startOfToday); d.setMonth(d.getMonth() + MONTHS_AHEAD); return d; })();
    const firstVisibleMonth = (() => { const d = new Date(startOfToday); d.setDate(1); return d; })();
    const lastVisibleMonth = (() => { const d = new Date(firstVisibleMonth); d.setMonth(d.getMonth() + MONTHS_AHEAD); return d; })();

    const fmtDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    // Build a month's day cells, padded with leading nulls so the 1st lands on its weekday.
    const monthMatrix = (monthDate) => {
        const year = monthDate.getFullYear();
        const month = monthDate.getMonth();
        const firstWeekday = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const cells = [];
        for (let i = 0; i < firstWeekday; i++) cells.push(null);
        for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, month, day));
        return cells;
    };

    // A day is bookable only on weekdays the provider actually works (when known).
    const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const providerWorksOn = (d) => {
        if (!providerAvailability) return true; // schedule unknown (generic booking) → leave enabled
        const sched = providerAvailability[dayKeys[d.getDay()]];
        return !!(sched?.enabled && (sched.slots || []).some(s => s?.start && s?.end));
    };

    const canGoPrevMonth = calendarMonth > firstVisibleMonth;
    const canGoNextMonth = calendarMonth < lastVisibleMonth;
    const calNavBtn = (enabled) => ({ background: 'var(--surface-sunken)', border: '1px solid var(--border)', borderRadius: '8px', width: '34px', height: '34px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.4, color: 'var(--charcoal)', fontSize: '1.05rem' });

    // Generate time slot pills from provider availability (or 08:00–20:00 fallback).
    // Slots are hourly by default; once an hour is partially booked, its remaining free
    // time is broken into slots the size of the selected service (anchored at the hour
    // start) so the day fills efficiently — see buildTimeSlots for the exact rules.
    // Spans EVERY working block of the day (split shifts) and never appears in the past.
    // "HH:MM" period list → sorted minute blocks.
    const toBlocks = (periods) => (periods || [])
        .filter(s => s?.start && s?.end)
        .map(s => {
            const [sH, sM] = s.start.split(':').map(Number);
            const [eH, eM] = s.end.split(':').map(Number);
            return { start: sH * 60 + sM, end: eH * 60 + eM };
        })
        .filter(b => b.end > b.start)
        .sort((a, b) => a.start - b.start);

    const generateTimeSlots = (dateStr) => {
        const duration = totalDuration || 30;

        // Working blocks for the day — supports multiple slots (e.g. 09:00–12:00, 13:00–17:00)
        let blocks = [{ start: 8 * 60, end: 20 * 60 }];
        // A chosen member with a shift for this date: their shift REPLACES business
        // hours (models/Shift), and may run past closing. An empty window is a
        // rostered day off. This is what lets a customer self-book a late/early
        // shift the published hours don't cover — the server already accepts it.
        if (selectedStaff && shiftWindow !== null) {
            blocks = toBlocks(shiftWindow);
            if (blocks.length === 0) return [];
        } else if (providerAvailability && dateStr) {
            const [y, m, d] = dateStr.split('-').map(Number);
            const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            const daySchedule = providerAvailability[dayNames[new Date(y, m - 1, d).getDay()]];
            if (!daySchedule?.enabled || !Array.isArray(daySchedule.slots) || daySchedule.slots.length === 0) return [];
            blocks = toBlocks(daySchedule.slots);
            if (blocks.length === 0) return [];
        }

        // Convert busy times to minute ranges. The API returns both real bookings
        // and provider-blocked time (lunch, day off); `kind` keeps them apart so a
        // blocked hour reads "Unavailable" rather than offering a pointless waitlist.
        const bookedRanges = bookedSlots.map(b => {
            const [bsH, bsM] = b.startTime.split(':').map(Number);
            const [beH, beM] = b.endTime.split(':').map(Number);
            return { start: bsH * 60 + bsM, end: beH * 60 + beM, kind: b.kind };
        });

        // For today, hide times that have already passed
        let minStart = -1;
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        if (dateStr === todayStr) minStart = now.getHours() * 60 + now.getMinutes();

        return buildTimeSlots({ blocks, bookedRanges, duration, minStart });
    };

    const timeSlots = generateTimeSlots(formData.appointmentDate);
    const selectedSlotBooked = formData.startTime && timeSlots.find(s => s.time === formData.startTime)?.isBooked;
    const canReview = formData.service && formData.appointmentDate && formData.startTime && !availabilityError && !selectedSlotBooked && !walletShort;

    const labelStyle = { display: 'block', fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.5rem', letterSpacing: '0.05em', textTransform: 'uppercase' };
    const cardStyle = { background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '2rem', boxShadow: 'var(--shadow-sm)' };
    const stepBadge = (num) => (
        <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--gold)', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: '600', flexShrink: 0 }}>{num}</div>
    );

    const formattedDate = formData.appointmentDate
        ? new Date(formData.appointmentDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })
        : '';

    // Built ONCE and rendered from both returns below. The waiting-list prompt is
    // triggered from the form screen and the booking one from the review screen —
    // defining it here is what stops it existing in only one of them.
    // `next` carries the current URL (which holds providerId/serviceId) so signing
    // in returns the visitor to this business instead of dumping them on Home.
    const authPromptEl = authPrompt && (
        <AuthPrompt
            {...authPrompt}
            next={typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : undefined}
            onClose={() => setAuthPrompt(null)}
        />
    );

    // â"€â"€â"€ REVIEW SCREEN â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    if (step === 'review') {
        return (
            <div style={{ background: 'var(--off-white)', minHeight: '100dvh' }}>
                {/* The celebratory moment is triggered from THIS (review) screen, so it
                    must render here too — not only in the form-step return below.
                    Without it, a confirmed booking set no visible overlay and the user
                    re-tapped Confirm into their own just-created slot. */}
                {confirmedOverlay && (
                    <StatusOverlay
                        variant="confirmed"
                        title="Appointment confirmed"
                        subtitle={confirmedOverlay.subtitle}
                        onDone={() => navigate(confirmedOverlay.next)}
                    />
                )}
                {authPromptEl}
                {/* Header */}
                <div style={{ background: 'var(--ink)', paddingTop: 'var(--page-hero-pad-top)', paddingBottom: '3rem', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(ellipse at 20% 50%, rgba(240,62,22,0.05) 0%, transparent 60%)', pointerEvents: 'none' }} />
                    <div className="container" style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <button onClick={() => setStep('form')} style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 'var(--radius-sm)', padding: '0.5rem 1rem', color: 'white', cursor: 'pointer', fontSize: '0.85rem', fontFamily: 'var(--font-body)' }}>&larr; Back</button>
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
                                                    ? <img src={cloudinaryAvatar(providerInfo.avatar)} alt={providerInfo.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                    : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontSize: '1.4rem', color: 'var(--gold)', fontWeight: '600' }}>{providerInfo.name?.charAt(0)}</div>
                                                }
                                            </div>
                                            <div>
                                                <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: '600', color: 'var(--charcoal)' }}>{providerInfo.name}</div>
                                                {providerInfo.providerCategory && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>{providerInfo.providerCategory}</div>}
                                                {providerInfo.businessProfile?.address && <a href={mapsUrl(providerInfo.businessProfile.address)} target="_blank" rel="noopener noreferrer" style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '3px', textDecoration: 'underline' }}>{providerInfo.businessProfile.address}</a>}
                                            </div>
                                        </div>
                                    </>
                                )}

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                        <Calendar size={16} strokeWidth={2} style={{ color: 'var(--gold-dark)', flexShrink: 0 }} />
                                        <span style={{ fontFamily: 'var(--font-body)', color: 'var(--charcoal)', fontWeight: '500' }}>{formattedDate}</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                        <Clock size={16} strokeWidth={2} style={{ color: 'var(--gold-dark)', flexShrink: 0 }} />
                                        <span style={{ fontFamily: 'var(--font-body)', color: 'var(--charcoal)', fontWeight: '500' }}>
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
                                        <div style={{ fontFamily: 'var(--font-body)', fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.95rem' }}>{selectedService?.name}{selectedOption ? ` — ${selectedOption.name}` : ''}</div>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>{effectiveDuration} min{providerInfo ? ` with ${providerInfo.name}` : ''}</div>
                                    </div>
                                    <span style={{ fontFamily: 'var(--font-body)', fontWeight: '600', color: 'var(--charcoal)' }}>{curSym} {effectivePrice}</span>
                                </div>
                                {selectedAddOns.map((addOn, i) => (
                                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '0.75rem', borderBottom: i < selectedAddOns.length - 1 ? '1px solid var(--border)' : 'none', marginBottom: i < selectedAddOns.length - 1 ? '0.75rem' : 0 }}>
                                        <div>
                                            <div style={{ fontFamily: 'var(--font-body)', fontWeight: '500', color: 'var(--charcoal)', fontSize: '0.9rem' }}>{addOn.name}</div>
                                            {addOn.duration > 0 && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>+{addOn.duration} min</div>}
                                        </div>
                                        <span style={{ fontFamily: 'var(--font-body)', fontWeight: '600', color: 'var(--charcoal)' }}>{curSym} {addOn.price}</span>
                                    </div>
                                ))}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '1rem', borderTop: '1px solid var(--border)', marginTop: '0.5rem' }}>
                                    <span style={{ fontFamily: 'var(--font-body)', fontWeight: '600', color: 'var(--charcoal)' }}>Total</span>
                                    <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: '600', color: 'var(--charcoal)' }}>{curSym} {totalPrice}</span>
                                </div>
                            </div>

                            {/* Cancellation policy */}
                            <div style={cardStyle}>
                                <div style={{ fontFamily: 'var(--font-body)', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.4rem' }}>Cancellation policy</div>
                                <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>
                                    {(providerInfo?.cancellationWindowHours ?? 24) === 0
                                        ? 'Cancel or reschedule for free anytime.'
                                        : `Cancel or reschedule for free up to ${providerInfo?.cancellationWindowHours ?? 24} hours before your appointment.`}
                                </div>
                            </div>

                            {/* Guest contact — only when not signed in */}
                            {!user && (
                                <div style={cardStyle}>
                                    <div style={{ fontFamily: 'var(--font-body)', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.35rem' }}>Your details</div>
                                    <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontFamily: 'var(--font-body)', margin: '0 0 0.9rem' }}>
                                        Booking as a guest — we'll email your confirmation and a link to manage it. Already have an account?{' '}
                                        <Link to="/login" style={{ color: 'var(--gold-dark)', fontWeight: 600 }}>Log in</Link>.
                                    </p>
                                    <div style={{ display: 'grid', gap: '0.6rem' }}>
                                        <input type="text" value={guest.name} onChange={e => setGuest(g => ({ ...g, name: e.target.value }))}
                                            placeholder="Full name *" aria-label="Your name" autoComplete="name" className="input" style={{ fontFamily: 'var(--font-body)' }} />
                                        <input type="email" value={guest.email} onChange={e => setGuest(g => ({ ...g, email: e.target.value }))}
                                            placeholder="Email *" aria-label="Your email" autoComplete="email" inputMode="email" className="input" style={{ fontFamily: 'var(--font-body)' }} />
                                        <input type="tel" value={guest.phone} onChange={e => setGuest(g => ({ ...g, phone: e.target.value }))}
                                            placeholder="Phone (optional)" aria-label="Your phone" autoComplete="tel" inputMode="tel" className="input" style={{ fontFamily: 'var(--font-body)' }} />
                                    </div>
                                </div>
                            )}

                            {/* Notes */}
                            <div style={cardStyle}>
                                <div style={{ fontFamily: 'var(--font-body)', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.75rem' }}>Comments or requests</div>
                                <textarea
                                    name="notes"
                                    value={formData.notes}
                                    onChange={handleChange}
                                    rows="3"
                                    placeholder="Anything you'd like us to know?"
                                    className="input"
                                    style={{ resize: 'vertical', fontFamily: 'var(--font-body)' }}
                                />
                            </div>
                        </div>

                        {/* Right - sticky confirm panel (desktop only) */}
                        <div className="booking-confirm-desktop" style={{ position: 'sticky', top: 'calc(100px + env(safe-area-inset-top, 0px))' }}>
                            <div style={{ ...cardStyle, padding: '1.5rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.35rem' }}>
                                    <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: '600', color: 'var(--charcoal)' }}>{curSym} {totalPrice}</span>
                                </div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'var(--font-body)', marginBottom: '1.25rem' }}>Estimated total</div>
                                <button
                                    data-testid="booking-confirm"
                                    onClick={handleConfirm}
                                    disabled={loading || !!confirmedOverlay || (!user && !guestReady) || walletShort}
                                    style={{ width: '100%', padding: '0.875rem', background: 'var(--ink)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: '0.95rem', fontWeight: '600', fontFamily: 'var(--font-body)', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.85 : 1, letterSpacing: '0.03em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem' }}
                                >
                                    {loading && <span style={{ display: 'inline-block', width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />}
                                    {loading ? 'Confirming...' : rescheduleId ? 'Confirm reschedule' : 'Confirm'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Mobile sticky bottom confirm bar */}
                <div className="booking-confirm-mobile" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'var(--card-bg)', borderTop: '1px solid var(--border)', padding: '1rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 1000, boxShadow: '0 -4px 20px rgba(0,0,0,0.08)' }}>
                    <div style={{ flexShrink: 0 }}>
                        <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: '600', color: 'var(--charcoal)' }}>{curSym} {totalPrice}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>Estimated total</div>
                    </div>
                    <button data-testid="booking-confirm-mobile" onClick={handleConfirm} disabled={loading || !!confirmedOverlay || (!user && !guestReady) || walletShort} style={{ flex: 1, marginLeft: '0.9rem', justifyContent: 'center', padding: '0.875rem 1rem', background: 'var(--ink)', color: 'white', border: 'none', borderRadius: '99px', fontSize: '0.95rem', fontWeight: '600', fontFamily: 'var(--font-body)', cursor: (loading || (!user && !guestReady) || walletShort) ? 'not-allowed' : 'pointer', opacity: (loading || (!user && !guestReady) || walletShort) ? 0.85 : 1, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        {loading && <span style={{ display: 'inline-block', width: '15px', height: '15px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />}
                        {loading ? 'Confirming...' : rescheduleId ? 'Confirm reschedule' : 'Confirm'}
                    </button>
                </div>
            </div>
        );
    }

    // ─── BOOKING FORM â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    return (
        <div style={{ background: 'var(--off-white)', minHeight: '100dvh' }}>
            {confirmedOverlay && (
                <StatusOverlay
                    variant="confirmed"
                    title="Appointment confirmed"
                    subtitle={confirmedOverlay.subtitle}
                    onDone={() => navigate(confirmedOverlay.next)}
                />
            )}
            {authPromptEl}
            {/* Header */}
            <div style={{ background: 'var(--ink)', paddingTop: 'var(--page-hero-pad-top)', paddingBottom: '3rem', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(ellipse at 20% 50%, rgba(240,62,22,0.05) 0%, transparent 60%)', pointerEvents: 'none' }} />
                <div className="container" style={{ position: 'relative' }}>
                    <p style={{ color: 'var(--gold)', fontSize: '0.75rem', fontWeight: '600', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>{rescheduleId ? 'Reschedule' : 'Schedule Your Visit'}</p>
                    <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2rem, 4vw, 3rem)', fontWeight: '600', color: 'white' }}>{rescheduleId ? 'Reschedule your appointment' : 'Book an Appointment'}</h1>
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
                                                fontSize: '0.8rem', fontWeight: '600', flexShrink: 0, transition: 'all var(--dur) var(--ease-out)',
                                                background: complete ? 'var(--gold)' : active ? 'var(--ink)' : 'var(--surface-sunken)',
                                                color: complete ? 'var(--ink)' : active ? 'var(--on-ink)' : 'var(--text-muted)',
                                                border: active && !complete ? '2px solid var(--gold)' : '2px solid transparent',
                                            }}>{complete ? '✓' : s.n}</div>
                                            <span style={{ fontSize: '0.82rem', fontWeight: active ? '600' : '500', color: active ? 'var(--charcoal)' : 'var(--text-muted)', whiteSpace: 'nowrap' }} className="hidden-mobile">{s.label}</span>
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
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                    {groupedServices.map(group => (
                                        <div key={group.key}>
                                            {showCategoryHeaders && (
                                                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem', fontWeight: '600', color: 'var(--charcoal)', margin: '0 0 0.75rem', letterSpacing: '-0.01em' }}>{group.name}</h3>
                                            )}
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem' }}>
                                    {group.services.map(service => {
                                        const sel = selectedService?._id === service._id;
                                        return (
                                            <button key={service._id} type="button" data-testid="booking-service" onClick={() => handleServiceSelect(service)} style={{
                                                position: 'relative', padding: '1rem', border: '2px solid', cursor: 'pointer', textAlign: 'left', minHeight: '76px',
                                                transition: 'transform var(--dur-fast) var(--ease-out), border-color var(--dur) ease, background var(--dur) ease, box-shadow var(--dur) ease',
                                                fontFamily: 'var(--font-body)', borderRadius: 'var(--radius)',
                                                borderColor: sel ? 'var(--gold)' : 'var(--border)',
                                                background: sel ? 'rgba(240,62,22,0.08)' : 'var(--card-bg)',
                                                boxShadow: sel ? 'var(--shadow-sm)' : 'none',
                                            }}
                                                onMouseEnter={e => { if (!sel) { e.currentTarget.style.borderColor = 'rgba(240,62,22,0.5)'; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; } }}
                                                onMouseLeave={e => { if (!sel) { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; } }}
                                            >
                                                {sel && <span aria-hidden="true" style={{ position: 'absolute', top: '0.65rem', right: '0.65rem', width: '20px', height: '20px', borderRadius: '50%', background: 'var(--gold)', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: '600' }}>✓</span>}
                                                <div style={{ fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.92rem', marginBottom: '0.4rem', paddingRight: sel ? '1.5rem' : 0 }}>{service.name}</div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                                    <span className="price" style={{ color: 'var(--gold-dark)', fontWeight: '600' }}>{curSym} {service.price}</span>
                                                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{service.duration} min</span>
                                                </div>
                                            </button>
                                        );
                                    })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Add-ons */}
                        {selectedService?.addOns?.length > 0 && (
                            <div style={cardStyle}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                                    {stepBadge(2)}
                                    <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: '600', color: 'var(--charcoal)' }}>Add-ons <span style={{ fontSize: '0.8rem', fontWeight: '400', color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>(optional)</span></h2>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                    {selectedService.addOns.map((addOn, i) => {
                                        const checked = selectedAddOns.some(a => a.name === addOn.name);
                                        return (
                                            <label key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.85rem 1rem', border: `2px solid ${checked ? 'var(--gold)' : 'var(--border)'}`, borderRadius: 'var(--radius-sm)', cursor: 'pointer', background: checked ? 'rgba(240,62,22,0.08)' : 'var(--card-bg)', transition: 'border-color var(--dur) ease, background var(--dur) ease' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                    <input type="checkbox" checked={checked} onChange={() => toggleAddOn(addOn)} style={{ accentColor: 'var(--gold)', width: '16px', height: '16px' }} />
                                                    <span style={{ fontWeight: '500', color: 'var(--charcoal)', fontSize: '0.9rem', fontFamily: 'var(--font-body)' }}>{addOn.name}</span>
                                                    {addOn.duration > 0 && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>+{addOn.duration} min</span>}
                                                </div>
                                                <span style={{ color: 'var(--gold-dark)', fontWeight: '600', fontFamily: 'var(--font-body)' }}>+{curSym} {addOn.price}</span>
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

                            {staffList.length > 0 && (
                                <div style={{ marginBottom: '1.5rem' }}>
                                    <label style={labelStyle}>Choose your professional</label>
                                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                        <button type="button" data-testid="booking-staff-any"
                                            onClick={() => setSelectedStaff(null)}
                                            style={{ padding: '0.5rem 1rem', borderRadius: '999px', cursor: 'pointer', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: '0.85rem', border: `1.5px solid ${!selectedStaff ? 'var(--gold)' : 'var(--border)'}`, background: !selectedStaff ? 'rgba(240,62,22,0.10)' : 'var(--card-bg)', color: !selectedStaff ? 'var(--gold-dark)' : 'var(--text-secondary)' }}>
                                            Any professional
                                        </button>
                                        {staffList.map(st => {
                                            const sel = selectedStaff?._id === st._id;
                                            return (
                                                <button key={st._id} type="button" data-testid="booking-staff"
                                                    onClick={() => setSelectedStaff(st)}
                                                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', padding: '0.5rem 1rem', borderRadius: '999px', cursor: 'pointer', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: '0.85rem', border: `1.5px solid ${sel ? 'var(--gold)' : 'var(--border)'}`, background: sel ? 'rgba(240,62,22,0.10)' : 'var(--card-bg)', color: sel ? 'var(--gold-dark)' : 'var(--text-secondary)' }}>
                                                    <span aria-hidden="true" style={{ width: '10px', height: '10px', borderRadius: '50%', background: st.color || 'var(--gold)', flexShrink: 0 }} />
                                                    {st.name}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Month calendar — navigate up to 4 months ahead */}
                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={labelStyle}>Select a date</label>
                                <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1rem', background: 'var(--card-bg)', maxWidth: '420px' }}>
                                    {/* Month header + nav */}
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
                                        <button type="button" aria-label="Previous month" disabled={!canGoPrevMonth}
                                            onClick={() => canGoPrevMonth && setCalendarMonth(m => { const d = new Date(m); d.setMonth(d.getMonth() - 1); return d; })}
                                            style={calNavBtn(canGoPrevMonth)}>←</button>
                                        <span style={{ fontFamily: 'var(--font-display)', fontWeight: '600', fontSize: '1.05rem', color: 'var(--charcoal)' }}>
                                            {calendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                                        </span>
                                        <button type="button" aria-label="Next month" disabled={!canGoNextMonth}
                                            onClick={() => canGoNextMonth && setCalendarMonth(m => { const d = new Date(m); d.setMonth(d.getMonth() + 1); return d; })}
                                            style={calNavBtn(canGoNextMonth)}>→</button>
                                    </div>
                                    {/* Weekday headers */}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', marginBottom: '4px' }}>
                                        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                                            <div key={d} style={{ textAlign: 'center', fontSize: '0.64rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '4px 0' }}>{d}</div>
                                        ))}
                                    </div>
                                    {/* Day grid */}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
                                        {monthMatrix(calendarMonth).map((d, i) => {
                                            if (!d) return <div key={i} />;
                                            const dateStr = fmtDate(d);
                                            const disabled = d < startOfToday || d > maxDate || !providerWorksOn(d);
                                            const isSelected = formData.appointmentDate === dateStr;
                                            const isToday = dateStr === fmtDate(startOfToday);
                                            return (
                                                <button
                                                    key={i}
                                                    type="button"
                                                    data-testid="booking-date"
                                                    className="pressable"
                                                    disabled={disabled}
                                                    onClick={() => !disabled && handleDateSelect(dateStr)}
                                                    style={{
                                                        aspectRatio: '1 / 1',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        border: `1.5px solid ${isSelected ? 'var(--gold)' : 'transparent'}`,
                                                        borderRadius: '10px',
                                                        background: isSelected ? 'var(--gold)' : isToday ? 'var(--surface-sunken)' : 'transparent',
                                                        color: disabled ? 'var(--text-muted)' : isSelected ? 'var(--ink)' : 'var(--charcoal)',
                                                        opacity: disabled ? 0.3 : 1,
                                                        cursor: disabled ? 'not-allowed' : 'pointer',
                                                        fontFamily: 'var(--font-body)', fontSize: '0.9rem',
                                                        fontWeight: isSelected || isToday ? '600' : '500',
                                                        transition: 'transform var(--dur-fast) var(--ease-out), background 0.12s ease, border-color 0.12s ease, color 0.12s ease',
                                                    }}
                                                >
                                                    {d.getDate()}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>

                            {/* Time slot pills */}
                            {formData.appointmentDate && (
                                <div>
                                    <label style={labelStyle}>Pick a time</label>
                                    {timeSlots.length === 0 ? (
                                        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', padding: '0.75rem 0', fontFamily: 'var(--font-body)' }}>
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
                                                        className="pressable"
                                                        data-testid={slot.isBooked ? 'booking-time-booked' : 'booking-time'}
                                                        // Blocked time isn't held by anyone, so there's no waitlist to join —
                                                        // the slot is simply not offered.
                                                        disabled={slot.isBlocked}
                                                        onClick={() => { if (!slot.isBlocked) handleTimeSelect(slot.time); }}
                                                        style={{
                                                            width: '100%',
                                                            padding: '1rem 1.25rem',
                                                            borderRadius: '12px',
                                                            border: `2px solid ${slot.isBooked ? 'var(--border)' : isSelected ? 'var(--gold)' : 'var(--border)'}`,
                                                            background: slot.isBooked ? 'var(--surface-sunken)' : isSelected ? 'rgba(240,62,22,0.08)' : 'white',
                                                            color: slot.isBooked ? 'var(--text-muted)' : isSelected ? 'var(--gold-dark)' : 'var(--charcoal)',
                                                            fontWeight: isSelected ? '600' : '400',
                                                            fontSize: '1rem',
                                                            cursor: slot.isBlocked ? 'not-allowed' : 'pointer',
                                                            fontFamily: 'var(--font-body)',
                                                            textAlign: 'left',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'space-between',
                                                            transition: 'transform var(--dur-fast) var(--ease-out), background 0.15s ease, border-color 0.15s ease, color 0.15s ease',
                                                        }}
                                                    >
                                                        <span>{slot.time}</span>
                                                        {slot.isBooked && (
                                                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                                                {slot.isBlocked ? 'Unavailable' : 'Taken — tap to join waitlist'}
                                                            </span>
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
                            <div style={{ marginTop: '1rem', background: '#fef3c7', border: '1px solid #fcd34d', color: '#92400e', padding: '0.875rem 1rem', borderRadius: 'var(--radius-sm)', fontSize: '0.875rem', fontFamily: 'var(--font-body)' }}>
                                <strong>This slot is already taken.</strong> You can join the waiting list and we'll notify you if it opens up.
                            </div>
                        )}

                        {availabilityError && (
                                <div style={{ marginTop: '1rem', background: '#fef3c7', border: '1px solid #fcd34d', color: '#92400e', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem' }}>
                                    {availabilityError}
                                </div>
                            )}

                        {/* Recurring booking — same calendar/time UI as the rest of the app */}
                        {!rescheduleId && formData.startTime && (
                            <div style={{ marginTop: '1.5rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1.25rem', background: 'var(--card-bg)' }}>
                                <RecurrenceFields value={recurrence} onChange={setRecurrence} minDate={formData.appointmentDate} />
                            </div>
                        )}
                        </div>
                    </div>

                    {/* Right - summary + proceed */}
                    <div className="booking-summary" style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '2rem', boxShadow: 'var(--shadow-sm)', position: 'sticky', top: 'calc(100px + env(safe-area-inset-top, 0px))' }}>
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
                                    <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-body)' }}>{label}</span>
                                    <span style={{ fontWeight: '600', color: 'var(--charcoal)', fontFamily: 'var(--font-body)' }}>{value}</span>
                                </div>
                            ))}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 0', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', marginBottom: '1.5rem' }}>
                            <span style={{ fontWeight: '600', color: 'var(--charcoal)', fontFamily: 'var(--font-body)' }}>Total</span>
                            <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: '600', color: 'var(--charcoal)' }}>
                                {selectedService ? `${curSym} ${totalPrice}` : '—'}
                            </span>
                        </div>

                        {/* Payment method — let the client pay from their wallet or in cash */}
                        {wallet?.settings?.enabled && (() => {
                            const available = wallet.wallet?.availableBalance ?? 0;
                            const short = paymentMethod === 'wallet' && selectedService && totalPrice > available;
                            return (
                                <div style={{ marginBottom: '1.25rem' }}>
                                    <span style={{ display: 'block', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '0.5rem', fontFamily: 'var(--font-body)' }}>Payment method</span>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        {[{ v: 'wallet', t: 'Wallet', sub: `${curSym} ${available.toFixed(2)}` }, { v: 'cash', t: 'Cash', sub: 'Pay at visit' }].map((o) => {
                                            const active = paymentMethod === o.v;
                                            return (
                                                <button key={o.v} type="button" onClick={() => setPaymentMethod(o.v)} style={{
                                                    flex: 1, padding: '0.6rem 0.5rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontFamily: 'var(--font-body)',
                                                    border: `1.5px solid ${active ? 'var(--gold)' : 'var(--border)'}`,
                                                    background: active ? 'rgba(240,62,22,0.1)' : 'var(--card-bg)', color: active ? 'var(--gold-dark)' : 'var(--text-secondary)',
                                                }}>
                                                    <div style={{ fontWeight: '600', fontSize: '0.85rem' }}>{o.t}</div>
                                                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{o.sub}</div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {paymentMethod === 'wallet' && (
                                        short
                                            ? <p style={{ margin: '0.5rem 0 0', fontSize: '0.78rem', background: 'var(--warning-bg)', color: 'var(--warning-fg)', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-sm)' }}>Not enough balance — you need {curSym} {(totalPrice - available).toFixed(2)} more. <Link to="/wallet" style={{ fontWeight: '600', color: 'var(--warning-fg)', textDecoration: 'underline' }}>Top up</Link> or choose Cash.</p>
                                            : <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>{curSym} {totalPrice || 0} will be reserved from your wallet.</p>
                                    )}
                                </div>
                            );
                        })()}

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
                            <button onClick={handleJoinWaitingList} disabled={joining} className="btn-outline" style={{ width: '100%', padding: '0.875rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem', cursor: joining ? 'not-allowed' : 'pointer', opacity: joining ? 0.85 : 1 }}>
                                {joining && <span style={{ display: 'inline-block', width: '16px', height: '16px', border: '2px solid rgba(4,5,5,0.2)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />}
                                {joining ? 'Joining...' : 'Join Waiting List'}
                            </button>
                        )}
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-body)', textAlign: 'center', marginTop: '1rem', lineHeight: 1.5 }}>
                            {(providerInfo?.cancellationWindowHours ?? 24) === 0
                                ? 'Free cancellation anytime before your appointment.'
                                : `Free cancellation up to ${providerInfo?.cancellationWindowHours ?? 24} hours before your appointment.`}
                        </p>
                    </div>
                </div>
            </div>
            {/* Mobile sticky bottom bar — shown only on mobile via CSS */}
            {selectedService && (
                <div className="booking-mobile-bar">
                    <div style={{ flexShrink: 0 }}>
                        <div style={{ fontWeight: '600', fontSize: '1.1rem', color: 'var(--charcoal)', fontFamily: 'var(--font-body)' }}>{curSym} {totalPrice}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>{1 + selectedAddOns.length} {selectedAddOns.length ? 'items' : 'item'} · {totalDuration} min</div>
                    </div>
                    {selectedSlotBooked && formData.startTime ? (
                        <button
                            onClick={handleJoinWaitingList}
                            disabled={joining}
                            style={{ flex: 1, marginLeft: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', background: 'var(--ink)', color: 'white', border: 'none', borderRadius: '99px', padding: '0.8rem 1rem', fontWeight: '600', cursor: joining ? 'not-allowed' : 'pointer', opacity: joining ? 0.85 : 1, fontSize: '0.9rem', fontFamily: 'var(--font-body)', whiteSpace: 'nowrap' }}
                        >
                            {joining && <span style={{ display: 'inline-block', width: '15px', height: '15px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />}
                            {joining ? 'Joining...' : 'Join Waitlist'}
                        </button>
                    ) : (
                        <button
                            data-testid="booking-continue-mobile"
                            onClick={() => { setError(''); setStep('review'); }}
                            disabled={!canReview}
                            style={{ flex: 1, marginLeft: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', background: 'var(--ink)', color: 'white', border: 'none', borderRadius: '99px', padding: '0.8rem 1rem', fontWeight: '600', cursor: canReview ? 'pointer' : 'not-allowed', opacity: canReview ? 1 : 0.5, fontSize: '0.95rem', fontFamily: 'var(--font-body)', whiteSpace: 'nowrap' }}
                        >
                            Continue →
                        </button>
                    )}
                </div>
            )}
        {/* Floating "back to top" — escapes the calendar / time-slot scroll deadzone */}
        {showScrollTop && (
            <button type="button" onClick={scrollToTop} className="scroll-top-fab" aria-label="Back to top" title="Back to top">↑</button>
        )}

        {/* ── Service options bottom sheet ── */}
        {optionSheet && (
            <>
                <div onClick={() => setOptionSheet(null)} className="scrim-in" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 900 }} />
                <div role="dialog" aria-modal="true" aria-labelledby="option-sheet-title" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'var(--card-bg)', borderRadius: '20px 20px 0 0', zIndex: 901, maxHeight: '90dvh', overflowY: 'auto', boxShadow: '0 -8px 40px rgba(0,0,0,0.2)', animation: 'slideUp var(--dur) var(--ease-out)' }}>
                    <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <h2 id="option-sheet-title" style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: '600', color: 'var(--charcoal)', margin: 0 }}>{optionSheet.name}</h2>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0.2rem 0 0' }}>Select an option · Required</p>
                        </div>
                        <button onClick={() => setOptionSheet(null)} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.6rem', color: 'var(--text-muted)', lineHeight: 1, padding: 0 }}>×</button>
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
                                    <div style={{ fontWeight: '600', color: 'var(--charcoal)', fontFamily: 'var(--font-body)', fontSize: '0.95rem' }}>{opt.name}</div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>{opt.duration} min</div>
                                    {opt.description && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px', lineHeight: 1.5 }}>{opt.description}</div>}
                                    <div style={{ fontWeight: '600', color: 'var(--charcoal)', marginTop: '6px', fontFamily: 'var(--font-body)' }}>{curSym} {opt.price}</div>
                                </div>
                                <div style={{ width: '22px', height: '22px', borderRadius: '50%', border: '2px solid var(--border)', flexShrink: 0, marginTop: '2px' }} />
                            </button>
                        ))}
                    </div>
                    <div style={{ padding: '1rem 1.5rem calc(1rem + env(safe-area-inset-bottom, 0px))', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>from </span>
                            <span style={{ fontWeight: '600', color: 'var(--charcoal)', fontFamily: 'var(--font-body)' }}>{curSym} {Math.min(...optionSheet.options.map(o => o.price))}</span>
                            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: '0.4rem' }}>{Math.min(...optionSheet.options.map(o => o.duration))} – {Math.max(...optionSheet.options.map(o => o.duration))} min</span>
                        </div>
                        {/* This footer button never applied a selection — each option row
                            above already selects + closes on tap (handleOptionConfirm). Label
                            it for what it actually does instead of the misleading "Add". */}
                        <button onClick={() => setOptionSheet(null)} style={{ padding: '0.65rem 1.5rem', background: 'var(--warm-gray)', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: '600', color: 'var(--text-secondary)', fontFamily: 'var(--font-body)' }}>Cancel</button>
                    </div>
                </div>
            </>
        )}
        </div>
    );
};

export default BookAppointment;
