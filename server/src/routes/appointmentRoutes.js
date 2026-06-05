const express = require('express');
const router = express.Router();
const {
    createAppointment,
    getAllAppointments,
    cancelAppointment,
    updateAppointment,
    updateAppointmentStatus,
    rescheduleAppointment,
} = require('../controllers/appointmentController');
const { auth, authorize } = require('../middleware/auth');
const {
    createAppointmentRules,
    updateAppointmentStatusRules,
    rescheduleAppointmentRules,
    cancelAppointmentRules,
} = require('../middleware/validate');

router.post('/', auth, authorize('customer'), createAppointmentRules, createAppointment);
router.get('/', auth, getAllAppointments);
router.put('/:id', auth, authorize('admin'), updateAppointment);
router.put('/:id/status', auth, authorize('admin', 'provider'), updateAppointmentStatusRules, updateAppointmentStatus);
router.delete('/:id', auth, authorize('customer', 'admin'), cancelAppointmentRules, cancelAppointment);
router.put('/:id/reschedule', auth, authorize('customer'), rescheduleAppointmentRules, rescheduleAppointment);

module.exports = router;