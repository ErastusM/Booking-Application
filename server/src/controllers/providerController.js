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
        }).select('name avatar providerCategory businessProfile');

        // Batch: fetch all services for these providers in ONE query
        const allServices = await Service.find({
            provider: { $in: providerIds },
            isActive: true,
        }).select('provider name price location');

        // Batch: fetch all reviews for those services in ONE query
        const serviceIds = allServices.map(s => s._id);
        const allReviews = await Review.find({
            service: { $in: serviceIds },
        }).select('service rating');

        // Build lookup maps
        const servicesByProvider = {};
        allServices.forEach(s => {
            const pid = s.provider.toString();
            if (!servicesByProvider[pid]) servicesByProvider[pid] = [];
            servicesByProvider[pid].push(s);
        });

        const reviewsByService = {};
        allReviews.forEach(r => {
            const sid = r.service.toString();
            if (!reviewsByService[sid]) reviewsByService[sid] = [];
            reviewsByService[sid].push(r.rating);
        });

        const enriched = providers.map(p => {
            const services = servicesByProvider[p._id.toString()] || [];
            const ratings = services.flatMap(s => reviewsByService[s._id.toString()] || []);

            const avgRating = ratings.length
                ? parseFloat((ratings.reduce((s, r) => s + r, 0) / ratings.length).toFixed(1))
                : null;

            const prices = services.map(s => s.price);
            const locations = [...new Set(services.map(s => s.location).filter(Boolean))];

            return {
                _id: p._id,
                name: p.name,
                avatar: p.avatar,
                providerCategory: p.providerCategory || null,
                serviceCount: services.length,
                reviewCount: ratings.length,
                avgRating,
                minPrice: prices.length ? Math.min(...prices) : null,
                maxPrice: prices.length ? Math.max(...prices) : null,
                location: locations[0] || '',
                locations,
            };
        });

        res.status(200).json({ success: true, count: enriched.length, data: enriched });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.getProviderProfile = async (req, res) => {
    try {
        const provider = await User.findOne({
            _id: req.params.id,
            role: 'provider',
        }).select('name avatar providerCategory businessProfile');

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

        // Get reviews — limit payload; compute avg via aggregation
        const [reviewDocs, [avgResult]] = await Promise.all([
            Review.find({ service: { $in: services.map(s => s._id) } })
                .populate('customer', 'name')
                .sort({ createdAt: -1 })
                .limit(20),
            Review.aggregate([
                { $match: { service: { $in: services.map(s => s._id) } } },
                { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
            ]),
        ]);

        const avgRating = avgResult ? parseFloat(avgResult.avg.toFixed(1)) : null;
        const reviewCount = avgResult?.count || 0;

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
                    avatar: provider.avatar,
                    providerCategory: provider.providerCategory || null,
                    businessProfile: provider.businessProfile || null,
                    address: provider.businessProfile?.address || '',
                    avgRating,
                    reviewCount,
                    serviceCount: services.length,
                },
                categories: grouped,
                reviews: reviewDocs.slice(0, 5),
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};