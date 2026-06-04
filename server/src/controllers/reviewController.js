const Review = require('../models/Review');
const Appointment = require('../models/Appointment');

exports.createReview = async (req, res) => {
    try {
        const { appointmentId, rating, comment } = req.body;

        if (!appointmentId || !rating || !comment) {
            return res.status(400).json({ success: false, message: 'Please provide all required fields' });
        }

        // Verify appointment exists, belongs to customer, and is completed
        const appointment = await Appointment.findById(appointmentId);

        if (!appointment) {
            return res.status(404).json({ success: false, message: 'Appointment not found' });
        }

        if (appointment.customer.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        if (appointment.status !== 'completed') {
            return res.status(400).json({ success: false, message: 'You can only review completed appointments' });
        }

        // Check if already reviewed
        const existing = await Review.findOne({ appointment: appointmentId });
        if (existing) {
            return res.status(400).json({ success: false, message: 'You have already reviewed this appointment' });
        }

        const review = await Review.create({
            customer: req.user._id,
            service: appointment.service,
            appointment: appointmentId,
            rating,
            comment,
        });

        await review.populate('customer', 'name');

        res.status(201).json({ success: true, data: review });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.getServiceReviews = async (req, res) => {
    try {
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const skip = (page - 1) * limit;

        const [reviews, total, avgResult] = await Promise.all([
            Review.find({ service: req.params.serviceId })
                .populate('customer', 'name')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),
            Review.countDocuments({ service: req.params.serviceId }),
            Review.aggregate([
                { $match: { service: require('mongoose').Types.ObjectId.createFromHexString(req.params.serviceId) } },
                { $group: { _id: null, avg: { $avg: '$rating' } } },
            ]),
        ]);

        const avgRating = avgResult[0] ? parseFloat(avgResult[0].avg.toFixed(1)) : null;
        res.status(200).json({ success: true, count: reviews.length, total, avgRating, data: reviews });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.deleteReview = async (req, res) => {
    try {
        const review = await Review.findById(req.params.id);

        if (!review) {
            return res.status(404).json({ success: false, message: 'Review not found' });
        }

        await Review.findByIdAndDelete(req.params.id);
        res.status(200).json({ success: true, message: 'Review deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.getMyReviews = async (req, res) => {
    try {
        const reviews = await Review.find({ customer: req.user._id })
            .populate('service', 'name')
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: reviews });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};