const User = require('../models/User');
const Service = require('../models/Service');
const Review = require('../models/Review');
const Category = require('../models/Category');
const TeamMember = require('../models/TeamMember');
const Availability = require('../models/Availability');
const Shift = require('../models/Shift');
const TimeOff = require('../models/TimeOff');
const { searchAvailability } = require('../utils/availabilitySearch');

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

// Fields needed to render the public provider profile (by id or by slug).
const PROFILE_SELECT = 'name avatar providerCategory businessProfile portfolio phone email bookingPolicy';

/**
 * GET /api/providers/:id/staff?serviceId=
 * Public — bookable staff for a business, optionally narrowed to those who
 * perform a given service (empty services array = performs all of them).
 * Powers the staff-selection step in the customer booking flow.
 */
exports.getProviderStaff = async (req, res) => {
    try {
        const query = { provider: req.params.id, isActive: true };
        if (req.query.serviceId) {
            query.$or = [{ services: { $size: 0 } }, { services: req.query.serviceId }];
        }
        const staff = await TeamMember.find(query)
            .select('name role color services serviceOverrides photoUrl isPrimary') // public: no email/phone/user
            .sort({ isPrimary: -1, createdAt: 1 }); // the primary member is shown first
        const data = staff.map(m => (m.toObject ? m.toObject() : m));

        // When a business has a roster, the OWNER is a bookable professional too
        // ("you"), offered FIRST alongside staff. The owner has no TeamMember row —
        // their column is the unassigned one — so synthesize an entry under the
        // 'owner' sentinel id, which the booking flow maps to teamMember:null. Solo
        // businesses (no staff) keep the owner-implicit flow and need no tile.
        const staffCount = await TeamMember.countDocuments({ provider: req.params.id, isActive: true });
        if (staffCount > 0) {
            const owner = await User.findById(req.params.id).select('name');
            data.unshift({
                _id: 'owner', isOwner: true,
                name: owner?.name || 'Owner', role: 'Owner',
                color: '#f03e16', services: [], serviceOverrides: [], isPrimary: false,
            });
        }
        res.status(200).json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/**
 * GET /api/providers/:id/staff/:teamMemberId/shift-days?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Public — the date-specific shifts a member has in a range, reduced to what the
 * customer date picker needs: which days they WORK (open the day even if the
 * business is normally closed — a member covering a Sunday) and which they are
 * rostered OFF (close the day even if the business is open). The slot times
 * themselves still come from getBookedSlots once a date is chosen.
 *
 * Only date keys are returned — never slot times or notes — so the public
 * calendar learns which days to enable and nothing else about the roster.
 */
exports.getProviderStaffShiftDays = async (req, res) => {
    try {
        const { from, to } = req.query;
        if (!DATE_KEY.test(from || '') || !DATE_KEY.test(to || '')) {
            return res.status(400).json({ success: false, message: 'from and to must be YYYY-MM-DD' });
        }
        // Bound the work on this public, unauthenticated endpoint: the per-day
        // leave-expansion loop below runs across [from, to], so an unbounded
        // window (from=0001, to=9999) against a long leave is a cheap DoS. A
        // calendar never needs more than a year at a time.
        const spanDays = Math.round((new Date(`${to}T00:00:00.000Z`) - new Date(`${from}T00:00:00.000Z`)) / 86400000);
        if (spanDays < 0 || spanDays > 400) {
            return res.status(400).json({ success: false, message: 'from and to must be a range of at most 400 days' });
        }
        // The member must belong to THIS provider and still be active. A miss
        // returns empty (not 404), so the picker simply falls back to business
        // hours rather than leaking whether an id exists.
        const member = await TeamMember.findOne({
            _id: req.params.teamMemberId, provider: req.params.id, isActive: true,
        }).select('_id');
        if (!member) return res.status(200).json({ success: true, data: { working: [], off: [] } });

        const [shifts, leaves] = await Promise.all([
            Shift.find({ teamMember: member._id, date: { $gte: from, $lte: to } }).select('date slots').lean(),
            // All-day approved leave overlapping the window closes those days.
            TimeOff.find({
                teamMember: member._id, status: 'approved', allDay: true,
                startDate: { $lte: to }, endDate: { $gte: from },
            }).select('startDate endDate').lean(),
        ]);

        const workingSet = new Set();
        const offSet = new Set();
        // An empty-slots shift is a rostered day off; anything else is a working day.
        shifts.forEach((s) => ((s.slots && s.slots.length) ? workingSet : offSet).add(s.date));
        // Expand each all-day leave into the days it covers within [from, to].
        leaves.forEach((lv) => {
            const s = lv.startDate < from ? from : lv.startDate;
            const e = lv.endDate > to ? to : lv.endDate;
            for (let d = new Date(`${s}T00:00:00.000Z`); d.toISOString().slice(0, 10) <= e; d.setUTCDate(d.getUTCDate() + 1)) {
                offSet.add(d.toISOString().slice(0, 10));
            }
        });
        // Leave wins over a working shift: a member rostered on but on approved
        // leave is still away, so never report that day as workable.
        const working = [...workingSet].filter((d) => !offSet.has(d));
        const off = [...offSet];
        res.status(200).json({ success: true, data: { working, off } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/**
 * GET /api/providers/search?date=YYYY-MM-DD&time=HH:MM&q=
 * Public — providers with a REAL opening on the given day (staff union or
 * owner column, minus bookings and blocked time). Returns provider ids plus
 * their first few openings; the client merges these into its provider cards.
 */
exports.searchProviders = async (req, res) => {
    try {
        const { date, time, q } = req.query;
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ success: false, message: 'date is required (YYYY-MM-DD)' });
        }
        if (time && !/^\d{2}:\d{2}$/.test(time)) {
            return res.status(400).json({ success: false, message: 'time must be HH:MM' });
        }
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        if (date < today) {
            return res.status(400).json({ success: false, message: 'date must be today or later' });
        }
        const results = await searchAvailability({ date, time, q });
        res.status(200).json({ success: true, data: results });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

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
        }).select('name avatar providerCategory businessProfile portfolio createdAt');

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
                businessName: p.businessProfile?.businessName || p.name,
                description: p.businessProfile?.description || '',
                avatar: p.avatar,
                coverImage: p.portfolio?.images?.[0] || null,
                photos: (p.portfolio?.images || []).slice(0, 5),
                likesCount: Math.max(0, p.businessProfile?.likesCount || 0),
                createdAt: p.createdAt,
                providerCategory: p.providerCategory || null,
                currency: p.businessProfile?.currency || 'NAD',
                serviceCount: services.length,
                reviewCount: ratings.length,
                avgRating,
                minPrice: prices.length ? Math.min(...prices) : null,
                maxPrice: prices.length ? Math.max(...prices) : null,
                // Prefer a service location; fall back to the provider's saved business address
                location: locations[0] || p.businessProfile?.address || '',
                address: p.businessProfile?.address || '',
                locations,
            };
        });

        res.status(200).json({ success: true, count: enriched.length, data: enriched });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Shared payload builder — one provider doc in, the full public profile out.
// Both the id route and the slug route funnel through here so they never drift.
async function buildProviderProfilePayload(provider) {
    // Get their services with categories
    const services = await Service.find({
        provider: provider._id,
        isActive: true,
    }).populate('category', 'name order').sort({ createdAt: -1 });

    // Get their categories
    const categories = await Category.find({ provider: provider._id }).sort({ order: 1 });

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

    // Group services by category — Featured shows ALL services
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

    return {
        provider: {
            _id: provider._id,
            name: provider.name,
            avatar: provider.avatar,
            providerCategory: provider.providerCategory || null,
            currency: provider.businessProfile?.currency || 'NAD',
            // SECURITY: this payload is served on TWO unauthenticated routes
            // (GET /:id and GET /by-slug/:slug). Do NOT spread the whole
            // businessProfile subdocument — it also carries private onboarding
            // answers (teamSize, locationType, currentSoftware, referralSource)
            // and the exact map-pin coordinates, none of which the public UI
            // consumes. Whitelist only the public fields the customer app reads
            // off provider.businessProfile (businessName/address/description/slug,
            // plus currency + the public heart count for parity).
            businessProfile: provider.businessProfile ? {
                businessName: provider.businessProfile.businessName || '',
                currency: provider.businessProfile.currency || 'NAD',
                description: provider.businessProfile.description || '',
                address: provider.businessProfile.address || '',
                slug: provider.businessProfile.slug || null,
                likesCount: Math.max(0, provider.businessProfile.likesCount || 0),
            } : null,
            address: provider.businessProfile?.address || '',
            // Contact + visual fields for the social-style profile page
            phone: provider.phone || '',
            email: provider.email || '',
            photos: (provider.portfolio?.images || []).slice(0, 10),
            instagramUrl: provider.portfolio?.instagramUrl || '',
            likesCount: Math.max(0, provider.businessProfile?.likesCount || 0),
            avgRating,
            reviewCount,
            serviceCount: services.length,
            // Notice a customer must give to cancel/reschedule (0 = anytime).
            cancellationWindowHours: provider.bookingPolicy?.cancellationWindowHours ?? 24,
        },
        categories: grouped,
        reviews: reviewDocs.slice(0, 5),
    };
}

exports.getProviderProfile = async (req, res) => {
    try {
        const provider = await User.findOne({
            _id: req.params.id,
            role: 'provider',
        }).select(PROFILE_SELECT);

        if (!provider) {
            return res.status(404).json({ success: false, message: 'Provider not found' });
        }

        const data = await buildProviderProfilePayload(provider);
        res.status(200).json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/**
 * GET /api/providers/by-slug/:slug
 * Public — resolve a shareable booking-link handle to the same profile payload
 * as /:id, so a link like www.bookplus.pro/b/vibe-barbershop opens the business
 * profile directly.
 */
exports.getProviderProfileBySlug = async (req, res) => {
    try {
        const slug = String(req.params.slug || '').trim().toLowerCase();
        if (!slug) return res.status(404).json({ success: false, message: 'Provider not found' });

        const provider = await User.findOne({
            'businessProfile.slug': slug,
            role: 'provider',
        }).select(PROFILE_SELECT);

        if (!provider) {
            return res.status(404).json({ success: false, message: 'Provider not found' });
        }

        const data = await buildProviderProfilePayload(provider);
        res.status(200).json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/**
 * GET /api/providers/me/setup-status
 * Auth (provider) — which onboarding pieces are done, derived from live data.
 * Powers the dashboard "finish setting up" reminder so it stays truthful even
 * when a step is completed later outside the onboarding flow.
 */
exports.getMySetupStatus = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('avatar businessProfile portfolio');
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        const [serviceCount, availability] = await Promise.all([
            Service.countDocuments({ provider: user._id }),
            Availability.findOne({ provider: user._id }).select('schedule').lean(),
        ]);

        const bp = user.businessProfile || {};
        const hoursSet = !!availability && Object.values(availability.schedule || {}).some(
            (d) => d && d.enabled && Array.isArray(d.slots) && d.slots.length > 0
        );

        const status = {
            address: !!(bp.address && bp.address.trim()),
            hours: hoursSet,
            services: serviceCount > 0,
            photos: !!user.avatar || (user.portfolio?.images?.length > 0),
            slug: !!bp.slug,
        };
        status.complete = status.address && status.hours && status.services && status.photos;

        res.status(200).json({ success: true, data: status });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};