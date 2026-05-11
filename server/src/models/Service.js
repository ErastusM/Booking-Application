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
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model('Service', serviceSchema);
