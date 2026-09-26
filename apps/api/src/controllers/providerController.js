const mongoose = require('mongoose');
const User = require('../models/User');
const Service = require('../models/Service');
const Review = require('../models/Review');
const Category = require('../models/Category');
const TeamMember = require('../models/TeamMember');
const Availability = require('../models/Availability');
const Shift = require('../models/Shift');
const TimeOff = require('../models/TimeOff');
const { pickRotationWeek, ownerPerforms } = require('../utils/staffBooking');
const { bookableMembersByProvider, performersOf, offeringSummary } = require('../utils/serviceOffering');
const { photoPresentation } = require('../utils/photoEdits');
const { memberSlugMap, findMemberIdBySlug } = require('../utils/memberLink');

// The member's effective week for a given date, or null when they have no weekly
// schedule at all (they inherit business hours, so nothing to narrow). Rotation
// aware via the SAME helper the booking validator uses, so the calendar and the
// rule it is previewing can never drift apart.
const pickWeekFor = (availability) => {
    if (!availability) return null;
    return (dateKey) => pickRotationWeek(availability, new Date(`${dateKey}T00:00:00.000Z`));
};
const { searchAvailability } = require('../utils/availabilitySearch');
const { NAMIBIA_OFFSET_MIN } = require('../utils/appointmentTime');

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
        // Only people clients can book: active AND bookable. A front desk member
        // (bookable:false) used to be listed, picked, and then refused at the very
        // last step ("not available for online booking").
        const query = { provider: req.params.id, isActive: true, bookable: { $ne: false } };
        if (req.query.serviceId) {
            // Who performs this service? Mirrors staffBooking.performsService:
            //   offersAllServices:true  → yes; offersAllServices:false → only if listed;
            //   legacy rows (field absent) → empty list = all, else only if listed.
            const sid = req.query.serviceId;
            query.$or = [
                { offersAllServices: true },
                { offersAllServices: false, services: sid },
                { offersAllServices: { $exists: false }, services: { $size: 0 } },
                { offersAllServices: { $exists: false }, services: sid },
            ];
        }
        const staff = await TeamMember.find(query)
            // Public allow-list — bio/pronouns/languages are customer-facing; the
            // owner-only HR fields (employment, notes, emergencyContact, address…)
            // are deliberately absent so they can never leak here.
            // `offersAllServices` is part of the ANSWER, not an internal detail: without
            // it the client sees only `services: []` and cannot tell "performs nothing
            // yet" from a legacy row that means "performs everything". That ambiguity
            // showed a newly hired cleaner the whole barbering menu.
            .select('name role color services offersAllServices serviceOverrides photoUrl isPrimary bio pronouns languages')
            .sort({ isPrimary: -1, createdAt: 1 }); // the primary member is shown first

        // Per-professional rating: one aggregate over this business's reviews,
        // grouped by the professional (the null bucket = the owner's own column).
        // Keyed by member id (or 'owner') so each tile shows its own stars/count.
        const ratingBy = {};
        if (mongoose.isValidObjectId(req.params.id)) {
            const agg = await Review.aggregate([
                { $match: { provider: new mongoose.Types.ObjectId(req.params.id) } },
                { $group: { _id: '$teamMember', avg: { $avg: '$rating' }, count: { $sum: 1 } } },
            ]);
            agg.forEach((r) => {
                ratingBy[r._id ? String(r._id) : 'owner'] = {
                    ratingAvg: Math.round(r.avg * 10) / 10,
                    ratingCount: r.count,
                };
            });
        }
        const withRating = (tile, key) => ({
            ...tile,
            ratingAvg: ratingBy[key]?.ratingAvg ?? null,
            ratingCount: ratingBy[key]?.ratingCount ?? 0,
        });

        // Each professional's personal booking-link handle (/b/<business>/<member>).
        const slugs = await memberSlugMap(req.params.id);
        const data = staff.map((m) => ({
            ...withRating(m.toObject ? m.toObject() : m, String(m._id)),
            linkSlug: slugs.get(String(m._id)) || null,
        }));

        // When a business has a roster, the OWNER is a bookable professional too
        // ("you"), offered FIRST alongside staff. The owner has no TeamMember row —
        // their column is the unassigned one — so synthesize an entry under the
        // 'owner' sentinel id, which the booking flow maps to teamMember:null. Solo
        // businesses (no staff) keep the owner-implicit flow and need no tile.
        const staffCount = await TeamMember.countDocuments({ provider: req.params.id, isActive: true, bookable: { $ne: false } });
        // What the OWNER offers: their own list, exactly like a member's — not the
        // whole catalogue. The tile used to say offersAllServices:true, which
        // listed every service a team member had added for themselves under the
        // owner, at that member's price (a driver's N$20 000 "Long trip" above the
        // owner's N$70 trim). The client's performs() check reads this list, so
        // the owner's step now shows only what the owner does, at the owner's price.
        const catalogue = mongoose.isValidObjectId(req.params.id)
            ? await Service.find({ provider: req.params.id, isActive: true }).select('_id ownerPerforms').lean()
            : [];
        const ownerServiceIds = catalogue.filter(ownerPerforms).map((s) => String(s._id));
        const ownerOffersIt = !req.query.serviceId || ownerServiceIds.includes(String(req.query.serviceId));
        // An owner who offers nothing themselves (they manage, the team performs)
        // gets no tile — picking them would lead to an empty list.
        const ownerOffersAnything = ownerServiceIds.length > 0 || catalogue.length === 0;
        if (staffCount > 0 && ownerOffersIt && ownerOffersAnything) {
            const owner = await User.findById(req.params.id).select('name businessProfile.ownerTitle avatar');
            data.unshift(withRating({
                _id: 'owner', isOwner: true,
                // The owner's own set job title (e.g. "Barber"); "Owner" only as a fallback.
                name: owner?.name || 'Owner', role: owner?.businessProfile?.ownerTitle?.trim() || 'Owner',
                color: '#f03e16', services: ownerServiceIds, serviceOverrides: [], isPrimary: false,
                photoUrl: owner?.avatar || null,
                bio: '', pronouns: '', languages: [], // owner tile keeps the same public shape
                // The owner's services are the ones listed — their price is the
                // Service's own price, so no overrides are needed.
                offersAllServices: false,
            }, 'owner'));
        }
        res.status(200).json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/**
 * GET /api/providers/:id/staff/:teamMemberId/reviews?page=&limit=
 * Public — a single professional's reviews (newest first) with their average.
 * The 'owner' sentinel (or any non-ObjectId id) maps to the owner's own column,
 * stored as teamMember:null. Only the reviewer's public identity (name + avatar)
 * and the service name are returned — never the reviewer's email.
 */
exports.getProviderStaffReviews = async (req, res) => {
    try {
        const providerId = req.params.id;
        if (!mongoose.isValidObjectId(providerId)) {
            return res.status(400).json({ success: false, message: 'Invalid provider' });
        }
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const skip = (page - 1) * limit;
        // 'owner' (or any non-ObjectId) = the owner's own column (teamMember null);
        // a real member id filters to that professional's reviews.
        const isOwner = req.params.teamMemberId === 'owner' || !mongoose.isValidObjectId(req.params.teamMemberId);
        const filter = {
            provider: new mongoose.Types.ObjectId(providerId),
            teamMember: isOwner ? null : new mongoose.Types.ObjectId(req.params.teamMemberId),
        };

        const [reviews, total, avgResult] = await Promise.all([
            Review.find(filter)
                .select('rating comment createdAt customer service')
                .populate('customer', 'name avatar') // public identity only — never email
                .populate('service', 'name')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),
            Review.countDocuments(filter),
            Review.aggregate([
                { $match: filter },
                { $group: { _id: null, avg: { $avg: '$rating' } } },
            ]),
        ]);
        const avgRating = avgResult[0] ? Math.round(avgResult[0].avg * 10) / 10 : null;
        res.status(200).json({ success: true, count: reviews.length, total, avgRating, data: reviews });
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
        // The owner is offered as a professional under the 'owner' sentinel
        // (getProviderStaff), which is not a TeamMember id — nor is any other
        // non-ObjectId. The owner has no shifts or leave (they work business
        // hours), so return the same empty payload a missing member gets, BEFORE
        // the id reaches a Mongoose cast that would throw a 500 on this public
        // endpoint. The client then falls back to business hours, which is correct.
        if (req.params.teamMemberId === 'owner' || !require('mongoose').isValidObjectId(req.params.teamMemberId)) {
            return res.status(200).json({ success: true, data: { working: [], off: [] } });
        }
        // The member must belong to THIS provider and still be active. A miss
        // returns empty (not 404), so the picker simply falls back to business
        // hours rather than leaking whether an id exists.
        const member = await TeamMember.findOne({
            _id: req.params.teamMemberId, provider: req.params.id, isActive: true,
        }).select('_id');
        if (!member) return res.status(200).json({ success: true, data: { working: [], off: [] } });

        const StaffAvailability = require('../models/StaffAvailability');
        const [shifts, leaves, availability, bookableCount] = await Promise.all([
            Shift.find({ teamMember: member._id, date: { $gte: from, $lte: to } }).select('date slots').lean(),
            // All-day approved leave overlapping the window closes those days.
            TimeOff.find({
                teamMember: member._id, status: 'approved', allDay: true,
                startDate: { $lte: to }, endDate: { $gte: from },
            }).select('startDate endDate').lean(),
            // Their WEEKLY hours — which days they work at all, not just the dates
            // someone rostered by hand.
            StaffAvailability.findOne({ teamMember: member._id }).select('schedule rotation').lean(),
            TeamMember.countDocuments({ provider: req.params.id, isActive: true, bookable: { $ne: false } }),
        ]);

        const workingSet = new Set();
        const offSet = new Set();
        // An empty-slots shift is a rostered day off; anything else is a working day.
        const shiftDates = new Set();
        shifts.forEach((s) => {
            shiftDates.add(s.date);
            ((s.slots && s.slots.length) ? workingSet : offSet).add(s.date);
        });

        // Dates with NO hand-rostered shift fall to the member's weekly schedule —
        // the same rule the booking validator enforces (staffHoursReason). Without
        // this the calendar left every business-open day selectable, so a member who
        // simply doesn't work Mondays showed Monday as pickable and the customer
        // only found out by opening it to a wall of greyed-out times.
        //
        // A SOLO bookable member is skipped deliberately: the validator ignores a
        // lone member's weekly hours and falls back to business hours, so narrowing
        // here would close days the booking would actually accept.
        const weekly = bookableCount === 1 ? null : pickWeekFor(availability);
        if (weekly) {
            const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            for (let d = new Date(`${from}T00:00:00.000Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
                const key = d.toISOString().slice(0, 10);
                if (shiftDates.has(key)) continue;   // a rostered shift is authoritative for its date
                const week = weekly(key);
                const day = week && week[DAY_NAMES[new Date(`${key}T00:00:00.000Z`).getUTCDay()]];
                const works = !!(day && day.enabled && Array.isArray(day.slots) && day.slots.some((sl) => sl && sl.start && sl.end));
                (works ? workingSet : offSet).add(key);
            }
        }
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
        // "Today" is Namibia-local (Africa/Windhoek, UTC+2), NOT the server's UTC —
        // the same reference searchAvailability floors past slots against. A UTC
        // gate disagreed with the search floor in the 00:00–01:59 local window
        // (still the prior UTC day), letting a search for the just-passed local day
        // through un-floored and surfacing that day's already-gone slots.
        const nib = new Date(Date.now() + NAMIBIA_OFFSET_MIN * 60000);
        const today = `${nib.getUTCFullYear()}-${String(nib.getUTCMonth() + 1).padStart(2, '0')}-${String(nib.getUTCDate()).padStart(2, '0')}`;
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
        }).select('provider name price duration location ownerPerforms');
        // …and every bookable team member, so each card can tell the owner's own
        // offering apart from services only a team member performs.
        const membersByProvider = await bookableMembersByProvider(providerIds);

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

        // A business only appears when a client could actually book something.
        const summaryById = new Map(providers.map((p) => [
            p._id.toString(),
            offeringSummary(servicesByProvider[p._id.toString()] || [], membersByProvider.get(p._id.toString()) || []),
        ]));
        const enriched = providers.filter((p) => summaryById.get(p._id.toString()).bookable.length > 0).map(p => {
            const services = servicesByProvider[p._id.toString()] || [];
            const ratings = services.flatMap(s => reviewsByService[s._id.toString()] || []);

            const avgRating = ratings.length
                ? parseFloat((ratings.reduce((s, r) => s + r, 0) / ratings.length).toFixed(1))
                : null;

            // "Starting at N$…" and "N services available" describe the OWNER's
            // own offering at the owner's prices. They used to span the whole
            // catalogue, so a team member adding a N$15 service of their own
            // became the business's advertised starting price.
            const offering = summaryById.get(p._id.toString());
            const locations = [...new Set(services.map(s => s.location).filter(Boolean))];

            return {
                _id: p._id,
                name: p.name,
                businessName: p.businessProfile?.businessName || p.name,
                description: p.businessProfile?.description || '',
                avatar: p.avatar,
                coverImage: p.portfolio?.images?.[0] || null,
                photos: (p.portfolio?.images || []).slice(0, 5),
                // How the owner framed them (post shape + per-photo crop/adjust).
                ...photoPresentation(p.portfolio, (p.portfolio?.images || []).slice(0, 5)),
                likesCount: Math.max(0, p.businessProfile?.likesCount || 0),
                createdAt: p.createdAt,
                providerCategory: p.providerCategory || null,
                currency: p.businessProfile?.currency || 'NAD',
                serviceCount: offering.serviceCount,
                reviewCount: ratings.length,
                avgRating,
                minPrice: offering.minPrice,
                maxPrice: offering.maxPrice,
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

    // What clients can book here, and from whom. A service only a team member
    // performs is still on the business's page — clients find Erastus's car wash
    // here — but it is marked as his (ownerPerforms:false + performers) and
    // priced at his price, never presented as the owner's. A service nobody
    // performs any more is not offered at all.
    const members = (await bookableMembersByProvider([provider._id])).get(String(provider._id)) || [];
    const offering = offeringSummary(services, members);
    const bookableServices = offering.bookable.map((s) => ({
        ...(s.toObject ? s.toObject() : s),
        ownerPerforms: ownerPerforms(s),
        performers: performersOf(s, members, provider.name),
    }));

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

    // Group services by category — Featured shows every bookable service
    const grouped = {
        featured: { name: 'Featured', services: bookableServices },
    };

    categories.forEach(cat => {
        const catServices = bookableServices.filter(s => {
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
            ...photoPresentation(provider.portfolio, (provider.portfolio?.images || []).slice(0, 10)),
            instagramUrl: provider.portfolio?.instagramUrl || '',
            likesCount: Math.max(0, provider.businessProfile?.likesCount || 0),
            avgRating,
            reviewCount,
            // The owner's own offering (see utils/serviceOffering.offeringSummary)
            // — the "N services available from N$…" bar.
            serviceCount: offering.serviceCount,
            minPrice: offering.minPrice,
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
 * GET /api/providers/by-slug/:slug/member/:memberSlug
 * Public — resolves a personal booking link (/b/<business>/<member>) to the ids
 * the booking flow needs. Only an ACTIVE member resolves; a paused, removed or
 * renamed member 404s so the customer app falls back to the business page.
 */
exports.getMemberBySlug = async (req, res) => {
    try {
        const slug = String(req.params.slug || '').trim().toLowerCase();
        const provider = slug && await User.findOne({ 'businessProfile.slug': slug, role: 'provider' }).select('_id');
        if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });
        const memberId = await findMemberIdBySlug(provider._id, req.params.memberSlug);
        const member = memberId && await TeamMember.findOne({ _id: memberId, provider: provider._id, isActive: true }).select('name');
        if (!member) return res.status(404).json({ success: false, message: 'Team member not found' });
        res.status(200).json({ success: true, data: { providerId: provider._id, teamMemberId: member._id, name: member.name } });
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