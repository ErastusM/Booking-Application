const mongoose = require('mongoose');

const teamMemberSchema = new mongoose.Schema({
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name:     { type: String, required: true, trim: true, maxlength: 80 },
    role:     { type: String, trim: true, default: 'Staff' },
    email:    { type: String, trim: true, lowercase: true, default: '' },
    phone:    { type: String, trim: true, default: '' },
    color:    { type: String, default: '#c9a84c' }, // for calendar colour coding
    isActive: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('TeamMember', teamMemberSchema);
