const Category = require('../models/Category');
const Service = require('../models/Service');
const MAIN_CATEGORIES = require('../constants/mainCategories');

// The business a catalogue-category write/read acts on: owner's own id, or a
// services:edit staff member's employer (staffOf). null = detached staff.
const businessScope = (req) => (req.user.role === 'staff' ? req.user.staffOf || null : req.user._id);

exports.getMainCategories = async (req, res) => {
    try {
        res.status(200).json({ success: true, data: MAIN_CATEGORIES });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.getMyCategories = async (req, res) => {
    try {
        const providerId = businessScope(req);
        if (!providerId) return res.status(403).json({ success: false, message: 'No business context for this account.' });
        const categories = await Category.find({ provider: providerId }).sort({ order: 1, createdAt: 1 });
        res.status(200).json({ success: true, data: categories });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.getProviderCategories = async (req, res) => {
    try {
        const categories = await Category.find({ provider: req.params.providerId }).sort({ order: 1, createdAt: 1 });
        res.status(200).json({ success: true, data: categories });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.createCategory = async (req, res) => {
    try {
        const providerId = businessScope(req);
        if (!providerId) return res.status(403).json({ success: false, message: 'No business context for this account.' });
        const { name } = req.body;
        if (!name) return res.status(400).json({ success: false, message: 'Name is required' });

        const category = await Category.create({ name, provider: providerId });
        res.status(201).json({ success: true, data: category });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.updateCategory = async (req, res) => {
    try {
        const providerId = businessScope(req);
        if (!providerId) return res.status(403).json({ success: false, message: 'No business context for this account.' });
        const category = await Category.findOne({ _id: req.params.id, provider: providerId });
        if (!category) return res.status(404).json({ success: false, message: 'Category not found' });

        category.name = req.body.name || category.name;
        await category.save();

        res.status(200).json({ success: true, data: category });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.deleteCategory = async (req, res) => {
    try {
        const providerId = businessScope(req);
        if (!providerId) return res.status(403).json({ success: false, message: 'No business context for this account.' });
        const category = await Category.findOne({ _id: req.params.id, provider: providerId });
        if (!category) return res.status(404).json({ success: false, message: 'Category not found' });

        // Move services in this category to uncategorized
        await Service.updateMany({ category: req.params.id }, { category: null });
        await Category.findByIdAndDelete(req.params.id);

        res.status(200).json({ success: true, message: 'Category deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};