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

// Per-ACCOUNT cap: the guest limiter skips signed-in users, so a single throwaway
// account (or a compromised staff token) could otherwise flood a provider's
// calendar with thousands of bookings (a recurring request alone inserts up to
// 60). Bucket by user id, not IP. Providers/admins legitimately bulk-book their
// own business (walk-ins), so they're exempt; customers and staff are capped.
const accountBookingLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 30,
    message: { success: false, message: 'Too many bookings on this account. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => String(req.user?._id || req.ip),
    skip: (req) => process.env.NODE_ENV === 'test' || !req.user
        || req.user.role === 'provider' || req.user.role === 'admin',
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
    providerBatchReschedule,
    getBookedSlots,
    getRejectionsSummary,
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
// Owner-side signal: turned-away customer bookings over the last 7 days.
router.get('/rejections-summary', auth, authorize('provider'), getRejectionsSummary);

// Public — no-login "manage my booking" via opaque token
router.get('/manage/:token', getAppointmentByToken);
router.post('/manage/:token/cancel', cancelAppointmentByToken);
router.post('/manage/:token/reschedule', rescheduleAppointmentByToken);

// Guest checkout: no-login bookings allowed. optionalAuth attaches req.user when
// signed in; the controller enforces guest contact fields when it's absent, and
// still gates provider-only powers (walk-ins, book-on-behalf) on req.user.role.
router.post('/', optionalAuth, guestBookingLimiter, accountBookingLimiter, createAppointmentRules, createAppointment);
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
// Drag-to-reschedule: one decision that may move several bookings (a push that
// ripples through an afternoon). Deliberately NOT :id-scoped — the batch is the
// unit, and splitting it into per-id calls is what this endpoint exists to avoid.
router.post('/batch-reschedule', auth, authorize('provider'), providerBatchReschedule);
router.delete('/:id/series', auth, authorize('provider', 'admin'), cancelAppointmentSeries);

module.exports = router;