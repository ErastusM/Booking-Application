const express = require('express');
const router = express.Router();
const {
    getMainCategories,
    getMyCategories,
    getProviderCategories,
    createCategory,
    updateCategory,
    deleteCategory,
} = require('../controllers/categoryController');
const { auth, allow } = require('../middleware/auth');

// Categories organize the service catalogue → services:edit (High tier).
const canEditCatalogue = allow({ roles: ['provider'], capability: 'services:edit' });

router.get('/main', getMainCategories); // static list — public
router.get('/my-categories', auth, canEditCatalogue, getMyCategories);
router.get('/provider/:providerId', getProviderCategories); // public storefront read
router.post('/', auth, canEditCatalogue, createCategory);
router.put('/:id', auth, canEditCatalogue, updateCategory);
router.delete('/:id', auth, canEditCatalogue, deleteCategory);

module.exports = router;