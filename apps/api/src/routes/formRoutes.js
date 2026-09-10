const express = require('express');
const router = express.Router();
const {
    getMyTemplates, createTemplate, updateTemplate, deleteTemplate,
    getSubmissions, getFormsForAppointment, submitForm,
} = require('../controllers/formController');
const { auth, allow } = require('../middleware/auth');

// Provider template management — forms:manage (Medium tier and up). allow() keeps
// owner/admin access and adds the tiered-staff path; the controllers scope to the
// caller's business so staff only manage their own employer's templates.
const canManageForms = allow({ roles: ['provider', 'admin'], capability: 'forms:manage' });
router.get('/templates', auth, canManageForms, getMyTemplates);
router.post('/templates', auth, canManageForms, createTemplate);
router.put('/templates/:id', auth, canManageForms, updateTemplate);
router.delete('/templates/:id', auth, canManageForms, deleteTemplate);

// Provider: view submissions
router.get('/submissions', auth, canManageForms, getSubmissions);

// Customer + provider: forms attached to an appointment, and submission
router.get('/for-appointment/:appointmentId', auth, getFormsForAppointment);
router.post('/submissions', auth, authorize('customer', 'provider'), submitForm);

module.exports = router;
