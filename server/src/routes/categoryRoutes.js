const express = require('express');
const router = express.Router();
const {
    getMyCategories,
    getProviderCategories,
    createCategory,
    updateCategory,
    deleteCategory,
} = require('../controllers/categoryController');
const { auth, authorize } = require('../middleware/auth');

router.get('/my-categories', auth, authorize('provider'), getMyCategories);
router.get('/provider/:providerId', getProviderCategories);
router.post('/', auth, authorize('provider'), createCategory);
router.put('/:id', auth, authorize('provider'), updateCategory);
router.delete('/:id', auth, authorize('provider'), deleteCategory);

module.exports = router;