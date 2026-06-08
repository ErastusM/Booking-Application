const Appointment = require('../models/Appointment');

exports.getMyEarnings = async (req, res) => {
    try {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

        // Single aggregation for revenue totals — no full table load
        const [revResult] = await Appointment.aggregate([
            { $match: { provider: req.user._id, status: 'completed' } },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$totalPrice' },
                    thisMonth: {
                        $sum: { $cond: [{ $gte: ['$createdAt', startOfMonth] }, '$totalPrice', 0] }
                    },
                    lastMonth: {
                        $sum: {
                            $cond: [
                                { $and: [{ $gte: ['$createdAt', startOfLastMonth] }, { $lte: ['$createdAt', endOfLastMonth] }] },
                                '$totalPrice',
                                0
                            ]
                        }
                    },
                    count: { $sum: 1 },
                }
            }
        ]);
        const totalEarned = revResult?.total || 0;
        const thisMonthEarned = revResult?.thisMonth || 0;
        const lastMonthEarned = revResult?.lastMonth || 0;
        const completedCount = revResult?.count || 0;
        const growth = lastMonthEarned === 0 ? 100
            : Math.round(((thisMonthEarned - lastMonthEarned) / lastMonthEarned) * 100);

        // Earnings by service — aggregation only
        const earningsByServiceArr = await Appointment.aggregate([
            { $match: { provider: req.user._id, status: 'completed' } },
            { $group: { _id: '$service', total: { $sum: '$totalPrice' }, count: { $sum: 1 } } },
            { $lookup: { from: 'services', localField: '_id', foreignField: '_id', as: 'svc' } },
            { $unwind: { path: '$svc', preserveNullAndEmptyArrays: true } },
            { $project: { name: { $ifNull: ['$svc.name', 'Unknown'] }, total: 1, count: 1 } },
            { $sort: { total: -1 } },
        ]);

        // Recent 10 transactions only — scoped query
        const recentAppointments = await Appointment.find({
            provider: req.user._id,
            status: 'completed',
        })
            .select('customer service appointmentDate totalPrice paymentStatus')
            .populate('service', 'name')
            .populate('customer', 'name')
            .sort({ appointmentDate: -1 })
            .limit(10);

        const recentTransactions = recentAppointments.map(a => ({
            _id: a._id,
            customerName: a.customer?.name || 'Unknown',
            serviceName: a.service?.name || 'Unknown',
            amount: a.totalPrice,
            date: a.appointmentDate,
            paymentStatus: a.paymentStatus,
        }));

        res.status(200).json({
            success: true,
            data: {
                totalEarned,
                thisMonthEarned,
                lastMonthEarned,
                growth,
                completedCount,
                earningsByService: earningsByServiceArr,
                recentTransactions,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};