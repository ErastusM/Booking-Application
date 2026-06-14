const Appointment = require('../models/Appointment');

/**
 * GET /api/earnings  (provider, admin)
 * A reporting view of the value of COMPLETED appointments only.
 * This is NOT a payments/payout/wallet feature — totalPrice is a display
 * field and these figures represent service value already collected in person.
 *
 * Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD  (defaults to the last 30 days)
 */
exports.getMyEarnings = async (req, res) => {
    try {
        const providerId = req.user._id;
        const now = new Date();

        // ── Resolve the requested range (defaults to last 30 days) ──
        const parseDate = (s, fallback) => {
            if (!s) return fallback;
            const d = new Date(s);
            return isNaN(d.getTime()) ? fallback : d;
        };
        const rangeFrom = parseDate(req.query.from, new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000));
        rangeFrom.setHours(0, 0, 0, 0);
        const rangeTo = parseDate(req.query.to, now);
        rangeTo.setHours(23, 59, 59, 999);

        // Month windows for the comparison cards (independent of the range)
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

        const completedBase = { provider: providerId, status: 'completed' };

        // ── Range totals + month comparison in a single pass (uses appointmentDate) ──
        const [agg] = await Appointment.aggregate([
            { $match: { ...completedBase } },
            {
                $group: {
                    _id: null,
                    rangeEarned: {
                        $sum: { $cond: [{ $and: [{ $gte: ['$appointmentDate', rangeFrom] }, { $lte: ['$appointmentDate', rangeTo] }] }, '$totalPrice', 0] },
                    },
                    rangeCount: {
                        $sum: { $cond: [{ $and: [{ $gte: ['$appointmentDate', rangeFrom] }, { $lte: ['$appointmentDate', rangeTo] }] }, 1, 0] },
                    },
                    thisMonthEarned: {
                        $sum: { $cond: [{ $gte: ['$appointmentDate', startOfMonth] }, '$totalPrice', 0] },
                    },
                    thisMonthCount: {
                        $sum: { $cond: [{ $gte: ['$appointmentDate', startOfMonth] }, 1, 0] },
                    },
                    lastMonthEarned: {
                        $sum: { $cond: [{ $and: [{ $gte: ['$appointmentDate', startOfLastMonth] }, { $lte: ['$appointmentDate', endOfLastMonth] }] }, '$totalPrice', 0] },
                    },
                    lastMonthCount: {
                        $sum: { $cond: [{ $and: [{ $gte: ['$appointmentDate', startOfLastMonth] }, { $lte: ['$appointmentDate', endOfLastMonth] }] }, 1, 0] },
                    },
                    allTimeEarned: { $sum: '$totalPrice' },
                    allTimeCount: { $sum: 1 },
                },
            },
        ]);

        const rangeEarned = agg?.rangeEarned || 0;
        const rangeCount = agg?.rangeCount || 0;
        const thisMonthEarned = agg?.thisMonthEarned || 0;
        const lastMonthEarned = agg?.lastMonthEarned || 0;
        const growthPct = lastMonthEarned === 0
            ? (thisMonthEarned > 0 ? 100 : 0)
            : Math.round(((thisMonthEarned - lastMonthEarned) / lastMonthEarned) * 100);
        const avgPerAppointment = rangeCount > 0 ? Math.round(rangeEarned / rangeCount) : 0;

        // ── Earnings by service (within range) ──
        const byService = await Appointment.aggregate([
            { $match: { ...completedBase, appointmentDate: { $gte: rangeFrom, $lte: rangeTo } } },
            { $group: { _id: '$service', earned: { $sum: '$totalPrice' }, count: { $sum: 1 } } },
            { $lookup: { from: 'services', localField: '_id', foreignField: '_id', as: 'svc' } },
            { $unwind: { path: '$svc', preserveNullAndEmptyArrays: true } },
            { $project: { name: { $ifNull: ['$svc.name', 'Unknown'] }, earned: 1, count: 1 } },
            { $sort: { earned: -1 } },
        ]);

        // ── Earnings over time (within range, grouped by day, zero-filled) ──
        const overTimeRaw = await Appointment.aggregate([
            { $match: { ...completedBase, appointmentDate: { $gte: rangeFrom, $lte: rangeTo } } },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$appointmentDate' } },
                    earned: { $sum: '$totalPrice' },
                    count: { $sum: 1 },
                },
            },
            { $sort: { _id: 1 } },
        ]);
        const overTimeMap = new Map(overTimeRaw.map(d => [d._id, d]));
        const overTime = [];
        const dayCursor = new Date(rangeFrom);
        const MAX_DAYS = 370; // safety cap for very wide ranges
        let guard = 0;
        while (dayCursor <= rangeTo && guard < MAX_DAYS) {
            const key = `${dayCursor.getFullYear()}-${String(dayCursor.getMonth() + 1).padStart(2, '0')}-${String(dayCursor.getDate()).padStart(2, '0')}`;
            const found = overTimeMap.get(key);
            overTime.push({
                date: key,
                label: dayCursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                earned: found ? found.earned : 0,
                count: found ? found.count : 0,
            });
            dayCursor.setDate(dayCursor.getDate() + 1);
            guard += 1;
        }

        // ── Top clients (within range) ──
        const topClientsRaw = await Appointment.aggregate([
            { $match: { ...completedBase, appointmentDate: { $gte: rangeFrom, $lte: rangeTo } } },
            { $group: { _id: '$customer', earned: { $sum: '$totalPrice' }, count: { $sum: 1 } } },
            { $sort: { earned: -1 } },
            { $limit: 5 },
            { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } },
            { $unwind: { path: '$u', preserveNullAndEmptyArrays: true } },
            { $project: { name: { $ifNull: ['$u.name', 'Walk-in'] }, earned: 1, count: 1 } },
        ]);

        // ── Recent completed appointments (latest 10, range-independent) ──
        const recentDocs = await Appointment.find(completedBase)
            .select('customer walkInName service appointmentDate startTime endTime totalPrice')
            .populate('service', 'name')
            .populate('customer', 'name')
            .sort({ appointmentDate: -1 })
            .limit(10);
        const recent = recentDocs.map(a => ({
            _id: a._id,
            client: a.walkInName || a.customer?.name || 'Walk-in',
            service: a.service?.name || 'Unknown',
            date: a.appointmentDate,
            time: a.startTime ? `${a.startTime} – ${a.endTime}` : '',
            amount: a.totalPrice || 0,
        }));

        res.status(200).json({
            success: true,
            data: {
                range: { from: rangeFrom, to: rangeTo },
                totals: {
                    earned: rangeEarned,
                    completedCount: rangeCount,
                    avgPerAppointment,
                    allTimeEarned: agg?.allTimeEarned || 0,
                    allTimeCount: agg?.allTimeCount || 0,
                },
                thisMonth: { earned: thisMonthEarned, completedCount: agg?.thisMonthCount || 0 },
                lastMonth: { earned: lastMonthEarned, completedCount: agg?.lastMonthCount || 0 },
                growthPct,
                byService,
                byTeamMember: [], // appointments are not yet linked to individual team members
                overTime,
                topClients: topClientsRaw,
                recent,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
