const Appointment = require('../models/Appointment');

exports.getMyEarnings = async (req, res) => {
    try {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

        // All completed appointments for this provider
        const allCompleted = await Appointment.find({
            provider: req.user._id,
            status: 'completed',
        }).populate('service', 'name price').populate('customer', 'name').sort({ appointmentDate: -1 });

        const totalEarned = allCompleted.reduce((sum, a) => sum + (a.totalPrice || 0), 0);

        const thisMonthEarned = allCompleted
            .filter(a => new Date(a.createdAt) >= startOfMonth)
            .reduce((sum, a) => sum + (a.totalPrice || 0), 0);

        const lastMonthEarned = allCompleted
            .filter(a => new Date(a.createdAt) >= startOfLastMonth && new Date(a.createdAt) <= endOfLastMonth)
            .reduce((sum, a) => sum + (a.totalPrice || 0), 0);

        const growth = lastMonthEarned === 0 ? 100
            : Math.round(((thisMonthEarned - lastMonthEarned) / lastMonthEarned) * 100);

        // Earnings by service
        const earningsByService = {};
        allCompleted.forEach(a => {
            const name = a.service?.name || 'Unknown';
            if (!earningsByService[name]) {
                earningsByService[name] = { name, total: 0, count: 0 };
            }
            earningsByService[name].total += a.totalPrice || 0;
            earningsByService[name].count += 1;
        });

        const earningsByServiceArr = Object.values(earningsByService)
            .sort((a, b) => b.total - a.total);

        // Recent transactions (last 10)
        const recentTransactions = allCompleted.slice(0, 10).map(a => ({
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
                completedCount: allCompleted.length,
                earningsByService: earningsByServiceArr,
                recentTransactions,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};