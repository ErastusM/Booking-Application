const express = require('express');
const router = express.Router();
const { auth, authorize } = require('../middleware/auth');
const {
    getMyPackages,
    createPackage,
    updatePackage,
    deletePackage,
    getProviderPackages,
    purchasePackage,
    getMyClientPackages,
    redeemSession,
    getMyPackageClients,
} = require('../controllers/packageController');

router.use(auth);

// Provider routes
router.get('/my-packages', authorize('admin', 'provider'), getMyPackages);
router.post('/my-packages', authorize('admin', 'provider'), createPackage);
router.put('/my-packages/:id', authorize('admin', 'provider'), updatePackage);
router.delete('/my-packages/:id', authorize('admin', 'provider'), deletePackage);
router.get('/my-package-clients', authorize('admin', 'provider'), getMyPackageClients);

// Customer routes
router.get('/provider/:providerId', getProviderPackages);
router.post('/:id/purchase', purchasePackage);
router.get('/my-client-packages', getMyClientPackages);
router.post('/my-client-packages/:id/redeem', redeemSession);

module.exports = router;
