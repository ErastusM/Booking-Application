const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, 'Please add a service name'],
            trim: true,
            unique: true
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
        isActive: {
            type: Boolean,
            default: true
        },
        createdBy: {
            type: mongoose.Schema.ObjectId,
            ref: 'User',
            required: true
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model('Service', serviceSchema);
