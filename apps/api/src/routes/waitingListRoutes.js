const express = require('express');
const router = express.Router();
const {
    joinWaitingList,
    getMyWaitingList,
    getProviderWaitingList,
    leaveWaitingList,
    getNotifications,
    getPendingPromotions,
    markPromotionCelebrated,
} = require('../controllers/waitingListController');
const { auth, authorize, allow } = require('../middleware/auth');
const { joinWaitingListRules } = require('../middleware/validate');

router.post('/', auth, authorize('customer', 'provider'), joinWaitingListRules, joinWaitingList);
router.get('/', auth, getMyWaitingList);
// Staff whose access includes waitlist:manage (Low tier and up) see their
// business's waiting list — the tab their calendar already offers them.
router.get('/provider', auth, allow({ roles: ['provider', 'admin'], capability: 'waitlist:manage' }), getProviderWaitingList);
router.get('/notifications', auth, getNotifications);
// Celebratory "a slot opened up!" moment for the customer app (once per promotion).
router.get('/promotions/pending', auth, getPendingPromotions);
router.post('/promotions/:id/celebrated', auth, markPromotionCelebrated);
router.delete('/:id', auth, leaveWaitingList);

module.exports = router;
