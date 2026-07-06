const mongoose = require('mongoose');

const fieldSchema = new mongoose.Schema({
    label:    { type: String, required: true, trim: true, maxlength: 200 },
    type:     { type: String, enum: ['text', 'textarea', 'select', 'radio', 'checkbox', 'date', 'number'], default: 'text' },
    required: { type: Boolean, default: false },
    options:  { type: [String], default: [] }, // for select / radio
    // Simple conditional: show this field only when another field equals a value
    showIf:   {
        field: { type: String, default: '' }, // label of the controlling field
        equals: { type: String, default: '' },
    },
}, { _id: true });

const formTemplateSchema = new mongoose.Schema({
    provider:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title:       { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 1000 },
    kind:        { type: String, enum: ['intake', 'consent', 'consultation', 'feedback'], default: 'intake' },
    fields:      { type: [fieldSchema], default: [] },
    // Services this form is attached to (empty = applies to all of this provider's bookings)
    services:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'Service' }],
    isActive:    { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('FormTemplate', formTemplateSchema);
