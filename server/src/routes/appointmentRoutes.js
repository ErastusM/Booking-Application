const express = require('express');
const router = express.Router();
const {
    getAllAppointments,
    getCustomerAppointments,
    createAppointment,
    updateAppointment,
    cancelAppointment
} = require('../controllers/appointmentController');
const { auth, authorize } = require('../middleware/auth');

router.get('/', auth, authorize('admin'), getAllAppointments);
router.get('/my-appointments', auth, getCustomerAppointments);
router.post('/', auth, createAppointment);
router.put('/:id', auth, updateAppointment);
router.post('/:id/cancel', auth, cancelAppointment);

module.exports = router;
