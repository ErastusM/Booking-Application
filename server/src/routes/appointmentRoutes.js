const express = require('express');
const router = express.Router();
const {
    createAppointment,
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
} = require('../controllers/appointmentController');
const { auth, authorize } = require('../middleware/auth');
const {
    createAppointmentRules,
    updateAppointmentStatusRules,
    rescheduleAppointmentRules,
    cancelAppointmentRules,
} = require('../middleware/validate');

// Public — used by booking page to show available slots
router.get('/booked-slots', auth, getBookedSlots);

router.post('/', auth, authorize('customer', 'provider'), createAppointmentRules, createAppointment);
router.get('/my-appointments', auth, getMyAppointments);
router.get('/history', auth, authorize('provider', 'admin'), getAppointmentHistory);
router.post('/group', auth, authorize('provider', 'admin'), createGroupBooking);
router.get('/group/:groupId', auth, getGroupBooking);
router.get('/', auth, getAllAppointments);
router.put('/:id', auth, authorize('admin'), updateAppointment);
router.put('/:id/status', auth, authorize('admin', 'provider'), updateAppointmentStatusRules, updateAppointmentStatus);
router.delete('/:id', auth, authorize('customer', 'admin'), cancelAppointmentRules, cancelAppointment);
router.put('/:id/reschedule', auth, authorize('customer'), rescheduleAppointmentRules, rescheduleAppointment);
router.put('/:id/provider-reschedule', auth, authorize('provider'), providerRescheduleAppointment);
router.delete('/:id/series', auth, authorize('provider', 'admin'), cancelAppointmentSeries);

module.exports = router;