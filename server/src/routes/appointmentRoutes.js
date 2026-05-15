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

router.post('/', auth, authorize('customer'), createAppointment);
router.get('/', auth, getAllAppointments);
router.put('/:id', auth, authorize('admin'), updateAppointment);
router.put('/:id/status', auth, authorize('admin', 'provider'), updateAppointmentStatus);
router.delete('/:id', auth, cancelAppointment);
router.put('/:id/reschedule', auth, authorize('customer'), rescheduleAppointment);

module.exports = router;