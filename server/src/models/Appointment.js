const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      required: true
    },
    service: {
      type: mongoose.Schema.ObjectId,
      ref: 'Service',
      required: true
    },
    appointmentDate: {
      type: Date,
      required: [true, 'Please select an appointment date']
    },
    startTime: {
      type: String,
      required: [true, 'Please select a start time']
    },
    endTime: {
      type: String,
      required: [true, 'End time is required']
    },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'completed', 'cancelled'],
      default: 'pending'
    },
    notes: {
      type: String,
      default: ''
    },
    totalPrice: {
      type: Number,
      required: true
    },
    cancellationReason: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Index for faster queries
appointmentSchema.index({ customer: 1, appointmentDate: 1 });
appointmentSchema.index({ appointmentDate: 1, status: 1 });

module.exports = mongoose.model('Appointment', appointmentSchema);
