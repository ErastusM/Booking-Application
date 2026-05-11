const User = require('../models/User');
const Service = require('../models/Service');
const Review = require('../models/Review');
const Category = require('../models/Category');

exports.getAllProviders = async (req, res) => {
    try {
        // Get all providers who have at least one active service
        const providerIds = await Service.distinct('provider', {
            provider: { $ne: null },
            isActive: true,
        });

        const providers = await User.find({
            _id: { $in: providerIds },
            role: 'provider',
        }).select('name email avatar');

        // Enrich each provider with stats
        const enriched = await Promise.all(providers.map(async (p) => {
            const services = await Service.find({ provider: p._id, isActive: true });
            const reviews = await Review.find({ service: { $in: services.map(s => s._id) } });

            const avgRating = reviews.length
                ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
                : null;

            const prices = services.map(s => s.price);
            const minPrice = prices.length ? Math.min(...prices) : null;
            const maxPrice = prices.length ? Math.max(...prices) : null;

            const locations = [...new Set(services.map(s => s.location).filter(Boolean))];

            return {
                _id: p._id,
                name: p.name,
                email: p.email,
                avatar: p.avatar,
                serviceCount: services.length,
                reviewCount: reviews.length,
                avgRating,
                minPrice,
                maxPrice,
                location: locations[0] || '',
                locations,
            };
        }));

        res.status(200).json({ success: true, count: enriched.length, data: enriched });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getProviderProfile = async (req, res) => {
    try {
        const provider = await User.findOne({
            _id: req.params.id,
            role: 'provider',
        }).select('name email avatar');

        if (!provider) {
            return res.status(404).json({ success: false, message: 'Provider not found' });
        }

        // Get their services with categories
        const services = await Service.find({
            provider: req.params.id,
            isActive: true,
        }).populate('category', 'name order').sort({ createdAt: -1 });

        // Get their categories
        const categories = await Category.find({ provider: req.params.id }).sort({ order: 1 });

        // Get reviews
        const reviews = await Review.find({
            service: { $in: services.map(s => s._id) }
        }).populate('customer', 'name').sort({ createdAt: -1 });

        const avgRating = reviews.length
            ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
            : null;

        // Group services by category
        // Group services by category — Featured shows ALL services
        // Always put ALL services in featured
        const grouped = {
            featured: { name: 'Featured', services: services.map(s => s.toObject ? s.toObject() : s) },
        };

        categories.forEach(cat => {
            const catServices = services.filter(s => {
                if (!s.category) return false;
                const catId = s.category._id ? s.category._id.toString() : s.category.toString();
                return catId === cat._id.toString();
            });
            grouped[cat._id.toString()] = {
                name: cat.name,
                services: catServices,
            };
        });

        res.status(200).json({
            success: true,
            data: {
                provider: {
                    _id: provider._id,
                    name: provider.name,
                    email: provider.email,
                    avatar: provider.avatar,
                    avgRating,
                    reviewCount: reviews.length,
                    serviceCount: services.length,
                },
                categories: grouped,
                reviews: reviews.slice(0, 5),
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};