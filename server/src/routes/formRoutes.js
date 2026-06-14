const express = require('express');
const router = express.Router();
const {
    getMyTemplates, createTemplate, updateTemplate, deleteTemplate,
    getSubmissions, getFormsForAppointment, submitForm,
} = require('../controllers/formController');
const { auth, authorize } = require('../middleware/auth');

// Provider template management
router.get('/templates', auth, authorize('provider', 'admin'), getMyTemplates);
router.post('/templates', auth, authorize('provider', 'admin'), createTemplate);
router.put('/templates/:id', auth, authorize('provider', 'admin'), updateTemplate);
router.delete('/templates/:id', auth, authorize('provider', 'admin'), deleteTemplate);

// Provider: view submissions
router.get('/submissions', auth, authorize('provider', 'admin'), getSubmissions);

// Customer + provider: forms attached to an appointment, and submission
router.get('/for-appointment/:appointmentId', auth, getFormsForAppointment);
router.post('/submissions', auth, authorize('customer'), submitForm);

module.exports = router;
