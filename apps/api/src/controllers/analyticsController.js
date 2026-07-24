const mongoose = require('mongoose');
const Appointment = require('../models/Appointment');
const User = require('../models/User');
const Service = require('../models/Service');
const Review = require('../models/Review');
const Availability = require('../models/Availability');
const WaitingList = require('../models/WaitingList');
const ClientPackage = require('../models/ClientPackage');
const ProviderWallet = require('../models/ProviderWallet');

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return (h || 0) * 60 + (m || 0); };

exports.getAnalytics = async (req, res) => {
    try {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
        const last30Days = new Date(now - 30 * 24 * 60 * 60 * 1000);
        const last7Days = new Date(now - 7 * 24 * 60 * 60 * 1000);

        // ── Appointments ──
        const totalAppointments = await Appointment.countDocuments();
        const thisMonthAppointments = await Appointment.countDocuments({ createdAt: { $gte: startOfMonth } });

        const appointmentsByStatus = await Appointment.aggregate([
            { $group: { _id: '$status', count: { $sum: 1 } } },
        ]);

        // ── Bookings over last 30 days ──
        const bookingsOverTime = await Appointment.aggregate([
            { $match: { createdAt: { $gte: last30Days } } },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                    count: { $sum: 1 },
                }
            },
            { $sort: { _id: 1 } },
        ]);

        // Fill in missing days with 0
        const filledBookings = [];
        for (let i = 29; i >= 0; i--) {
            const date = new Date(now - i * 24 * 60 * 60 * 1000);
            const dateStr = date.toISOString().split('T')[0];
            const found = bookingsOverTime.find(b => b._id === dateStr);
            filledBookings.push({
                date: dateStr,
                label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                count: found ? found.count : 0,
            });
        }

        // ── Users ──
        const totalUsers = await User.countDocuments({ role: { $ne: 'admin' } });
        const totalCustomers = await User.countDocuments({ role: 'customer' });
        const totalProviders = await User.countDocuments({ role: 'provider' });
        const newUsersThisMonth = await User.countDocuments({ createdAt: { $gte: startOfMonth } });
        const newUsersLastWeek = await User.countDocuments({ createdAt: { $gte: last7Days } });

        const newUsersOverTime = await User.aggregate([
            { $match: { createdAt: { $gte: last30Days }, role: { $ne: 'admin' } } },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                    count: { $sum: 1 },
                }
            },
            { $sort: { _id: 1 } },
        ]);

        const filledUsers = [];
        for (let i = 29; i >= 0; i--) {
            const date = new Date(now - i * 24 * 60 * 60 * 1000);
            const dateStr = date.toISOString().split('T')[0];
            const found = newUsersOverTime.find(u => u._id === dateStr);
            filledUsers.push({
                date: dateStr,
                label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                count: found ? found.count : 0,
            });
        }

        // ── Popular services ──
        const popularServices = await Appointment.aggregate([
            { $group: { _id: '$service', count: { $sum: 1 } } },
            { $lookup: { from: 'services', localField: '_id', foreignField: '_id', as: 'service' } },
            { $unwind: '$service' },
            { $project: { name: '$service.name', price: '$service.price', count: 1 } },
            { $sort: { count: -1 } },
            { $limit: 5 },
        ]);

        // ── Busiest days ──
        const busiestDays = await Appointment.aggregate([
            {
                $group: {
                    _id: { $dayOfWeek: '$appointmentDate' },
                    count: { $sum: 1 },
                }
            },
            { $sort: { count: -1 } },
        ]);

        const dayNames = ['', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const busiestDaysMapped = busiestDays.map(d => ({
            day: dayNames[d._id],
            count: d.count,
        }));

        // ── Average ratings ──
        const ratingsPerService = await Review.aggregate([
            { $group: { _id: '$service', avgRating: { $avg: '$rating' }, count: { $sum: 1 } } },
            { $lookup: { from: 'services', localField: '_id', foreignField: '_id', as: 'service' } },
            { $unwind: '$service' },
            { $project: { name: '$service.name', avgRating: { $round: ['$avgRating', 1] }, count: 1 } },
            { $sort: { avgRating: -1 } },
        ]);

        res.status(200).json({
            success: true,
            data: {
                appointments: { total: totalAppointments, thisMonth: thisMonthAppointments, byStatus: appointmentsByStatus },
                bookingsOverTime: filledBookings,
                users: { total: totalUsers, customers: totalCustomers, providers: totalProviders, newThisMonth: newUsersThisMonth, newLastWeek: newUsersLastWeek },
                newUsersOverTime: filledUsers,
                popularServices,
                busiestDays: busiestDaysMapped,
                ratingsPerService,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};


/**
 * GET /api/analytics/provider  (provider, admin)
 * Operational (non-financial) analytics for a single provider.
 * Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD (defaults to last 30 days)
 */
exports.getProviderAnalytics = async (req, res) => {
    try {
        const providerId = req.user._id;
        const now = new Date();
        const parseDate = (val, fallback) => {
            if (!val) return fallback;
            const d = new Date(val);
            return isNaN(d.getTime()) ? fallback : d;
        };
        const from = parseDate(req.query.from, new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000));
        from.setHours(0, 0, 0, 0);
        const to = parseDate(req.query.to, now);
        to.setHours(23, 59, 59, 999);

        const inRange = { provider: providerId, appointmentDate: { $gte: from, $lte: to } };

        // Pull the appointments we need once
        const appts = await Appointment.find(inRange)
            .select('status appointmentDate startTime endTime customer service')
            .lean();
        const activeAppts = appts.filter(a => ['pending', 'confirmed', 'completed'].includes(a.status));

        // ── Status counts ──
        const statusCounts = appts.reduce((acc, a) => { acc[a.status] = (acc[a.status] || 0) + 1; return acc; }, {});
        const total = appts.length;
        const completed = statusCounts.completed || 0;
        const cancelled = statusCounts.cancelled || 0;
        const noShow = statusCounts['no-show'] || 0;
        const noShowRate = (completed + noShow) > 0 ? Math.round((noShow / (completed + noShow)) * 100) : 0;
        const cancellationRate = total > 0 ? Math.round((cancelled / total) * 100) : 0;

        // ── Peak hours (by startTime hour) and peak days (by weekday) ── active only
        const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }));
        const byDay = DAY_KEYS.map((d) => ({ day: d.slice(0, 3), full: d, count: 0 }));
        activeAppts.forEach(a => {
            if (a.startTime) {
                const h = Math.floor(toMin(a.startTime) / 60);
                if (byHour[h]) byHour[h].count += 1;
            }
            const dow = new Date(a.appointmentDate).getDay();
            byDay[dow].count += 1;
        });
        // Trim peak-hours to a sensible window (7am–8pm) for display
        const peakHours = byHour.slice(7, 21).map(h => ({
            label: h.hour === 12 ? '12pm' : h.hour < 12 ? `${h.hour}am` : `${h.hour - 12}pm`,
            count: h.count,
        }));

        // ── New vs returning clients (within range, based on first-ever appointment) ──
        const clientIds = [...new Set(appts.map(a => a.customer?.toString()).filter(Boolean))];
        let newClients = 0, returningClients = 0;
        if (clientIds.length) {
            const firstApptByClient = await Appointment.aggregate([
                { $match: { provider: providerId, customer: { $in: clientIds.map(id => new (require('mongoose').Types.ObjectId)(id)) } } },
                { $group: { _id: '$customer', firstDate: { $min: '$appointmentDate' } } },
            ]);
            const firstMap = new Map(firstApptByClient.map(c => [c._id.toString(), c.firstDate]));
            clientIds.forEach(id => {
                const first = firstMap.get(id);
                if (first && first >= from && first <= to) newClients += 1;
                else returningClients += 1;
            });
        }

        // ── Utilization: booked minutes vs available minutes across the range ──
        const availabilityDoc = await Availability.findOne({ provider: providerId });
        const schedule = availabilityDoc?.schedule;
        let availableMinutes = 0;
        if (schedule) {
            const cursor = new Date(from);
            let guard = 0;
            while (cursor <= to && guard < 370) {
                const day = schedule[DAY_KEYS[cursor.getDay()]];
                if (day?.enabled && Array.isArray(day.slots)) {
                    day.slots.forEach(slot => { availableMinutes += Math.max(0, toMin(slot.end) - toMin(slot.start)); });
                }
                cursor.setDate(cursor.getDate() + 1);
                guard += 1;
            }
        }
        let bookedMinutes = 0;
        activeAppts.forEach(a => {
            if (a.startTime && a.endTime) bookedMinutes += Math.max(0, toMin(a.endTime) - toMin(a.startTime));
        });
        const utilizationPct = availableMinutes > 0 ? Math.min(100, Math.round((bookedMinutes / availableMinutes) * 100)) : 0;

        // ── Bookings over time (daily, zero-filled) ──
        const overTimeMap = appts.reduce((acc, a) => {
            const d = new Date(a.appointmentDate);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});
        const overTime = [];
        const dCursor = new Date(from);
        let g2 = 0;
        while (dCursor <= to && g2 < 370) {
            const key = `${dCursor.getFullYear()}-${String(dCursor.getMonth() + 1).padStart(2, '0')}-${String(dCursor.getDate()).padStart(2, '0')}`;
            overTime.push({ date: key, label: dCursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), count: overTimeMap[key] || 0 });
            dCursor.setDate(dCursor.getDate() + 1);
            g2 += 1;
        }

        // ── Waitlist volume (current active entries for this provider) ──
        const waitlistVolume = await WaitingList.countDocuments({ provider: providerId, status: 'waiting' });

        res.status(200).json({
            success: true,
            data: {
                range: { from, to },
                totals: { total, completed, cancelled, noShow },
                rates: { noShowRate, cancellationRate, utilizationPct },
                utilization: { bookedMinutes, availableMinutes },
                clients: { new: newClients, returning: returningClients },
                peakHours,
                peakDays: byDay,
                overTime,
                waitlistVolume,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};


/**
 * GET /api/analytics/admin/providers  (admin)
 * Per-provider revenue leaderboard + a platform roll-up. Revenue = service revenue
 * (completed appointments' totalPrice) + package/membership revenue (what clients
 * paid for multi-session packages). Also surfaces each provider's platform wallet
 * balance so an admin sees earnings and account funds side by side.
 */
exports.getProviderRevenueList = async (req, res) => {
    try {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        // Service revenue per provider (completed appointments only).
        const svcAgg = await Appointment.aggregate([
            { $match: { status: 'completed', provider: { $ne: null } } },
            {
                $group: {
                    _id: '$provider',
                    servicesRevenue: { $sum: '$totalPrice' },
                    completedCount: { $sum: 1 },
                    thisMonthRevenue: { $sum: { $cond: [{ $gte: ['$appointmentDate', startOfMonth] }, '$totalPrice', 0] } },
                },
            },
        ]);
        const svcMap = new Map(svcAgg.map(r => [String(r._id), r]));

        // Package (membership) revenue per provider.
        const pkgAgg = await ClientPackage.aggregate([
            { $group: { _id: '$provider', packageRevenue: { $sum: '$purchasePrice' }, packageCount: { $sum: 1 } } },
        ]);
        const pkgMap = new Map(pkgAgg.map(r => [String(r._id), r]));

        // Platform wallet balances per provider.
        const wallets = await ProviderWallet.find().select('provider balance').lean();
        const walletMap = new Map(wallets.map(w => [String(w.provider), w.balance]));

        const providers = await User.find({ role: 'provider' })
            .select('name email phone providerCategory avatar isActive createdAt')
            .lean();

        const rows = providers.map(p => {
            const id = String(p._id);
            const svc = svcMap.get(id) || {};
            const pkg = pkgMap.get(id) || {};
            const servicesRevenue = svc.servicesRevenue || 0;
            const packageRevenue = pkg.packageRevenue || 0;
            return {
                _id: p._id,
                name: p.name,
                email: p.email,
                phone: p.phone || null,
                category: p.providerCategory || null,
                avatar: p.avatar || null,
                isActive: p.isActive !== false,
                joinedAt: p.createdAt,
                servicesRevenue,
                packageRevenue,
                totalRevenue: servicesRevenue + packageRevenue,
                thisMonthRevenue: svc.thisMonthRevenue || 0,
                completedCount: svc.completedCount || 0,
                packageCount: pkg.packageCount || 0,
                walletBalance: walletMap.get(id) || 0,
            };
        }).sort((a, b) => b.totalRevenue - a.totalRevenue);

        const platform = rows.reduce((acc, r) => {
            acc.servicesRevenue += r.servicesRevenue;
            acc.packageRevenue += r.packageRevenue;
            acc.totalRevenue += r.totalRevenue;
            acc.thisMonthRevenue += r.thisMonthRevenue;
            acc.completedCount += r.completedCount;
            return acc;
        }, { servicesRevenue: 0, packageRevenue: 0, totalRevenue: 0, thisMonthRevenue: 0, completedCount: 0, providerCount: rows.length });

        res.status(200).json({ success: true, data: { platform, providers: rows } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/**
 * GET /api/analytics/admin/providers/:id  (admin)
 * Full revenue + activity breakdown for a single provider: service and package
 * revenue (all-time, this/last month, 6-month trend), appointment status mix,
 * top services, unique clients, platform wallet balance, and recent activity.
 */
exports.getProviderRevenueDetail = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({ success: false, message: 'Invalid provider id' });
        }
        const providerDoc = await User.findById(id)
            .select('name email phone providerCategory avatar isActive createdAt businessName slug');
        if (!providerDoc) {
            return res.status(404).json({ success: false, message: 'Provider not found' });
        }
        const providerId = new mongoose.Types.ObjectId(id);
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
        const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

        // Service revenue aggregates (completed only).
        const [rev] = await Appointment.aggregate([
            { $match: { provider: providerId, status: 'completed' } },
            {
                $group: {
                    _id: null,
                    allTime: { $sum: '$totalPrice' },
                    completedCount: { $sum: 1 },
                    thisMonth: { $sum: { $cond: [{ $gte: ['$appointmentDate', startOfMonth] }, '$totalPrice', 0] } },
                    lastMonth: { $sum: { $cond: [{ $and: [{ $gte: ['$appointmentDate', startOfLastMonth] }, { $lte: ['$appointmentDate', endOfLastMonth] }] }, '$totalPrice', 0] } },
                },
            },
        ]);

        // Appointment status mix (all statuses).
        const statusAgg = await Appointment.aggregate([
            { $match: { provider: providerId } },
            { $group: { _id: '$status', count: { $sum: 1 } } },
        ]);
        const byStatus = statusAgg.reduce((acc, s) => { acc[s._id] = s.count; return acc; }, {});
        const totalAppointments = statusAgg.reduce((s, r) => s + r.count, 0);

        // Monthly service revenue over the last 6 months (UTC bucketed, zero-filled).
        const monthlyAgg = await Appointment.aggregate([
            { $match: { provider: providerId, status: 'completed', appointmentDate: { $gte: sixMonthsAgo } } },
            { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$appointmentDate', timezone: 'UTC' } }, revenue: { $sum: '$totalPrice' }, count: { $sum: 1 } } },
        ]);
        const monthlyMap = new Map(monthlyAgg.map(m => [m._id, m]));
        const monthly = [];
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const found = monthlyMap.get(key);
            monthly.push({ month: key, label: d.toLocaleDateString('en-US', { month: 'short' }), revenue: found ? found.revenue : 0, count: found ? found.count : 0 });
        }

        // Top services by revenue.
        const topServices = await Appointment.aggregate([
            { $match: { provider: providerId, status: 'completed' } },
            { $group: { _id: '$service', revenue: { $sum: '$totalPrice' }, count: { $sum: 1 } } },
            { $lookup: { from: 'services', localField: '_id', foreignField: '_id', as: 'svc' } },
            { $unwind: { path: '$svc', preserveNullAndEmptyArrays: true } },
            { $project: { name: { $ifNull: ['$svc.name', 'Unknown'] }, revenue: 1, count: 1 } },
            { $sort: { revenue: -1 } },
            { $limit: 5 },
        ]);

        // Unique clients served (completed, registered customers).
        const uniqueClients = (await Appointment.distinct('customer', { provider: providerId, status: 'completed', customer: { $ne: null } })).length;

        // Package (membership) revenue + counts.
        const [pkg] = await ClientPackage.aggregate([
            { $match: { provider: providerId } },
            { $group: { _id: null, revenue: { $sum: '$purchasePrice' }, count: { $sum: 1 }, active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } } } },
        ]);

        const recentPackages = await ClientPackage.find({ provider: providerId })
            .populate('customer', 'name')
            .populate('package', 'name')
            .sort({ purchasedAt: -1 })
            .limit(5)
            .lean();

        const wallet = await ProviderWallet.findOne({ provider: providerId }).select('balance currency').lean();

        const recentDocs = await Appointment.find({ provider: providerId, status: 'completed' })
            .select('customer guestName walkInName service appointmentDate totalPrice')
            .populate('service', 'name')
            .populate('customer', 'name')
            .sort({ appointmentDate: -1 })
            .limit(8)
            .lean();

        const servicesRevenue = rev?.allTime || 0;
        const packageRevenue = pkg?.revenue || 0;
        const completedCount = rev?.completedCount || 0;
        const thisMonthRev = rev?.thisMonth || 0;
        const lastMonthRev = rev?.lastMonth || 0;
        const growthPct = lastMonthRev === 0
            ? (thisMonthRev > 0 ? 100 : 0)
            : Math.round(((thisMonthRev - lastMonthRev) / lastMonthRev) * 100);

        res.status(200).json({
            success: true,
            data: {
                provider: {
                    _id: providerDoc._id,
                    name: providerDoc.name,
                    email: providerDoc.email,
                    phone: providerDoc.phone || null,
                    category: providerDoc.providerCategory || null,
                    businessName: providerDoc.businessName || null,
                    slug: providerDoc.slug || null,
                    avatar: providerDoc.avatar || null,
                    isActive: providerDoc.isActive !== false,
                    joinedAt: providerDoc.createdAt,
                },
                revenue: {
                    services: servicesRevenue,
                    packages: packageRevenue,
                    total: servicesRevenue + packageRevenue,
                    thisMonth: thisMonthRev,
                    lastMonth: lastMonthRev,
                    growthPct,
                    avgTicket: completedCount > 0 ? Math.round(servicesRevenue / completedCount) : 0,
                },
                appointments: { total: totalAppointments, completed: completedCount, byStatus, uniqueClients },
                packages: { revenue: packageRevenue, count: pkg?.count || 0, active: pkg?.active || 0 },
                walletBalance: wallet?.balance || 0,
                monthly,
                topServices,
                recentPackages: recentPackages.map(p => ({
                    _id: p._id,
                    client: p.customer?.name || 'Client',
                    package: p.package?.name || 'Package',
                    price: p.purchasePrice || 0,
                    purchasedAt: p.purchasedAt,
                    status: p.status,
                })),
                recent: recentDocs.map(a => ({
                    _id: a._id,
                    client: a.customer?.name || a.guestName || a.walkInName || 'Walk-in',
                    service: a.service?.name || 'Unknown',
                    date: a.appointmentDate,
                    amount: a.totalPrice || 0,
                })),
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
