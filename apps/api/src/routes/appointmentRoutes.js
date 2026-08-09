const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

// Guest checkout opened POST /appointments to anonymous callers. On top of the
// shared per-IP write limiter, cap ANONYMOUS bookings tightly so the public
// endpoint can't be used to spam a provider's calendar or email-bomb arbitrary
// addresses. Signed-in users are unaffected (skip when req.user is set).
const guestBookingLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 8,
    message: { success: false, message: 'Too many bookings from this connection. Please try again later or sign in.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => process.env.NODE_ENV === 'test' || !!req.user,
});
const {
    createAppointment,
    createMultiServiceAppointment,
    getAllAppointments,
    getMyAppointments,
    cancelAppointment,
    cancelAppointmentSeries,
    updateAppointment,
    updateAppointmentStatus,
    rescheduleAppointment,
    providerRescheduleAppointment,
    getBookedSlots,
    getAppointmentHistory,
    createGroupBooking,
    getGroupBooking,
    getAppointmentByToken,
    cancelAppointmentByToken,
    rescheduleAppointmentByToken,
} = require('../controllers/appointmentController');
const { auth, authorize, optionalAuth } = require('../middleware/auth');
const {
    createAppointmentRules,
    updateAppointmentStatusRules,
    rescheduleAppointmentRules,
    cancelAppointmentRules,
} = require('../middleware/validate');

// Public — the booking page (incl. guest checkout) shows available slots before login
router.get('/booked-slots', optionalAuth, getBookedSlots);

// Public — no-login "manage my booking" via opaque token
router.get('/manage/:token', getAppointmentByToken);
router.post('/manage/:token/cancel', cancelAppointmentByToken);
router.post('/manage/:token/reschedule', rescheduleAppointmentByToken);

// Guest checkout: no-login bookings allowed. optionalAuth attaches req.user when
// signed in; the controller enforces guest contact fields when it's absent, and
// still gates provider-only powers (walk-ins, book-on-behalf) on req.user.role.
router.post('/', optionalAuth, guestBookingLimiter, createAppointmentRules, createAppointment);
// Provider-built multi-service booking ("Add service" flow) — provider-only.
router.post('/multi', auth, authorize('provider'), createMultiServiceAppointment);
router.get('/my-appointments', auth, getMyAppointments);
router.get('/history', auth, authorize('provider', 'admin'), getAppointmentHistory);
router.post('/group', auth, authorize('provider', 'admin'), createGroupBooking);
router.get('/group/:groupId', auth, getGroupBooking);
router.get('/', auth, getAllAppointments);
router.put('/:id', auth, authorize('admin'), updateAppointment);
router.put('/:id/status', auth, authorize('admin', 'provider'), updateAppointmentStatusRules, updateAppointmentStatus);
router.delete('/:id', auth, authorize('customer', 'provider', 'admin'), cancelAppointmentRules, cancelAppointment);
router.put('/:id/reschedule', auth, authorize('customer', 'provider'), rescheduleAppointmentRules, rescheduleAppointment);
router.put('/:id/provider-reschedule', auth, authorize('provider'), providerRescheduleAppointment);
router.delete('/:id/series', auth, authorize('provider', 'admin'), cancelAppointmentSeries);

module.exports = router;