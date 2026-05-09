const express = require('express');
const router = express.Router();
const {
    createReview,
    getServiceReviews,
    deleteReview,
    getMyReviews,
} = require('../controllers/reviewController');
const { auth, authorize } = require('../middleware/auth');

router.post('/', auth, authorize('customer'), createReview);
router.get('/my-reviews', auth, getMyReviews);
router.get('/service/:serviceId', getServiceReviews);
router.delete('/:id', auth, authorize('admin'), deleteReview);

module.exports = router;