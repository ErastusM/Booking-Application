const Service = require('../models/Service');

// Get all services — customers see all active, providers see their own
exports.getAllServices = async (req, res) => {
    try {
        let query = { isActive: true };
        const services = await Service.find(query)
            .populate('provider', 'name avatar')
            .populate('createdBy', 'name')
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, count: services.length, data: services });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Get provider's own services
exports.getMyServices = async (req, res) => {
    try {
        const services = await Service.find({ provider: req.user._id })
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, count: services.length, data: services });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Admin creates a global service
exports.createService = async (req, res) => {
    try {
        const { name, description, price, duration } = req.body;

        const service = await Service.create({
            name, description, price, duration,
            createdBy: req.user._id,
            provider: null, // global
        });

        res.status(201).json({ success: true, data: service });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Provider creates their own service
exports.createMyService = async (req, res) => {
    try {
        const { name, description, price, duration, location, address } = req.body;

        const service = await Service.create({
            name, description, price, duration,
            location: location || '',
            address: address || '',
            createdBy: req.user._id,
            provider: req.user._id,
        });

        res.status(201).json({ success: true, data: service });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Update service — admin can update any, provider only their own
exports.updateService = async (req, res) => {
    try {
        const service = await Service.findById(req.params.id);

        if (!service) {
            return res.status(404).json({ success: false, message: 'Service not found' });
        }

        // Providers can only update their own
        if (req.user.role === 'provider' && service.provider?.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        const { name, description, price, duration, location, address, isActive } = req.body;
        const allowedUpdates = { name, description, price, duration, location, address };
        if (req.user.role === 'admin' && isActive !== undefined) allowedUpdates.isActive = isActive;
        Object.keys(allowedUpdates).forEach(k => allowedUpdates[k] === undefined && delete allowedUpdates[k]);

        const updated = await Service.findByIdAndUpdate(req.params.id, allowedUpdates, { new: true });
        res.status(200).json({ success: true, data: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Delete service — admin can delete any, provider only their own
exports.deleteService = async (req, res) => {
    try {
        const service = await Service.findById(req.params.id);

        if (!service) {
            return res.status(404).json({ success: false, message: 'Service not found' });
        }

        if (req.user.role === 'provider' && service.provider?.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        await Service.findByIdAndDelete(req.params.id);
        res.status(200).json({ success: true, message: 'Service deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};