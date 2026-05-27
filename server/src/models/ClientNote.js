const mongoose = require('mongoose');

const clientNoteSchema = new mongoose.Schema({
    provider:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    customer:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    notes:         { type: String, default: '' },
    allergies:     { type: String, default: '' },
    conditions:    { type: String, default: '' },
    internalNotes: { type: String, default: '' },
    tags:          { type: [String], default: [] },
    birthday:      { type: String, default: '' }, // 'MM-DD'
}, { timestamps: true });

clientNoteSchema.index({ provider: 1, customer: 1 }, { unique: true });

module.exports = mongoose.model('ClientNote', clientNoteSchema);
