const mongoose = require('mongoose');

const packageSchema = new mongoose.Schema({
    provider:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name:         { type: String, required: true, trim: true },
    description:  { type: String, default: '' },
    services:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'Service' }],
    totalSessions:{ type: Number, required: true, min: 1 },
    price:        { type: Number, required: true, min: 0 },
    validityDays: { type: Number, default: 365 }, // how many days after purchase it stays valid
    isActive:     { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('Package', packageSchema);
