const Appointment = require('../models/Appointment');
const User = require('../models/User');
const Service = require('../models/Service');
const Review = require('../models/Review');
const Availability = require('../models/Availability');
const WaitingList = require('../models/WaitingList');

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
