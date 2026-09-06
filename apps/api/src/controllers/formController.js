const FormTemplate = require('../models/FormTemplate');
const FormSubmission = require('../models/FormSubmission');
const Appointment = require('../models/Appointment');

// Keep provider-supplied field definitions within the schema shape
const sanitizeFields = (fields) => {
    if (!Array.isArray(fields)) return [];
    const allowed = ['text', 'textarea', 'select', 'radio', 'checkbox', 'date', 'number'];
    return fields
        .filter(f => f && String(f.label || '').trim())
        .slice(0, 50)
        .map(f => ({
            label: String(f.label).trim().slice(0, 200),
            type: allowed.includes(f.type) ? f.type : 'text',
            required: !!f.required,
            options: Array.isArray(f.options) ? f.options.filter(Boolean).map(o => String(o).slice(0, 120)).slice(0, 30) : [],
            showIf: {
                field: String(f.showIf?.field || '').slice(0, 200),
                equals: String(f.showIf?.equals || '').slice(0, 120),
            },
        }));
};

/* ── Provider: template CRUD ───────────────────────────────────────────── */

exports.getMyTemplates = async (req, res) => {
    try {
        const templates = await FormTemplate.find({ provider: req.user._id })
            .populate('services', 'name')
            .sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: templates });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.createTemplate = async (req, res) => {
    try {
        const { title, description, kind, fields, services, isActive } = req.body;
        if (!title || !String(title).trim()) {
            return res.status(400).json({ success: false, message: 'Title is required' });
        }
        const template = await FormTemplate.create({
            provider: req.user._id,
            title: String(title).trim().slice(0, 200),
            description: String(description || '').slice(0, 1000),
            kind: ['intake', 'consent', 'consultation', 'feedback'].includes(kind) ? kind : 'intake',
            fields: sanitizeFields(fields),
            services: Array.isArray(services) ? services : [],
            isActive: isActive !== false,
        });
        await template.populate('services', 'name');
        res.status(201).json({ success: true, data: template });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.updateTemplate = async (req, res) => {
    try {
        const template = await FormTemplate.findById(req.params.id);
        if (!template) return res.status(404).json({ success: false, message: 'Form not found' });
        if (template.provider.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }
        const { title, description, kind, fields, services, isActive } = req.body;
        if (title !== undefined) template.title = String(title).trim().slice(0, 200);
        if (description !== undefined) template.description = String(description).slice(0, 1000);
        if (kind !== undefined && ['intake', 'consent', 'consultation', 'feedback'].includes(kind)) template.kind = kind;
        if (fields !== undefined) template.fields = sanitizeFields(fields);
        if (services !== undefined) template.services = Array.isArray(services) ? services : [];
        if (isActive !== undefined) template.isActive = !!isActive;
        await template.save();
        await template.populate('services', 'name');
        res.status(200).json({ success: true, data: template });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.deleteTemplate = async (req, res) => {
    try {
        const template = await FormTemplate.findById(req.params.id);
        if (!template) return res.status(404).json({ success: false, message: 'Form not found' });
        if (template.provider.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }
        await template.deleteOne();
        res.status(200).json({ success: true, message: 'Form deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/* ── Provider: view submissions ────────────────────────────────────────── */

exports.getSubmissions = async (req, res) => {
    try {
        const query = { provider: req.user._id };
        if (req.query.appointment) query.appointment = req.query.appointment;
        if (req.query.customer) query.customer = req.query.customer;
        const submissions = await FormSubmission.find(query)
            .populate('template', 'title kind')
            .populate('customer', 'name email')
            .sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: submissions });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/* ── Customer: forms attached to an appointment + completion status ─────── */

exports.getFormsForAppointment = async (req, res) => {
    try {
        const appt = await Appointment.findById(req.params.appointmentId).select('customer provider service');
        if (!appt) return res.status(404).json({ success: false, message: 'Appointment not found' });
        const isOwner = appt.customer?.toString() === req.user._id.toString();
        const isProvider = appt.provider?.toString() === req.user._id.toString();
        if (!isOwner && !isProvider && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        // Active templates for this provider that apply to all bookings or to this service
        const templates = await FormTemplate.find({
            provider: appt.provider,
            isActive: true,
            $or: [{ services: { $size: 0 } }, { services: appt.service }],
        });
        const submissions = await FormSubmission.find({ appointment: appt._id });
        const submittedTemplateIds = new Set(submissions.map(s => s.template.toString()));

        const data = templates.map(t => ({
            template: t,
            completed: submittedTemplateIds.has(t._id.toString()),
            submission: submissions.find(s => s.template.toString() === t._id.toString()) || null,
        }));
        res.status(200).json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/* ── Customer: submit a form for an appointment ────────────────────────── */

exports.submitForm = async (req, res) => {
    try {
        const { template: templateId, appointment: appointmentId, answers } = req.body;
        const appt = await Appointment.findById(appointmentId).select('customer provider');
        if (!appt) return res.status(404).json({ success: false, message: 'Appointment not found' });
        if (appt.customer?.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }
        const template = await FormTemplate.findById(templateId);
        if (!template) return res.status(404).json({ success: false, message: 'Form not found' });
        // The template must belong to the appointment's provider. Otherwise a
        // customer could submit against a DIFFERENT provider's template — its
        // required-field rules would validate the answers, but the submission would
        // be stored under this appointment's provider, mismatching template owner
        // and response owner.
        if (template.provider.toString() !== appt.provider.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        // Required-field validation (server-side)
        const provided = new Map((answers || []).map(a => [a.label, a.value]));
        for (const f of template.fields) {
            if (f.required) {
                const v = provided.get(f.label);
                const empty = v === undefined || v === '' || v === null || (Array.isArray(v) && v.length === 0) || v === false;
                if (empty) {
                    return res.status(400).json({ success: false, message: `"${f.label}" is required` });
                }
            }
        }

        const submission = await FormSubmission.findOneAndUpdate(
            { template: templateId, appointment: appointmentId },
            {
                template: templateId,
                appointment: appointmentId,
                customer: req.user._id,
                provider: appt.provider,
                answers: (answers || []).map(a => ({ label: String(a.label), value: a.value })),
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        res.status(201).json({ success: true, data: submission });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
