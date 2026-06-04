const Appointment = require('../models/Appointment');

exports.getRetentionMetrics = async (req, res) => {
    try {
        const providerId = req.user._id;

        const completed = await Appointment.find({
            provider: providerId,
            status: 'completed',
        })
            .populate('customer', 'name email')
            .populate('service', 'name price')
            .sort({ appointmentDate: 1 });

        // Group by customer
        const byCustomer = new Map();
        for (const appt of completed) {
            if (!appt.customer) continue;
            const cid = appt.customer._id.toString();
            if (!byCustomer.has(cid)) {
                byCustomer.set(cid, { customer: appt.customer, dates: [], totalSpend: 0 });
            }
            const c = byCustomer.get(cid);
            c.dates.push(new Date(appt.appointmentDate));
            c.totalSpend += appt.totalPrice || 0;
        }

        const total = byCustomer.size;
        let returningCount = 0;
        let totalDaysBetween = 0;
        let daysBetweenCount = 0;

        const topClients = [];

        for (const [, c] of byCustomer) {
            c.dates.sort((a, b) => a - b);
            if (c.dates.length > 1) {
                returningCount++;
                for (let i = 1; i < c.dates.length; i++) {
                    const diff = (c.dates[i] - c.dates[i - 1]) / (1000 * 60 * 60 * 24);
                    totalDaysBetween += diff;
                    daysBetweenCount++;
                }
            }
            topClients.push({ customer: c.customer, visits: c.dates.length, totalSpend: c.totalSpend, lastVisit: c.dates[c.dates.length - 1] });
        }

        topClients.sort((a, b) => b.totalSpend - a.totalSpend);

        // Rebooking rate: customers who came back within 60 days
        let rebookCount = 0;
        for (const [, c] of byCustomer) {
            if (c.dates.length > 1) {
                const sorted = [...c.dates].sort((a, b) => a - b);
                for (let i = 1; i < sorted.length; i++) {
                    const diff = (sorted[i] - sorted[i - 1]) / (1000 * 60 * 60 * 24);
                    if (diff <= 60) { rebookCount++; break; }
                }
            }
        }
        const rebookingRate = total > 0 ? Math.round((rebookCount / total) * 100) : 0;
        const avgDaysBetween = daysBetweenCount > 0 ? Math.round(totalDaysBetween / daysBetweenCount) : null;

        // New vs returning per month (last 12 months)
        const twelveMonthsAgo = new Date();
        twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
        const recentAppts = completed.filter(a => new Date(a.appointmentDate) >= twelveMonthsAgo);

        // Track first visit date per customer
        const firstVisitByCustomer = {};
        for (const appt of completed) {
            if (!appt.customer) continue;
            const cid = appt.customer._id.toString();
            const d = new Date(appt.appointmentDate);
            if (!firstVisitByCustomer[cid] || d < firstVisitByCustomer[cid]) {
                firstVisitByCustomer[cid] = d;
            }
        }

        const monthMap = {};
        for (const appt of recentAppts) {
            const d = new Date(appt.appointmentDate);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            if (!monthMap[key]) monthMap[key] = { month: key, newClients: 0, returningClients: 0 };
            const cid = appt.customer?._id?.toString();
            const firstVisit = firstVisitByCustomer[cid];
            // If first visit month matches this appointment's month, count as new
            const firstKey = firstVisit ? `${firstVisit.getFullYear()}-${String(firstVisit.getMonth() + 1).padStart(2, '0')}` : null;
            if (firstKey === key) monthMap[key].newClients++;
            else monthMap[key].returningClients++;
        }

        const newVsReturning = Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month));

        res.status(200).json({
            success: true,
            data: {
                totalClients: total,
                returningClients: returningCount,
                newClients: total - returningCount,
                rebookingRate,
                avgDaysBetweenVisits: avgDaysBetween,
                topClients: topClients.slice(0, 10),
                newVsReturning,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
