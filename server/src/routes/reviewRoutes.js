const express = require('express');
const router = express.Router();
const {
    createReview,
    getServiceReviews,
    deleteReview,
    getMyReviews,
    getProviderReviews,
} = require('../controllers/reviewController');
const { auth, authorize } = require('../middleware/auth');
const { createReviewRules } = require('../middleware/validate');

router.post('/', auth, authorize('customer'), createReviewRules, createReview);
router.get('/my-reviews', auth, getMyReviews);
router.get('/provider-reviews', auth, authorize('provider'), getProviderReviews);
router.get('/service/:serviceId', getServiceReviews);
router.delete('/:id', auth, authorize('admin'), deleteReview);

module.exports = router;