const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Appointment = require('../models/Appointment');
const Service = require('../models/Service');

exports.createPaymentIntent = async (req, res) => {
    try {
        const { serviceId } = req.body;

        const service = await Service.findById(serviceId);
        if (!service) {
            return res.status(404).json({ success: false, message: 'Service not found' });
        }

        // Stripe amounts are in cents
        const amount = Math.round(service.price * 100);

        const paymentIntent = await stripe.paymentIntents.create({
            amount,
            currency: 'usd',
            metadata: {
                serviceId: serviceId,
                customerId: req.user._id.toString(),
                serviceName: service.name,
            },
        });

        res.status(200).json({
            success: true,
            clientSecret: paymentIntent.client_secret,
            amount,
            serviceName: service.name,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.confirmPayment = async (req, res) => {
    try {
        const { paymentIntentId, appointmentId } = req.body;

        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

        if (paymentIntent.status !== 'succeeded') {
            return res.status(400).json({ success: false, message: 'Payment not completed' });
        }

        // Mark appointment as confirmed after successful payment
        const appointment = await Appointment.findByIdAndUpdate(
            appointmentId,
            {
                status: 'confirmed',
                paymentStatus: 'paid',
                paymentIntentId,
            },
            { new: true }
        );

        res.status(200).json({ success: true, data: appointment });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};