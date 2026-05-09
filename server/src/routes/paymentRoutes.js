const express = require('express');
const router = express.Router();
const { createPaymentIntent, confirmPayment } = require('../controllers/paymentController');
const { auth, authorize } = require('../middleware/auth');

router.post('/create-payment-intent', auth, authorize('customer'), createPaymentIntent);
router.post('/confirm', auth, authorize('customer'), confirmPayment);

module.exports = router;