const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        description: {
            type: String,
            required: [true, 'Please add a description']
        },
        price: {
            type: Number,
            required: [true, 'Please add a price']
        },
        duration: {
            type: Number,
            required: [true, 'Please add duration in minutes'],
            default: 30
        },
        image: {
            type: String,
            default: null
        },
        provider: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null, // null = global admin service, set = provider's own service
        },
        location: {
            type: String,
            default: '',
        },
        address: {
            type: String,
            default: '',
        },
        isActive: {
            type: Boolean,
            default: true
        },

        createdBy: {
            type: mongoose.Schema.ObjectId,
            ref: 'User',
            required: true
        },
        category: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Category',
            default: null,
        },
        addOns: {
            type: [{
                name: { type: String, required: true },
                price: { type: Number, required: true },
                duration: { type: Number, default: 0 },
            }],
            default: [],
        },
        /* Mutually exclusive sub-options (e.g. Adults / Students / Trim & Beard).
           If present, the customer must pick exactly one before booking. */
        options: {
            type: [{
                name:        { type: String, required: true },
                description: { type: String, default: '' },
                price:       { type: Number, required: true },
                duration:    { type: Number, required: true },
            }],
            default: [],
        },
    },
    {
        timestamps: true
    }
);

serviceSchema.index({ provider: 1, isActive: 1 });
serviceSchema.index({ isActive: 1, createdAt: -1 });

module.exports = mongoose.model('Service', serviceSchema);
