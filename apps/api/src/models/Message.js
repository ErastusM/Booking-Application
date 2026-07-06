const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    sender:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recipient:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    appointment: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: true },
    content:     { type: String, required: true, trim: true, maxlength: 2000 },
    readBy:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });

messageSchema.index({ appointment: 1, createdAt: 1 });
messageSchema.index({ recipient: 1, sender: 1 });

module.exports = mongoose.model('Message', messageSchema);
