const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema({
    label: { type: String, required: true },
    value: { type: mongoose.Schema.Types.Mixed, default: '' }, // string | number | boolean | string[]
}, { _id: false });

const formSubmissionSchema = new mongoose.Schema({
    template:    { type: mongoose.Schema.Types.ObjectId, ref: 'FormTemplate', required: true, index: true },
    appointment: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: true, index: true },
    customer:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    provider:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    answers:     { type: [answerSchema], default: [] },
}, { timestamps: true });

// One submission per template per appointment
formSubmissionSchema.index({ template: 1, appointment: 1 }, { unique: true });

module.exports = mongoose.model('FormSubmission', formSubmissionSchema);
