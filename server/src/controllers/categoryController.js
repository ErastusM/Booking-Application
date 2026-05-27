const Category = require('../models/Category');
const Service = require('../models/Service');
const MAIN_CATEGORIES = require('../constants/mainCategories');

exports.getMainCategories = async (req, res) => {
    try {
        res.status(200).json({ success: true, data: MAIN_CATEGORIES });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getMyCategories = async (req, res) => {
    try {
        const categories = await Category.find({ provider: req.user._id }).sort({ order: 1, createdAt: 1 });
        res.status(200).json({ success: true, data: categories });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getProviderCategories = async (req, res) => {
    try {
        const categories = await Category.find({ provider: req.params.providerId }).sort({ order: 1, createdAt: 1 });
        res.status(200).json({ success: true, data: categories });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.createCategory = async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ success: false, message: 'Name is required' });

        const category = await Category.create({ name, provider: req.user._id });
        res.status(201).json({ success: true, data: category });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.updateCategory = async (req, res) => {
    try {
        const category = await Category.findOne({ _id: req.params.id, provider: req.user._id });
        if (!category) return res.status(404).json({ success: false, message: 'Category not found' });

        category.name = req.body.name || category.name;
        await category.save();

        res.status(200).json({ success: true, data: category });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.deleteCategory = async (req, res) => {
    try {
        const category = await Category.findOne({ _id: req.params.id, provider: req.user._id });
        if (!category) return res.status(404).json({ success: false, message: 'Category not found' });

        // Move services in this category to uncategorized
        await Service.updateMany({ category: req.params.id }, { category: null });
        await Category.findByIdAndDelete(req.params.id);

        res.status(200).json({ success: true, message: 'Category deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};