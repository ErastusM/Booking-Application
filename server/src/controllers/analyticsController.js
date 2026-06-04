const Appointment = require('../models/Appointment');
const User = require('../models/User');
const Service = require('../models/Service');
const Review = require('../models/Review');

exports.getAnalytics = async (req, res) => {
    try {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
        const last30Days = new Date(now - 30 * 24 * 60 * 60 * 1000);
        const last7Days = new Date(now - 7 * 24 * 60 * 60 * 1000);

        // ── Revenue (single aggregation pass, no full table load into memory) ──
        const [revResult] = await Appointment.aggregate([
            { $match: { paymentStatus: 'paid' } },
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
                }
            }
        ]);
        const totalRevenue = revResult?.total || 0;
        const thisMonthRevenue = revResult?.thisMonth || 0;
        const lastMonthRevenue = revResult?.lastMonth || 0;

        const revenueGrowth = lastMonthRevenue === 0 ? 100
            : Math.round(((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100);

        // ── Revenue by service ──
        const revenueByService = await Appointment.aggregate([
            { $match: { paymentStatus: 'paid' } },
            { $group: { _id: '$service', total: { $sum: '$totalPrice' }, count: { $sum: 1 } } },
            { $lookup: { from: 'services', localField: '_id', foreignField: '_id', as: 'service' } },
            { $unwind: '$service' },
            { $project: { name: '$service.name', total: 1, count: 1 } },
            { $sort: { total: -1 } },
            { $limit: 6 },
        ]);

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
                    revenue: { $sum: '$totalPrice' },
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
                revenue: found ? found.revenue : 0,
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
                revenue: { total: totalRevenue, thisMonth: thisMonthRevenue, lastMonth: lastMonthRevenue, growth: revenueGrowth },
                revenueByService,
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